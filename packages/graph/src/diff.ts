import type { Graph, GraphEdge, GraphNode } from "./schema";

export interface GraphDiff {
  added_nodes: string[];
  removed_nodes: string[];
  changed_nodes: string[];
  added_edges: string[];
  removed_edges: string[];
  changed_edges: string[];
}

// canvas_id is a drawing detail; moving or recreating a shape is not a design change.
function nodeKey(n: GraphNode): string {
  const { canvas_id: _c, ...rest } = n;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

function edgeKey(e: GraphEdge): string {
  const { canvas_id: _c, ...rest } = e;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

export function diffGraphs(prev: Graph, next: Graph): GraphDiff {
  const out: GraphDiff = {
    added_nodes: [],
    removed_nodes: [],
    changed_nodes: [],
    added_edges: [],
    removed_edges: [],
    changed_edges: [],
  };
  const pn = new Map(prev.nodes.map((n) => [n.id, n]));
  const nn = new Map(next.nodes.map((n) => [n.id, n]));
  for (const [id, n] of nn) {
    const p = pn.get(id);
    if (!p) out.added_nodes.push(id);
    else if (nodeKey(p) !== nodeKey(n)) out.changed_nodes.push(id);
  }
  for (const id of pn.keys()) if (!nn.has(id)) out.removed_nodes.push(id);

  const pe = new Map(prev.edges.map((e) => [e.id, e]));
  const ne = new Map(next.edges.map((e) => [e.id, e]));
  for (const [id, e] of ne) {
    const p = pe.get(id);
    if (!p) out.added_edges.push(id);
    else if (edgeKey(p) !== edgeKey(e)) out.changed_edges.push(id);
  }
  for (const id of pe.keys()) if (!ne.has(id)) out.removed_edges.push(id);
  return out;
}

export function isEmptyDiff(d: GraphDiff): boolean {
  return Object.values(d).every((v) => v.length === 0);
}

/** Stable fingerprint of the design content, ignoring canvas ids and ordering. */
export function graphFingerprint(g: Graph): string {
  const nodes = g.nodes.map(nodeKey).sort();
  const edges = g.edges.map(edgeKey).sort();
  return JSON.stringify([nodes, edges]);
}
