import json
import os
from types import SimpleNamespace

import httpx
from fastapi.testclient import TestClient

from stacksketch_api.llm import DEFAULT_MODELS, LLM, GenEdge, GenGraph, GenNode, Judgement, Narration, RefineOutput, Rewrite
from stacksketch_api.main import create_app, serve


class FakeMessages:
    """Stands in for client.beta.messages: returns canned structured output."""

    def __init__(self, outputs):
        self.outputs = outputs
        self.calls = []

    async def parse(self, **kwargs):
        self.calls.append(kwargs)
        out = self.outputs[kwargs["output_format"]]
        return SimpleNamespace(stop_reason="end_turn", parsed_output=out)

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text="Order Service is the bottleneck.")])


def fake_llm(outputs) -> tuple[LLM, FakeMessages]:
    messages = FakeMessages(outputs)
    client = SimpleNamespace(beta=SimpleNamespace(messages=messages))
    return LLM(client=client, model="claude-opus-5-5", effort="medium", provider="anthropic"), messages


def openrouter_llm(reply) -> tuple[LLM, list[dict]]:
    """An OpenRouter LLM whose HTTP calls go to `reply(request_body) -> httpx.Response`."""
    sent: list[dict] = []

    def handle(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        sent.append(body)
        return reply(body)

    client = httpx.AsyncClient(base_url="https://openrouter.ai/api/v1", transport=httpx.MockTransport(handle))
    return LLM(client=client, provider="openrouter", model="google/gemini-2.5-flash-lite"), sent


def completion(content: str, finish_reason: str = "stop") -> httpx.Response:
    return httpx.Response(200, json={"choices": [{"finish_reason": finish_reason, "message": {"role": "assistant", "content": content}}]})


def graph_json(shop):
    return shop.model_dump(by_alias=True)


def test_rules_only_without_credentials(shop, monkeypatch):
    monkeypatch.setenv("STACKSKETCH_LLM", "off")
    client = TestClient(create_app())
    assert client.get("/health").json()["llm"] is False

    r = client.post("/review", json={"graph": graph_json(shop)})
    assert r.status_code == 200
    body = r.json()
    assert len(body["findings"]) == 4 and body["questions"] == []
    assert body["diff"]["added_nodes"][0] == "web"

    r = client.post("/review/refine", json={"graph": graph_json(shop), "findings": body["findings"]})
    assert r.json()["llm"] is False and r.json()["findings"] == body["findings"]

    assert client.post("/generate", json={"prompt": "a todo app"}).status_code == 503


def test_explain_endpoints(shop, monkeypatch):
    monkeypatch.setenv("STACKSKETCH_LLM", "off")
    client = TestClient(create_app())
    entries = client.post("/explain/entries", json={"graph": graph_json(shop), "node_id": "api-gw"}).json()["entries"]
    r = client.post("/explain", json={"graph": graph_json(shop), "node_id": "api-gw", "entry_edge_id": entries[0]["edge_id"], "narrate_with_llm": True})
    body = r.json()
    assert body["llm"] is False
    assert body["steps"][0]["from"] == "web" and body["steps"][0]["phase"] == "call"
    assert client.post("/explain", json={"graph": graph_json(shop), "node_id": "api-gw", "entry_edge_id": "nope"}).status_code == 404


def test_refine_validates_llm_output(shop):
    out = RefineOutput(
        rewrites=[
            Rewrite(finding_id="spof-hot-path:order-svc", title="Order Service can take checkout down", message="Checkout fails whenever its one pod restarts.", fix="Run 2 pods across zones."),
            Rewrite(finding_id="made-up", title="x", message="x", fix="x"),
        ],
        judgements=[
            Judgement(target="order-svc->stripe", severity="high", slug="Missing idempotency", title="Charges can double", message="Retried charge calls have no idempotency key.", fix="Send an Idempotency-Key per order."),
            Judgement(target="ghost-node", severity="low", slug="whatever", title="x", message="x", fix="x"),
        ],
    )
    llm, messages = fake_llm({RefineOutput: out})
    client = TestClient(create_app(llm))
    findings = client.post("/review", json={"graph": graph_json(shop)}).json()["findings"]
    r = client.post("/review/refine", json={"graph": graph_json(shop), "findings": findings, "not_useful": ["shared-database:orders-db"]})
    body = r.json()
    assert body["llm"] is True
    by_id = {f["id"]: f for f in body["findings"]}
    assert by_id["spof-hot-path:order-svc"]["title"] == "Order Service can take checkout down"
    assert by_id["spof-hot-path:order-svc"]["refined"] is True
    assert by_id["shared-database:orders-db"]["refined"] is False
    assert "llm-missing-idempotency:order-svc->stripe" in by_id
    assert by_id["llm-missing-idempotency:order-svc->stripe"]["canvas_id"] == "a-order-svc-stripe"
    assert not any("ghost" in f for f in by_id)
    call = messages.calls[0]
    assert call["model"] == "claude-opus-5-5"
    assert call["fallbacks"] == "default" and call["betas"] == ["server-side-fallback-2026-07-01"]
    assert "voted_not_useful_by_team" in call["messages"][0]["content"]


def test_generate_and_narrate(shop):
    gen = GenGraph(
        nodes=[
            GenNode(id="Web", type="client", label="Web", tech=None, replicas=None, dlq=None),
            GenNode(id="api", type="service", label="API", tech="FastAPI", replicas=None, dlq=None),
            GenNode(id="api", type="database", label="DB", tech="Postgres", replicas=None, dlq=None),
        ],
        edges=[
            GenEdge(from_node="Web", to_node="api", kind="sync", protocol="REST", endpoint="POST /todos", retry=None, timeout_ms=None, hot_path=True),
            GenEdge(from_node="api", to_node="missing", kind="sync", protocol=None, endpoint=None, retry=None, timeout_ms=None, hot_path=None),
        ],
        assumptions=["Single region"],
    )
    steps_count = 14
    narration = Narration(lines=[f"line {i}" for i in range(steps_count)], summary="Checkout in short.")
    llm, _ = fake_llm({GenGraph: gen, Narration: narration})
    client = TestClient(create_app(llm))

    r = client.post("/generate", json={"prompt": "A todo app with an API and a database"})
    body = r.json()
    assert [n["id"] for n in body["graph"]["nodes"]] == ["web", "api", "api-2"]
    assert body["graph"]["edges"][0]["from"] == "web" and body["graph"]["edges"][0]["source"] == "ai"
    assert "Single region" in body["notes"]

    r = client.post("/explain", json={"graph": graph_json(shop), "node_id": "api-gw", "entry_edge_id": "web->api-gw", "narrate_with_llm": True})
    body = r.json()
    assert body["llm"] is True and body["steps"][3]["narration"] == "line 3" and body["summary"] == "Checkout in short."


def test_chat(shop):
    llm, messages = fake_llm({})
    client = TestClient(create_app(llm))
    r = client.post("/chat", json={"graph": graph_json(shop), "messages": [{"role": "user", "author": "Mel", "text": "Where is the bottleneck?"}]})
    assert r.json() == {"reply": "Order Service is the bottleneck.", "llm": True}
    sent = messages.calls[0]["messages"]
    assert sent[-1] == {"role": "user", "content": "Mel: Where is the bottleneck?"}


def test_openrouter_structured_output(shop):
    out = RefineOutput(
        rewrites=[Rewrite(finding_id="spof-hot-path:order-svc", title="Order Service can take checkout down", message="One pod.", fix="Run two.")],
        judgements=[],
    )
    # Some models wrap their JSON in a code fence; that still parses.
    llm, sent = openrouter_llm(lambda body: completion(f"```json\n{out.model_dump_json()}\n```"))
    client = TestClient(create_app(llm))
    findings = client.post("/review", json={"graph": graph_json(shop)}).json()["findings"]
    body = client.post("/review/refine", json={"graph": graph_json(shop), "findings": findings}).json()
    assert body["llm"] is True
    assert {f["id"]: f for f in body["findings"]}["spof-hot-path:order-svc"]["title"] == "Order Service can take checkout down"

    request = sent[0]
    assert request["model"] == "google/gemini-2.5-flash-lite"
    assert request["messages"][0]["role"] == "system" and request["messages"][1]["role"] == "user"
    assert request["provider"] == {"require_parameters": True}
    fmt = request["response_format"]
    assert fmt["type"] == "json_schema" and fmt["json_schema"]["name"] == "RefineOutput" and fmt["json_schema"]["strict"] is True
    schema = fmt["json_schema"]["schema"]
    assert "$ref" not in json.dumps(schema) and schema["additionalProperties"] is False
    rewrite = schema["properties"]["rewrites"]["items"]
    assert rewrite["required"] == ["finding_id", "title", "message", "fix"] and rewrite["additionalProperties"] is False


def test_openrouter_failures_become_503(shop):
    cases = [
        (httpx.Response(402, json={"error": {"message": "Insufficient credits", "code": 402}}), "out of credits"),
        (httpx.Response(401, json={"error": {"message": "No auth", "code": 401}}), "rejected the API key"),
        (httpx.Response(404, json={"error": {"message": "No endpoints found that can handle the requested parameters."}}), "No endpoints found"),
        (completion("not json at all"), "did not match the expected format"),
        (completion('{"nodes": [', finish_reason="length"), "cut off"),
    ]
    for response, expected in cases:
        llm, _ = openrouter_llm(lambda body, r=response: r)
        r = TestClient(create_app(llm)).post("/generate", json={"prompt": "a todo app"})
        assert r.status_code == 503 and expected in r.json()["detail"], (expected, r.json())


def test_openrouter_chat(shop):
    llm, sent = openrouter_llm(lambda body: completion("Order Service is the bottleneck."))
    r = TestClient(create_app(llm)).post("/chat", json={"graph": graph_json(shop), "messages": [{"role": "user", "author": "Mel", "text": "Where is the bottleneck?"}]})
    assert r.json() == {"reply": "Order Service is the bottleneck.", "llm": True}
    assert "response_format" not in sent[0]
    assert sent[0]["messages"][0]["role"] == "system" and sent[0]["messages"][-1] == {"role": "user", "content": "Mel: Where is the bottleneck?"}


def test_provider_follows_the_keys(monkeypatch):
    for key in ("STACKSKETCH_PROVIDER", "STACKSKETCH_MODEL", "STACKSKETCH_LLM", "OPENROUTER_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test")
    llm = LLM()
    assert (llm.provider, llm.model, llm.enabled) == ("openrouter", DEFAULT_MODELS["openrouter"], True)
    monkeypatch.setenv("STACKSKETCH_MODEL", "openai/gpt-4.1-nano")
    assert LLM().model == "openai/gpt-4.1-nano"
    monkeypatch.setenv("STACKSKETCH_PROVIDER", "anthropic")
    assert LLM().provider == "anthropic"
    monkeypatch.setenv("STACKSKETCH_LLM", "off")
    monkeypatch.setenv("STACKSKETCH_PROVIDER", "openrouter")
    assert LLM().enabled is False
    health = TestClient(create_app()).get("/health").json()
    assert health["llm"] is False and health["provider"] is None


def test_serve_reads_dotenv(tmp_path, monkeypatch):
    """The uvicorn factory reads .env; variables already in the environment win, empty placeholders are skipped."""
    monkeypatch.setattr(os, "environ", {k: v for k, v in os.environ.items() if not k.startswith(("STACKSKETCH_", "OPENROUTER_", "ANTHROPIC_"))})
    os.environ["STACKSKETCH_EFFORT"] = "high"
    (tmp_path / ".env").write_text("OPENROUTER_API_KEY=sk-or-from-file\nSTACKSKETCH_MODEL=openai/gpt-4.1-nano\nSTACKSKETCH_EFFORT=low\nANTHROPIC_API_KEY=\n")
    monkeypatch.chdir(tmp_path)
    llm = serve().state.llm
    assert (llm.provider, llm.model, llm.effort, llm.enabled) == ("openrouter", "openai/gpt-4.1-nano", "high", True)
    assert "ANTHROPIC_API_KEY" not in os.environ
