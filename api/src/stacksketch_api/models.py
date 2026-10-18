"""Pydantic mirror of the shared graph schema (packages/graph/src/schema.ts)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

NodeType = Literal["client", "gateway", "service", "worker", "database", "cache", "queue", "external"]
EdgeKind = Literal["sync", "async", "stream"]
Source = Literal["user", "infra", "code", "ai"]
Severity = Literal["high", "medium", "low"]

SEVERITY_RANK: dict[str, int] = {"high": 0, "medium": 1, "low": 2}


class Node(BaseModel):
    id: str
    type: NodeType
    label: str
    tech: str | None = None
    replicas: int | None = Field(default=None, ge=0)
    dlq: bool | None = None
    canvas_id: str | None = None
    source: Source = "user"
    confidence: float = Field(default=1.0, ge=0, le=1)


class Edge(BaseModel):
    id: str
    from_: str = Field(alias="from")
    to: str
    kind: EdgeKind = "sync"
    protocol: str | None = None
    endpoint: str | None = None
    retry: bool | None = None
    timeout_ms: int | None = Field(default=None, ge=0)
    hot_path: bool | None = None
    canvas_id: str | None = None
    source: Source = "user"
    confidence: float = Field(default=1.0, ge=0, le=1)

    model_config = {"populate_by_name": True}


class Graph(BaseModel):
    nodes: list[Node] = []
    edges: list[Edge] = []

    @model_validator(mode="after")
    def _referential_integrity(self) -> "Graph":
        ids = [n.id for n in self.nodes]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate node ids")
        known = set(ids)
        for e in self.edges:
            if e.from_ not in known or e.to not in known:
                raise ValueError(f"edge {e.id} references an unknown node")
        return self

    def node(self, node_id: str) -> Node | None:
        return next((n for n in self.nodes if n.id == node_id), None)

    def edge(self, edge_id: str) -> Edge | None:
        return next((e for e in self.edges if e.id == edge_id), None)

    def dump(self) -> dict:
        return self.model_dump(by_alias=True)


class Finding(BaseModel):
    id: str
    rule: str
    severity: Severity
    target: str
    target_kind: Literal["node", "edge"]
    canvas_id: str | None = None
    title: str
    message: str
    fix: str
    origin: Literal["rule", "llm"] = "rule"
    refined: bool = False


class Question(BaseModel):
    id: str
    target: str
    target_kind: Literal["node", "edge"]
    canvas_id: str | None = None
    field: str
    prompt: str
    blocks: str
    answer_type: Literal["boolean", "number", "text"]
    unit: str | None = None


class GraphDiff(BaseModel):
    added_nodes: list[str] = []
    removed_nodes: list[str] = []
    changed_nodes: list[str] = []
    added_edges: list[str] = []
    removed_edges: list[str] = []
    changed_edges: list[str] = []

    def is_empty(self) -> bool:
        return not any(getattr(self, f) for f in type(self).model_fields)


# --- requests / responses ---------------------------------------------------------


class ReviewRequest(BaseModel):
    graph: Graph
    previous: Graph | None = None
    dismissed_questions: list[str] = []
    max_questions: int = Field(default=3, ge=0, le=10)
    sync_depth_limit: int = Field(default=3, ge=1, le=10)


class ReviewResponse(BaseModel):
    findings: list[Finding]
    questions: list[Question]
    diff: GraphDiff
    rules_run: list[str]


class RefineRequest(BaseModel):
    graph: Graph
    diff: GraphDiff | None = None
    findings: list[Finding]
    not_useful: list[str] = []
    """Finding ids the team voted not useful: the LLM should avoid advice like these."""


class RefineResponse(BaseModel):
    findings: list[Finding]
    llm: bool
    model: str | None = None


class EntryPoint(BaseModel):
    id: str
    label: str
    edge_id: str


class EntriesRequest(BaseModel):
    graph: Graph
    node_id: str


class EntriesResponse(BaseModel):
    entries: list[EntryPoint]


class FlowStep(BaseModel):
    index: int
    edge_id: str
    from_: str = Field(alias="from")
    to: str
    kind: EdgeKind
    phase: Literal["call", "return"]
    depth: int
    narration: str

    model_config = {"populate_by_name": True}


class ExplainRequest(BaseModel):
    graph: Graph
    node_id: str
    entry_edge_id: str
    narrate_with_llm: bool = False


class ExplainResponse(BaseModel):
    steps: list[FlowStep]
    summary: str
    llm: bool


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=4000)


class GraphResponse(BaseModel):
    graph: Graph
    notes: list[str] = []


class ComposeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500_000)


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    author: str = ""
    text: str


class ChatRequest(BaseModel):
    graph: Graph
    findings: list[Finding] = []
    messages: list[ChatTurn]


class ChatResponse(BaseModel):
    reply: str
    llm: bool
