// Auto-layout for graphs that arrive without a drawing (idea to architecture,
// docker-compose import, raw JSON) and for tidying a sketched board. Layered left
// to right in three zones: users and clients, the system itself, and outside
// services. Every component is an icon with its name underneath; edges get
// orthogonal routes that go around icons and their names.

import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkExtendedEdge, ElkNode } from "elkjs/lib/elk-api";
import type { Box } from "./derive";
import { ICON_SIZE } from "./icons";
import type { Graph, GraphNode } from "./schema";

export interface Point {
  x: number;
  y: number;
}

export type ZoneKind = "clients" | "system" | "external";

export interface Zone {
  /** Set when the zone came from `LayoutOptions.groups`. */
  id?: string;
  kind: ZoneKind;
  label: string;
  box: Box;
  /** Node ids inside the zone. */
  members: string[];
}

/** A zone the layout should keep, with the nodes that belong in it. */
export interface LayoutGroup {
  id: string;
  kind: ZoneKind;
  label: string;
  members: string[];
}

export interface Layout {
  /** Node id -> icon box (the name sits below it). */
  boxes: Map<string, Box>;
  /** Edge id -> route from the source icon to the target icon. */
  routes: Map<string, Point[]>;
  zones: Zone[];
}

export interface LayoutOptions {
  /** Group nodes into clients / system / external zones (default true). Ignored when `groups` is given. */
  zones?: boolean;
  /** Title of the zone around the system's own components. */
  systemName?: string;
  /** Lay out these zones instead; nodes in none of them sit outside any zone. */
  groups?: LayoutGroup[];
}

/** Name font metrics, for reserving room under each icon. */
export const LABEL_FONT_SIZE = 14;
export const LABEL_GAP = 8;
const LINE_HEIGHT = LABEL_FONT_SIZE * 1.15;
const CHAR_WIDTH = LABEL_FONT_SIZE * 0.55;

export function labelLines(node: Pick<GraphNode, "label" | "tech">): string[] {
  return [node.label, node.tech].filter((l): l is string => !!l);
}

function labelSize(node: GraphNode): { width: number; height: number } {
  const lines = labelLines(node);
  const longest = Math.max(1, ...lines.map((l) => l.length));
  return { width: Math.min(Math.max(longest * CHAR_WIDTH + 8, 40), 220), height: lines.length * LINE_HEIGHT + LABEL_GAP };
}

const SPACING = {
  "elk.spacing.nodeNode": "56",
  "elk.layered.spacing.nodeNodeBetweenLayers": "110",
  "elk.spacing.edgeNode": "26",
  "elk.spacing.edgeEdge": "16",
  "elk.layered.spacing.edgeNodeBetweenLayers": "26",
  "elk.spacing.labelNode": String(LABEL_GAP),
};

const ZONE_PADDING = "[top=52,left=40,bottom=36,right=40]";

export const ZONE_LABEL: Record<ZoneKind, string> = {
  clients: "Clients",
  system: "System",
  external: "External services",
};

function zoneOf(node: GraphNode): ZoneKind {
  return node.type === "client" ? "clients" : node.type === "external" ? "external" : "system";
}

let elk: InstanceType<typeof ELK> | null = null;

export async function layoutGraph(graph: Graph, options: LayoutOptions = {}): Promise<Layout> {
  elk ??= new ELK();
  const leaf = (n: GraphNode): ElkNode => ({
    id: n.id,
    width: ICON_SIZE,
    height: ICON_SIZE,
    labels: [{ id: `${n.id}::label`, text: labelLines(n).join("\n"), ...labelSize(n) }],
    layoutOptions: { "elk.nodeLabels.placement": "[H_CENTER, V_BOTTOM, OUTSIDE]" },
  });

  const known = new Set(graph.nodes.map((n) => n.id));
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const kinds: ZoneKind[] = ["clients", "system", "external"];
  // The zones to lay out: the ones given, or clients / system / external.
  let groups: LayoutGroup[] = [];
  if (options.groups) {
    const seen = new Set<string>();
    groups = options.groups
      .map((g) => ({ ...g, members: g.members.filter((m) => known.has(m) && !seen.has(m) && seen.add(m)) }))
      .filter((g) => g.members.length > 0);
  } else if (options.zones !== false && graph.nodes.length > 0) {
    groups = kinds
      .map((k) => ({
        id: k,
        kind: k,
        label: k === "system" && options.systemName ? options.systemName : ZONE_LABEL[k],
        members: graph.nodes.filter((n) => zoneOf(n) === k).map((n) => n.id),
      }))
      .filter((g) => g.members.length > 0);
  }
  const grouped = new Set(groups.flatMap((g) => g.members));
  const zoneNodes: ElkNode[] = groups.map((g) => ({
    id: `zone:${g.id}`,
    layoutOptions: {
      ...SPACING,
      "elk.padding": ZONE_PADDING,
      ...(g.kind === "clients" ? { "elk.layered.layering.layerConstraint": "FIRST" } : {}),
      ...(g.kind === "external" ? { "elk.layered.layering.layerConstraint": "LAST" } : {}),
    },
    children: g.members.map((m) => leaf(nodeById.get(m)!)),
  }));
  const children: ElkNode[] = [...zoneNodes, ...graph.nodes.filter((n) => !grouped.has(n.id)).map(leaf)];

  const result = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.separateConnectedComponents": "false",
      "elk.json.shapeCoords": "ROOT",
      "elk.json.edgeCoords": "ROOT",
      ...SPACING,
    },
    children,
    edges: graph.edges
      .filter((e) => e.from !== e.to && known.has(e.from) && known.has(e.to))
      .map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
  });

  const boxes = new Map<string, Box>();
  const zones: Zone[] = [];
  const groupById = new Map(groups.map((g) => [`zone:${g.id}`, g]));
  const place = (node: ElkNode) => boxes.set(node.id, { x: node.x ?? 0, y: node.y ?? 0, width: ICON_SIZE, height: ICON_SIZE });
  for (const child of result.children ?? []) {
    const group = groupById.get(child.id);
    if (!group) {
      place(child);
      continue;
    }
    for (const n of child.children ?? []) place(n);
    zones.push({
      ...(options.groups ? { id: group.id } : {}),
      kind: group.kind,
      label: group.label,
      box: { x: child.x ?? 0, y: child.y ?? 0, width: child.width ?? 0, height: child.height ?? 0 },
      members: (child.children ?? []).map((n) => n.id),
    });
  }

  const routes = new Map<string, Point[]>();
  for (const edge of (result.edges ?? []) as ElkExtendedEdge[]) {
    const section = edge.sections?.[0];
    if (!section) continue;
    routes.set(edge.id, [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({ x: p.x, y: p.y })));
  }
  return { boxes, routes, zones };
}
