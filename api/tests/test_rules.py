from stacksketch_api.models import Graph
from stacksketch_api.rules import diff_graphs, run_rules

from .conftest import edge, node


def ids(findings):
    return {f.id for f in findings}


def test_shop_findings(shop):
    findings, questions = run_rules(shop)
    assert ids(findings) == {
        "spof-hot-path:order-svc",
        "shared-database:orders-db",
        "external-timeout:order-svc->stripe",
        "queue-retry-dlq:orders-topic",
    }
    by_id = {f.id: f for f in findings}
    assert by_id["spof-hot-path:order-svc"].severity == "high"
    assert by_id["spof-hot-path:order-svc"].canvas_id == "c-order-svc"
    assert by_id["queue-retry-dlq:orders-topic"].title == "Failed messages from Orders Topic are lost"
    assert by_id["external-timeout:order-svc->stripe"].target_kind == "edge"
    # Findings come out most severe first.
    assert [f.severity for f in findings] == sorted((f.severity for f in findings), key=["high", "medium", "low"].index)
    assert questions == []


def test_null_fields_become_questions_not_findings():
    g = Graph(
        nodes=[node("app", "client"), node("svc", "service"), node("pay", "external", "PayPal"), node("q", "queue", "Jobs")],
        edges=[edge("app", "svc"), edge("svc", "pay"), edge("svc", "q", kind="async"), edge("q", "svc", kind="async")],
    )
    findings, questions = run_rules(g)
    assert findings == []
    assert [q.id for q in questions] == ["svc->pay:timeout_ms", "svc:replicas", "q:dlq"]
    assert questions[0].answer_type == "number" and questions[0].unit == "ms"
    # Dismissed questions are not asked again, and at most N are asked at once.
    _, again = run_rules(g, dismissed={"svc:replicas"}, max_questions=1)
    assert [q.id for q in again] == ["svc->pay:timeout_ms"]


def test_explicit_hot_path_limits_spof_check():
    g = Graph(
        nodes=[node("app", "client"), node("a", "service", replicas=1), node("b", "service", replicas=1)],
        edges=[edge("app", "a", hot_path=True), edge("app", "b")],
    )
    findings, questions = run_rules(g)
    assert ids(findings) == {"spof-hot-path:a"}
    assert "treats the synchronous paths" not in findings[0].message


def test_deep_sync_chain():
    names = ["gw", "a", "b", "c", "d"]
    g = Graph(
        nodes=[node("app", "client")] + [node(n, "gateway" if n == "gw" else "service", replicas=2) for n in names],
        edges=[edge("app", "gw")] + [edge(x, y) for x, y in zip(names, names[1:])],
    )
    findings, _ = run_rules(g)
    assert ids(findings) == {"sync-chain-depth:c->d"}
    assert "4 synchronous calls" in findings[0].message
    findings, _ = run_rules(g, depth_limit=4)
    assert findings == []


def test_queue_with_dlq_or_retry():
    base_nodes = [node("svc", "service", replicas=2), node("q", "queue", "Jobs", replicas=3), node("w", "worker", replicas=2)]
    with_dlq = Graph(
        nodes=base_nodes + [node("dlq", "queue", "Jobs DLQ", replicas=3)],
        edges=[edge("svc", "q", kind="async"), edge("q", "w", kind="async"), edge("q", "dlq", kind="async")],
    )
    findings, questions = run_rules(with_dlq)
    assert not any(f.rule == "queue-retry-dlq" for f in findings)
    assert not any(q.blocks == "queue-retry-dlq" for q in questions)

    retry_no_dlq = Graph(
        nodes=[*base_nodes[:1], base_nodes[1].model_copy(update={"dlq": False}), base_nodes[2]],
        edges=[edge("svc", "q", kind="async"), edge("q", "w", kind="async", retry=True)],
    )
    findings, _ = run_rules(retry_no_dlq)
    assert {f.id: f.severity for f in findings if f.rule == "queue-retry-dlq"} == {"queue-retry-dlq:q": "medium"}


def test_extra_checks():
    g = Graph(
        nodes=[node("app", "client"), node("db", "database", replicas=2), node("a", "service", replicas=2), node("b", "service", replicas=2), node("q", "queue", "Events", replicas=3)],
        edges=[edge("app", "db"), edge("app", "a"), edge("a", "b"), edge("b", "a"), edge("a", "q", kind="async")],
    )
    findings, _ = run_rules(g)
    assert {f.rule for f in findings} == {"client-direct-data", "sync-cycle", "queue-no-consumer"}


def test_diff_ignores_canvas_ids(shop):
    moved = shop.model_copy(update={"nodes": [n.model_copy(update={"canvas_id": "x"}) for n in shop.nodes]})
    assert diff_graphs(shop, moved).is_empty()
    changed = shop.model_copy(update={"nodes": [n.model_copy(update={"replicas": 5}) if n.id == "order-svc" else n for n in shop.nodes]})
    assert diff_graphs(shop, changed).changed_nodes == ["order-svc"]
    assert diff_graphs(None, shop).added_nodes == [n.id for n in shop.nodes]
