import pytest

from stacksketch_api.compose import graph_from_compose
from stacksketch_api.explainer import entry_points, explain
from stacksketch_api.models import Graph

from .conftest import edge, node


def test_entry_points(shop):
    entries = entry_points(shop, "api-gw")
    assert [(e.edge_id, e.label) for e in entries] == [("web->api-gw", "POST /checkout (from Web App)")]
    # A client has no callers, so its own requests are the entry points.
    assert [e.edge_id for e in entry_points(shop, "web")] == ["web->api-gw"]
    with pytest.raises(KeyError):
        entry_points(shop, "nope")


def test_checkout_walk(shop):
    steps, summary = explain(shop, "api-gw", "web->api-gw")
    trace = [(s.phase, s.edge_id) for s in steps]
    assert trace == [
        ("call", "web->api-gw"),
        ("call", "api-gw->order-svc"),
        ("call", "order-svc->inventory-svc"),
        ("call", "inventory-svc->orders-db"),
        ("return", "inventory-svc->orders-db"),
        ("return", "order-svc->inventory-svc"),
        ("call", "order-svc->orders-db"),
        ("return", "order-svc->orders-db"),
        ("call", "order-svc->stripe"),
        ("return", "order-svc->stripe"),
        ("call", "order-svc->orders-topic"),
        ("return", "api-gw->order-svc"),
        ("return", "web->api-gw"),
        ("call", "orders-topic->email-worker"),
    ]
    by_edge = {(s.phase, s.edge_id): s.narration for s in steps}
    assert by_edge[("call", "order-svc->stripe")] == "Order Service calls the external Stripe POST /charges and waits for it, with no timeout."
    assert by_edge[("call", "order-svc->orders-topic")].startswith("Order Service publishes order.created to Orders Topic")
    assert by_edge[("call", "inventory-svc->orders-db")] == "Inventory Service writes to Orders DB (Postgres)."
    assert by_edge[("call", "orders-topic->email-worker")].startswith("Later, Email Worker picks up")
    assert "POST /checkout touches 8 components in 8 hops: 6 synchronous" in summary
    assert steps[2].depth == 2


def test_gateway_routes_by_path():
    g = Graph(
        nodes=[node("app", "client"), node("gw", "gateway"), node("orders", "service"), node("users", "service")],
        edges=[
            edge("app", "gw", endpoint="GET /users/42"),
            edge("gw", "orders", endpoint="POST /orders"),
            edge("gw", "users", endpoint="GET /users/{id}"),
        ],
    )
    steps, summary = explain(g, "gw", "app->gw")
    assert {s.to for s in steps if s.phase == "call"} == {"gw", "users"}
    assert "unknown" not in summary


def test_database_hop_uses_its_own_verb():
    g = Graph(
        nodes=[node("app", "client"), node("svc", "service", "Shortener"), node("db", "database", "URL DB"), node("q", "queue", "Clicks"),
               node("worker", "worker", "Analytics Worker"), node("stats", "database", "Stats DB")],
        edges=[
            edge("app", "svc", endpoint="GET /abc"),
            edge("svc", "db", endpoint="INSERT/SELECT"),
            edge("svc", "q", kind="async", endpoint="click"),
            edge("q", "worker", kind="async"),
            edge("worker", "stats", endpoint="INSERT"),
        ],
    )
    steps, _ = explain(g, "svc", "app->svc")
    said = {s.edge_id: s.narration for s in steps if s.phase == "call"}
    # A GET request still writes when the hop says INSERT.
    assert said["svc->db"].startswith("Shortener reads from and writes to URL DB")
    assert said["worker->stats"].startswith("Analytics Worker writes to Stats DB")


def test_explain_rejects_unrelated_entry(shop):
    with pytest.raises(ValueError):
        explain(shop, "stripe", "web->api-gw")


COMPOSE = """
services:
  nginx:
    image: nginx:1.27
    ports: ["80:80"]
    depends_on: [api]
  api:
    build: ./api
    environment:
      DATABASE_URL: postgres://app:secret@db:5432/app
      REDIS_URL: redis://cache:6379/0
      KAFKA_BOOTSTRAP: kafka:9092
    depends_on: [db, cache]
  worker:
    build: ./api
    command: celery -A app worker
    depends_on:
      kafka:
        condition: service_started
      db:
        condition: service_healthy
    deploy:
      replicas: 3
  db:
    image: postgres:16
  cache:
    image: redis:7
  kafka:
    image: bitnami/kafka:3.7
"""


def test_compose_topology():
    g, notes = graph_from_compose(COMPOSE)
    types = {n.id: n.type for n in g.nodes}
    assert types == {"users": "client", "nginx": "gateway", "api": "service", "worker": "worker", "db": "database", "cache": "cache", "kafka": "queue"}
    edges = {e.id: (e.kind, e.protocol) for e in g.edges}
    assert edges == {
        "nginx->api": ("sync", None),
        "api->db": ("sync", "SQL"),
        "api->cache": ("sync", "Redis"),
        "api->kafka": ("async", "Kafka"),
        "kafka->worker": ("async", None),
        "worker->db": ("sync", None),
        "users->nginx": ("sync", "HTTP"),
    }
    assert {n.id: n.replicas for n in g.nodes}["worker"] == 3
    assert all(n.source == "infra" for n in g.nodes)
    assert any("Users" in note for note in notes)


def test_compose_rejects_non_compose():
    with pytest.raises(ValueError):
        graph_from_compose("hello: world")
