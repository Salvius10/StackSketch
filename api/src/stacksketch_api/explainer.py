"""Flow explainer: walk a request through the graph, one narrated hop at a time.

Sync hops are nested calls: the caller waits, so each one gets a matching
"return" step. Async hops are fire-and-forget: they are published during the
request, and what happens downstream is walked after the response goes back.
"""

from __future__ import annotations

import re
from collections import defaultdict, deque

from .models import Edge, EntryPoint, FlowStep, Graph, Node

LEAVES = {"database", "cache", "external"}
MAX_STEPS = 60
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# What a database hop says it does, e.g. "INSERT/SELECT" on the connector.
DB_WRITES = re.compile(r"\b(insert|update|delete|upsert|merge|write|put)\b", re.IGNORECASE)
DB_READS = re.compile(r"\b(select|read|get|query|find)\b", re.IGNORECASE)


def _path(endpoint: str | None) -> tuple[str | None, str | None]:
    if not endpoint:
        return None, None
    parts = endpoint.split()
    if len(parts) >= 2 and parts[0].isupper():
        return parts[0], parts[1]
    return None, parts[0] if parts[0].startswith("/") else None


def _matches(request: str | None, candidate: str | None) -> bool:
    _, rp = _path(request)
    _, cp = _path(candidate)
    if not rp or not cp:
        return request is not None and candidate is not None and request.strip().lower() == candidate.strip().lower()
    if rp == cp:
        return True
    rs = [s for s in rp.split("/") if s]
    cs = [s for s in cp.split("/") if s]
    return bool(rs and cs and rs[0] == cs[0])


def entry_points(graph: Graph, node_id: str) -> list[EntryPoint]:
    node = graph.node(node_id)
    if node is None:
        raise KeyError(node_id)
    names = {n.id: n.label for n in graph.nodes}
    incoming = [e for e in graph.edges if e.to == node_id]
    candidates = incoming if incoming and node.type != "client" else [e for e in graph.edges if e.from_ == node_id]
    out: list[EntryPoint] = []
    seen: set[str] = set()
    for e in candidates:
        what = e.endpoint or e.protocol or "request"
        label = f"{what} (from {names[e.from_]})" if e.to == node_id else f"{what} (to {names[e.to]})"
        if label in seen:
            continue
        seen.add(label)
        out.append(EntryPoint(id=e.id, label=label, edge_id=e.id))
    return out


class _Walker:
    def __init__(self, graph: Graph, entry: Edge):
        self.graph = graph
        self.nodes: dict[str, Node] = {n.id: n for n in graph.nodes}
        self.out: dict[str, list[Edge]] = defaultdict(list)
        for e in graph.edges:
            self.out[e.from_].append(e)
        self.entry = entry
        self.request = entry.endpoint
        method, _ = _path(entry.endpoint)
        self.writes = method in WRITE_METHODS if method else None
        self.steps: list[FlowStep] = []
        self.visited: set[str] = {entry.from_}
        self.deferred: deque[tuple[str, int]] = deque()
        self.unknown_routing: set[str] = set()

    def name(self, node_id: str) -> str:
        return self.nodes[node_id].label

    def add(self, e: Edge, phase: str, depth: int, text: str) -> None:
        if len(self.steps) >= MAX_STEPS:
            return
        self.steps.append(
            FlowStep(index=len(self.steps), edge_id=e.id, from_=e.from_, to=e.to, kind=e.kind, phase=phase, depth=depth, narration=text)
        )

    def next_edges(self, node_id: str) -> list[Edge]:
        outs = [e for e in self.out.get(node_id, []) if e.to not in self.visited]
        node = self.nodes[node_id]
        with_endpoint = [e for e in outs if e.endpoint and e.kind == "sync"]
        if node.type == "gateway" and len(outs) > 1:
            matched = [e for e in with_endpoint if _matches(self.request, e.endpoint)]
            if matched:
                return matched + [e for e in outs if e.kind != "sync"]
            if self.request:
                self.unknown_routing.add(node_id)
        return outs

    def call(self, e: Edge, depth: int) -> None:
        if len(self.steps) >= MAX_STEPS:
            return
        if e.kind != "sync":
            self.add(e, "call", depth, self.narrate_async(e))
            if e.to not in self.visited:
                self.deferred.append((e.to, depth))
                self.visited.add(e.to)
            return
        self.add(e, "call", depth, self.narrate_sync(e))
        target = self.nodes[e.to]
        if e.to not in self.visited:
            self.visited.add(e.to)
            if target.type not in LEAVES:
                outs = self.next_edges(e.to)
                for nxt in [x for x in outs if x.kind == "sync"]:
                    self.call(nxt, depth + 1)
                for nxt in [x for x in outs if x.kind != "sync"]:
                    self.call(nxt, depth + 1)
        self.add(e, "return", depth, self.narrate_return(e))

    def run(self) -> list[FlowStep]:
        self.call(self.entry, 0)
        while self.deferred and len(self.steps) < MAX_STEPS:
            node_id, depth = self.deferred.popleft()
            for nxt in self.next_edges(node_id):
                self.call(nxt, depth + 1)
        return self.steps

    # --- narration --------------------------------------------------------------------

    def _details(self, e: Edge) -> str:
        bits = []
        if e.timeout_ms == 0:
            bits.append("with no timeout")
        elif e.timeout_ms:
            secs = e.timeout_ms / 1000
            bits.append(f"giving up after {secs:g} s" if secs >= 1 else f"giving up after {e.timeout_ms} ms")
        if e.retry:
            bits.append("retrying on failure")
        return f", {' and '.join(bits)}" if bits else ""

    def _db_verb(self, e: Edge) -> str:
        """The hop's own verb when its label names one, else what the request's method implies."""
        said = e.endpoint or ""
        writes, reads = bool(DB_WRITES.search(said)), bool(DB_READS.search(said))
        if writes or reads:
            return "reads from and writes to" if writes and reads else "writes to" if writes else "reads from"
        return "writes to" if self.writes else "reads from" if self.writes is False else "queries"

    def narrate_sync(self, e: Edge) -> str:
        a, b = self.name(e.from_), self.name(e.to)
        target = self.nodes[e.to]
        what = f" {e.endpoint}" if e.endpoint else ""
        over = f" over {e.protocol}" if e.protocol and e.protocol not in (e.endpoint or "") else ""
        if target.type == "database":
            verb = self._db_verb(e)
            tech = f" ({target.tech})" if target.tech else ""
            return f"{a} {verb} {b}{tech}{':' + what if what else ''}{self._details(e)}."
        if target.type == "cache":
            return f"{a} checks {b} for a cached answer{self._details(e)}."
        if target.type == "external":
            return f"{a} calls the external {b}{what}{over} and waits for it{self._details(e)}."
        if e is self.entry:
            return f"{a} sends{what or ' a request'}{over} to {b} and waits for the response{self._details(e)}."
        return f"{a} calls {b}{what}{over} and waits for the reply{self._details(e)}."

    def narrate_async(self, e: Edge) -> str:
        a, b = self.name(e.from_), self.name(e.to)
        src, dst = self.nodes[e.from_], self.nodes[e.to]
        what = e.endpoint or "a message"
        if e.kind == "stream":
            return f"{a} streams {e.endpoint or 'data'} to {b} continuously."
        if dst.type == "queue":
            return f"{a} publishes {what} to {b} and carries on without waiting."
        if src.type == "queue":
            retry = ", retrying if processing fails" if e.retry else ""
            return f"Later, {b} picks up {e.endpoint or 'the message'} from {a}{retry}."
        return f"{a} sends {b} {what} without waiting for an answer."

    def narrate_return(self, e: Edge) -> str:
        a, b = self.name(e.from_), self.name(e.to)
        if e is self.entry:
            return f"{b} returns the response to {a}."
        if self.nodes[e.to].type in LEAVES:
            return f"{b} answers {a}."
        return f"{b} replies to {a}."


def explain(graph: Graph, node_id: str, entry_edge_id: str) -> tuple[list[FlowStep], str]:
    entry = graph.edge(entry_edge_id)
    if entry is None:
        raise KeyError(entry_edge_id)
    if node_id not in (entry.from_, entry.to):
        raise ValueError("entry edge does not touch the selected node")
    walker = _Walker(graph, entry)
    steps = walker.run()

    calls = [s for s in steps if s.phase == "call"]
    sync_calls = [s for s in calls if s.kind == "sync"]
    async_calls = [s for s in calls if s.kind != "sync"]
    touched = {s.from_ for s in calls} | {s.to for s in calls}
    deepest = max((s.depth for s in sync_calls), default=0) + 1
    what = entry.endpoint or f"A request from {walker.name(entry.from_)}"
    summary = (
        f"{what} touches {len(touched)} components in {len(calls)} hops: "
        f"{len(sync_calls)} synchronous (the caller waits) and {len(async_calls)} asynchronous. "
        f"The longest wait chain is {deepest} call{'s' if deepest != 1 else ''} deep."
    )
    if walker.unknown_routing:
        names = ", ".join(walker.name(n) for n in sorted(walker.unknown_routing))
        summary += f" Routing at {names} is unknown, so every route is shown; label its arrows with paths to narrow it."
    if len(steps) >= MAX_STEPS:
        summary += f" The walk stopped after {MAX_STEPS} steps."
    return steps, summary
