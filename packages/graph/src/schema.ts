// The one typed graph every StackSketch feature reads or writes.
// Unknown fields stay null: the reviewer asks rather than guesses.

import type { DiagramEdge, DiagramNode } from "./diagram";

export const NODE_TYPES = [
  "client",
  "gateway",
  "service",
  "worker",
  "database",
  "cache",
  "queue",
  "external",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const EDGE_KINDS = ["sync", "async", "stream"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const SOURCES = ["user", "infra", "code", "ai"] as const;
export type Source = (typeof SOURCES)[number];

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  tech: string | null;
  replicas: number | null;
  /** Queues only: whether failed messages land in a dead-letter queue. */
  dlq: boolean | null;
  /** The Excalidraw element this node maps to. */
  canvas_id: string | null;
  source: Source;
  confidence: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  protocol: string | null;
  endpoint: string | null;
  retry: boolean | null;
  timeout_ms: number | null;
  hot_path: boolean | null;
  /** The Excalidraw arrow this edge maps to. */
  canvas_id: string | null;
  source: Source;
  confidence: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const emptyGraph = (): Graph => ({ nodes: [], edges: [] });

/** Fields a person can set on a node from the inspector or by answering a question. */
export const NODE_FIELDS = ["type", "tech", "replicas", "dlq"] as const;
/** Fields a person can set on an edge. */
export const EDGE_FIELDS = ["kind", "protocol", "endpoint", "retry", "timeout_ms", "hot_path"] as const;

export type Severity = "high" | "medium" | "low";

export interface Finding {
  id: string;
  rule: string;
  severity: Severity;
  target: string;
  target_kind: "node" | "edge";
  canvas_id: string | null;
  title: string;
  message: string;
  fix: string;
  /** "rule" for deterministic checks, "llm" for judgement calls. */
  origin: "rule" | "llm";
  /** True once the LLM layer has rewritten the wording for this design. */
  refined: boolean;
}

export interface Question {
  id: string;
  target: string;
  target_kind: "node" | "edge";
  canvas_id: string | null;
  field: string;
  prompt: string;
  /** The rule this answer unblocks. */
  blocks: string;
  answer_type: "boolean" | "number" | "text";
  unit?: string | null;
}

export interface FlowStep {
  index: number;
  edge_id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /** "call" travels caller to callee; "return" is the sync response coming back. */
  phase: "call" | "return";
  depth: number;
  narration: string;
}

export interface Flow {
  id: string;
  node_id: string;
  entry: string;
  steps: FlowStep[];
  summary: string;
  created_at: number;
  created_by: string;
}

// --- board edits: changes the room AI makes, in graph ids (mirrors api/models.py) ------

export interface BoardEdits {
  /** zone: the name of an existing zone to put it in; null puts it beside what it connects to. */
  add_nodes: { id: string; type: NodeType; label: string; tech: string | null; zone: string | null }[];
  /** null fields stay as they are. */
  update_nodes: { id: string; label: string | null; type: NodeType | null; tech: string | null; replicas: number | null; dlq: boolean | null }[];
  remove_nodes: string[];
  add_edges: {
    from_node: string;
    to_node: string;
    kind: EdgeKind;
    protocol: string | null;
    endpoint: string | null;
    retry: boolean | null;
    timeout_ms: number | null;
    hot_path: boolean | null;
  }[];
  update_edges: {
    id: string;
    kind: EdgeKind | null;
    protocol: string | null;
    endpoint: string | null;
    retry: boolean | null;
    timeout_ms: number | null;
    hot_path: boolean | null;
  }[];
  remove_edges: string[];
  /** New zones around these node ids. */
  groups: { label: string; members: string[] }[];
}

/** Diagram changes as data: put these nodes and edges, delete those ids. */
export interface BoardChange {
  put: { nodes: DiagramNode[]; edges: DiagramEdge[] };
  remove: { nodes: string[]; edges: string[] };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  author: string;
  text: string;
  ts: number;
  /** Set on user messages addressed to the AI; the sync server answers "pending" ones. */
  status?: "pending" | "answered" | "error";
  /** On user messages: the browser tab that sent it. That tab applies the AI's edits. */
  tab?: string;
  /** On AI replies: the id of the message being answered. */
  reply_to?: string;
  error?: string;
  /** On AI replies: changes to the board, and whether they are on it. */
  edits?: BoardEdits;
  edit_state?: "proposed" | "applied" | "undone" | "failed";
  /** What the edits did, in a few words, or why they could not be applied. */
  edit_note?: string;
  /** Puts the board back as it was before the edits. */
  edit_undo?: BoardChange;
  /** The nodes the edits added, to show them. */
  edit_ids?: string[];
}

export interface ReviewerStatus {
  state: "idle" | "running" | "refining" | "error";
  at: number;
  llm: boolean;
  error?: string | null;
  rules_ms?: number;
}

export function isNodeType(v: unknown): v is NodeType {
  return typeof v === "string" && (NODE_TYPES as readonly string[]).includes(v);
}

export function isEdgeKind(v: unknown): v is EdgeKind {
  return typeof v === "string" && (EDGE_KINDS as readonly string[]).includes(v);
}

export function isSource(v: unknown): v is Source {
  return typeof v === "string" && (SOURCES as readonly string[]).includes(v);
}

/** Structural validation; returns a list of problems (empty = valid). */
export function validateGraph(g: Graph): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const n of g.nodes) {
    if (!n.id) problems.push("node with empty id");
    if (ids.has(n.id)) problems.push(`duplicate node id ${n.id}`);
    ids.add(n.id);
    if (!isNodeType(n.type)) problems.push(`node ${n.id}: bad type ${String(n.type)}`);
    if (!isSource(n.source)) problems.push(`node ${n.id}: bad source ${String(n.source)}`);
    if (!(n.confidence >= 0 && n.confidence <= 1)) problems.push(`node ${n.id}: confidence out of range`);
    if (n.replicas !== null && !(Number.isInteger(n.replicas) && n.replicas >= 0))
      problems.push(`node ${n.id}: replicas must be a non-negative integer or null`);
  }
  const edgeIds = new Set<string>();
  for (const e of g.edges) {
    if (edgeIds.has(e.id)) problems.push(`duplicate edge id ${e.id}`);
    edgeIds.add(e.id);
    if (!ids.has(e.from)) problems.push(`edge ${e.id}: unknown from ${e.from}`);
    if (!ids.has(e.to)) problems.push(`edge ${e.id}: unknown to ${e.to}`);
    if (!isEdgeKind(e.kind)) problems.push(`edge ${e.id}: bad kind ${String(e.kind)}`);
    if (!isSource(e.source)) problems.push(`edge ${e.id}: bad source ${String(e.source)}`);
    if (e.timeout_ms !== null && !(e.timeout_ms >= 0)) problems.push(`edge ${e.id}: bad timeout_ms`);
  }
  return problems;
}
