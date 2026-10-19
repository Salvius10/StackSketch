// draw.io (mxGraph XML) export and import. The XML is graph-native: vertices
// are nodes, edges carry source and target. StackSketch fields ride along as
// custom properties on <object> wrappers so a round trip is lossless.

import { XMLParser } from "fast-xml-parser";
import { inflateSync, strFromU8 } from "fflate";
import type { Box } from "./derive";
import { inferNodeType, parseEdgeLabel, parseNodeLabel, slugify } from "./derive";
import { type ArrowKind, type Diagram, type DiagramEdge, type DiagramNode, type Side, nameDrop } from "./diagram";
import { ICON_SIZE, INK, iconFor, iconOf, iconSvg } from "./icons";
import type { ZoneKind } from "./layout";
import { lookOf, rowsLayout, safeColour, shapeDef, shapeSvg, tableLayout } from "./shapes";
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

// --- the whole diagram ----------------------------------------------------------

const DRAWIO_ARROW: Record<ArrowKind, string> = {
  none: "none;",
  arrow: "block;Fill=1;",
  open: "open;Fill=0;",
  triangle: "block;Fill=0;",
  diamond: "diamond;Fill=1;",
  "diamond-open": "diamond;Fill=0;",
  circle: "oval;Fill=1;",
  "er-one": "ERmandOne;Fill=0;",
  "er-many": "ERmany;Fill=0;",
  "er-zero-many": "ERzeroToMany;Fill=0;",
  "er-one-many": "ERoneToMany;Fill=0;",
  "er-zero-one": "ERzeroToOne;Fill=0;",
};

const arrowStyle = (end: "start" | "end", kind: ArrowKind | undefined, fallback: ArrowKind) => {
  const [name, fill] = (DRAWIO_ARROW[kind ?? fallback] ?? DRAWIO_ARROW[fallback]).split(";");
  return `${end}Arrow=${name};${fill ? `${end}${fill};` : ""}`;
};

const ANCHOR: Record<Side, string> = { top: "X=0.5;{}Y=0;", bottom: "X=0.5;{}Y=1;", left: "X=0;{}Y=0.5;", right: "X=1;{}Y=0.5;" };
const anchor = (which: "exit" | "entry", side: Side | null | undefined) => (side ? `${which}${ANCHOR[side].replace("{}", which)}` : "");

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const htmlLines = (s: string) => html(s).replace(/\n/g, "<br>");

function rowsLabel(kind: "class" | "entity" | "list", label: string): string {
  const layout = rowsLayout(kind, label);
  const head = layout.head.map((l, i) => (i === layout.head.length - 1 ? `<b>${html(l)}</b>` : html(l))).join("<br>");
  let out = `<p style="margin:0px;margin-top:4px;text-align:center;">${head}</p><hr size="1">`;
  let lastY = layout.headH;
  for (const row of layout.rows) {
    // A separator between rows (a class's attributes and methods) sits in the gap before the row.
    if (layout.lines.some((y) => y > lastY && y < row.y)) out += `<hr size="1">`;
    out += `<p style="margin:0px;margin-left:6px;">${row.key ? `<b>${html(row.key)}</b>&nbsp;&nbsp;` : ""}${html(row.text)}</p>`;
    lastY = row.y;
  }
  return out;
}

function tableLabel(label: string): string {
  const { cells, cols } = tableLayout(label, 1, 1);
  const rows = cells.map((r, i) => `<tr>${Array.from({ length: cols }, (_, c) => `<td>${i === 0 ? `<b>${html(r[c] ?? "")}</b>` : html(r[c] ?? "")}</td>`).join("")}</tr>`);
  return `<table border="1" cellpadding="4" style="width:100%;height:100%;border-collapse:collapse;">${rows.join("")}</table>`;
}

/** A node's draw.io style and label. */
function vertex(n: DiagramNode, w: number, h: number): { style: string; label: string } {
  if (n.kind === "component") {
    const label = n.tech ? `${html(n.label)}<br><font style="font-size:10px;color:${MUTED}">${html(n.tech)}</font>` : html(n.label);
    return {
      style:
        "shape=image;html=1;imageAspect=0;aspect=fixed;verticalLabelPosition=bottom;verticalAlign=top;" +
        `labelPosition=center;align=center;fontSize=12;fontColor=${INK};image=data:image/svg+xml,${btoa(iconSvg(iconOf(n)))};`,
      label,
    };
  }
  if (n.kind === "note") {
    return { style: "text;html=1;whiteSpace=wrap;align=left;verticalAlign=top;spacingLeft=8;fillColor=#FFFFFF;strokeColor=#D5DBDB;rounded=1;arcSize=4;", label: htmlLines(n.label) };
  }
  const look = lookOf(n.style, n.kind === "shape" ? shapeDef(n.shape) : null);
  const colours = (fill: string) =>
    `fillColor=${fill};strokeColor=${look.stroke};fontColor=${look.fontColor};fontSize=${look.fontSize};strokeWidth=${look.strokeWidth};` +
    `fontStyle=${(look.bold ? 1 : 0) + (look.italic ? 2 : 0) + (look.underline ? 4 : 0)};` +
    (look.dashed ? "dashed=1;" : "") +
    (look.opacity < 1 ? `opacity=${Math.round(look.opacity * 100)};` : "");
  if (n.kind === "zone") {
    const z = n.zone ?? "system";
    const custom = n.style?.fill || n.style?.stroke || n.style?.dashed !== undefined;
    const base = custom ? colours(safeColour(n.style?.fill, "none")).replace(/fontSize=\d+;/, "fontSize=13;") : ZONE_STYLES[z];
    const kind =
      n.shape === "swimlane"
        ? "swimlane;horizontal=0;startSize=30;whiteSpace=wrap;html=1;container=1;collapsible=0;"
        : "rounded=0;whiteSpace=wrap;html=1;container=1;collapsible=0;pointerEvents=0;verticalAlign=top;align=left;spacingLeft=12;spacingTop=6;";
    return { style: `${kind}fontSize=13;fontColor=${INK};${base}`, label: html(n.label) };
  }
  const def = shapeDef(n.shape);
  const fill = def.solid ? look.stroke : look.fill;
  const text = `align=${look.align};verticalAlign=${look.valign};`;
  if (def.rows === "table") return { style: `html=1;whiteSpace=wrap;overflow=fill;${colours(fill)}`, label: tableLabel(n.label) };
  if (def.rows) return { style: `verticalAlign=top;align=left;overflow=fill;html=1;whiteSpace=wrap;${colours(fill)}`, label: rowsLabel(def.rows, n.label) };
  const label = def.label === "none" ? "" : htmlLines(n.label);
  const below = def.label === "below" ? "verticalLabelPosition=bottom;verticalAlign=top;labelPosition=center;align=center;" : "";
  if (def.drawio) return { style: `${def.drawio}${below || text}${colours(fill)}`, label };
  // No draw.io shape draws this one: embed the outline as a picture, keeping the text editable.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="visible">${shapeSvg(def, w, h, look, n.label)}</svg>`;
  return { style: `shape=image;html=1;imageAspect=0;whiteSpace=wrap;${below || text}fontColor=${look.fontColor};fontSize=${look.fontSize};image=data:image/svg+xml,${btoa(svg)};`, label };
}

/** A connector's draw.io style; `from` and `to` are its ends, whose names a line going down should pass under. */
function connector(e: DiagramEdge, from: DiagramNode, to: DiagramNode): string {
  const kind = e.kind ?? "sync";
  const stroke = safeColour(e.stroke, INK);
  const line = e.line === "straight" ? "edgeStyle=none;" : e.line === "curved" ? "edgeStyle=none;curved=1;" : "edgeStyle=orthogonalEdgeStyle;";
  return (
    `${line}rounded=0;html=1;strokeColor=${stroke};fontSize=11;fontColor=${MUTED};labelBackgroundColor=#ffffff;` +
    (kind === "async" ? "dashed=1;" : kind === "stream" ? "dashed=1;dashPattern=1 4;" : "") +
    `strokeWidth=${e.width ?? (e.hot_path ? 2 : 1)};` +
    arrowStyle("end", e.endArrow, "arrow") +
    arrowStyle("start", e.startArrow, "none") +
    anchor("exit", e.sourceSide) +
    anchor("entry", e.targetSide) +
    (e.sourceSide === "bottom" && nameDrop(from) ? `exitDy=${nameDrop(from)};` : "") +
    (e.targetSide === "bottom" && nameDrop(to) ? `entryDy=${nameDrop(to)};` : "")
  );
}

/**
 * The whole diagram as a .drawio file: shapes as draw.io's own shapes, zones as
 * containers, connectors with their arrowheads. What the reviewer knows about a
 * component or connector rides along as ss_ properties, as in `toDrawio`.
 */
export function diagramToDrawio(diagram: Diagram, graph?: Graph): string {
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const depth = (n: DiagramNode) => {
    let d = 0;
    for (let p = n.parent ? byId.get(n.parent) : undefined; p && d < 50; p = p.parent ? byId.get(p.parent) : undefined) d++;
    return d;
  };
  // Parents before children, and the stacking order within each level.
  const ordered = [...diagram.nodes].sort((a, b) => depth(a) - depth(b) || (a.kind === "zone" ? 0 : 1) - (b.kind === "zone" ? 0 : 1) || (a.z ?? 0) - (b.z ?? 0));
  const cellId = new Map(ordered.map((n, i) => [n.id, `ss-${i + 1}`]));
  const graphNode = new Map((graph?.nodes ?? []).filter((n) => n.canvas_id).map((n) => [n.canvas_id!, n]));
  const graphEdge = new Map((graph?.edges ?? []).filter((e) => e.canvas_id).map((e) => [e.canvas_id!, e]));
  const cells: string[] = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];

  for (const n of ordered) {
    const id = cellId.get(n.id)!;
    const parent = n.parent && cellId.has(n.parent) ? cellId.get(n.parent)! : "1";
    const w = n.kind === "component" ? ICON_SIZE : (n.w ?? ICON_SIZE);
    const h = n.kind === "component" ? ICON_SIZE : (n.h ?? ICON_SIZE);
    const { style, label } = vertex(n, w, h);
    const g = graphNode.get(n.id);
    const custom = attrs({
      id,
      label,
      ...(n.kind === "zone" ? { ss_role: "zone", ss_zone: n.zone ?? "system" } : {}),
      ...(g
        ? { ss_id: g.id, ss_type: g.type, ss_tech: g.tech, ss_replicas: g.replicas, ss_dlq: g.dlq, ss_source: g.source, ss_confidence: g.confidence }
        : {}),
    });
    cells.push(
      `<object ${custom}><mxCell style="${esc(style)}" vertex="1" parent="${parent}">` +
        `<mxGeometry x="${Math.round(n.x)}" y="${Math.round(n.y)}" width="${Math.round(w)}" height="${Math.round(h)}" as="geometry"/>` +
        `</mxCell></object>`,
    );
  }

  diagram.edges.forEach((e, i) => {
    const source = cellId.get(e.source);
    const target = cellId.get(e.target);
    if (!source || !target) return;
    const g = graphEdge.get(e.id);
    const custom = attrs({
      id: `ss-e-${i + 1}`,
      label: html(e.label?.trim() || e.endpoint || e.protocol || ""),
      ...(g
        ? {
            ss_id: g.id,
            ss_kind: g.kind,
            ss_protocol: g.protocol,
            ss_endpoint: g.endpoint,
            ss_retry: g.retry,
            ss_timeout_ms: g.timeout_ms,
            ss_hot_path: g.hot_path,
            ss_source: g.source,
            ss_confidence: g.confidence,
          }
        : {}),
    });
    const waypoints = (e.points ?? []).slice(1, -1);
    const geometry = waypoints.length
      ? `<mxGeometry relative="1" as="geometry"><Array as="points">${waypoints.map((p) => `<mxPoint x="${Math.round(p.x)}" y="${Math.round(p.y)}"/>`).join("")}</Array></mxGeometry>`
      : `<mxGeometry relative="1" as="geometry"/>`;
    cells.push(`<object ${custom}><mxCell style="${esc(connector(e, byId.get(e.source)!, byId.get(e.target)!))}" edge="1" parent="1" source="${source}" target="${target}">${geometry}</mxCell></object>`);
  });

  return (
    `<mxfile host="StackSketch" agent="StackSketch" version="1.0">\n` +
    `  <diagram id="stacksketch" name="Diagram">\n` +
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
