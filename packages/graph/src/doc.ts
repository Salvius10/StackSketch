// Layout of the one shared Yjs document. The canvas, the typed graph, the
// reviewer's findings, flows and the room chat all live here, so every user
// (and the server) reads the same state.

import * as Y from "yjs";
import type { CanvasElement, DeriveIssue } from "./derive";
import type { Diagram, DiagramEdge, DiagramNode } from "./diagram";
import type {
  ChatMessage,
  Finding,
  Flow,
  Graph,
  GraphEdge,
  GraphNode,
  Question,
  ReviewerStatus,
} from "./schema";

export const KEYS = {
  /** The diagram: components, zones and notes, and connectors. Written by clients. */
  diagramNodes: "diagram.nodes",
  diagramEdges: "diagram.edges",
  /** Excalidraw elements of boards drawn before the diagram editor; read once to convert them. */
  elements: "elements",
  /** Derived graph. Written by the sync server only. */
  nodes: "graph.nodes",
  edges: "graph.edges",
  /** Reviewer output. Written by the sync server only. */
  findings: "findings",
  questions: "questions",
  /** `${findingId}|${userId}` -> Vote. Written by clients. */
  votes: "votes",
  /** questionId -> { by, at }. Written by clients. */
  dismissed: "dismissed",
  /** Flow explanations by id. */
  flows: "flows",
  /** Room AI thread. */
  chat: "chat",
  /** Board name, reviewer status, derive issues. */
  meta: "meta",
} as const;

export interface Vote {
  finding: string;
  user: string;
  vote: "useful" | "not_useful";
  at: number;
}

export const diagramNodesMap = (doc: Y.Doc) => doc.getMap<DiagramNode>(KEYS.diagramNodes);
export const diagramEdgesMap = (doc: Y.Doc) => doc.getMap<DiagramEdge>(KEYS.diagramEdges);
export const elementsMap = (doc: Y.Doc) => doc.getMap<CanvasElement>(KEYS.elements);
export const nodesMap = (doc: Y.Doc) => doc.getMap<GraphNode>(KEYS.nodes);
export const edgesMap = (doc: Y.Doc) => doc.getMap<GraphEdge>(KEYS.edges);
export const findingsMap = (doc: Y.Doc) => doc.getMap<Finding>(KEYS.findings);
export const questionsMap = (doc: Y.Doc) => doc.getMap<Question>(KEYS.questions);
export const votesMap = (doc: Y.Doc) => doc.getMap<Vote>(KEYS.votes);
export const dismissedMap = (doc: Y.Doc) => doc.getMap<{ by: string; at: number }>(KEYS.dismissed);
export const flowsMap = (doc: Y.Doc) => doc.getMap<Flow>(KEYS.flows);
export const chatArray = (doc: Y.Doc) => doc.getArray<ChatMessage>(KEYS.chat);
export const metaMap = (doc: Y.Doc) => doc.getMap<unknown>(KEYS.meta);

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function readElements(doc: Y.Doc): CanvasElement[] {
  return Array.from(elementsMap(doc).values());
}

export function readDiagram(doc: Y.Doc): Diagram {
  return {
    nodes: Array.from(diagramNodesMap(doc).values()).sort(byId),
    edges: Array.from(diagramEdgesMap(doc).values()).sort(byId),
  };
}

/** Add or replace diagram nodes and edges, and delete others, in one transaction. */
export function writeDiagram(doc: Y.Doc, diagram: Partial<Diagram>, remove: { nodes?: string[]; edges?: string[] } = {}, origin: unknown = null): void {
  doc.transact(() => {
    const nodes = diagramNodesMap(doc);
    const edges = diagramEdgesMap(doc);
    for (const id of remove.edges ?? []) edges.delete(id);
    for (const id of remove.nodes ?? []) nodes.delete(id);
    for (const n of diagram.nodes ?? []) nodes.set(n.id, n);
    for (const e of diagram.edges ?? []) edges.set(e.id, e);
  }, origin);
}

export function readGraph(doc: Y.Doc): Graph {
  return {
    nodes: Array.from(nodesMap(doc).values()).sort(byId),
    edges: Array.from(edgesMap(doc).values()).sort(byId),
  };
}

export function readFindings(doc: Y.Doc): Finding[] {
  return Array.from(findingsMap(doc).values()).sort(byId);
}

export function readQuestions(doc: Y.Doc): Question[] {
  return Array.from(questionsMap(doc).values()).sort(byId);
}

export function readReviewerStatus(doc: Y.Doc): ReviewerStatus | null {
  return (metaMap(doc).get("reviewer") as ReviewerStatus | undefined) ?? null;
}

export function readIssues(doc: Y.Doc): DeriveIssue[] {
  return (metaMap(doc).get("issues") as DeriveIssue[] | undefined) ?? [];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Write only the entries that changed. Returns true if anything was written. */
export function syncMap<T extends { id: string }>(map: Y.Map<T>, items: readonly T[]): boolean {
  let changed = false;
  const next = new Map(items.map((i) => [i.id, i]));
  for (const key of Array.from(map.keys())) {
    if (!next.has(key)) {
      map.delete(key);
      changed = true;
    }
  }
  for (const [id, item] of next) {
    if (!same(map.get(id), item)) {
      map.set(id, item);
      changed = true;
    }
  }
  return changed;
}

export function writeGraph(doc: Y.Doc, graph: Graph, origin: unknown = null): boolean {
  let changed = false;
  doc.transact(() => {
    const a = syncMap(nodesMap(doc), graph.nodes);
    const b = syncMap(edgesMap(doc), graph.edges);
    changed = a || b;
  }, origin);
  return changed;
}

/** Votes per finding: useful minus not useful. */
export function voteTally(doc: Y.Doc): Map<string, { useful: number; not_useful: number }> {
  const out = new Map<string, { useful: number; not_useful: number }>();
  for (const v of votesMap(doc).values()) {
    const t = out.get(v.finding) ?? { useful: 0, not_useful: 0 };
    t[v.vote] += 1;
    out.set(v.finding, t);
  }
  return out;
}
