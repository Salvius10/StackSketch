"""Deterministic reviewer rules.

Rules run first and on every change. They keep the advice tied to the actual
graph; the LLM layer only rewords their findings and adds judgement calls.
A rule never guesses: when a field it needs is null, it asks a question.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable

from .models import SEVERITY_RANK, Edge, Finding, Graph, GraphDiff, Node, Question, Severity

COMPUTE = {"gateway", "service", "worker", "external"}
DATA = {"database", "cache"}
REPLICABLE = {"gateway", "service", "worker", "database", "cache", "queue"}


@dataclass
class Context:
    graph: Graph
    dismissed: set[str]
    depth_limit: int
    nodes: dict[str, Node] = field(init=False)
    out_edges: dict[str, list[Edge]] = field(init=False)
    in_edges: dict[str, list[Edge]] = field(init=False)
    hot_edges: set[str] = field(init=False)
    hot_inferred: bool = field(init=False)

    def __post_init__(self) -> None:
        self.nodes = {n.id: n for n in self.graph.nodes}
        self.out_edges = defaultdict(list)
        self.in_edges = defaultdict(list)
        for e in self.graph.edges:
            self.out_edges[e.from_].append(e)
            self.in_edges[e.to].append(e)
        self.hot_edges, self.hot_inferred = self._hot_path()

    def _hot_path(self) -> tuple[set[str], bool]:
        marked = {e.id for e in self.graph.edges if e.hot_path}
        if marked:
            return marked, False
        # Nothing is marked hot: treat synchronous paths from the entry points as the hot path.
        entries = [n.id for n in self.graph.nodes if n.type == "client"]
        if not entries:
            entries = [n.id for n in self.graph.nodes if n.type == "gateway"]
        if not entries:
            entries = [n.id for n in self.graph.nodes if not self.in_edges.get(n.id)]
        seen_nodes = set(entries)
        hot: set[str] = set()
        stack = list(entries)
        while stack:
            cur = stack.pop()
            for e in self.out_edges.get(cur, []):
                if e.kind != "sync":
                    continue
                hot.add(e.id)
                if e.to not in seen_nodes:
                    seen_nodes.add(e.to)
                    stack.append(e.to)
        return hot, True

    def hot_nodes(self) -> set[str]:
        out: set[str] = set()
        for e in self.graph.edges:
            if e.id in self.hot_edges:
                out.update((e.from_, e.to))
        return out

    def name(self, node_id: str) -> str:
        n = self.nodes.get(node_id)
        return n.label if n else node_id


@dataclass
class RuleOutput:
    findings: list[Finding] = field(default_factory=list)
    questions: list[tuple[Severity, Question]] = field(default_factory=list)


def _finding(rule: str, severity: Severity, target: Node | Edge, title: str, message: str, fix: str) -> Finding:
    kind = "node" if isinstance(target, Node) else "edge"
    return Finding(
        id=f"{rule}:{target.id}",
        rule=rule,
        severity=severity,
        target=target.id,
        target_kind=kind,
        canvas_id=target.canvas_id,
        title=title,
        message=message,
        fix=fix,
    )


def _question(
    ctx: Context,
    out: RuleOutput,
    severity: Severity,
    rule: str,
    target: Node | Edge,
    fld: str,
    prompt: str,
    answer_type: str,
    unit: str | None = None,
) -> None:
    qid = f"{target.id}:{fld}"
    if qid in ctx.dismissed:
        return
    out.questions.append(
        (
            severity,
            Question(
                id=qid,
                target=target.id,
                target_kind="node" if isinstance(target, Node) else "edge",
                canvas_id=target.canvas_id,
                field=fld,
                prompt=prompt,
                blocks=rule,
                answer_type=answer_type,  # type: ignore[arg-type]
                unit=unit,
            ),
        )
    )


# --- starter rules --------------------------------------------------------------------

SPOF_FIX = {
    "database": "Add a standby with automatic failover (managed Postgres/MySQL HA, or a replica set) and send reads to a replica.",
    "cache": "Run the cache with a replica (Redis Sentinel or cluster) and make callers fall back to the source on a miss.",
    "queue": "Run the broker as a cluster of at least 3 with replicated topics or mirrored queues.",
    "gateway": "Run at least 2 gateway instances behind a load balancer, spread across zones.",
}


def spof_hot_path(ctx: Context, out: RuleOutput) -> None:
    hot = ctx.hot_nodes()
    note = " (No edges are marked hot, so StackSketch treats the synchronous paths from your clients as the hot path.)" if ctx.hot_inferred else ""
    for node_id in sorted(hot):
        n = ctx.nodes[node_id]
        if n.type not in REPLICABLE:
            continue
        if n.replicas is None:
            _question(
                ctx, out, "high", "spof-hot-path", n, "replicas",
                f"How many instances of {n.label} run in production?", "number", "instances",
            )
            continue
        if n.replicas <= 1:
            callers = sorted({ctx.name(e.from_) for e in ctx.in_edges.get(n.id, []) if e.id in ctx.hot_edges})
            via = f" Requests from {', '.join(callers)} pass through it." if callers else ""
            out.findings.append(
                _finding(
                    "spof-hot-path", "high", n,
                    f"{n.label} is a single point of failure",
                    f"{n.label} runs as a single instance on the hot path.{via} If it restarts or its host dies, those requests fail until it is back.{note}",
                    SPOF_FIX.get(n.type, "Run at least 2 replicas across zones behind a load balancer, with health checks and a readiness probe."),
                )
            )


def sync_chain_depth(ctx: Context, out: RuleOutput) -> None:
    """Longest run of synchronous calls between compute components."""

    def hop(e: Edge) -> bool:
        src, dst = ctx.nodes[e.from_], ctx.nodes[e.to]
        return e.kind == "sync" and src.type in COMPUTE and dst.type in COMPUTE

    reported: set[str] = set()
    budget = [20000]

    def walk(node_id: str, path: list[Edge], visited: set[str]) -> None:
        budget[0] -= 1
        if budget[0] <= 0:
            return
        extended = False
        for e in ctx.out_edges.get(node_id, []):
            if not hop(e) or e.to in visited:
                continue
            extended = True
            walk(e.to, path + [e], visited | {e.to})
        if not extended and len(path) > ctx.depth_limit:
            offender = path[ctx.depth_limit]
            if offender.id in reported:
                return
            reported.add(offender.id)
            chain = " → ".join([ctx.name(path[0].from_)] + [ctx.name(e.to) for e in path])
            out.findings.append(
                _finding(
                    "sync-chain-depth", "medium", offender,
                    f"{len(path)} synchronous hops in a row",
                    f"A request waits on {len(path)} synchronous calls in sequence: {chain}. Latencies add up, every hop is another failure point, and one slow service stalls the whole chain. The limit is {ctx.depth_limit}.",
                    f"Make the tail asynchronous (have {ctx.name(offender.from_)} publish an event instead of calling {ctx.name(offender.to)}), merge hops that always travel together, or cache what {ctx.name(offender.from_)} needs.",
                )
            )

    starts = [n.id for n in ctx.graph.nodes if n.type in COMPUTE and not any(hop(e) for e in ctx.in_edges.get(n.id, []))]
    for s in starts or [n.id for n in ctx.graph.nodes if n.type in COMPUTE]:
        walk(s, [], {s})


def _is_dlq(n: Node) -> bool:
    return n.type == "queue" and re.search(r"\b(dlq|dead[- ]?letter)\b", n.label, re.I) is not None


def queue_retry_dlq(ctx: Context, out: RuleOutput) -> None:
    for q in ctx.graph.nodes:
        if q.type != "queue":
            continue
        outgoing = ctx.out_edges.get(q.id, [])
        if q.dlq is True or any(_is_dlq(ctx.nodes[e.to]) for e in outgoing):
            continue
        consumers = [e for e in outgoing if not _is_dlq(ctx.nodes[e.to])]
        if not consumers:
            continue
        any_retry = any(e.retry is True for e in consumers)
        unknown_retry = [e for e in consumers if e.retry is None]
        if q.dlq is None:
            _question(
                ctx, out, "medium", "queue-retry-dlq", q, "dlq",
                f"When a consumer fails on a message from {q.label}, does the message go to a dead-letter queue?", "boolean",
            )
            continue
        # dlq is False from here on.
        if any_retry:
            out.findings.append(
                _finding(
                    "queue-retry-dlq", "medium", q,
                    f"{q.label} retries with no dead-letter queue",
                    f"Consumers of {q.label} retry failed messages but there is no dead-letter queue. A message that can never succeed (a poison message) is retried forever, blocks its partition and hides real failures.",
                    "Cap retries (e.g. 5 with backoff) and route messages that still fail to a dead-letter queue with an alert on its depth.",
                )
            )
        elif unknown_retry:
            e = unknown_retry[0]
            _question(
                ctx, out, "high", "queue-retry-dlq", e, "retry",
                f"Does {ctx.name(e.to)} retry when processing a message from {q.label} fails?", "boolean",
            )
        else:
            out.findings.append(
                _finding(
                    "queue-retry-dlq", "high", q,
                    f"Failed messages from {q.label} are lost",
                    f"{q.label} has no dead-letter queue and its consumers do not retry. When processing fails, the message is acknowledged and dropped, and nobody finds out.",
                    "Retry transient failures with backoff, then move the message to a dead-letter queue and alert when it is not empty.",
                )
            )


def shared_database(ctx: Context, out: RuleOutput) -> None:
    for d in ctx.graph.nodes:
        if d.type != "database":
            continue
        users = sorted({e.from_ for e in ctx.in_edges.get(d.id, []) if ctx.nodes[e.from_].type in {"service", "worker", "gateway"}})
        users += sorted({e.to for e in ctx.out_edges.get(d.id, []) if ctx.nodes[e.to].type in {"service", "worker"} and e.to not in users})
        if len(users) < 2:
            continue
        names = ", ".join(ctx.name(u) for u in users)
        out.findings.append(
            _finding(
                "shared-database", "medium", d,
                f"{d.label} is shared by {len(users)} services",
                f"{names} all use {d.label}. A schema change or heavy query from one can break or slow the others, and they cannot be deployed or scaled independently.",
                "Give each service its own schema or database and share data through an API or events. If they must share for now, write down which service owns which tables and give each its own database user.",
            )
        )


def external_timeout(ctx: Context, out: RuleOutput) -> None:
    for e in ctx.graph.edges:
        dst = ctx.nodes[e.to]
        if dst.type != "external" or e.kind != "sync":
            continue
        hot = e.id in ctx.hot_edges
        if e.timeout_ms is None:
            _question(
                ctx, out, "high" if hot else "medium", "external-timeout", e, "timeout_ms",
                f"What timeout does {ctx.name(e.from_)} use when calling {dst.label}? (0 = none)", "number", "ms",
            )
        elif e.timeout_ms == 0:
            caller = ctx.name(e.from_)
            out.findings.append(
                _finding(
                    "external-timeout", "high" if hot else "medium", e,
                    f"No timeout on the call to {dst.label}",
                    f"{caller} calls {dst.label} with no timeout. When {dst.label} hangs, {caller}'s workers wait forever, its pool fills up, and {caller} goes down with it.",
                    f"Set a timeout below {caller}'s own latency budget (2-5 s is typical), add a circuit breaker, and decide what {caller} returns while {dst.label} is down.",
                )
            )


# --- extra checks -------------------------------------------------------------------------


def client_direct_data(ctx: Context, out: RuleOutput) -> None:
    for e in ctx.graph.edges:
        src, dst = ctx.nodes[e.from_], ctx.nodes[e.to]
        if src.type == "client" and dst.type in DATA:
            out.findings.append(
                _finding(
                    "client-direct-data", "high", e,
                    f"{src.label} talks to {dst.label} directly",
                    f"{src.label} connects straight to {dst.label}. Credentials ship to the client, there is no place to enforce authorisation or validation, and the schema becomes a public API.",
                    f"Put a service or gateway in front of {dst.label} and have {src.label} call that instead.",
                )
            )


def sync_cycle(ctx: Context, out: RuleOutput) -> None:
    graph: dict[str, list[Edge]] = {
        n: [e for e in es if e.kind == "sync" and ctx.nodes[e.to].type in COMPUTE] for n, es in ctx.out_edges.items()
    }
    color: dict[str, int] = {}
    seen_cycles: set[frozenset[str]] = set()

    def dfs(u: str, stack: list[Edge]) -> None:
        color[u] = 1
        for e in graph.get(u, []):
            if color.get(e.to) == 1:
                idx = next((i for i, s in enumerate(stack) if s.from_ == e.to), None)
                cycle = (stack[idx:] if idx is not None else []) + [e]
                key = frozenset(c.id for c in cycle)
                if key not in seen_cycles:
                    seen_cycles.add(key)
                    loop = " → ".join([ctx.name(cycle[0].from_)] + [ctx.name(c.to) for c in cycle])
                    out.findings.append(
                        _finding(
                            "sync-cycle", "high", e,
                            "Synchronous call cycle",
                            f"These services call each other synchronously in a loop: {loop}. Under load each waits on the other, threads run out, and retries amplify the traffic.",
                            "Break the loop: have one side publish an event, or move the shared logic into the service both depend on.",
                        )
                    )
            elif color.get(e.to) is None:
                dfs(e.to, stack + [e])
        color[u] = 2

    for n in ctx.graph.nodes:
        if color.get(n.id) is None and n.type in COMPUTE:
            dfs(n.id, [])


def queue_no_consumer(ctx: Context, out: RuleOutput) -> None:
    for q in ctx.graph.nodes:
        if q.type != "queue":
            continue
        has_out = bool(ctx.out_edges.get(q.id))
        pulled = any(ctx.nodes[e.from_].type == "worker" for e in ctx.in_edges.get(q.id, []))
        if not has_out and not pulled and ctx.in_edges.get(q.id):
            out.findings.append(
                _finding(
                    "queue-no-consumer", "low", q,
                    f"Nothing consumes {q.label}",
                    f"Messages are published to {q.label} but no component reads them, so they pile up until retention deletes them.",
                    f"Draw the consumer of {q.label}, or remove the queue if it is not needed yet.",
                )
            )


RULES: dict[str, Callable[[Context, RuleOutput], None]] = {
    "spof-hot-path": spof_hot_path,
    "sync-chain-depth": sync_chain_depth,
    "queue-retry-dlq": queue_retry_dlq,
    "shared-database": shared_database,
    "external-timeout": external_timeout,
    "client-direct-data": client_direct_data,
    "sync-cycle": sync_cycle,
    "queue-no-consumer": queue_no_consumer,
}


def run_rules(
    graph: Graph,
    dismissed: set[str] | None = None,
    depth_limit: int = 3,
    max_questions: int = 3,
) -> tuple[list[Finding], list[Question]]:
    ctx = Context(graph=graph, dismissed=dismissed or set(), depth_limit=depth_limit)
    out = RuleOutput()
    for rule in RULES.values():
        rule(ctx, out)

    findings = {f.id: f for f in out.findings}
    ordered = sorted(findings.values(), key=lambda f: (SEVERITY_RANK[f.severity], f.rule, f.target))

    # Ask about the most severe blocked findings first, at most `max_questions` at a time.
    seen: set[str] = set()
    questions: list[Question] = []
    for _, q in sorted(out.questions, key=lambda sq: (SEVERITY_RANK[sq[0]], sq[1].id)):
        if q.id in seen:
            continue
        seen.add(q.id)
        questions.append(q)
    return ordered, questions[:max_questions]


def diff_graphs(prev: Graph | None, nxt: Graph) -> GraphDiff:
    d = GraphDiff()
    if prev is None:
        d.added_nodes = [n.id for n in nxt.nodes]
        d.added_edges = [e.id for e in nxt.edges]
        return d

    def key(m) -> str:
        data = m.model_dump(by_alias=True)
        data.pop("canvas_id", None)
        return repr(sorted(data.items()))

    pn, nn = {n.id: n for n in prev.nodes}, {n.id: n for n in nxt.nodes}
    pe, ne = {e.id: e for e in prev.edges}, {e.id: e for e in nxt.edges}
    d.added_nodes = sorted(set(nn) - set(pn))
    d.removed_nodes = sorted(set(pn) - set(nn))
    d.changed_nodes = sorted(i for i in set(nn) & set(pn) if key(nn[i]) != key(pn[i]))
    d.added_edges = sorted(set(ne) - set(pe))
    d.removed_edges = sorted(set(pe) - set(ne))
    d.changed_edges = sorted(i for i in set(ne) & set(pe) if key(ne[i]) != key(pe[i]))
    return d
