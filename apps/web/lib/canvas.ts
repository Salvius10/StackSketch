// Turning typed graph pieces into Excalidraw elements in StackSketch's diagram
// style: every component is an icon with its name underneath, connectors are
// orthogonal (elbow) arrows bound to the icons, and zones box in the users, the
// system and outside services. Also writes the inspector's edits back onto
// elements as customData.

import { CaptureUpdateAction, FONT_FAMILY, convertToExcalidrawElements, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import type {
  ExcalidrawElement,
  ExcalidrawImageElement,
  ExcalidrawTextElement,
  FileId,
  FractionalIndex,
  NonDeletedExcalidrawElement,
} from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData, DataURL, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  type Box,
  type EdgeKind,
  type EdgeMeta,
  type ElementMeta,
  type Flow,
  type Graph,
  type GraphEdge,
  type GraphNode,
  ICON_SIZE,
  INK,
  LABEL_FONT_SIZE,
  LABEL_GAP,
  type Layout,
  META_KEY,
  type NodeMeta,
  type NodeType,
  type Point,
  type Zone,
  type ZoneKind,
  allIcons,
  getMeta,
  iconDataUrl,
  iconForElement,
  iconId,
  iconLabel,
  isNodeElement,
  kindToStroke,
  labelLines,
  layoutGraph,
} from "@stacksketch/graph";
import { generateNKeysBetween } from "fractional-indexing";

/** Labels use an Arial-like sans that Excalidraw embeds in exports. */
export const FONT = FONT_FAMILY["Liberation Sans"];
const MUTED = "#545b64";
/** Space between an arrowhead and the icon it points at. */
const ARROW_GAP = 6;

const ZONE_STROKE: Record<ZoneKind, { strokeColor: string; strokeStyle: "solid" | "dashed" }> = {
  clients: { strokeColor: "#8d99a6", strokeStyle: "solid" },
  system: { strokeColor: INK, strokeStyle: "solid" },
  external: { strokeColor: "#8d99a6", strokeStyle: "dashed" },
};

/** Colours for components sketched by hand as plain shapes. */
export const NODE_STYLE: Record<NodeType, { backgroundColor: string; strokeColor: string }> = {
  client: { backgroundColor: "#f1f3f5", strokeColor: "#495057" },
  gateway: { backgroundColor: "#e5dbff", strokeColor: "#5f3dc4" },
  service: { backgroundColor: "#d0ebff", strokeColor: "#1864ab" },
  worker: { backgroundColor: "#f3d9fa", strokeColor: "#862e9c" },
  database: { backgroundColor: "#d3f9d8", strokeColor: "#2b8a3e" },
  cache: { backgroundColor: "#ffe8cc", strokeColor: "#d9480f" },
  queue: { backgroundColor: "#fff3bf", strokeColor: "#e67700" },
  external: { backgroundColor: "#f8f9fa", strokeColor: "#495057" },
};

export const NODE_LABEL: Record<NodeType, string> = {
  client: "Client",
  gateway: "Gateway",
  service: "Service",
  worker: "Worker",
  database: "Database",
  cache: "Cache",
  queue: "Queue",
  external: "External API",
};

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Drop nulls: a null in customData would override what the label says. */
function compact<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined)) as Partial<T>;
}

// --- icon files ---------------------------------------------------------------------

let files: BinaryFileData[] | null = null;

/** Every icon as an Excalidraw file; each client registers them all at start-up. */
export function iconFiles(): BinaryFileData[] {
  files ??= allIcons().map(({ id, spec }) => ({
    id: id as FileId,
    mimeType: "image/svg+xml",
    dataURL: iconDataUrl(spec) as DataURL,
    created: 0,
  }));
  return files;
}

// --- building blocks ----------------------------------------------------------------

export interface NodeDraft {
  meta: ElementMeta;
  /** "Name" or "Name\nTechnology", as the label shows it. */
  text: string;
}

export interface EdgeDraft {
  meta: ElementMeta;
  text: string;
  kind: EdgeKind;
  hot: boolean;
}

function nodeMetaOf(n: GraphNode): NodeMeta {
  return {
    role: "node",
    ...compact({ type: n.type, tech: n.tech, replicas: n.replicas, dlq: n.dlq, source: n.source, confidence: n.confidence }),
  };
}

function edgeMetaOf(e: GraphEdge): EdgeMeta {
  return {
    role: "edge",
    ...compact({
      kind: e.kind,
      protocol: e.protocol,
      endpoint: e.endpoint,
      retry: e.retry,
      timeout_ms: e.timeout_ms,
      hot_path: e.hot_path,
      source: e.source,
      confidence: e.confidence,
    }),
  };
}

/** An icon and its name, grouped so they select and move together. */
export function componentElements(draft: NodeDraft, at: Point): [ExcalidrawImageElement, ExcalidrawTextElement] {
  const groupId = uid();
  const text = draft.text.trim() || (draft.meta.type ? NODE_LABEL[draft.meta.type] : "Component");
  const [icon, label] = convertToExcalidrawElements(
    [
      {
        type: "image",
        x: at.x,
        y: at.y,
        width: ICON_SIZE,
        height: ICON_SIZE,
        fileId: iconId(iconForElement(draft.meta, text)) as FileId,
        status: "saved",
        strokeColor: "transparent",
        backgroundColor: "transparent",
        roughness: 0,
        groupIds: [groupId],
        customData: { [META_KEY]: { ...draft.meta, role: "node" } },
      },
      {
        type: "text",
        x: at.x,
        y: at.y + ICON_SIZE + LABEL_GAP,
        text,
        fontSize: LABEL_FONT_SIZE,
        fontFamily: FONT,
        textAlign: "center",
        strokeColor: INK,
        roughness: 0,
        groupIds: [groupId],
        customData: { [META_KEY]: { role: "label" } },
      },
    ] as ExcalidrawElementSkeleton[],
    { regenerateIds: true },
  ) as unknown as [ExcalidrawImageElement, ExcalidrawTextElement];
  return [icon, { ...label, x: at.x + ICON_SIZE / 2 - label.width / 2 }];
}

/** Orthogonal route between two boxes, leaving and entering on the sides so it never crosses a name. */
export function orthogonalRoute(a: Box, b: Box): Point[] {
  const ay = a.y + a.height / 2;
  const by = b.y + b.height / 2;
  const between = (sx: number, ex: number): Point[] => {
    if (Math.abs(ay - by) < 1) return [{ x: sx, y: ay }, { x: ex, y: ay }];
    const mx = (sx + ex) / 2;
    return [{ x: sx, y: ay }, { x: mx, y: ay }, { x: mx, y: by }, { x: ex, y: by }];
  };
  if (b.x >= a.x + a.width) return between(a.x + a.width, b.x);
  if (b.x + b.width <= a.x) return between(a.x, b.x + b.width);
  // Stacked in the same column: go out to the right and back in.
  const rx = Math.max(a.x + a.width, b.x + b.width) + 40;
  return [{ x: a.x + a.width, y: ay }, { x: rx, y: ay }, { x: rx, y: by }, { x: b.x + b.width, y: by }];
}

/** Drop repeated and collinear points, which elbow arrows don't allow. */
function simplify(route: Point[]): Point[] {
  const out: Point[] = [];
  const same = (a: number, b: number) => Math.abs(a - b) < 0.5;
  for (const p of route) {
    const last = out[out.length - 1];
    if (last && same(last.x, p.x) && same(last.y, p.y)) continue;
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      if (!((same(a.x, b.x) && same(b.x, c.x)) || (same(a.y, b.y) && same(b.y, c.y)))) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

/** Pull both ends back a little so arrowheads don't touch the icons. */
function withGap(route: Point[], gap: number): Point[] {
  const pts = [...route];
  const nudge = (from: Point, toward: Point): Point => {
    const dx = toward.x - from.x;
    const dy = toward.y - from.y;
    const len = Math.hypot(dx, dy);
    return len > gap * 2 ? { x: from.x + (dx / len) * gap, y: from.y + (dy / len) * gap } : from;
  };
  pts[0] = nudge(pts[0], pts[1]);
  pts[pts.length - 1] = nudge(pts[pts.length - 1], pts[pts.length - 2]);
  return pts;
}

/** Where on a box an arrow end sits, as Excalidraw's elbow-arrow binding records it. */
function fixedBinding(el: ExcalidrawElement, p: Point) {
  // Excalidraw nudges exact centres off 0.5 to keep the arrow's heading unambiguous.
  const ratio = (v: number) => (Math.abs(v - 0.5) < 1e-4 ? 0.5001 : v);
  return { elementId: el.id, focus: 0, gap: 0, fixedPoint: [ratio((p.x - el.x) / el.width), ratio((p.y - el.y) / el.height)] };
}

/** An elbow arrow along `route`, bound to both elements, plus its label. Arrow first. */
export function connectorElements(draft: EdgeDraft, route: Point[], from: ExcalidrawElement, to: ExcalidrawElement): ExcalidrawElement[] {
  const pts = withGap(simplify(route), ARROW_GAP);
  const start = pts[0];
  const end = pts[pts.length - 1];
  const created = convertToExcalidrawElements(
    [
      {
        type: "arrow",
        x: start.x,
        y: start.y,
        points: pts.map((p) => [p.x - start.x, p.y - start.y]),
        elbowed: true,
        roundness: null,
        strokeColor: INK,
        strokeWidth: draft.hot ? 2 : 1,
        strokeStyle: kindToStroke(draft.kind),
        roughness: 0,
        startArrowhead: null,
        endArrowhead: "triangle",
        customData: { [META_KEY]: { ...draft.meta, role: "edge" } },
        ...(draft.text ? { label: { text: draft.text, fontSize: 13, fontFamily: FONT, strokeColor: MUTED } } : {}),
      },
      // Points are plain pairs here; Excalidraw's LocalPoint is the same tuple, branded.
    ] as unknown as ExcalidrawElementSkeleton[],
    { regenerateIds: true },
  );
  const arrow = created.find((e) => e.type === "arrow")!;
  // The converter nudges arrow ends by half a pixel; keep the exact route, starting at the arrow's origin.
  const points = pts.map((p) => [p.x - start.x, p.y - start.y]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const bound = {
    ...arrow,
    x: start.x,
    y: start.y,
    points,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    startBinding: fixedBinding(from, start),
    endBinding: fixedBinding(to, end),
  } as unknown as ExcalidrawElement;
  return [bound, ...created.filter((e) => e.id !== arrow.id)];
}

/**
 * Excalidraw expects every arrow's first point at its origin. Earlier StackSketch
 * versions saved some half a pixel off; shift those back without moving them.
 */
export function normalizeArrows(api: ExcalidrawImperativeAPI): void {
  const fixes = api
    .getSceneElements()
    .filter((e) => (e.type === "arrow" || e.type === "line") && (e.points[0][0] !== 0 || e.points[0][1] !== 0))
    .map((e) => {
      const [ox, oy] = (e as { points: readonly (readonly [number, number])[] }).points[0];
      const points = (e as { points: readonly (readonly [number, number])[] }).points.map(([x, y]) => [x - ox, y - oy]);
      return newElementWith(e, { x: e.x + ox, y: e.y + oy, points } as never);
    });
  if (fixes.length) replaceElements(api, fixes, CaptureUpdateAction.NEVER);
}

function zoneElements(zone: Zone): ExcalidrawElement[] {
  const groupId = uid();
  return convertToExcalidrawElements(
    [
      {
        type: "rectangle",
        x: zone.box.x,
        y: zone.box.y,
        width: zone.box.width,
        height: zone.box.height,
        ...ZONE_STROKE[zone.kind],
        backgroundColor: "transparent",
        strokeWidth: 1,
        roughness: 0,
        roundness: null,
        groupIds: [groupId],
        customData: { [META_KEY]: { role: "zone", zone: zone.kind } },
      },
      {
        type: "text",
        x: zone.box.x + 14,
        y: zone.box.y + 12,
        text: zone.label,
        fontSize: 15,
        fontFamily: FONT,
        strokeColor: INK,
        roughness: 0,
        groupIds: [groupId],
        customData: { [META_KEY]: { role: "zone" } },
      },
    ] as ExcalidrawElementSkeleton[],
    { regenerateIds: true },
  );
}

/** Zones (to go under everything) and components with their connectors. */
function buildDiagram(graph: Graph, layout: Layout, nodes: Map<string, NodeDraft>, edges: Map<string, EdgeDraft>) {
  const zones = layout.zones.flatMap(zoneElements);
  const parts = new Map<string, [ExcalidrawImageElement, ExcalidrawTextElement]>();
  for (const n of graph.nodes) {
    const box = layout.boxes.get(n.id);
    const draft = nodes.get(n.id);
    if (box && draft) parts.set(n.id, componentElements(draft, box));
  }
  const connectors: ExcalidrawElement[] = [];
  const attached = new Map<string, { id: string; type: "arrow" }[]>();
  for (const e of graph.edges) {
    const from = parts.get(e.from)?.[0];
    const to = parts.get(e.to)?.[0];
    const draft = edges.get(e.id);
    if (!from || !to || from === to || !draft) continue;
    const els = connectorElements(draft, layout.routes.get(e.id) ?? orthogonalRoute(from, to), from, to);
    connectors.push(...els);
    for (const icon of [from, to]) attached.set(icon.id, [...(attached.get(icon.id) ?? []), { id: els[0].id, type: "arrow" }]);
  }
  const components = [...parts.values()].flatMap(([icon, label]) => [{ ...icon, boundElements: attached.get(icon.id) ?? null }, label]);
  return { zones, content: [...connectors, ...components] as ExcalidrawElement[] };
}

function shiftLayout(layout: Layout, origin: Point): Layout {
  let minX = Infinity;
  let minY = Infinity;
  for (const b of [...layout.boxes.values(), ...layout.zones.map((z) => z.box)]) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
  }
  if (!Number.isFinite(minX)) return layout;
  const dx = origin.x - minX;
  const dy = origin.y - minY;
  const move = <T extends Point>(p: T): T => ({ ...p, x: p.x + dx, y: p.y + dy });
  return {
    boxes: new Map([...layout.boxes].map(([id, b]) => [id, move(b)])),
    routes: new Map([...layout.routes].map(([id, pts]) => [id, pts.map(move)])),
    zones: layout.zones.map((z) => ({ ...z, box: move(z.box) })),
  };
}

/** Give new elements valid z-order keys between two existing ones. */
function indexBetween<T extends ExcalidrawElement>(elements: T[], before: string | null | undefined, after: string | null | undefined): T[] {
  if (elements.length === 0) return elements;
  const keys = generateNKeysBetween(before ?? null, after ?? null, elements.length);
  return elements.map((el, i) => ({ ...el, index: keys[i] as FractionalIndex }));
}

/** Add zones under everything and content on top, deleting `remove`, as one undo step. */
function commit(api: ExcalidrawImperativeAPI, zones: ExcalidrawElement[], content: ExcalidrawElement[], remove = new Set<string>()) {
  const all = api.getSceneElementsIncludingDeleted();
  const under = indexBetween(zones, null, all[0]?.index);
  const over = indexBetween(content, all[all.length - 1]?.index, null);
  api.updateScene({
    elements: [...under, ...all.map((e) => (remove.has(e.id) ? newElementWith(e, { isDeleted: true }) : e)), ...over],
    appState: { selectedElementIds: {}, selectedGroupIds: {} },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  // Fit the new drawing, clear of the floating toolbar.
  api.scrollToContent([...under, ...over], { fitToContent: true, animate: true, canvasOffsets: { top: 80, right: 24, bottom: 56, left: 24 } });
}

function sceneBounds(elements: readonly NonDeletedExcalidrawElement[]) {
  if (elements.length === 0) return null;
  let maxX = -Infinity;
  let minY = Infinity;
  for (const el of elements) {
    maxX = Math.max(maxX, el.x + el.width);
    minY = Math.min(minY, el.y);
  }
  return { maxX, minY };
}

// --- whole diagrams -----------------------------------------------------------------

/**
 * Put a whole graph on the canvas, to the right of anything already there. Uses
 * the given boxes (e.g. from a .drawio file) or lays it out in zones with ELK.
 */
export async function insertGraph(
  api: ExcalidrawImperativeAPI,
  graph: Graph,
  boxes?: Map<string, Box>,
  options: { systemName?: string } = {},
): Promise<number> {
  const bounds = sceneBounds(api.getSceneElements());
  const origin = bounds ? { x: bounds.maxX + 200, y: bounds.minY } : { x: 0, y: 0 };
  const given = boxes && graph.nodes.length > 0 && graph.nodes.every((n) => boxes.has(n.id));
  // Icons keep the centre of whatever box the file gave the component.
  const raw: Layout = given
    ? {
        boxes: new Map(
          [...boxes!].map(([id, b]) => [id, { x: b.x + b.width / 2 - ICON_SIZE / 2, y: b.y + b.height / 2 - ICON_SIZE / 2, width: ICON_SIZE, height: ICON_SIZE }]),
        ),
        routes: new Map(),
        zones: [],
      }
    : await layoutGraph(graph, options);
  const nodes = new Map(graph.nodes.map((n) => [n.id, { meta: nodeMetaOf(n), text: labelLines(n).join("\n") }]));
  const edges = new Map(
    graph.edges.map((e) => [e.id, { meta: edgeMetaOf(e), text: e.endpoint ?? e.protocol ?? "", kind: e.kind, hot: !!e.hot_path }]),
  );
  const { zones, content } = buildDiagram(graph, shiftLayout(raw, origin), nodes, edges);
  commit(api, zones, content);
  return zones.length + content.length;
}

/**
 * Redraw the board's components and connections as a clean diagram: icons, zones
 * and orthogonal connectors laid out from scratch. Names, labels and everything set
 * in the inspector carry over; other drawings stay where they are. One undo step.
 */
export async function tidyUp(api: ExcalidrawImperativeAPI, graph: Graph, options: { systemName?: string } = {}): Promise<number> {
  const live = api.getSceneElements();
  const byId = new Map<string, ExcalidrawElement>(live.map((e) => [e.id, e]));
  const remove = new Set<string>();
  const textOf = (t: ExcalidrawElement | undefined) => (t && t.type === "text" ? t.originalText || t.text : "");
  const takeBoundText = (el: ExcalidrawElement) => {
    const ref = el.boundElements?.find((b) => b.type === "text");
    const t = ref ? byId.get(ref.id) : undefined;
    if (t) remove.add(t.id);
    return textOf(t);
  };

  const nodes = new Map<string, NodeDraft>();
  for (const n of graph.nodes) {
    const el = n.canvas_id ? byId.get(n.canvas_id) : undefined;
    if (!el) continue;
    remove.add(el.id);
    let text: string;
    if (el.type === "image") {
      const label = iconLabel(el as never, live as never) as ExcalidrawElement | undefined;
      if (label) remove.add(label.id);
      text = textOf(label);
    } else text = takeBoundText(el);
    nodes.set(n.id, { meta: { ...getMeta(el as never), role: "node" }, text: text || labelLines(n).join("\n") });
  }
  if (nodes.size === 0) return 0;

  const edges = new Map<string, EdgeDraft>();
  for (const e of graph.edges) {
    const el = e.canvas_id ? byId.get(e.canvas_id) : undefined;
    if (!el) continue;
    remove.add(el.id);
    const text = takeBoundText(el) || e.endpoint || e.protocol || "";
    edges.set(e.id, { meta: { ...getMeta(el as never), role: "edge" }, text, kind: e.kind, hot: !!e.hot_path });
  }
  // Old zones and step numbers are replaced, and arrows hanging off a redrawn component would dangle.
  for (const el of live) {
    const ends = el.type === "arrow" ? [el.startBinding?.elementId, el.endBinding?.elementId] : [];
    const role = getMeta(el as never).role;
    if (role === "zone" || role === "step" || ends.some((id) => id && remove.has(id))) {
      remove.add(el.id);
      takeBoundText(el);
    }
  }

  const removed = live.filter((e) => remove.has(e.id));
  const origin = { x: Math.min(...removed.map((e) => e.x)), y: Math.min(...removed.map((e) => e.y)) };
  const subgraph: Graph = {
    nodes: graph.nodes.filter((n) => nodes.has(n.id)),
    edges: graph.edges.filter((e) => edges.has(e.id) && nodes.has(e.from) && nodes.has(e.to)),
  };
  const layout = shiftLayout(await layoutGraph(subgraph, options), origin);
  const { zones, content } = buildDiagram(subgraph, layout, nodes, edges);
  commit(api, zones, content, remove);
  return subgraph.nodes.length;
}

// --- single components --------------------------------------------------------------

const overlaps = (a: Box, b: Box, gap = 40) =>
  a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

/** Add one typed component near a scene position, in the first free spot, and select it. */
export function insertNode(api: ExcalidrawImperativeAPI, type: NodeType, center: Point): void {
  const footprint = { width: ICON_SIZE, height: ICON_SIZE + 40 };
  const taken = api.getSceneElements().filter((e) => e.type !== "arrow" && getMeta(e as never).role !== "zone");
  const start = { x: center.x - ICON_SIZE / 2, y: center.y - ICON_SIZE / 2 };
  let box: Box = { ...start, ...footprint };
  // Walk right, then down a row, until nothing is in the way.
  for (let i = 0; i < 60 && taken.some((e) => overlaps(box, e)); i++) {
    const col = (i + 1) % 5;
    const row = Math.floor((i + 1) / 5);
    box = { ...box, x: start.x + col * (footprint.width + 110), y: start.y + row * (footprint.height + 60) };
  }
  const [icon, label] = componentElements({ meta: { role: "node", type }, text: NODE_LABEL[type] }, box);
  const all = api.getSceneElementsIncludingDeleted();
  const placed = indexBetween([icon, label], all[all.length - 1]?.index, null);
  api.updateScene({
    elements: [...all, ...placed],
    appState: { selectedElementIds: { [icon.id]: true, [label.id]: true }, selectedGroupIds: { [icon.groupIds[0]]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/** Append freshly built elements on top of the scene. */
export function appendElements(api: ExcalidrawImperativeAPI, created: ExcalidrawElement[], replaced: ExcalidrawElement[] = []): void {
  const all = api.getSceneElementsIncludingDeleted();
  const byId = new Map(replaced.map((e) => [e.id, e]));
  api.updateScene({
    elements: [...all.map((e) => byId.get(e.id) ?? e), ...indexBetween(created, all[all.length - 1]?.index, null)],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
}

/** Replace elements in the scene by id (as new versions), keeping order. */
export function replaceElements(
  api: ExcalidrawImperativeAPI,
  updated: ExcalidrawElement[],
  captureUpdate: (typeof CaptureUpdateAction)[keyof typeof CaptureUpdateAction] = CaptureUpdateAction.IMMEDIATELY,
): void {
  const byId = new Map(updated.map((e) => [e.id, e]));
  api.updateScene({ elements: api.getSceneElementsIncludingDeleted().map((e) => byId.get(e.id) ?? e), captureUpdate });
}

/**
 * Keep icons in step with what their components are: after a rename or a type
 * change, swap in the icon the type and technology call for. Not an undo step;
 * an undo of the edit itself triggers this again.
 */
export function refreshIcons(api: ExcalidrawImperativeAPI, changed: readonly ExcalidrawElement[]): void {
  const scene = api.getSceneElements();
  const icons = new Set<ExcalidrawImageElement>();
  const isIcon = (e: ExcalidrawElement): e is ExcalidrawImageElement => e.type === "image" && getMeta(e as never).role === "node";
  for (const el of changed) {
    if (el.isDeleted) continue;
    const current = scene.find((e) => e.id === el.id);
    if (!current) continue;
    if (isIcon(current)) icons.add(current);
    else if (current.type === "text" && getMeta(current as never).role === "label" && current.groupIds[0]) {
      const icon = scene.find((e) => isIcon(e) && e.groupIds[0] === current.groupIds[0]);
      if (icon) icons.add(icon as ExcalidrawImageElement);
    }
  }
  const updates: ExcalidrawElement[] = [];
  for (const icon of icons) {
    const label = iconLabel(icon as never, scene as never) as ExcalidrawElement | undefined;
    const text = label?.type === "text" ? label.originalText || label.text : "";
    const want = iconId(iconForElement(getMeta(icon as never), text)) as FileId;
    if (icon.fileId !== want) updates.push(newElementWith(icon, { fileId: want }));
  }
  if (updates.length) replaceElements(api, updates, CaptureUpdateAction.NEVER);
}

type MetaPatch = { [K in keyof ElementMeta]?: ElementMeta[K] | undefined };

/**
 * Merge fields into an element's StackSketch metadata. `undefined` removes a
 * field (back to "unknown, or whatever the label says"); `null` pins it unknown.
 */
export function updateMeta(api: ExcalidrawImperativeAPI, elementId: string, patch: MetaPatch): void {
  const scene = api.getSceneElementsIncludingDeleted();
  const el = scene.find((e) => e.id === elementId);
  if (!el) return;
  const current = getMeta(el as never);
  const role = current.role ?? (el.type === "arrow" ? "edge" : "node");
  const next: Record<string, unknown> = { ...current, role };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  // A person confirmed or corrected this element, so it is now user-sourced.
  next.source = "user";
  if (role === "node" && patch.type) next.confidence = 1;
  const updates: Record<string, unknown> = {
    customData: { ...(el.customData ?? {}), [META_KEY]: next },
  };
  // Keep the drawing honest: the type and kind are visible on the canvas too.
  if (role === "node" && el.type === "image") {
    const label = iconLabel(el as never, scene.filter((e) => !e.isDeleted) as never) as ExcalidrawElement | undefined;
    const text = label?.type === "text" ? label.originalText || label.text : "";
    updates.fileId = iconId(iconForElement(next as ElementMeta, text));
  } else if (role === "node" && patch.type) {
    Object.assign(updates, { ...NODE_STYLE[patch.type], fillStyle: "solid" });
  }
  if (role === "edge" && patch.kind) updates.strokeStyle = kindToStroke(patch.kind as EdgeKind);
  if (role === "edge" && "hot_path" in patch) {
    updates.strokeWidth = el.roughness === 0 ? (patch.hot_path ? 2 : 1) : patch.hot_path ? 3 : 2;
  }
  replaceElements(api, [newElementWith(el, updates as never)]);
}

// --- numbered flows -----------------------------------------------------------------

const STEP_COLOR = "#0b6bcb";
const STEP_SIZE = 24;

/** The point `dist` along a path, and the unit direction of travel there. */
function pointAlong(path: Point[], dist: number): Point & { dx: number; dy: number } {
  let left = dist;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 0 && (left <= len || i === path.length - 1)) {
      const k = Math.min(left, len) / len;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len };
    }
    left -= len;
  }
  return { ...path[path.length - 1], dx: 1, dy: 0 };
}

function pathLength(path: Point[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  return total;
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

const isStep = (e: ExcalidrawElement) => getMeta(e as never).role === "step";

/** Whether the canvas shows step numbers. */
export const hasStepNumbers = (api: ExcalidrawImperativeAPI) => api.getSceneElements().some(isStep);

/**
 * Number a flow's hops on the diagram, the way reference architectures do: a
 * badge on each call where it leaves the caller, and the numbered steps listed
 * beside the drawing. Replaces earlier numbers. Returns how many hops got one.
 */
export function numberFlow(api: ExcalidrawImperativeAPI, graph: Graph, flow: Flow): number {
  const scene = api.getSceneElements();
  const byId = new Map<string, ExcalidrawElement>(scene.map((e) => [e.id, e]));
  // Badges keep clear of connector labels and of each other.
  const taken: Box[] = scene.filter((e) => e.type === "text" && e.containerId && byId.get(e.containerId)?.type === "arrow" && !isStep(e));
  const badges: ExcalidrawElement[] = [];
  const items: string[] = [];
  let n = 0;
  for (const step of flow.steps) {
    if (step.phase !== "call") continue;
    const edge = graph.edges.find((e) => e.id === step.edge_id);
    const arrow = edge?.canvas_id ? byId.get(edge.canvas_id) : undefined;
    if (!edge || !arrow || arrow.type !== "arrow") continue;
    n += 1;
    const points = arrow.points.map(([x, y]) => ({ x: arrow.x + x, y: arrow.y + y }));
    // Read the arrow in the direction the request travels.
    const caller = graph.nodes.find((x) => x.id === step.from)?.canvas_id;
    const path = arrow.startBinding && caller && arrow.startBinding.elementId !== caller ? points.reverse() : points;
    // A third of the way from the caller and beside the line; further along while it
    // would cover a label or another badge (arrows leaving one component bunch up).
    const total = pathLength(path);
    const width = n < 10 ? STEP_SIZE : STEP_SIZE + 8;
    const boxAt = (d: number): Box => {
      const p = pointAlong(path, d);
      const cx = p.x + p.dy * 17;
      const cy = p.y - p.dx * 17;
      return { x: cx - width / 2, y: cy - STEP_SIZE / 2, width, height: STEP_SIZE };
    };
    let d = Math.min(Math.max(total * 0.3, 22), 70, total / 2);
    let box = boxAt(d);
    while (d < total - 16 && taken.some((t) => overlaps(box, t, 2))) {
      d += 10;
      box = boxAt(d);
    }
    taken.push(box);
    const [badge, number] = convertToExcalidrawElements(
      [
        {
          type: "rectangle",
          ...box,
          backgroundColor: STEP_COLOR,
          fillStyle: "solid",
          strokeColor: STEP_COLOR,
          strokeWidth: 1,
          roughness: 0,
          roundness: { type: 3 },
          customData: { [META_KEY]: { role: "step" } },
          label: { text: String(n), fontSize: 13, fontFamily: FONT, strokeColor: "#ffffff" },
        },
      ] as ExcalidrawElementSkeleton[],
      { regenerateIds: true },
    );
    badges.push(badge, { ...number, customData: { [META_KEY]: { role: "step" } } } as ExcalidrawElement);
    items.push(...wrap(step.narration, 64).map((line, i) => (i === 0 ? `${n}. ${line}` : `    ${line}`)));
  }
  if (items.length === 0) return 0;

  // The list goes to the right of everything else on the board.
  const rest = scene.filter((e) => !isStep(e));
  const right = Math.max(...rest.map((e) => e.x + e.width));
  const top = Math.min(...rest.map((e) => e.y));
  const groupId = uid();
  const legend = convertToExcalidrawElements(
    [
      {
        type: "text",
        x: right + 56,
        y: top,
        text: flow.entry,
        fontSize: 16,
        fontFamily: FONT,
        strokeColor: INK,
        roughness: 0,
        groupIds: [groupId],
        customData: { [META_KEY]: { role: "step" } },
      },
      {
        type: "text",
        x: right + 56,
        y: top + 30,
        text: items.join("\n"),
        fontSize: 14,
        fontFamily: FONT,
        strokeColor: INK,
        roughness: 0,
        groupIds: [groupId],
        customData: { [META_KEY]: { role: "step" } },
      },
    ] as ExcalidrawElementSkeleton[],
    { regenerateIds: true },
  );

  const all = api.getSceneElementsIncludingDeleted();
  api.updateScene({
    elements: [
      ...all.map((e) => (!e.isDeleted && isStep(e) ? newElementWith(e, { isDeleted: true }) : e)),
      ...indexBetween([...badges, ...legend], all[all.length - 1]?.index, null),
    ],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return n;
}

/** Remove step numbers and their list. */
export function clearStepNumbers(api: ExcalidrawImperativeAPI): void {
  replaceElements(
    api,
    api
      .getSceneElements()
      .filter(isStep)
      .map((e) => newElementWith(e, { isDeleted: true })),
  );
}

// --- reading the canvas -------------------------------------------------------------

/** Zone boxes on the canvas, for exporters. */
export function zonesOnCanvas(api: ExcalidrawImperativeAPI): { kind: ZoneKind; label: string; box: Box }[] {
  const scene = api.getSceneElements();
  return scene
    .filter((e) => e.type === "rectangle" && getMeta(e as never).role === "zone")
    .map((rect) => {
      const title = scene.find((t) => t.type === "text" && t.groupIds[0] && t.groupIds[0] === rect.groupIds[0]);
      const kind = (rect.customData?.[META_KEY] as { zone?: ZoneKind } | undefined)?.zone ?? "system";
      return {
        kind,
        label: title?.type === "text" ? title.originalText || title.text : "",
        box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    });
}

/** Whether an element is one of StackSketch's components (icon or sketched shape). */
export const isComponent = (el: ExcalidrawElement) => isNodeElement(el as never);
