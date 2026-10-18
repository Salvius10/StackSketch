// The diagram the editor draws: components, zones, notes and connectors, kept in
// the shared Yjs document. The typed graph the reviewer reads is derived from it:
// components become nodes and connectors become edges, while zones and notes are
// layout. Anything inside a zone is positioned relative to the zone, so it moves
// with it.

import {
  type Box,
  type CanvasElement,
  type DeriveIssue,
  type DeriveResult,
  deriveGraph,
  getMeta,
  inferNodeType,
  parseEdgeLabel,
  slugify,
} from "./derive";
import { type Glyph, ICON_SIZE } from "./icons";
import type { Layout, Point, ZoneKind } from "./layout";
import {
  type EdgeKind,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type NodeType,
  type Source,
  isEdgeKind,
  isNodeType,
  isSource,
} from "./schema";

export type DiagramNodeKind = "component" | "zone" | "note";
export type Side = "top" | "right" | "bottom" | "left";

export interface DiagramNode {
  id: string;
  kind: DiagramNodeKind;
  /** Top-left corner; relative to the parent zone when there is one. */
  x: number;
  y: number;
  /** Size of zones and notes. Components are always icon-sized. */
  w?: number;
  h?: number;
  parent?: string | null;
  /** Component name, zone title or note text. */
  label: string;
  type?: NodeType;
  tech?: string | null;
  replicas?: number | null;
  dlq?: boolean | null;
  origin?: Source;
  confidence?: number;
  /** A specific icon chosen from the shape library; otherwise it follows type and name. */
  icon?: Glyph;
  zone?: ZoneKind;
  /** On a note listing a numbered request flow: that flow's id. */
  legendFor?: string;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  sourceSide?: Side | null;
  targetSide?: Side | null;
  /** Text shown on the connector. Details it mentions fill in fields left unset. */
  label?: string;
  kind?: EdgeKind;
  protocol?: string | null;
  endpoint?: string | null;
  retry?: boolean | null;
  timeout_ms?: number | null;
  hot_path?: boolean | null;
  origin?: Source;
  confidence?: number;
  /** A route from an auto-layout, in canvas coordinates; dropped once an end moves. */
  points?: Point[] | null;
  /** Step numbers, when a request flow is numbered on the diagram. */
  steps?: number[] | null;
}

export interface Diagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export const newDiagramId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const clamp01 = (n: unknown, fallback: number) => (typeof n === "number" && n >= 0 && n <= 1 ? n : fallback);

/** A node's box in canvas coordinates, following its chain of parent zones. */
export function absoluteBox(node: DiagramNode, nodes: ReadonlyMap<string, DiagramNode>): Box {
  let x = node.x;
  let y = node.y;
  const seen = new Set([node.id]);
  let parent = node.parent ? nodes.get(node.parent) : undefined;
  while (parent && !seen.has(parent.id)) {
    seen.add(parent.id);
    x += parent.x;
    y += parent.y;
    parent = parent.parent ? nodes.get(parent.parent) : undefined;
  }
  return { x, y, width: node.kind === "component" ? ICON_SIZE : (node.w ?? ICON_SIZE), height: node.kind === "component" ? ICON_SIZE : (node.h ?? ICON_SIZE) };
}

/** The typed graph a diagram describes. Pure, so every client and the server agree. */
export function deriveFromDiagram(diagram: { nodes: readonly DiagramNode[]; edges: readonly DiagramEdge[] }): DeriveResult {
  const issues: DeriveIssue[] = [];
  const nodes: GraphNode[] = [];
  const idByCanvas = new Map<string, string>();
  const used = new Set<string>();
  const uniqueId = (base: string) => {
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };

  for (const c of diagram.nodes.filter((n) => n.kind === "component").slice().sort(byId)) {
    const label = (c.label ?? "").trim();
    const inferred = inferNodeType(`${label} ${c.tech ?? ""}`);
    const type = isNodeType(c.type) ? c.type : inferred.type;
    const id = uniqueId(slugify(label) || `${type}-${c.id.slice(0, 4).toLowerCase()}`);
    idByCanvas.set(c.id, id);
    nodes.push({
      id,
      type,
      label: label || type,
      tech: c.tech ?? null,
      replicas: c.replicas ?? null,
      dlq: type === "queue" ? (c.dlq ?? null) : null,
      canvas_id: c.id,
      source: isSource(c.origin) ? c.origin : "user",
      confidence: isNodeType(c.type) ? clamp01(c.confidence, 1) : inferred.confidence,
    });
    if (!label) issues.push({ canvas_id: c.id, message: "Component has no name; name it so the reviewer can talk about it." });
  }

  const edges: GraphEdge[] = [];
  const usedEdges = new Set<string>();
  for (const e of diagram.edges.slice().sort(byId)) {
    const from = idByCanvas.get(e.source);
    const to = idByCanvas.get(e.target);
    if (!from || !to) {
      issues.push({ canvas_id: e.id, message: "Connector is not attached to a component at both ends, so it is not part of the graph." });
      continue;
    }
    if (from === to) continue;
    const parsed = parseEdgeLabel(e.label ?? "");
    let id = `${from}->${to}`;
    for (let n = 2; usedEdges.has(id); n++) id = `${from}->${to}#${n}`;
    usedEdges.add(id);
    const pick = <T>(value: T | null | undefined, fallback: T | null): T | null => (value !== undefined ? value : fallback);
    edges.push({
      id,
      from,
      to,
      kind: isEdgeKind(e.kind) ? e.kind : "sync",
      protocol: pick(e.protocol, parsed.protocol),
      endpoint: pick(e.endpoint, parsed.endpoint),
      retry: pick(e.retry, parsed.retry),
      timeout_ms: pick(e.timeout_ms, parsed.timeout_ms),
      hot_path: pick(e.hot_path, parsed.hot_path),
      canvas_id: e.id,
      source: isSource(e.origin) ? e.origin : "user",
      confidence: clamp01(e.confidence, 1),
    });
  }

  // A queue fed into a queue labelled as a dead-letter queue counts as having one.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const src = nodeById.get(e.from);
    const dst = nodeById.get(e.to);
    if (src?.type === "queue" && src.dlq === null && dst && /\b(dlq|dead[- ]?letter)\b/i.test(`${dst.label} ${e.endpoint ?? ""}`)) src.dlq = true;
  }
  return { graph: { nodes, edges }, issues };
}

/** Which sides a connector leaves and enters by, from where the two boxes sit. */
export function sidesBetween(a: Box, b: Box): [Side, Side] {
  const dx = b.x + b.width / 2 - (a.x + a.width / 2);
  const dy = b.y + b.height / 2 - (a.y + a.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

/** Sides from a route: the direction of its first and last segments. */
function sidesOfRoute(route: Point[]): [Side, Side] | null {
  if (route.length < 2) return null;
  const leave = (a: Point, b: Point): Side =>
    Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? (b.x >= a.x ? "right" : "left") : b.y >= a.y ? "bottom" : "top";
  const opposite: Record<Side, Side> = { right: "left", left: "right", top: "bottom", bottom: "top" };
  const n = route.length;
  return [leave(route[0], route[1]), opposite[leave(route[n - 2], route[n - 1])]];
}

/** A laid-out graph as a diagram: zones with their members inside, routed connectors. */
export function diagramFromLayout(graph: Graph, layout: Layout, newId: () => string = newDiagramId): Diagram {
  const zones: DiagramNode[] = layout.zones.map((z) => ({
    id: newId(),
    kind: "zone",
    x: z.box.x,
    y: z.box.y,
    w: z.box.width,
    h: z.box.height,
    label: z.label,
    zone: z.kind,
    parent: null,
  }));
  const zoneOf = new Map<string, DiagramNode>();
  layout.zones.forEach((z, i) => z.members.forEach((m) => zoneOf.set(m, zones[i])));

  const ids = new Map<string, string>();
  const components: DiagramNode[] = [];
  for (const n of graph.nodes) {
    const box = layout.boxes.get(n.id);
    if (!box) continue;
    const id = newId();
    ids.set(n.id, id);
    const zone = zoneOf.get(n.id);
    components.push({
      id,
      kind: "component",
      x: box.x - (zone?.x ?? 0),
      y: box.y - (zone?.y ?? 0),
      parent: zone?.id ?? null,
      label: n.label,
      type: n.type,
      tech: n.tech,
      replicas: n.replicas,
      dlq: n.dlq,
      origin: n.source,
      confidence: n.confidence,
    });
  }

  const edges: DiagramEdge[] = [];
  for (const e of graph.edges) {
    const source = ids.get(e.from);
    const target = ids.get(e.to);
    const a = layout.boxes.get(e.from);
    const b = layout.boxes.get(e.to);
    if (!source || !target || !a || !b) continue;
    const route = layout.routes.get(e.id);
    const [sourceSide, targetSide] = (route && sidesOfRoute(route)) ?? sidesBetween(a, b);
    edges.push({
      id: newId(),
      source,
      target,
      sourceSide,
      targetSide,
      kind: e.kind,
      protocol: e.protocol,
      endpoint: e.endpoint,
      retry: e.retry,
      timeout_ms: e.timeout_ms,
      hot_path: e.hot_path,
      origin: e.source,
      confidence: e.confidence,
      points: route && route.length > 2 ? route : null,
    });
  }
  return { nodes: [...zones, ...components], edges };
}

/** A position for a box: inside the first zone (in `zones`) that holds its centre. */
function placeIn(box: Box, zones: DiagramNode[]): { x: number; y: number; parent: string | null } {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const zone = zones.find((z) => cx >= z.x && cx <= z.x + (z.w ?? 0) && cy >= z.y && cy <= z.y + (z.h ?? 0));
  return zone ? { x: box.x - zone.x, y: box.y - zone.y, parent: zone.id } : { x: box.x, y: box.y, parent: null };
}

const textOf = (el: CanvasElement | undefined) => (el?.originalText ?? el?.text ?? "").trim();

/**
 * Convert a board drawn with the earlier Excalidraw canvas. Components keep their
 * place (sketched shapes become icons at their centre), zones keep their members,
 * free text becomes notes, and connectors keep every detail the reviewer knew.
 */
export function diagramFromElements(elements: readonly CanvasElement[], newId: () => string = newDiagramId): Diagram {
  const live = elements.filter((e) => !e.isDeleted);
  const byElement = new Map(live.map((e) => [e.id, e]));
  const { graph } = deriveGraph(live);
  const grouped = (el: CanvasElement) =>
    live.find((t) => t.type === "text" && t.id !== el.id && !t.containerId && !!el.groupIds?.[0] && t.groupIds?.[0] === el.groupIds[0]);

  const zones: DiagramNode[] = live
    .filter((e) => e.type === "rectangle" && getMeta(e).role === "zone")
    .map((z) => ({
      id: newId(),
      kind: "zone",
      x: z.x,
      y: z.y,
      w: z.width,
      h: z.height,
      label: textOf(grouped(z)) || "System",
      zone: ((z.customData?.stacksketch as { zone?: ZoneKind } | undefined)?.zone ?? "system") as ZoneKind,
      parent: null,
    }));

  const ids = new Map<string, string>();
  const boxes = new Map<string, Box>();
  const components: DiagramNode[] = [];
  for (const n of graph.nodes) {
    const el = n.canvas_id ? byElement.get(n.canvas_id) : undefined;
    if (!el) continue;
    const box: Box =
      el.type === "image"
        ? { x: el.x, y: el.y, width: ICON_SIZE, height: ICON_SIZE }
        : { x: el.x + el.width / 2 - ICON_SIZE / 2, y: el.y + el.height / 2 - ICON_SIZE / 2, width: ICON_SIZE, height: ICON_SIZE };
    const id = newId();
    ids.set(n.id, id);
    boxes.set(n.id, box);
    components.push({
      id,
      kind: "component",
      ...placeIn(box, zones),
      label: n.label,
      type: n.type,
      tech: n.tech,
      replicas: n.replicas,
      dlq: n.dlq,
      origin: n.source,
      confidence: n.confidence,
    });
  }

  const edges: DiagramEdge[] = [];
  for (const e of graph.edges) {
    const source = ids.get(e.from);
    const target = ids.get(e.to);
    if (!source || !target) continue;
    const arrow = e.canvas_id ? byElement.get(e.canvas_id) : undefined;
    const text = arrow ? textOf(live.find((t) => t.type === "text" && t.containerId === arrow.id)) : "";
    const [sourceSide, targetSide] = sidesBetween(boxes.get(e.from)!, boxes.get(e.to)!);
    edges.push({
      id: newId(),
      source,
      target,
      sourceSide,
      targetSide,
      ...(text ? { label: text } : {}),
      kind: e.kind,
      protocol: e.protocol,
      endpoint: e.endpoint,
      retry: e.retry,
      timeout_ms: e.timeout_ms,
      hot_path: e.hot_path,
      origin: e.source,
      confidence: e.confidence,
    });
  }

  // Free text that isn't a name, a zone title or a step list becomes a note.
  const notes: DiagramNode[] = live
    .filter((t) => t.type === "text" && !t.containerId && getMeta(t).role === undefined && textOf(t))
    .map((t) => ({ id: newId(), kind: "note", ...placeIn({ x: t.x, y: t.y, width: t.width, height: t.height }, zones), w: Math.max(t.width + 20, 120), h: t.height + 16, label: textOf(t) }));

  return { nodes: [...zones, ...components, ...notes], edges };
}
