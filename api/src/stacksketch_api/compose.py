"""Topology from docker-compose.yml: the first ingestion layer.

Services become nodes, depends_on/links and connection strings in the
environment become edges. Compose says nothing about production replica
counts, so replicas stay null unless deploy.replicas is set.
"""

from __future__ import annotations

import re
from typing import Any

import yaml

from .models import Edge, Graph, Node

TYPE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("database", re.compile(r"postgres|postgis|mysql|mariadb|mongo|cassandra|scylla|cockroach|clickhouse|elasticsearch|opensearch|timescale|influxdb|neo4j|couchdb|dynamodb", re.I)),
    ("cache", re.compile(r"redis|memcached|valkey|keydb|dragonfly", re.I)),
    ("queue", re.compile(r"kafka|redpanda|rabbitmq|nats|activemq|pulsar|localstack|elasticmq|zookeeper", re.I)),
    ("gateway", re.compile(r"nginx|traefik|envoy|haproxy|kong|caddy|apisix|krakend", re.I)),
]
WORKER_RE = re.compile(r"worker|celery|consumer|beat|scheduler|cron|sidekiq|rq\b|dramatiq|processor", re.I)
CLIENT_RE = re.compile(r"^(frontend|front-end|ui|web|webapp|web-app|client|spa|dashboard)$", re.I)
SCHEME_PROTOCOL = {
    "postgres": "SQL", "postgresql": "SQL", "mysql": "SQL", "mariadb": "SQL", "mongodb": "MongoDB",
    "redis": "Redis", "rediss": "Redis", "amqp": "AMQP", "amqps": "AMQP", "nats": "NATS",
    "kafka": "Kafka", "http": "HTTP", "https": "HTTP", "grpc": "gRPC",
}


def _type_for(name: str, svc: dict[str, Any]) -> str:
    image = str(svc.get("image") or "")
    command = svc.get("command") or ""
    if isinstance(command, list):
        command = " ".join(map(str, command))
    for t, pat in TYPE_PATTERNS:
        if pat.search(image) or pat.fullmatch(name) or pat.search(name.split("-")[0]):
            return t
    if WORKER_RE.search(name) or WORKER_RE.search(str(command)):
        return "worker"
    if CLIENT_RE.match(name):
        return "client"
    return "service"


def _env_values(svc: dict[str, Any]) -> list[str]:
    env = svc.get("environment") or {}
    if isinstance(env, dict):
        return [str(v) for v in env.values() if v is not None]
    return [str(item).split("=", 1)[1] for item in env if "=" in str(item)]


def _deps(svc: dict[str, Any]) -> list[str]:
    out: list[str] = []
    dep = svc.get("depends_on") or []
    out += list(dep.keys()) if isinstance(dep, dict) else [str(d) for d in dep]
    out += [str(link).split(":")[0] for link in svc.get("links") or []]
    return out


def graph_from_compose(text: str) -> tuple[Graph, list[str]]:
    data = yaml.safe_load(text)
    if not isinstance(data, dict) or not isinstance(data.get("services"), dict):
        raise ValueError("No services found: is this a docker-compose file?")
    services: dict[str, dict[str, Any]] = {k: (v or {}) for k, v in data["services"].items()}

    nodes: list[Node] = []
    for name, svc in services.items():
        t = _type_for(name, svc)
        image = svc.get("image")
        replicas = (svc.get("deploy") or {}).get("replicas", svc.get("scale"))
        nodes.append(
            Node(
                id=name,
                type=t,  # type: ignore[arg-type]
                label=name.replace("_", " ").replace("-", " ").title() if not image else name,
                tech=str(image) if image else None,
                replicas=int(replicas) if isinstance(replicas, int) else None,
                dlq=None,
                source="infra",
                confidence=0.9 if image or t != "service" else 0.7,
            )
        )
    types = {n.id: n.type for n in nodes}

    edges: dict[tuple[str, str], Edge] = {}
    from_deps = from_env = 0

    def add(src: str, dst: str, protocol: str | None, confidence: float) -> bool:
        if src == dst or dst not in types:
            return False
        # Consumers depend on the broker, but messages flow from the queue to them.
        if types[dst] == "queue" and types[src] == "worker":
            src, dst = dst, src
        kind = "async" if "queue" in (types[src], types[dst]) else "sync"
        key = (src, dst)
        if key in edges:
            if protocol and not edges[key].protocol:
                edges[key].protocol = protocol
            return False
        edges[key] = Edge(
            id=f"{src}->{dst}", from_=src, to=dst, kind=kind, protocol=protocol,
            source="infra", confidence=confidence,
        )
        return True

    host_re = {name: re.compile(rf"(?:^|[/@=,\s]){re.escape(name)}(?::\d+|/|$|,|\s)") for name in services}
    for name, svc in services.items():
        for dep in _deps(svc):
            from_deps += add(name, dep, None, 0.9)
        for value in _env_values(svc):
            scheme = value.split("://", 1)[0].lower() if "://" in value else None
            for other, pat in host_re.items():
                if other != name and pat.search(value):
                    proto = SCHEME_PROTOCOL.get(scheme or "") or ("Kafka" if types[other] == "queue" and "kafka" in other else None)
                    from_env += add(name, other, proto, 0.75)

    notes = [f"{len(nodes)} services from docker-compose; {from_deps} edges from depends_on/links, {from_env} from connection strings in the environment."]

    # Published ports on the edge of the system: something outside calls them.
    published = [n for n in nodes if services[n.id].get("ports") and n.type in ("gateway", "service", "client")]
    entry = [n for n in published if n.type == "gateway"] or [n for n in published if n.type == "client"] or published
    if entry and not any(n.type == "client" for n in nodes):
        nodes.insert(0, Node(id="users", type="client", label="Users", source="infra", confidence=0.5))
        types["users"] = "client"
        for n in entry:
            add("users", n.id, "HTTP", 0.5)
        notes.append("Added a Users client in front of the services that publish ports.")
    elif entry:
        for c in [n for n in nodes if n.type == "client"]:
            for n in [x for x in entry if x.type == "gateway"]:
                add(c.id, n.id, "HTTP", 0.6)

    notes.append("Compose does not say how many replicas run in production, so the reviewer will ask.")
    return Graph(nodes=nodes, edges=list(edges.values())), notes
