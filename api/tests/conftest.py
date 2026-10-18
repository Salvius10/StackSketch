from __future__ import annotations

import pytest

from stacksketch_api.models import Edge, Graph, Node


def node(id: str, type: str, label: str | None = None, **kw) -> Node:
    return Node(id=id, type=type, label=label or id, canvas_id=f"c-{id}", **kw)


def edge(src: str, dst: str, kind: str = "sync", **kw) -> Edge:
    return Edge(id=f"{src}->{dst}", from_=src, to=dst, kind=kind, canvas_id=f"a-{src}-{dst}", **kw)


@pytest.fixture
def shop() -> Graph:
    """A checkout flow with a few classic flaws."""
    return Graph(
        nodes=[
            node("web", "client", "Web App"),
            node("api-gw", "gateway", "API Gateway", replicas=2),
            node("order-svc", "service", "Order Service", tech="FastAPI", replicas=1),
            node("inventory-svc", "service", "Inventory Service", replicas=3),
            node("orders-db", "database", "Orders DB", tech="Postgres", replicas=2),
            node("stripe", "external", "Stripe"),
            node("orders-topic", "queue", "Orders Topic", tech="Kafka", replicas=3, dlq=False),
            node("email-worker", "worker", "Email Worker", replicas=2),
        ],
        edges=[
            edge("web", "api-gw", endpoint="POST /checkout", protocol="REST"),
            edge("api-gw", "order-svc", endpoint="POST /checkout", protocol="REST"),
            edge("order-svc", "inventory-svc", endpoint="POST /reserve"),
            edge("order-svc", "orders-db"),
            edge("inventory-svc", "orders-db"),
            edge("order-svc", "stripe", endpoint="POST /charges", timeout_ms=0),
            edge("order-svc", "orders-topic", kind="async", endpoint="order.created"),
            edge("orders-topic", "email-worker", kind="async", retry=False),
        ],
    )
