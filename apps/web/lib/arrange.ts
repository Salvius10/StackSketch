// Editing operations that touch several elements at once: auto layout, placing
// an imported or generated graph, zones (group, ungroup, drop into), alignment,
// the clipboard, quick-add and numbered request flows. Each applies its changes
// through the model as one undo step.

import {
  type Box,
  type Diagram,
  type DiagramEdge,
  type DiagramNode,
  type DrawioZone,
  type Flow,
  type Graph,
  ICON_SIZE,
  type Layout,
  type LayoutGroup,
  type Side,
  absoluteBox,
  deriveFromDiagram,
  diagramFromLayout,
  layoutGraph,
  newDiagramId,
  sidesBetween,
} from "@stacksketch/graph";
import type { DiagramActions } from "./diagram";

export const GRID = 10;
export const snap = (v: number) => Math.round(v / GRID) * GRID;

/** Room a component needs below its icon for the name and technology. */
export const NAME_SPACE = 44;

type NodeMap = ReadonlyMap<string, DiagramNode>;

const byIdOf = (diagram: Diagram): NodeMap => new Map(diagram.nodes.map((n) => [n.id, n]));

/** A node's box including the name under a component's icon. */
export function footprint(node: DiagramNode, byId: NodeMap): Box {
  const box = absoluteBox(node, byId);
  return node.kind === "component" ? { x: box.x - 24, y: box.y, width: box.width + 48, height: box.height + NAME_SPACE } : box;
}

export function union(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

export function contentBounds(diagram: Diagram): Box | null {
  const byId = byIdOf(diagram);
  return union(diagram.nodes.map((n) => footprint(n, byId)));
}

export const overlaps = (a: Box, b: Box, gap = 0) =>
  a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

/** Every node inside `id`, at any depth. */
export function descendants(id: string, diagram: Diagram): Set<string> {
  const out = new Set<string>();
  let frontier = [id];
  while (frontier.length) {
    const next = diagram.nodes.filter((n) => n.parent && frontier.includes(n.parent) && !out.has(n.id)).map((n) => n.id);
    next.forEach((n) => out.add(n));
    frontier = next;
  }
  return out;
}

/** The innermost zone holding a point, ignoring `skip` and everything inside it. */
export function zoneAt(point: { x: number; y: number }, diagram: Diagram, skip: Set<string> = new Set()): DiagramNode | null {
  const byId = byIdOf(diagram);
  const excluded = new Set(skip);
  for (const id of skip) descendants(id, diagram).forEach((d) => excluded.add(d));
  let best: { zone: DiagramNode; area: number } | null = null;
  for (const z of diagram.nodes) {
    if (z.kind !== "zone" || excluded.has(z.id)) continue;
    const b = absoluteBox(z, byId);
    if (point.x < b.x || point.x > b.x + b.width || point.y < b.y || point.y > b.y + b.height) continue;
    const area = b.width * b.height;
    if (!best || area < best.area) best = { zone: z, area };
  }
  return best?.zone ?? null;
}

/** Position of an absolute point relative to a parent zone (or the canvas). */
function relativeTo(abs: { x: number; y: number }, parent: DiagramNode | null | undefined, byId: NodeMap) {
  if (!parent) return { x: snap(abs.x), y: snap(abs.y) };
  const p = absoluteBox(parent, byId);
  return { x: snap(abs.x - p.x), y: snap(abs.y - p.y) };
}

/** Only the outermost of the given nodes: moving a zone already moves what's inside. */
function outermost(ids: string[], diagram: Diagram): DiagramNode[] {
  const byId = byIdOf(diagram);
  const set = new Set(ids);
  return ids
    .map((id) => byId.get(id))
    .filter((n): n is DiagramNode => !!n)
    .filter((n) => {
      let p = n.parent ? byId.get(n.parent) : undefined;
      const seen = new Set<string>();
      while (p && !seen.has(p.id)) {
        if (set.has(p.id)) return false;
        seen.add(p.id);
        p = p.parent ? byId.get(p.parent) : undefined;
      }
      return true;
    });
}

// --- placing new things -----------------------------------------------------------

/** The first spot near `at` where a component doesn't overlap anything (zones don't count). */
export function freeSpot(at: { x: number; y: number }, diagram: Diagram): { x: number; y: number } {
  const byId = byIdOf(diagram);
  const taken = diagram.nodes.filter((n) => n.kind !== "zone").map((n) => footprint(n, byId));
  const start = { x: snap(at.x - ICON_SIZE / 2), y: snap(at.y - ICON_SIZE / 2) };
  const box = (x: number, y: number): Box => ({ x: x - 24, y, width: ICON_SIZE + 48, height: ICON_SIZE + NAME_SPACE });
  for (let i = 0; i < 80; i++) {
    const x = start.x + (i % 6) * 140;
    const y = start.y + Math.floor(i / 6) * 130;
    if (!taken.some((t) => overlaps(box(x, y), t, 16))) return { x, y };
  }
  return start;
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/** draw.io's blue arrows: a copy of a component on one side, connected to it. */
export function addConnected(fromId: string, side: Side, diagram: Diagram, actions: DiagramActions, kind: DiagramEdge["kind"]): string | null {
  const byId = byIdOf(diagram);
  const from = byId.get(fromId);
  if (!from || from.kind !== "component") return null;
  const step = { right: [180, 0], left: [-180, 0], bottom: [0, 150], top: [0, -150] }[side];
  const node: DiagramNode = {
    id: newDiagramId(),
    kind: "component",
    x: snap(from.x + step[0]),
    y: snap(from.y + step[1]),
    parent: from.parent ?? null,
    label: from.label,
    type: from.type,
    icon: from.icon,
    origin: "user",
    confidence: 1,
  };
  const edge: DiagramEdge = { id: newDiagramId(), source: from.id, target: node.id, sourceSide: side, targetSide: OPPOSITE[side], kind };
  actions.put({ nodes: [node], edges: [edge] });
  return node.id;
}

/** Shift top-level nodes (and routes) so the drawing's top-left lands at `to`. */
function moveTo(fresh: Diagram, to: { x: number; y: number }): Diagram {
  const top = fresh.nodes.filter((n) => !n.parent);
  const from = union(top.map((n) => ({ x: n.x, y: n.y, width: 1, height: 1 })));
  if (!from) return fresh;
  const dx = snap(to.x - from.x);
  const dy = snap(to.y - from.y);
  return {
    nodes: fresh.nodes.map((n) => (n.parent ? n : { ...n, x: n.x + dx, y: n.y + dy })),
    edges: fresh.edges.map((e) => (e.points ? { ...e, points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : e)),
  };
}

/**
 * Add a whole graph to the right of what's on the canvas: laid out in zones, or
 * at the positions a .drawio file gave (icons keep each box's centre).
 */
export async function insertGraph(
  graph: Graph,
  diagram: Diagram,
  actions: DiagramActions,
  options: { boxes?: Map<string, Box>; systemName?: string } = {},
): Promise<string[]> {
  const given = options.boxes && graph.nodes.length > 0 && graph.nodes.every((n) => options.boxes!.has(n.id));
  const layout: Layout = given
    ? {
        boxes: new Map(
          [...options.boxes!].map(([id, b]) => [id, { x: b.x + b.width / 2 - ICON_SIZE / 2, y: b.y + b.height / 2 - ICON_SIZE / 2, width: ICON_SIZE, height: ICON_SIZE }]),
        ),
        routes: new Map(),
        zones: [],
      }
    : await layoutGraph(graph, { systemName: options.systemName });
  const bounds = contentBounds(diagram);
  const fresh = moveTo(diagramFromLayout(graph, layout), bounds ? { x: bounds.x + bounds.width + 160, y: bounds.y } : { x: 40, y: 40 });
  actions.put(fresh);
  return fresh.nodes.map((n) => n.id);
}

// --- auto layout ----------------------------------------------------------------------

/**
 * Lay the whole diagram out again, left to right. Zones you drew stay zones, with
 * their components inside; a diagram with none gets clients / system / external
 * zones. Notes stay where they are. Returns how many components were placed.
 */
export async function autoLayout(diagram: Diagram, actions: DiagramActions, systemName?: string): Promise<number> {
  const { graph } = deriveFromDiagram(diagram);
  if (graph.nodes.length === 0) return 0;
  const byId = byIdOf(diagram);
  const canvasOf = new Map(graph.nodes.map((n) => [n.id, n.canvas_id!]));

  const outerZone = (n: DiagramNode): DiagramNode | null => {
    let zone: DiagramNode | null = null;
    let p = n.parent ? byId.get(n.parent) : undefined;
    const seen = new Set<string>();
    while (p && !seen.has(p.id)) {
      seen.add(p.id);
      if (p.kind === "zone") zone = p;
      p = p.parent ? byId.get(p.parent) : undefined;
    }
    return zone;
  };
  const zones = diagram.nodes.filter((n) => n.kind === "zone");
  let groups: LayoutGroup[] | undefined;
  if (zones.length > 0) {
    const members = new Map<string, string[]>();
    for (const g of graph.nodes) {
      const z = outerZone(byId.get(g.canvas_id!)!);
      if (z) members.set(z.id, [...(members.get(z.id) ?? []), g.id]);
    }
    groups = zones.filter((z) => !z.parent && members.has(z.id)).map((z) => ({ id: z.id, kind: z.zone ?? "system", label: z.label, members: members.get(z.id)! }));
  }
  const layout = await layoutGraph(graph, groups ? { groups } : { systemName });

  // Keep the drawing where it was on the canvas.
  const before = union([...graph.nodes.map((g) => absoluteBox(byId.get(g.canvas_id!)!, byId)), ...zones.filter((z) => !z.parent).map((z) => absoluteBox(z, byId))]);
  const after = union([...layout.boxes.values(), ...layout.zones.map((z) => z.box)]);
  const dx = before && after ? snap(before.x - after.x) : 0;
  const dy = before && after ? snap(before.y - after.y) : 0;
  const shift = <T extends { x: number; y: number }>(p: T): T => ({ ...p, x: p.x + dx, y: p.y + dy });

  // Zone boxes in canvas coordinates: laid-out ones, and any new ones for a diagram without zones.
  const zoneBox = new Map<string, Box>();
  const created: DiagramNode[] = [];
  const memberZone = new Map<string, string>();
  for (const z of layout.zones) {
    const box = shift(z.box);
    const id = z.id ?? newDiagramId();
    zoneBox.set(id, box);
    if (!z.id) created.push({ id, kind: "zone", x: box.x, y: box.y, w: box.width, h: box.height, label: z.label, zone: z.kind, parent: null });
    for (const m of z.members) memberZone.set(m, id);
  }

  const nodePatches: { id: string; patch: Partial<DiagramNode> }[] = [];
  for (const [id, box] of zoneBox) {
    if (byId.has(id)) nodePatches.push({ id, patch: { x: box.x, y: box.y, w: snap(box.width), h: snap(box.height), parent: null } });
  }
  // Components: placed in their outer zone, or in a nested zone resized around them below.
  const iconAt = new Map<string, Box>();
  for (const g of graph.nodes) {
    const box = layout.boxes.get(g.id);
    if (box) iconAt.set(canvasOf.get(g.id)!, shift(box));
  }
  const nested = zones.filter((z) => z.parent);
  const nestedBox = new Map<string, Box>();
  for (const z of nested) {
    const inside = [...descendants(z.id, diagram)].map((id) => iconAt.get(id)).filter((b): b is Box => !!b);
    const b = union(inside.map((i) => ({ x: i.x - 30, y: i.y - 40, width: i.width + 60, height: i.height + NAME_SPACE + 60 })));
    if (b) nestedBox.set(z.id, b);
  }
  const absOf = (id: string | null | undefined): { x: number; y: number } | null => {
    if (!id) return null;
    return nestedBox.get(id) ?? zoneBox.get(id) ?? (byId.get(id) ? absoluteBox(byId.get(id)!, byId) : null);
  };
  for (const z of nested) {
    const b = nestedBox.get(z.id);
    const parentAbs = absOf(z.parent);
    if (b && parentAbs) nodePatches.push({ id: z.id, patch: { x: snap(b.x - parentAbs.x), y: snap(b.y - parentAbs.y), w: snap(b.width), h: snap(b.height) } });
  }
  for (const g of graph.nodes) {
    const canvasId = canvasOf.get(g.id)!;
    const box = iconAt.get(canvasId);
    if (!box) continue;
    const node = byId.get(canvasId)!;
    const fresh = memberZone.get(g.id);
    // A component keeps a nested zone it was in; otherwise it goes in the zone the layout chose.
    const parent = node.parent && nestedBox.has(node.parent) ? node.parent : (fresh ?? null);
    const parentAbs = absOf(parent);
    nodePatches.push({ id: canvasId, patch: { parent, x: snap(box.x - (parentAbs?.x ?? 0)), y: snap(box.y - (parentAbs?.y ?? 0)) } });
  }

  const edgePatches: { id: string; patch: Partial<DiagramEdge> }[] = [];
  for (const e of graph.edges) {
    if (!e.canvas_id) continue;
    const route = layout.routes.get(e.id);
    const a = layout.boxes.get(e.from);
    const b = layout.boxes.get(e.to);
    if (!a || !b) continue;
    const points = route && route.length > 2 ? route.map(shift) : null;
    const [sourceSide, targetSide] = sidesFor(route) ?? sidesBetween(a, b);
    edgePatches.push({ id: e.canvas_id, patch: { sourceSide, targetSide, points } });
  }

  actions.batch(() => {
    if (created.length) actions.put({ nodes: created });
    actions.patchNodes(nodePatches);
    actions.patchEdges(edgePatches);
  });
  return graph.nodes.length;
}

function sidesFor(route: { x: number; y: number }[] | undefined): [Side, Side] | null {
  if (!route || route.length < 2) return null;
  const dir = (a: { x: number; y: number }, b: { x: number; y: number }): Side =>
    Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? (b.x >= a.x ? "right" : "left") : b.y >= a.y ? "bottom" : "top";
  const n = route.length;
  return [dir(route[0], route[1]), OPPOSITE[dir(route[n - 2], route[n - 1])]];
}

// --- zones ----------------------------------------------------------------------------

/** Put the selection in a new zone around it (Ctrl+G). Returns the zone id. */
export function groupInZone(ids: string[], diagram: Diagram, actions: DiagramActions, label = "Group"): string | null {
  const byId = byIdOf(diagram);
  const picked = outermost(ids, diagram);
  if (picked.length === 0) return null;
  const parents = new Set(picked.map((n) => n.parent ?? null));
  const parent = parents.size === 1 ? [...parents][0] : null;
  const bounds = union(picked.map((n) => footprint(n, byId)))!;
  const abs = { x: snap(bounds.x - 30), y: snap(bounds.y - 52), width: snap(bounds.width + 60), height: snap(bounds.height + 88) };
  const parentNode = parent ? byId.get(parent) : null;
  const rel = relativeTo(abs, parentNode, byId);
  const zone: DiagramNode = { id: newDiagramId(), kind: "zone", ...rel, w: abs.width, h: abs.height, label, zone: "system", parent };
  actions.batch(() => {
    actions.put({ nodes: [zone] });
    actions.patchNodes(
      picked.map((n) => {
        const b = absoluteBox(n, byId);
        return { id: n.id, patch: { parent: zone.id, x: snap(b.x - abs.x), y: snap(b.y - abs.y) } };
      }),
    );
  });
  return zone.id;
}

/** Remove a zone but keep what was inside it, in place. */
export function ungroup(zoneId: string, diagram: Diagram, actions: DiagramActions): void {
  const byId = byIdOf(diagram);
  const zone = byId.get(zoneId);
  if (!zone || zone.kind !== "zone") return;
  const outer = zone.parent ? byId.get(zone.parent) : null;
  const children = diagram.nodes.filter((n) => n.parent === zoneId);
  actions.batch(() => {
    actions.patchNodes(children.map((c) => ({ id: c.id, patch: { parent: outer?.id ?? null, ...relativeTo(absoluteBox(c, byId), outer, byId) } })));
    actions.remove({ nodes: [zoneId] });
  });
}

/** After a drag: anything dropped into a zone joins it, anything dragged out leaves. */
export function reparentAfterDrag(ids: string[], diagram: Diagram, actions: DiagramActions): void {
  const byId = byIdOf(diagram);
  const patches: { id: string; patch: Partial<DiagramNode> }[] = [];
  for (const node of outermost(ids, diagram)) {
    const box = absoluteBox(node, byId);
    const centre = { x: box.x + box.width / 2, y: box.y + (node.kind === "zone" ? 12 : box.height / 2) };
    const target = zoneAt(centre, diagram, new Set([node.id]));
    if ((target?.id ?? null) === (node.parent ?? null)) continue;
    patches.push({ id: node.id, patch: { parent: target?.id ?? null, ...relativeTo(box, target, byId) } });
  }
  if (patches.length) actions.patchNodes(patches);
}

// --- alignment ------------------------------------------------------------------------

export type AlignHow = "left" | "center" | "right" | "top" | "middle" | "bottom";

export function align(ids: string[], how: AlignHow, diagram: Diagram, actions: DiagramActions): void {
  const byId = byIdOf(diagram);
  const nodes = outermost(ids, diagram);
  if (nodes.length < 2) return;
  const boxes = nodes.map((n) => absoluteBox(n, byId));
  const target = {
    left: Math.min(...boxes.map((b) => b.x)),
    right: Math.max(...boxes.map((b) => b.x + b.width)),
    center: (Math.min(...boxes.map((b) => b.x)) + Math.max(...boxes.map((b) => b.x + b.width))) / 2,
    top: Math.min(...boxes.map((b) => b.y)),
    bottom: Math.max(...boxes.map((b) => b.y + b.height)),
    middle: (Math.min(...boxes.map((b) => b.y)) + Math.max(...boxes.map((b) => b.y + b.height))) / 2,
  }[how];
  actions.patchNodes(
    nodes.map((n, i) => {
      const b = boxes[i];
      const abs = {
        x: how === "left" ? target : how === "right" ? target - b.width : how === "center" ? target - b.width / 2 : b.x,
        y: how === "top" ? target : how === "bottom" ? target - b.height : how === "middle" ? target - b.height / 2 : b.y,
      };
      return { id: n.id, patch: relativeTo(abs, n.parent ? byId.get(n.parent) : null, byId) };
    }),
  );
}

export function distribute(ids: string[], axis: "x" | "y", diagram: Diagram, actions: DiagramActions): void {
  const byId = byIdOf(diagram);
  const nodes = outermost(ids, diagram);
  if (nodes.length < 3) return;
  const items = nodes
    .map((n) => ({ n, b: absoluteBox(n, byId) }))
    .sort((p, q) => (axis === "x" ? p.b.x - q.b.x : p.b.y - q.b.y));
  const first = items[0].b;
  const last = items[items.length - 1].b;
  const span = axis === "x" ? last.x - first.x : last.y - first.y;
  actions.patchNodes(
    items.map(({ n, b }, i) => {
      const at = (axis === "x" ? first.x : first.y) + (span * i) / (items.length - 1);
      const abs = axis === "x" ? { x: at, y: b.y } : { x: b.x, y: at };
      return { id: n.id, patch: relativeTo(abs, n.parent ? byId.get(n.parent) : null, byId) };
    }),
  );
}

// --- clipboard ------------------------------------------------------------------------

export interface Clip {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

/** The selection, whatever is inside selected zones, and the connectors among them. */
export function copy(nodeIds: string[], diagram: Diagram): Clip | null {
  const byId = byIdOf(diagram);
  const ids = new Set<string>();
  for (const n of outermost(nodeIds, diagram)) {
    ids.add(n.id);
    descendants(n.id, diagram).forEach((d) => ids.add(d));
  }
  if (ids.size === 0) return null;
  const nodes = diagram.nodes
    .filter((n) => ids.has(n.id))
    .map((n) => {
      if (!n.parent || ids.has(n.parent)) return n;
      // Its zone isn't copied, so it keeps its place on the canvas.
      const b = absoluteBox(n, byId);
      return { ...n, x: b.x, y: b.y, parent: null };
    });
  const edges = diagram.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  return { nodes, edges };
}

/** Paste a copy, nudged so it doesn't sit on the original. Returns the new node ids. */
export function paste(clip: Clip, actions: DiagramActions, offset = 30): string[] {
  const ids = new Map(clip.nodes.map((n) => [n.id, newDiagramId()]));
  const nodes: DiagramNode[] = clip.nodes.map(({ legendFor: _legend, ...n }) => {
    const inCopiedZone = !!n.parent && ids.has(n.parent);
    return {
      ...n,
      id: ids.get(n.id)!,
      parent: inCopiedZone ? ids.get(n.parent!)! : null,
      x: inCopiedZone ? n.x : snap(n.x + offset),
      y: inCopiedZone ? n.y : snap(n.y + offset),
    };
  });
  const edges = clip.edges.map((e) => ({ ...e, id: newDiagramId(), source: ids.get(e.source)!, target: ids.get(e.target)!, points: null, steps: null }));
  actions.put({ nodes, edges });
  return nodes.map((n) => n.id);
}

// --- numbered request flows -----------------------------------------------------------

/**
 * Number a flow's hops on the diagram, the way reference architectures do: a badge
 * on each call, and the steps listed in a note beside the drawing. Replaces earlier
 * numbering. Returns how many hops got a number.
 */
export function numberFlow(flow: Flow, graph: Graph, diagram: Diagram, actions: DiagramActions): number {
  const steps = new Map<string, number[]>();
  const lines: string[] = [];
  for (const step of flow.steps) {
    if (step.phase !== "call") continue;
    const canvasId = graph.edges.find((e) => e.id === step.edge_id)?.canvas_id;
    if (!canvasId || !diagram.edges.some((e) => e.id === canvasId)) continue;
    const n = lines.length + 1;
    steps.set(canvasId, [...(steps.get(canvasId) ?? []), n]);
    lines.push(`${n}. ${step.narration}`);
  }
  if (lines.length === 0) return 0;
  const legends = diagram.nodes.filter((n) => n.legendFor).map((n) => n.id);
  const rest: Diagram = { nodes: diagram.nodes.filter((n) => !n.legendFor), edges: diagram.edges };
  const bounds = contentBounds(rest);
  const legend: DiagramNode = {
    id: newDiagramId(),
    kind: "note",
    x: snap((bounds ? bounds.x + bounds.width : 0) + 60),
    y: snap(bounds?.y ?? 0),
    w: 360,
    h: snap(48 + lines.length * 34),
    label: `${flow.entry}\n${lines.join("\n")}`,
    legendFor: flow.id,
    parent: null,
  };
  actions.batch(() => {
    actions.remove({ nodes: legends });
    actions.patchEdges(diagram.edges.map((e) => ({ id: e.id, patch: { steps: steps.get(e.id) ?? undefined } })));
    actions.put({ nodes: [legend] });
  });
  return lines.length;
}

export function clearNumbers(diagram: Diagram, actions: DiagramActions): void {
  actions.batch(() => {
    actions.remove({ nodes: diagram.nodes.filter((n) => n.legendFor).map((n) => n.id) });
    actions.patchEdges(diagram.edges.filter((e) => e.steps).map((e) => ({ id: e.id, patch: { steps: undefined } })));
  });
}

// --- exports ----------------------------------------------------------------------------

/** Icon boxes in canvas coordinates, by graph node id, for the draw.io exporter. */
export function exportBoxes(graph: Graph, diagram: Diagram): Map<string, Box> {
  const byId = byIdOf(diagram);
  const out = new Map<string, Box>();
  for (const n of graph.nodes) {
    const node = n.canvas_id ? byId.get(n.canvas_id) : undefined;
    if (node) out.set(n.id, absoluteBox(node, byId));
  }
  return out;
}

export function exportZones(diagram: Diagram): DrawioZone[] {
  const byId = byIdOf(diagram);
  return diagram.nodes.filter((n) => n.kind === "zone").map((z) => ({ kind: z.zone ?? "system", label: z.label, box: absoluteBox(z, byId) }));
}
