"""The LLM layer: judgement calls and wording on top of the rule checks.

Every call returns structured output validated against a Pydantic model, and
every id the model mentions is checked against the graph before it is used.

Two providers: Claude through the Anthropic API, or any model on OpenRouter
(a cheap one keeps testing costs down). The provider comes from
STACKSKETCH_PROVIDER, or from which key is set. Without credentials the API
runs rules-only.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Literal, TypeVar

import anthropic
import httpx
from pydantic import BaseModel, Field, ValidationError

from .models import SEVERITY_RANK, ChatTurn, Edge, Finding, FlowStep, Graph, GraphDiff, Node

log = logging.getLogger("stacksketch.llm")

Provider = Literal["anthropic", "openrouter"]
DEFAULT_MODELS: dict[str, str] = {
    "anthropic": "claude-opus-5-5",
    # Cheap and fast, with strict JSON-schema output and image input.
    "openrouter": "google/gemini-2.5-flash-lite",
}
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
T = TypeVar("T", bound=BaseModel)


class LLMUnavailable(RuntimeError):
    pass


def configured_provider() -> Provider:
    """STACKSKETCH_PROVIDER when set, else OpenRouter if its key is present, else Anthropic."""
    choice = os.environ.get("STACKSKETCH_PROVIDER", "").strip().lower()
    if choice in ("anthropic", "openrouter"):
        return choice  # type: ignore[return-value]
    if choice:
        log.warning("ignoring STACKSKETCH_PROVIDER=%r: use anthropic or openrouter", choice)
    return "openrouter" if os.environ.get("OPENROUTER_API_KEY") else "anthropic"


def credentials_configured(provider: Provider | None = None) -> bool:
    if os.environ.get("STACKSKETCH_LLM", "").lower() in ("0", "off", "false"):
        return False
    if (provider or configured_provider()) == "openrouter":
        return bool(os.environ.get("OPENROUTER_API_KEY"))
    if any(os.environ.get(k) for k in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE")):
        return True
    # A profile saved by `ant auth login` is picked up by the SDK without env vars.
    return (Path.home() / ".config" / "anthropic").is_dir()


def strict_json_schema(model: type[BaseModel]) -> dict[str, Any]:
    """The model's JSON schema in the form strict structured output wants:
    no $refs, every property required, no extra properties."""
    schema = model.model_json_schema()
    defs = schema.pop("$defs", {})

    def fix(node: Any) -> Any:
        if isinstance(node, list):
            return [fix(x) for x in node]
        if not isinstance(node, dict):
            return node
        if "$ref" in node:
            return fix(defs[node["$ref"].rsplit("/", 1)[-1]])
        # Drop the "title" and "default" keywords, but not properties that happen to be called that.
        out = {k: fix(v) for k, v in node.items() if k not in ("title", "default", "properties")}
        if "properties" in node:
            out["properties"] = {name: fix(prop) for name, prop in node["properties"].items()}
        if out.get("type") == "object" and "properties" in out:
            out["required"] = list(out["properties"])
            out["additionalProperties"] = False
        return out

    return fix(schema)


def _text(content: Any) -> str:
    """A reply's text, whether it came back as a string or a list of content parts."""
    if isinstance(content, list):
        return "".join(p.get("text", "") for p in content if isinstance(p, dict)).strip()
    return str(content or "").strip()


def _json_text(content: Any) -> str:
    """The JSON object in a reply, tolerating ```json fences or a sentence around it."""
    text = _text(content)
    if not text.startswith("{"):
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            text = text[start : end + 1]
    return text


# --- structured output shapes ---------------------------------------------------------


class Rewrite(BaseModel):
    finding_id: str
    title: str
    message: str
    fix: str


class Judgement(BaseModel):
    target: str = Field(description="An existing node id or edge id from the graph")
    severity: Literal["high", "medium", "low"]
    slug: str = Field(description="Short kebab-case name for the issue, e.g. 'missing-idempotency'")
    title: str
    message: str
    fix: str


class RefineOutput(BaseModel):
    rewrites: list[Rewrite]
    judgements: list[Judgement]


class Narration(BaseModel):
    lines: list[str]
    summary: str


class GenNode(BaseModel):
    id: str = Field(description="kebab-case id, unique")
    type: Literal["client", "gateway", "service", "worker", "database", "cache", "queue", "external"]
    label: str
    tech: str | None
    replicas: int | None
    dlq: bool | None


class GenEdge(BaseModel):
    from_node: str
    to_node: str
    kind: Literal["sync", "async", "stream"]
    protocol: str | None
    endpoint: str | None
    retry: bool | None
    timeout_ms: int | None
    hot_path: bool | None


class GenGraph(BaseModel):
    nodes: list[GenNode]
    edges: list[GenEdge]
    assumptions: list[str] = Field(description="Short notes on what you assumed, at most 5")


# --- prompts ------------------------------------------------------------------------

REVIEW_SYSTEM = """You are the design reviewer inside StackSketch, an architecture whiteboard used by small engineering teams and solo developers. You read a typed graph of components (nodes) and connections (edges) and help the team catch real design flaws while they draw.

Deterministic rule checks have already run. Their findings are correct about the facts; your job is to make the wording specific to this design and to add judgement calls the rules cannot make.

Rewrites: for each rule finding, rewrite title, message and fix so they name the actual components, endpoints and technologies in this graph and explain the concrete consequence for this system. Keep the facts the rule states. Message: at most 2 sentences. Fix: 1 or 2 sentences with a concrete change, not a list of options.

Judgements: add at most 3 findings for real flaws you can see in the graph that the rules did not cover, for example a missing idempotency key on a retried payment call, a cache with no clear invalidation path in front of a write-heavy store, or an async hop where the user is waiting for the result. Each must target an existing node or edge id. Only add one when you would defend it in a design review; zero is a fine answer. Do not flag missing information: null fields are handled by questions to the team. Do not restate a rule finding.

Write plainly, for engineers. No preamble, no hedging words like "consider" or "might want to"."""

NARRATE_SYSTEM = """You narrate how one request travels through a software architecture, one hop at a time, for a teammate who is new to the system. You get the graph and a list of steps already computed by a graph walk. Rewrite each step's narration as one short sentence (at most 20 words) that says what happens and why it matters at that hop, using the component names. Keep the same number of lines in the same order. "return" steps are the synchronous reply travelling back. Then write a 2-sentence summary of the flow and its riskiest hop."""

GENERATE_SYSTEM = """You turn a product or system idea into a first-draft architecture for StackSketch. Output a typed graph.

Node types: client (browsers, mobile apps, other callers outside the system), gateway (API gateway, load balancer, BFF), service (request-serving backend), worker (background or queue consumer), database, cache, queue (broker, topic or queue), external (third-party API or SaaS).
Edge kinds: sync (caller waits for the reply), async (fire-and-forget message or event), stream (continuous data stream).

Rules:
- Keep it to what a small team would build first: usually 5 to 12 nodes.
- Every edge goes from the caller or producer to the callee or consumer. Queue consumers are edges from the queue to the worker.
- Fill endpoint with the main operation where it is obvious (e.g. "POST /checkout", topic "order.created").
- Leave fields null when the idea does not say: replicas, retry, timeout_ms, dlq and hot_path are usually unknown. Never invent numbers.
- Mark hot_path true only on the edges of the main user-facing request path.
- List assumptions you made in a few short notes."""

SKETCH_PROMPT = "This is a hand-drawn architecture sketch. Read it into the typed graph exactly as drawn: one node per box or shape, one edge per arrow in the direction of the arrowhead. Solid arrows are sync, dashed arrows are async, double or dotted arrows are stream. Use the text on arrows as the endpoint. Do not add components that are not drawn."

CHAT_SYSTEM = """You are the shared AI in a StackSketch room: an architecture whiteboard where a small team designs a system together. Everyone in the room sees your replies. You get the current typed graph, the reviewer's open findings and the room's chat thread. Answer the latest message using the actual components in the graph. Be concise and concrete: a few sentences or a short list. If the graph does not contain what is needed to answer, say what is missing."""


def _graph_json(graph: Graph) -> str:
    def node(n: Node) -> dict:
        d = n.model_dump(exclude={"canvas_id"})
        return {k: v for k, v in d.items() if v is not None}

    def edge(e: Edge) -> dict:
        d = e.model_dump(by_alias=True, exclude={"canvas_id"})
        return {k: v for k, v in d.items() if v is not None}

    return json.dumps({"nodes": [node(n) for n in graph.nodes], "edges": [edge(e) for e in graph.edges]}, indent=1)


class LLM:
    def __init__(self, client: Any = None, model: str | None = None, effort: str | None = None, provider: Provider | None = None):
        """`client` is an AsyncAnthropic for Anthropic, or an httpx.AsyncClient for OpenRouter; built on first use if not given."""
        self.provider: Provider = provider or configured_provider()
        self.model = model or os.environ.get("STACKSKETCH_MODEL") or DEFAULT_MODELS[self.provider]
        self.effort = effort or os.environ.get("STACKSKETCH_EFFORT", "medium")
        self._client = client
        self.enabled = client is not None or credentials_configured(self.provider)

    @property
    def client(self) -> Any:
        if self._client is None:
            if self.provider == "openrouter":
                self._client = httpx.AsyncClient(
                    base_url=OPENROUTER_BASE_URL,
                    headers={"Authorization": f"Bearer {os.environ.get('OPENROUTER_API_KEY', '')}", "X-Title": "StackSketch"},
                    timeout=httpx.Timeout(120, connect=10),
                )
            else:
                self._client = anthropic.AsyncAnthropic()
        return self._client

    def _unavailable(self) -> LLMUnavailable:
        key = "OPENROUTER_API_KEY" if self.provider == "openrouter" else "ANTHROPIC_API_KEY or OPENROUTER_API_KEY"
        return LLMUnavailable(f"No AI credentials configured: set {key} in .env and restart the API.")

    async def _parse(self, system: str, user: str, output: type[T], max_tokens: int = 16000, image: tuple[str, str] | None = None) -> T:
        """One structured call. `image` is (base64 data, media type) for vision input."""
        if not self.enabled:
            raise self._unavailable()
        if self.provider == "openrouter":
            return await self._openrouter_parse(system, user, output, max_tokens, image)
        return await self._anthropic_parse(system, user, output, max_tokens, image)

    # --- Anthropic ---------------------------------------------------------------------------

    async def _anthropic_parse(self, system: str, user: str, output: type[T], max_tokens: int, image: tuple[str, str] | None) -> T:
        content: Any = user
        if image:
            content = [{"type": "image", "source": {"type": "base64", "media_type": image[1], "data": image[0]}}, {"type": "text", "text": user}]
        try:
            resp = await self.client.beta.messages.parse(
                model=self.model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": content}],
                output_format=output,
                output_config={"effort": self.effort},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.AuthenticationError as e:
            raise LLMUnavailable("Claude credentials were rejected.") from e
        except anthropic.RateLimitError as e:
            raise LLMUnavailable("Claude rate limit reached; try again shortly.") from e
        except anthropic.APIStatusError as e:
            raise LLMUnavailable(f"Claude API error {e.status_code}: {e.message}") from e
        except anthropic.APIConnectionError as e:
            raise LLMUnavailable("Could not reach the Claude API.") from e
        if resp.stop_reason == "refusal":
            raise LLMUnavailable("Claude declined this request.")
        if resp.stop_reason == "max_tokens" or resp.parsed_output is None:
            raise LLMUnavailable("Claude's answer was cut off or did not match the schema.")
        return resp.parsed_output

    # --- OpenRouter ---------------------------------------------------------------------------

    async def _openrouter(self, payload: dict[str, Any]) -> dict[str, Any]:
        """POST a chat completion and return the first choice's message, as an LLMUnavailable on any failure."""
        resp: httpx.Response | None = None
        for attempt in range(3):
            try:
                resp = await self.client.post("/chat/completions", json=payload)
            except httpx.TimeoutException as e:
                raise LLMUnavailable("OpenRouter did not answer in time.") from e
            except httpx.TransportError as e:
                if attempt == 2:
                    raise LLMUnavailable("Could not reach OpenRouter.") from e
                await asyncio.sleep(1 + attempt)
                continue
            # Busy or briefly down: try again before giving up.
            if resp.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                await asyncio.sleep(1 + attempt)
                continue
            break
        assert resp is not None
        try:
            body: dict[str, Any] = resp.json()
        except ValueError:
            body = {}
        error = body.get("error")
        message = error.get("message") if isinstance(error, dict) else None
        if resp.status_code == 401:
            raise LLMUnavailable("OpenRouter rejected the API key.")
        if resp.status_code == 402:
            raise LLMUnavailable("The OpenRouter account is out of credits.")
        if resp.status_code == 429:
            raise LLMUnavailable("OpenRouter rate limit reached; try again shortly.")
        if resp.status_code >= 400 or error:
            raise LLMUnavailable(f"OpenRouter error {resp.status_code}: {message or resp.text[:200]}")
        choice = (body.get("choices") or [None])[0]
        if not isinstance(choice, dict):
            raise LLMUnavailable("OpenRouter returned no answer.")
        if isinstance(choice.get("error"), dict):
            raise LLMUnavailable(f"OpenRouter error: {choice['error'].get('message', 'unknown')}")
        reply = choice.get("message") or {}
        if reply.get("refusal") or choice.get("finish_reason") == "content_filter":
            raise LLMUnavailable(f"{self.model} declined this request.")
        if choice.get("finish_reason") == "length":
            raise LLMUnavailable(f"{self.model}'s answer was cut off.")
        return reply

    async def _openrouter_parse(self, system: str, user: str, output: type[T], max_tokens: int, image: tuple[str, str] | None) -> T:
        content: Any = user
        if image:
            content = [{"type": "image_url", "image_url": {"url": f"data:{image[1]};base64,{image[0]}"}}, {"type": "text", "text": user}]
        reply = await self._openrouter(
            {
                "model": self.model,
                # Our outputs are small, and many cheaper models cap output well below 16k tokens.
                "max_tokens": min(max_tokens, 8000),
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": content}],
                "response_format": {
                    "type": "json_schema",
                    "json_schema": {"name": output.__name__, "strict": True, "schema": strict_json_schema(output)},
                },
                # Only route to providers that honour the schema, rather than ones that ignore it.
                "provider": {"require_parameters": True},
            }
        )
        try:
            return output.model_validate_json(_json_text(reply.get("content")))
        except ValidationError as e:
            log.info("%s output did not validate against %s: %s", self.model, output.__name__, e)
            raise LLMUnavailable(f"{self.model}'s answer did not match the expected format.") from e

    # --- reviewer ------------------------------------------------------------------------

    async def refine(self, graph: Graph, diff: GraphDiff | None, findings: list[Finding], not_useful: list[str]) -> list[Finding]:
        rule_findings = [f for f in findings if f.origin == "rule"]
        payload = {
            "graph": json.loads(_graph_json(graph)),
            "changed_since_last_review": diff.model_dump() if diff else None,
            "rule_findings": [f.model_dump(include={"id", "rule", "severity", "target", "title", "message", "fix"}) for f in rule_findings],
            "voted_not_useful_by_team": not_useful,
        }
        user = (
            "Review this design. Focus your judgements on what changed since the last review, but use the whole graph as context.\n"
            "If the team voted findings not useful, avoid advice of that kind.\n\n"
            f"<review_input>\n{json.dumps(payload, indent=1)}\n</review_input>"
        )
        out = await self._parse(REVIEW_SYSTEM, user, RefineOutput)

        by_id = {f.id: f for f in rule_findings}
        refined: dict[str, Finding] = {}
        for r in out.rewrites:
            f = by_id.get(r.finding_id)
            if f and r.message.strip():
                refined[f.id] = f.model_copy(update={"title": r.title.strip() or f.title, "message": r.message.strip(), "fix": r.fix.strip() or f.fix, "refined": True})
        result = [refined.get(f.id, f) for f in rule_findings]

        nodes = {n.id: n for n in graph.nodes}
        edges = {e.id: e for e in graph.edges}
        taken = {f.id for f in result}
        for j in out.judgements[:3]:
            target: Node | Edge | None = nodes.get(j.target) or edges.get(j.target)
            if target is None:
                log.info("dropping judgement on unknown target %s", j.target)
                continue
            slug = "".join(c if c.isalnum() or c == "-" else "-" for c in j.slug.lower()).strip("-")[:40] or "judgement"
            fid = f"llm-{slug}:{target.id}"
            if fid in taken:
                continue
            taken.add(fid)
            result.append(
                Finding(
                    id=fid, rule=f"llm-{slug}", severity=j.severity, target=target.id,
                    target_kind="node" if isinstance(target, Node) else "edge", canvas_id=target.canvas_id,
                    title=j.title.strip(), message=j.message.strip(), fix=j.fix.strip(), origin="llm", refined=True,
                )
            )
        return sorted(result, key=lambda f: (SEVERITY_RANK[f.severity], f.origin != "rule", f.id))

    # --- explainer -----------------------------------------------------------------------

    async def narrate(self, graph: Graph, steps: list[FlowStep], summary: str) -> tuple[list[FlowStep], str]:
        listing = "\n".join(f"{s.index}. [{s.kind} {s.phase}] {s.from_} -> {s.to}: {s.narration}" for s in steps)
        user = f"<graph>\n{_graph_json(graph)}\n</graph>\n\n<steps>\n{listing}\n</steps>\n\nDraft summary: {summary}"
        out = await self._parse(NARRATE_SYSTEM, user, Narration, max_tokens=8000)
        if len(out.lines) != len(steps):
            raise LLMUnavailable("Narration did not match the number of steps.")
        return [s.model_copy(update={"narration": line.strip() or s.narration}) for s, line in zip(steps, out.lines)], out.summary.strip() or summary

    # --- idea to architecture --------------------------------------------------------

    async def generate(self, idea: str) -> tuple[Graph, list[str]]:
        out = await self._parse(GENERATE_SYSTEM, f"<idea>\n{idea}\n</idea>", GenGraph)
        return gen_to_graph(out)

    async def read_sketch(self, image_b64: str, media_type: str) -> tuple[Graph, list[str]]:
        """Phase 0 spike: read a hand-drawn architecture sketch into a graph."""
        out = await self._parse(GENERATE_SYSTEM, SKETCH_PROMPT, GenGraph, image=(image_b64, media_type))
        return gen_to_graph(out)

    # --- room chat -------------------------------------------------------------------------

    async def chat(self, graph: Graph, findings: list[Finding], messages: list[ChatTurn]) -> str:
        if not self.enabled:
            raise self._unavailable()
        context = (
            f"<graph>\n{_graph_json(graph)}\n</graph>\n<open_findings>\n"
            + json.dumps([f.model_dump(include={"severity", "target", "title", "message"}) for f in findings], indent=1)
            + "\n</open_findings>"
        )
        thread = [{"role": "user", "content": context}, {"role": "assistant", "content": "I have the current design and findings."}]
        for m in messages[-30:]:
            content = f"{m.author}: {m.text}" if m.role == "user" and m.author else m.text
            if thread and thread[-1]["role"] == m.role:
                thread[-1]["content"] += "\n\n" + content
            else:
                thread.append({"role": m.role, "content": content})
        if thread[-1]["role"] != "user":
            raise ValueError("The last chat message must be from a user.")
        if self.provider == "openrouter":
            reply = await self._openrouter(
                {"model": self.model, "max_tokens": 4000, "messages": [{"role": "system", "content": CHAT_SYSTEM}, *thread]}
            )
            return _text(reply.get("content"))
        try:
            resp = await self.client.beta.messages.create(
                model=self.model,
                max_tokens=4000,
                system=CHAT_SYSTEM,
                messages=thread,  # type: ignore[arg-type]
                output_config={"effort": "low"},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.APIStatusError as e:
            raise LLMUnavailable(f"Claude API error {e.status_code}: {e.message}") from e
        except anthropic.APIConnectionError as e:
            raise LLMUnavailable("Could not reach the Claude API.") from e
        if resp.stop_reason == "refusal":
            raise LLMUnavailable("Claude declined this request.")
        return "".join(b.text for b in resp.content if b.type == "text").strip()


def gen_to_graph(out: GenGraph) -> tuple[Graph, list[str]]:
    nodes: list[Node] = []
    ids: set[str] = set()
    for n in out.nodes:
        nid = "".join(c if c.isalnum() else "-" for c in n.id.lower()).strip("-") or f"{n.type}-{len(nodes) + 1}"
        base, i = nid, 2
        while nid in ids:
            nid, i = f"{base}-{i}", i + 1
        ids.add(nid)
        nodes.append(
            Node(id=nid, type=n.type, label=n.label or nid, tech=n.tech, replicas=n.replicas if (n.replicas or 0) >= 0 else None,
                 dlq=n.dlq if n.type == "queue" else None, source="ai", confidence=0.6)
        )
    remap = {raw.id: node.id for raw, node in zip(out.nodes, nodes)}
    edges: list[Edge] = []
    seen: set[str] = set()
    notes = list(out.assumptions[:5])
    for e in out.edges:
        src, dst = remap.get(e.from_node), remap.get(e.to_node)
        if not src or not dst or src == dst:
            notes.append(f"Dropped an edge {e.from_node} -> {e.to_node} that referenced an unknown component.")
            continue
        eid, i = f"{src}->{dst}", 2
        while eid in seen:
            eid, i = f"{src}->{dst}#{i}", i + 1
        seen.add(eid)
        edges.append(
            Edge(id=eid, from_=src, to=dst, kind=e.kind, protocol=e.protocol, endpoint=e.endpoint, retry=e.retry,
                 timeout_ms=e.timeout_ms if (e.timeout_ms or 0) >= 0 else None, hot_path=e.hot_path, source="ai", confidence=0.6)
        )
    return Graph(nodes=nodes, edges=edges), notes
