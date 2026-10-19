// The room AI's edits to the board. The AI names components by graph id ("order-service");
// this turns that into diagram changes: new components placed beside what they connect
// to (or a whole drawing laid out, on a board with no components yet), connectors,
// renames, removals and new zones. It all runs on a copy first, so the result applies
// as one step and carries its own undo, which anyone in the room can use later.

import {
  type BoardChange,
  type BoardEdits,
  type Diagram,
  type DiagramEdge,
  type DiagramNode,
  type Graph,
  ICON_SIZE,
  type LayoutGroup,
  type Side,
  type ZoneKind,
  absoluteBox,
  deriveFromDiagram,
  diagramFromLayout,
  layoutGraph,
  newDiagramId,
  parseEdgeLabel,
  sidesBetween,
} from "@stacksketch/graph";
import { NAME_SPACE, contentBounds, footprint, freeSpot, groupInZone, moveTo, overlaps, putInside, snap } from "./arrange";
import type { DiagramActions } from "./diagram";

export interface EditPlan {
  change: BoardChange;
  undo: BoardChange;
  /** The nodes the edits added or changed, to show them. */
  touched: string[];
  /** What the edits do, in a few words. */
  note: string;
}

/** Apply a change (or an undo) as one step. */
export function applyChange(change: BoardChange, actions: DiagramActions): void {
  actions.batch(() => {
    actions.remove(change.remove);
    actions.put(change.put);
  });
}

/** Only the fields that are set: null in an edit means "leave it as it is". */
function setOnly<T extends object>(fields: T): Partial<{ [K in keyof T]: NonNullable<T[K]> }> {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined)) as Partial<{ [K in keyof T]: NonNullable<T[K]> }>;
}

/** DiagramActions over plain maps, so the editing helpers can run on a copy. */
function scratch(diagram: Diagram) {
  const nodes = new Map(diagram.nodes.map((n) => [n.id, n]));
  const edges = new Map(diagram.edges.map((e) => [e.id, e]));
  const merge = <T extends object>(current: T, patch: Partial<T>): T => {
    const next = { ...current } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    return next as T;
  };
  const actions: DiagramActions = {
    put(changes) {
      changes.nodes?.forEach((n) => nodes.set(n.id, n));
      changes.edges?.forEach((e) => edges.set(e.id, e));
    },
    patchNode(id, patch) {
      const n = nodes.get(id);
      if (n) nodes.set(id, merge(n, patch));
    },
    patchNodes(patches) {
      patches.forEach(({ id, patch }) => actions.patchNode(id, patch));
    },
    patchEdge(id, patch) {
      const e = edges.get(id);
      if (e) edges.set(id, merge(e, patch));
    },
    patchEdges(patches) {
      patches.forEach(({ id, patch }) => actions.patchEdge(id, patch));
    },
    remove({ nodes: nodeIds = [], edges: edgeIds = [] }) {
      const gone = new Set(nodeIds);
      for (const [id, e] of edges) if (gone.has(e.source) || gone.has(e.target)) edges.delete(id);
      edgeIds.forEach((id) => edges.delete(id));
      nodeIds.forEach((id) => nodes.delete(id));
    },
    batch(fn) {
      fn();
    },
    undo() {},
    redo() {},
  };
  const current = (): Diagram => ({ nodes: [...nodes.values()], edges: [...edges.values()] });
  return { actions, current };
}

/** What changed between two diagrams, and the change that puts it back. */
export function diffDiagrams(before: Diagram, after: Diagram): { change: BoardChange; undo: BoardChange } {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const compare = <T extends { id: string }>(was: T[], now: T[]) => {
    const old = new Map(was.map((x) => [x.id, x]));
    const cur = new Map(now.map((x) => [x.id, x]));
    return {
      put: now.filter((x) => !same(old.get(x.id), x)),
      removed: was.filter((x) => !cur.has(x.id)).map((x) => x.id),
      restore: was.filter((x) => !same(cur.get(x.id), x)),
      added: now.filter((x) => !old.has(x.id)).map((x) => x.id),
    };
  };
  const n = compare(before.nodes, after.nodes);
  const e = compare(before.edges, after.edges);
  return {
    change: { put: { nodes: n.put, edges: e.put }, remove: { nodes: n.removed, edges: e.removed } },
    undo: { put: { nodes: n.restore, edges: e.restore }, remove: { nodes: n.added, edges: e.added } },
  };
}

const STEP: Record<Side, [number, number]> = { right: [180, 0], left: [-180, 0], bottom: [0, 150], top: [0, -150] };

/** The first free component spot next to `anchor`, trying the sides in order, one step out and then further. */
function spotBeside(anchor: { x: number; y: number }, sides: Side[], diagram: Diagram): { x: number; y: number } | null {
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const taken = diagram.nodes.filter((n) => n.kind !== "zone").map((n) => footprint(n, byId));
  for (let i = 1; i <= 6; i++) {
    for (const side of sides) {
      const x = snap(anchor.x + STEP[side][0] * i);
      const y = snap(anchor.y + STEP[side][1] * i);
      const box = { x: x - 24, y, width: ICON_SIZE + 48, height: ICON_SIZE + NAME_SPACE };
      if (!taken.some((t) => overlaps(box, t, 16))) return { x, y };
    }
  }
  return null;
}

function zoneKind(members: string[], typeOf: Map<string, string>): ZoneKind {
  if (members.every((m) => typeOf.get(m) === "client")) return "clients";
  if (members.every((m) => typeOf.get(m) === "external")) return "external";
  return "system";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Work out what the edits do to `diagram`, without touching it. */
export async function planEdits(edits: BoardEdits, diagram: Diagram, systemName?: string): Promise<EditPlan> {
  const { graph } = deriveFromDiagram(diagram);
  const nodeCanvas = new Map(graph.nodes.map((n) => [n.id, n.canvas_id!]));
  const edgeCanvas = new Map(graph.edges.map((e) => [e.id, e.canvas_id!]));
  const { actions, current } = scratch(diagram);
  const known = (ids: (string | undefined)[]) => ids.filter((id): id is string => !!id);

  // Removals first, so nothing below is placed against what is going.
  const dropNodes = known(edits.remove_nodes.map((id) => nodeCanvas.get(id)));
  const dropEdges = known(edits.remove_edges.map((id) => edgeCanvas.get(id)));
  actions.remove({ nodes: dropNodes, edges: dropEdges });

  // Changes to what stays.
  const changed: string[] = [];
  for (const u of edits.update_nodes) {
    const id = nodeCanvas.get(u.id);
    const patch = setOnly({ label: u.label, type: u.type, tech: u.tech, replicas: u.replicas, dlq: u.dlq });
    if (!id || Object.keys(patch).length === 0) continue;
    actions.patchNode(id, patch);
    changed.push(id);
  }
  let changedEdges = 0;
  for (const u of edits.update_edges) {
    const id = edgeCanvas.get(u.id);
    const edge = id ? current().edges.find((e) => e.id === id) : undefined;
    if (!id || !edge) continue;
    const patch: Partial<DiagramEdge> = setOnly({ kind: u.kind, protocol: u.protocol, endpoint: u.endpoint, retry: u.retry, timeout_ms: u.timeout_ms, hot_path: u.hot_path });
    if (Object.keys(patch).length === 0) continue;
    // The label is what shows on the line. Once the endpoint or protocol changes, show those
    // instead, keeping whatever else the label said as fields.
    if ((patch.endpoint !== undefined || patch.protocol !== undefined) && edge.label?.trim()) {
      const parsed = parseEdgeLabel(edge.label);
      for (const k of ["protocol", "endpoint", "retry", "timeout_ms", "hot_path"] as const) {
        if (patch[k] === undefined && edge[k] === undefined && parsed[k] !== null) Object.assign(patch, { [k]: parsed[k] });
      }
      patch.label = undefined;
    }
    actions.patchEdge(id, patch);
    changedEdges++;
  }

  // New components: a whole drawing on a board with no components yet, else one by one beside their neighbours.
  const fresh = new Map<string, string>();
  const canvasOf = (gid: string) => fresh.get(gid) ?? nodeCanvas.get(gid);
  const laidOut = new Set<string>();
  const groupsDone = new Set<number>();
  const remaining = graph.nodes.filter((n) => !dropNodes.includes(n.canvas_id!));
  if (edits.add_nodes.length > 0 && remaining.length === 0) {
    const typeOf = new Map(edits.add_nodes.map((n) => [n.id, n.type]));
    const sub: Graph = {
      nodes: edits.add_nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, tech: n.tech, replicas: null, dlq: null, canvas_id: null, source: "ai", confidence: 0.6 })),
      edges: [],
    };
    for (const e of edits.add_edges) {
      if (!typeOf.has(e.from_node) || !typeOf.has(e.to_node)) continue;
      const { from_node: from, to_node: to, ...fields } = e;
      sub.edges.push({ id: `${from}->${to}`, from, to, ...fields, canvas_id: null, source: "ai", confidence: 0.6 });
      laidOut.add(`${from}->${to}`);
    }
    // Zones: the groups the AI made, then any zone it named on a component that's in none.
    const grouped = new Set<string>();
    const groups: LayoutGroup[] = [];
    edits.groups.forEach((g, i) => {
      const members = g.members.filter((m) => typeOf.has(m) && !grouped.has(m));
      if (members.length === 0) return;
      members.forEach((m) => grouped.add(m));
      groups.push({ id: `g${i}`, kind: zoneKind(members, typeOf), label: g.label, members });
      groupsDone.add(i);
    });
    for (const n of edits.add_nodes) {
      if (!n.zone || grouped.has(n.id)) continue;
      const existing = groups.find((g) => g.label.toLowerCase() === n.zone!.toLowerCase());
      if (existing) existing.members.push(n.id);
      else groups.push({ id: `z${groups.length}`, kind: "system", label: n.zone, members: [n.id] });
      grouped.add(n.id);
    }
    for (const g of groups) g.kind = zoneKind(g.members, typeOf);
    const layout = await layoutGraph(sub, groups.length > 0 ? { groups } : { systemName });
    const drawn = diagramFromLayout(sub, layout);
    const bounds = contentBounds(current());
    const placed = moveTo(drawn, bounds ? { x: bounds.x + bounds.width + 160, y: bounds.y } : { x: 40, y: 40 });
    // Components come out in the graph's order (those the layout placed), after the zones.
    const boxed = sub.nodes.filter((n) => layout.boxes.has(n.id));
    placed.nodes.filter((n) => n.kind === "component").forEach((n, i) => fresh.set(boxed[i].id, n.id));
    actions.put(placed);
  } else {
    const links = (gid: string) =>
      edits.add_edges.flatMap((e) => (e.from_node === gid ? [{ other: e.to_node, out: true }] : e.to_node === gid ? [{ other: e.from_node, out: false }] : []));
    const pending = [...edits.add_nodes];
    while (pending.length > 0) {
      // Next, one that connects to something already on the board.
      const work = current();
      const byId = new Map(work.nodes.map((n) => [n.id, n]));
      const onBoard = (gid: string) => {
        const id = canvasOf(gid);
        return id ? byId.get(id) : undefined;
      };
      const next = Math.max(0, pending.findIndex((n) => links(n.id).some((l) => onBoard(l.other))));
      const n = pending.splice(next, 1)[0];
      const link = links(n.id).find((l) => onBoard(l.other));
      const anchor = link ? onBoard(link.other) : undefined;
      const named = n.zone ? work.nodes.find((z) => z.kind === "zone" && z.label.trim().toLowerCase() === n.zone!.toLowerCase()) : undefined;
      const parent = named ?? (anchor?.parent ? byId.get(anchor.parent) : undefined);
      let at: { x: number; y: number } | null = null;
      if (anchor && (anchor.parent ?? null) === (parent?.id ?? null)) {
        // Downstream to the right, upstream to the left, as a request reads.
        const sides: Side[] = link!.out ? ["right", "bottom", "top", "left"] : ["left", "top", "bottom", "right"];
        at = spotBeside(absoluteBox(anchor, byId), sides, work);
      }
      if (!at) {
        const area = parent ? absoluteBox(parent, byId) : contentBounds(work);
        const start = parent ? { x: area!.x + 30, y: area!.y + 52 } : area ? { x: area.x + area.width + 120, y: area.y } : { x: 40, y: 40 };
        at = freeSpot({ x: start.x + ICON_SIZE / 2, y: start.y + ICON_SIZE / 2 }, work);
      }
      const origin = parent ? absoluteBox(parent, byId) : { x: 0, y: 0 };
      const node: DiagramNode = {
        id: newDiagramId(),
        kind: "component",
        x: snap(at.x - origin.x),
        y: snap(at.y - origin.y),
        parent: parent?.id ?? null,
        label: n.label,
        type: n.type,
        ...(n.tech ? { tech: n.tech } : {}),
        origin: "ai",
        confidence: 0.6,
      };
      fresh.set(n.id, node.id);
      putInside([node], [], work, actions);
    }
  }

  // Connectors.
  let connected = laidOut.size;
  for (const e of edits.add_edges) {
    if (laidOut.has(`${e.from_node}->${e.to_node}`)) continue;
    const work = current();
    const byId = new Map(work.nodes.map((n) => [n.id, n]));
    const source = byId.get(canvasOf(e.from_node) ?? "");
    const target = byId.get(canvasOf(e.to_node) ?? "");
    if (!source || !target || source.id === target.id) continue;
    const [sourceSide, targetSide] = sidesBetween(absoluteBox(source, byId), absoluteBox(target, byId));
    const { from_node: _from, to_node: _to, kind, ...fields } = e;
    actions.put({ edges: [{ id: newDiagramId(), source: source.id, target: target.id, sourceSide, targetSide, kind, ...setOnly(fields), origin: "ai", confidence: 0.6 }] });
    connected++;
  }

  // New zones around existing (or just placed) components.
  let zones = groupsDone.size;
  const zoneIds: string[] = [];
  edits.groups.forEach((g, i) => {
    if (groupsDone.has(i)) return;
    const work = current();
    const present = new Set(work.nodes.map((n) => n.id));
    const ids = known(g.members.map(canvasOf)).filter((id) => present.has(id));
    const zone = ids.length > 0 ? groupInZone(ids, work, actions, g.label) : null;
    if (zone) {
      zoneIds.push(zone);
      zones++;
    }
  });

  const { change, undo } = diffDiagrams(diagram, current());
  const added = [
    fresh.size ? plural(fresh.size, "component") : "",
    connected ? plural(connected, "connection") : "",
  ].filter(Boolean);
  const parts = [
    added.length ? `added ${added.join(" and ")}` : "",
    changed.length + changedEdges ? `changed ${changed.length + changedEdges}` : "",
    dropNodes.length + dropEdges.length ? `removed ${dropNodes.length + dropEdges.length}` : "",
    zones ? `made ${plural(zones, "zone")}` : "",
  ].filter(Boolean);
  const note = parts.length ? `${parts.join(", ").replace(/^./, (c) => c.toUpperCase())}.` : "Nothing to change: what it named is no longer on the board.";
  return { change, undo, touched: [...fresh.values(), ...changed, ...zoneIds], note };
}
