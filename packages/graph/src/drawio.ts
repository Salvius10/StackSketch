// draw.io (mxGraph XML) export and import. The XML is graph-native: vertices
// are nodes, edges carry source and target. StackSketch fields ride along as
// custom properties on <object> wrappers so a round trip is lossless.

import { XMLParser } from "fast-xml-parser";
import { inflateSync, strFromU8 } from "fflate";
import type { Box } from "./derive";
import { inferNodeType, parseEdgeLabel, parseNodeLabel, slugify } from "./derive";
import { ICON_SIZE, INK, iconFor, iconSvg } from "./icons";
import type { ZoneKind } from "./layout";
import {
  type EdgeKind,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type NodeType,
  isEdgeKind,
  isNodeType,
  isSource,
} from "./schema";

const MUTED = "#545B64";

// draw.io splits styles on ";", so an embedded image drops the ";base64" marker.
function nodeStyle(n: GraphNode): string {
  return (
    "shape=image;html=1;imageAspect=0;aspect=fixed;verticalLabelPosition=bottom;verticalAlign=top;" +
    `labelPosition=center;align=center;fontSize=12;fontColor=${INK};` +
    `image=data:image/svg+xml,${btoa(iconSvg(iconFor(n)))};`
  );
}

const EDGE_BASE = `edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=${INK};endArrow=block;endFill=1;fontSize=11;fontColor=${MUTED};labelBackgroundColor=#ffffff;`;
const EDGE_STYLES: Record<EdgeKind, string> = {
  sync: EDGE_BASE,
  async: `${EDGE_BASE}dashed=1;`,
  stream: `${EDGE_BASE}dashed=1;dashPattern=1 4;`,
};

const ZONE_STYLES: Record<ZoneKind, string> = {
  clients: "fillColor=#F8F9FA;strokeColor=#AAB7B8;",
  system: `fillColor=none;strokeColor=${INK};`,
  external: "fillColor=#F8F9FA;strokeColor=#AAB7B8;dashed=1;",
};

/** A boundary box around part of the diagram. */
export interface DrawioZone {
  kind: ZoneKind;
  label: string;
  box: Box;
  /** Node ids inside; when absent, nodes whose centre lies inside the box. */
  members?: string[];
}

function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;");
}

function attrs(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(" ");
}

const DEFAULT_BOX = { width: 160, height: 70 };

/**
 * Serialise the graph as a .drawio file. `boxes` maps node id to its icon's
 * position on the canvas; nodes without one are placed on a simple grid. Zones
 * become draw.io containers holding their components.
 */
export function toDrawio(graph: Graph, boxes: Map<string, Box> = new Map(), zones: DrawioZone[] = []): string {
  const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  const cellId = new Map<string, string>();
  const boxOf = (n: GraphNode, i: number): Box =>
    boxes.get(n.id) ?? { x: 40 + (i % 4) * 200, y: 40 + Math.floor(i / 4) * 160, width: ICON_SIZE, height: ICON_SIZE };

  // A node goes into the first zone that lists it, or whose box holds its centre.
  const zoneOf = new Map<string, { id: string; box: Box }>();
  zones.forEach((z, i) => {
    const id = `ss-z-${i + 1}`;
    const custom = attrs({ id, label: z.label, ss_role: "zone", ss_zone: z.kind });
    cells.push(
      `<object ${custom}><mxCell style="${esc(
        `rounded=0;whiteSpace=wrap;html=1;container=1;collapsible=0;pointerEvents=0;verticalAlign=top;align=left;spacingLeft=12;spacingTop=6;fontSize=13;fontColor=${INK};${ZONE_STYLES[z.kind]}`,
      )}" vertex="1" parent="1">` +
        `<mxGeometry x="${Math.round(z.box.x)}" y="${Math.round(z.box.y)}" width="${Math.round(z.box.width)}" height="${Math.round(z.box.height)}" as="geometry"/>` +
        `</mxCell></object>`,
    );
    graph.nodes.forEach((n, j) => {
      if (zoneOf.has(n.id)) return;
      const b = boxOf(n, j);
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const inside = z.members
        ? z.members.includes(n.id)
        : cx >= z.box.x && cx <= z.box.x + z.box.width && cy >= z.box.y && cy <= z.box.y + z.box.height;
      if (inside) zoneOf.set(n.id, { id, box: z.box });
    });
  });

  graph.nodes.forEach((n, i) => {
    const id = `ss-n-${i + 1}`;
    cellId.set(n.id, id);
    const box = boxOf(n, i);
    const zone = zoneOf.get(n.id);
    const x = zone ? box.x - zone.box.x : box.x;
    const y = zone ? box.y - zone.box.y : box.y;
    const label = n.tech ? `${n.label}<br><font style="font-size:10px;color:${MUTED}">${n.tech}</font>` : n.label;
    const custom = attrs({
      id,
      label,
      ss_id: n.id,
      ss_type: n.type,
      ss_tech: n.tech,
      ss_replicas: n.replicas,
      ss_dlq: n.dlq,
      ss_source: n.source,
      ss_confidence: n.confidence,
    });
    cells.push(
      `<object ${custom}><mxCell style="${esc(nodeStyle(n))}" vertex="1" parent="${zone?.id ?? "1"}">` +
        `<mxGeometry x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(box.width)}" height="${Math.round(box.height)}" as="geometry"/>` +
        `</mxCell></object>`,
    );
  });
  graph.edges.forEach((e, i) => {
    const source = cellId.get(e.from);
    const target = cellId.get(e.to);
    if (!source || !target) return;
    const custom = attrs({
      id: `ss-e-${i + 1}`,
      label: e.endpoint ?? e.protocol ?? "",
      ss_id: e.id,
      ss_kind: e.kind,
      ss_protocol: e.protocol,
      ss_endpoint: e.endpoint,
      ss_retry: e.retry,
      ss_timeout_ms: e.timeout_ms,
      ss_hot_path: e.hot_path,
      ss_source: e.source,
      ss_confidence: e.confidence,
    });
    const style = EDGE_STYLES[e.kind] + (e.hot_path ? "strokeWidth=2;" : "");
    cells.push(
      `<object ${custom}><mxCell style="${esc(style)}" edge="1" parent="1" source="${source}" target="${target}">` +
        `<mxGeometry relative="1" as="geometry"/></mxCell></object>`,
    );
  });

  return (
    `<mxfile host="StackSketch" agent="StackSketch" version="1.0">\n` +
    `  <diagram id="stacksketch" name="Architecture">\n` +
    `    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1654" pageHeight="1169" math="0" shadow="0">\n` +
    `      <root>\n        ${cells.join("\n        ")}\n      </root>\n` +
    `    </mxGraphModel>\n  </diagram>\n</mxfile>\n`
  );
}

// --- import -----------------------------------------------------------------

export interface DrawioImport {
  graph: Graph;
  /** Node id -> geometry from the file. */
  boxes: Map<string, Box>;
}

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  textNodeName: "#text",
  isArray: (name) => ["diagram", "mxCell", "object", "UserObject"].includes(name),
});

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** draw.io's compressed diagrams are base64(rawDeflate(encodeURIComponent(xml))). */
export function decompressDiagram(text: string): string {
  const inflated = strFromU8(inflateSync(base64ToBytes(text)));
  try {
    return decodeURIComponent(inflated);
  } catch {
    return inflated;
  }
}

export function htmlToText(label: string): string {
  return label
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

interface RawCell {
  id: string;
  label: string;
  style: string;
  vertex: boolean;
  edge: boolean;
  parent: string | null;
  source: string | null;
  target: string | null;
  geometry: Box | null;
  props: Record<string, string>;
}

function styleMap(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of style.split(";")) {
    if (!part) continue;
    const [k, v] = part.split("=");
    out[k] = v ?? "1";
  }
  return out;
}

function typeFromStyle(style: string): NodeType | null {
  const s = styleMap(style);
  const shape = s.shape ?? "";
  const icon = `${s.resIcon ?? ""} ${shape}`.toLowerCase();
  if (/rds|aurora|dynamodb|database|documentdb|sql/.test(icon)) return "database";
  if (/elasticache|cache|redis/.test(icon)) return "cache";
  if (/sqs|sns|kinesis|msk|eventbridge|queue|mq/.test(icon)) return "queue";
  if (/api_gateway|elastic_load_balancing|cloudfront|application_load_balancer/.test(icon)) return "gateway";
  if (/lambda|batch|fargate_task/.test(icon)) return "worker";
  if (/^(cylinder\d?|datastore)$/.test(shape)) return s.direction === "south" || s.direction === "north" ? "queue" : "database";
  if (shape === "cloud" || "cloud" in s) return "external";
  if (shape === "hexagon") return "gateway";
  if (shape === "process") return "worker";
  if (shape === "umlActor" || shape === "actor" || /mxgraph\.(basic\.)?person|user/.test(icon)) return "client";
  return null;
}

function readCell(cell: XmlNode, wrapper: XmlNode | null): RawCell {
  const a = (node: XmlNode | null, k: string) => (node?.[`@_${k}`] as string | undefined) ?? undefined;
  const props: Record<string, string> = {};
  if (wrapper) {
    for (const [k, v] of Object.entries(wrapper)) {
      if (k.startsWith("@_")) props[k.slice(2)] = String(v);
    }
  }
  const geomNode = cell.mxGeometry as XmlNode | undefined;
  const geometry =
    geomNode && a(geomNode, "relative") !== "1"
      ? {
          x: Number(a(geomNode, "x") ?? 0),
          y: Number(a(geomNode, "y") ?? 0),
          width: Number(a(geomNode, "width") ?? DEFAULT_BOX.width),
          height: Number(a(geomNode, "height") ?? DEFAULT_BOX.height),
        }
      : null;
  return {
    id: a(wrapper, "id") ?? a(cell, "id") ?? "",
    label: htmlToText(a(wrapper, "label") ?? a(cell, "value") ?? ""),
    style: a(cell, "style") ?? "",
    vertex: a(cell, "vertex") === "1",
    edge: a(cell, "edge") === "1",
    parent: a(cell, "parent") ?? null,
    source: a(cell, "source") ?? null,
    target: a(cell, "target") ?? null,
    geometry,
    props,
  };
}

const bool = (v: string | undefined): boolean | null =>
  v === undefined || v === "" ? null : v === "true" || v === "1";
const num = (v: string | undefined): number | null =>
  v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);
const str = (v: string | undefined): string | null => (v === undefined || v === "" ? null : v);

export function fromDrawio(xml: string): DrawioImport {
  const doc = parser.parse(xml) as XmlNode;
  let model: XmlNode | undefined;
  const mxfile = doc.mxfile as XmlNode | undefined;
  if (mxfile) {
    const diagram = (mxfile.diagram as XmlNode[] | undefined)?.[0];
    if (!diagram) throw new Error("draw.io file has no diagram");
    if (diagram.mxGraphModel) model = diagram.mxGraphModel as XmlNode;
    else if (typeof diagram["#text"] === "string") {
      model = (parser.parse(decompressDiagram(diagram["#text"] as string)) as XmlNode).mxGraphModel as XmlNode;
    }
  } else {
    model = doc.mxGraphModel as XmlNode | undefined;
  }
  const root = model?.root as XmlNode | undefined;
  if (!root) throw new Error("Not a draw.io diagram: no mxGraphModel root found");

  const cells: RawCell[] = [];
  for (const c of (root.mxCell as XmlNode[] | undefined) ?? []) cells.push(readCell(c, null));
  for (const key of ["object", "UserObject"]) {
    for (const o of (root[key] as XmlNode[] | undefined) ?? []) {
      const inner = (o.mxCell as XmlNode[] | undefined)?.[0];
      if (inner) cells.push(readCell(inner, o));
    }
  }

  const byId = new Map(cells.map((c) => [c.id, c]));
  const absolute = (c: RawCell): Box | null => {
    if (!c.geometry) return null;
    let { x, y } = c.geometry;
    let parent = c.parent ? byId.get(c.parent) : undefined;
    while (parent?.vertex && parent.geometry) {
      x += parent.geometry.x;
      y += parent.geometry.y;
      parent = parent.parent ? byId.get(parent.parent) : undefined;
    }
    return { ...c.geometry, x, y };
  };

  // Edge labels in draw.io are child vertices of the edge with an edgeLabel style.
  const edgeLabels = new Map<string, string>();
  for (const c of cells) {
    if (c.vertex && c.parent && byId.get(c.parent)?.edge && c.label) edgeLabels.set(c.parent, c.label);
  }

  const nodes: GraphNode[] = [];
  const boxes = new Map<string, Box>();
  const nodeIdByCell = new Map<string, string>();
  const used = new Set<string>();
  for (const c of cells) {
    if (!c.vertex) continue;
    if (c.parent && byId.get(c.parent)?.edge) continue;
    const style = styleMap(c.style);
    // Skip free text, labels, boundary boxes, and images that are only decoration.
    if ("text" in style || "edgeLabel" in style || "swimlane" in style || "group" in style || style.container === "1") continue;
    if (c.props.ss_role === "zone") continue;
    if (style.shape === "image" && !c.label && !c.props.ss_type) continue;
    if (!c.label && !c.props.ss_type) continue;

    const p = c.props;
    const parsed = parseNodeLabel(c.label);
    const styleType = typeFromStyle(c.style);
    const inferred = inferNodeType(`${parsed.label} ${parsed.tech ?? ""}`);
    const type: NodeType = isNodeType(p.ss_type) ? p.ss_type : styleType ?? inferred.type;
    const confidence = isNodeType(p.ss_type)
      ? num(p.ss_confidence) ?? 1
      : styleType
        ? 0.8
        : inferred.confidence;
    let id = p.ss_id || slugify(parsed.label) || `${type}-${nodes.length + 1}`;
    let n = 2;
    const base = id;
    while (used.has(id)) id = `${base}-${n++}`;
    used.add(id);
    nodeIdByCell.set(c.id, id);
    nodes.push({
      id,
      type,
      label: parsed.label || type,
      tech: p.ss_tech !== undefined ? str(p.ss_tech) : parsed.tech,
      replicas: p.ss_replicas !== undefined ? num(p.ss_replicas) : parsed.replicas,
      dlq: type === "queue" ? bool(p.ss_dlq) : null,
      canvas_id: null,
      source: isSource(p.ss_source) ? p.ss_source : "user",
      confidence,
    });
    const box = absolute(c);
    if (box) boxes.set(id, box);
  }

  const edges: GraphEdge[] = [];
  const usedEdges = new Set<string>();
  for (const c of cells) {
    if (!c.edge || !c.source || !c.target) continue;
    const from = nodeIdByCell.get(c.source);
    const to = nodeIdByCell.get(c.target);
    if (!from || !to || from === to) continue;
    const p = c.props;
    const style = styleMap(c.style);
    const label = c.label || edgeLabels.get(c.id) || "";
    const parsed = parseEdgeLabel(label);
    const dotted = style.dashed === "1" && /^1\s/.test(style.dashPattern ?? "");
    const kind: EdgeKind = isEdgeKind(p.ss_kind)
      ? p.ss_kind
      : style.shape === "link" || dotted
        ? "stream"
        : style.dashed === "1"
          ? "async"
          : "sync";
    let id = p.ss_id || `${from}->${to}`;
    let n = 2;
    const base = id;
    while (usedEdges.has(id)) id = `${base}#${n++}`;
    usedEdges.add(id);
    edges.push({
      id,
      from,
      to,
      kind,
      protocol: p.ss_protocol !== undefined ? str(p.ss_protocol) : parsed.protocol,
      endpoint: p.ss_endpoint !== undefined ? str(p.ss_endpoint) : parsed.endpoint,
      retry: p.ss_retry !== undefined ? bool(p.ss_retry) : parsed.retry,
      timeout_ms: p.ss_timeout_ms !== undefined ? num(p.ss_timeout_ms) : parsed.timeout_ms,
      hot_path: p.ss_hot_path !== undefined ? bool(p.ss_hot_path) : parsed.hot_path,
      canvas_id: null,
      source: isSource(p.ss_source) ? p.ss_source : "user",
      confidence: num(p.ss_confidence) ?? 1,
    });
  }

  return { graph: { nodes, edges }, boxes };
}
