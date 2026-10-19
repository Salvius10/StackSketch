// Draw the diagram as a standalone SVG for export: pure SVG (no embedded HTML),
// so it opens in any editor, always in the light palette, with exactly the
// shapes, arrowheads and connector geometry the canvas uses. PNG export
// rasterises this SVG; the sidebar and template previews show it as an image.

import {
  type Box,
  type Diagram,
  type DiagramNode,
  INK,
  type Look,
  ROW_H,
  type Side,
  absoluteBox,
  lookOf,
  nameDrop,
  rowsLayout,
  safeColour,
  shapeDef,
  shapeSvg,
  sidesBetween,
  tableLayout,
} from "@stacksketch/graph";
import { NAME_SPACE, connectable, union } from "./arrange";
import { componentIcon, zoneBadge } from "./library";
import { markerSvg } from "./markers";
import { connectorPath, sidePoint, stepAnchor } from "./routes";

const MUTED = "#545B64";
const FONT = "Helvetica, Arial, sans-serif";
const DASH: Record<string, string> = { async: "7 5", stream: "2 4" };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const textWidth = (s: string, size: number) => s.length * size * 0.56;

function wrap(text: string, width: number, size: number): string[] {
  const max = Math.max(4, Math.floor(width / (size * 0.56)));
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > max) {
        out.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out;
}

const ZONE_STYLE: Record<string, { fill: string; stroke: string; dash?: string }> = {
  system: { fill: "none", stroke: INK },
  clients: { fill: "#F7F9FB", stroke: "#AAB7B8" },
  external: { fill: "#F7F9FB", stroke: "#AAB7B8", dash: "5 4" },
};

/** Font attributes for a look. */
const font = (look: Look) =>
  `font-size="${look.fontSize}" fill="${look.fontColor}"` +
  (look.bold ? ` font-weight="700"` : "") +
  (look.italic ? ` font-style="italic"` : "") +
  (look.underline ? ` text-decoration="underline"` : "");

const ANCHOR = { left: "start", center: "middle", right: "end" } as const;

/** Lines of text in a box, aligned as the look says. */
function textBlock(text: string, box: { x: number; y: number; w: number; h: number }, look: Look): string {
  const lines = wrap(text, box.w, look.fontSize);
  const lh = look.fontSize * 1.25;
  const total = lines.length * lh;
  const top = look.valign === "top" ? box.y : look.valign === "bottom" ? box.y + box.h - total : box.y + (box.h - total) / 2;
  const x = look.align === "left" ? box.x : look.align === "right" ? box.x + box.w : box.x + box.w / 2;
  return lines
    .map((l, i) => `<text x="${x}" y="${(top + lh * i + look.fontSize * 0.95).toFixed(1)}" text-anchor="${ANCHOR[look.align]}" ${font(look)} xml:space="preserve">${esc(l)}</text>`)
    .join("");
}

/** A shape: its outline, then its text as the canvas lays it out. */
function shapeMarkup(n: DiagramNode, b: Box): { svg: string; extent: Box } {
  const def = shapeDef(n.shape);
  const look = lookOf(n.style, def);
  const { width: w, height: h } = b;
  let text = "";
  let extent: Box = b;
  if (def.label === "none") {
    // nothing to write
  } else if (def.rows === "table") {
    const t = tableLayout(n.label, w, h);
    t.cells.forEach((row, r) =>
      row.forEach((cell, c) => {
        const cellLook = { ...look, bold: look.bold || r === 0, align: "center" as const, valign: "middle" as const };
        text += textBlock(cell, { x: c * t.colW + 3, y: r * t.rowH, w: t.colW - 6, h: t.rowH }, cellLook);
      }),
    );
  } else if (def.rows) {
    const layout = rowsLayout(def.rows, n.label);
    const headTop = (layout.headH - layout.head.length * 15) / 2;
    layout.head.forEach((line, i) => {
      const last = i === layout.head.length - 1;
      text += `<text x="${w / 2}" y="${(headTop + 15 * i + 11.5).toFixed(1)}" text-anchor="middle" ${font({ ...look, bold: last || look.bold })}>${esc(line)}</text>`;
    });
    const left = (layout.keyCol ?? 0) + 6;
    for (const r of layout.rows.filter((row) => row.y + ROW_H <= h + 4)) {
      const y = (r.y + ROW_H * 0.7).toFixed(1);
      if (r.key) text += `<text x="6" y="${y}" ${font({ ...look, bold: true, fontSize: look.fontSize - 1 })}>${esc(r.key)}</text>`;
      const x = look.align === "center" ? (left + w - 6) / 2 : look.align === "right" ? w - 6 : left;
      text += `<text x="${x}" y="${y}" text-anchor="${ANCHOR[look.align]}" ${font(look)} xml:space="preserve">${esc(r.text)}</text>`;
    }
  } else if (n.label && def.label === "below") {
    const bw = Math.max(w, 160);
    const box = { x: (w - bw) / 2, y: h + 4, w: bw, h: 0 };
    text = textBlock(n.label, box, { ...look, align: "center", valign: "top" });
    const lines = wrap(n.label, bw, look.fontSize).length;
    extent = { x: b.x + box.x, y: b.y, width: bw, height: h + 8 + lines * look.fontSize * 1.25 };
  } else if (n.label) {
    text = textBlock(n.label, def.text(w, h), look);
  }
  return { svg: `<g transform="translate(${b.x} ${b.y})">${shapeSvg(def, w, h, look, def.rows ? n.label : "")}${text}</g>`, extent };
}

function zoneMarkup(z: DiagramNode, b: Box): string {
  const s = z.style;
  const custom = s && (s.fill !== undefined || s.stroke !== undefined || s.dashed !== undefined || s.strokeWidth !== undefined);
  const base = ZONE_STYLE[z.zone ?? "system"] ?? ZONE_STYLE.system;
  const look = custom ? lookOf({ fill: "none", strokeWidth: 1.2, ...s }, null) : null;
  const fill = look ? look.fill : base.fill;
  const stroke = look ? look.stroke : base.stroke;
  const dash = look ? (look.dashed ? "6 4" : "") : (base.dash ?? "");
  const width = look ? look.strokeWidth : 1;
  let out = `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
  const badge = zoneBadge(z);
  if (z.shape === "swimlane") {
    const cx = b.x + 15;
    const cy = b.y + b.height / 2;
    out +=
      `<path d="M${b.x + 30} ${b.y}V${b.y + b.height}" stroke="${stroke}" stroke-width="${width}"/>` +
      `<text x="${cx}" y="${cy}" transform="rotate(-90 ${cx} ${cy})" dy="4.5" text-anchor="middle" font-size="13" font-weight="600" fill="${INK}">${esc(z.label)}</text>`;
  } else {
    if (badge) out += `<image xlink:href="${badge}" x="${b.x}" y="${b.y}" width="28" height="28"/>`;
    out += `<text x="${b.x + (badge ? 36 : 12)}" y="${b.y + (badge ? 19 : 21)}" font-size="13" font-weight="600" fill="${INK}">${esc(z.label)}</text>`;
  }
  return out;
}

export function diagramToSvg(diagram: Diagram): { svg: string; width: number; height: number } {
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const box = (n: DiagramNode) => absoluteBox(n, byId);
  const parts: { zones: string[]; edges: string[]; labels: string[]; nodes: string[] } = { zones: [], edges: [], labels: [], nodes: [] };
  const extents: Box[] = [];
  const markers = new Map<string, string>();
  const marker = (kind: Parameters<typeof markerSvg>[1], colour: string, width: number): string | null => {
    if (!kind || kind === "none") return null;
    const key = `${kind}|${colour}|${width}`;
    let id = markers.get(key);
    if (!id) {
      id = `m${markers.size + 1}`;
      markers.set(key, id);
    }
    return id;
  };

  // Zones, outermost first so inner ones draw on top.
  const depth = (n: DiagramNode) => {
    let d = 0;
    for (let p = n.parent ? byId.get(n.parent) : undefined; p && d < 20; p = p.parent ? byId.get(p.parent) : undefined) d++;
    return d;
  };
  for (const z of diagram.nodes.filter((n) => n.kind === "zone").sort((a, b) => depth(a) - depth(b) || (a.z ?? 0) - (b.z ?? 0))) {
    const b = box(z);
    extents.push(b);
    parts.zones.push(zoneMarkup(z, b));
  }

  // Connectors.
  const used: { id: string; kind: Parameters<typeof markerSvg>[1]; colour: string; width: number }[] = [];
  for (const e of diagram.edges) {
    const a = byId.get(e.source);
    const t = byId.get(e.target);
    if (!connectable(a) || !connectable(t)) continue;
    const ab = box(a);
    const tb = box(t);
    const [defStart, defEnd] = sidesBetween(ab, tb);
    const startSide: Side = e.sourceSide ?? defStart;
    const endSide: Side = e.targetSide ?? defEnd;
    // A component's bottom point is under its name.
    const below = (n: DiagramNode, b: Box, side: Side) => (side === "bottom" ? { ...b, height: b.height + nameDrop(n) } : b);
    const start = sidePoint(below(a, ab, startSide), startSide);
    const end = sidePoint(below(t, tb, endSide), endSide);
    const { path, mid } = connectorPath(start, startSide, end, endSide, e.points, e.line);
    const dash = DASH[e.kind ?? "sync"];
    const colour = safeColour(e.stroke, INK);
    const width = e.width ?? (e.hot_path ? 2.4 : 1.4);
    const ms = marker(e.startArrow ?? "none", colour, width);
    const me = marker(e.endArrow ?? "arrow", colour, width);
    for (const [id, kind] of [
      [ms, e.startArrow],
      [me, e.endArrow ?? "arrow"],
    ] as const) {
      if (id && !used.some((u) => u.id === id)) used.push({ id, kind, colour, width });
    }
    parts.edges.push(
      `<path d="${path}" fill="none" stroke="${colour}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ""}` +
        `${ms ? ` marker-start="url(#${ms})"` : ""}${me ? ` marker-end="url(#${me})"` : ""}/>`,
    );
    const text = e.label?.trim() || e.endpoint || e.protocol || "";
    if (text) {
      const w = textWidth(text, 12) + 10;
      parts.labels.push(
        `<rect x="${mid.x - w / 2}" y="${mid.y - 9}" width="${w}" height="18" rx="3" fill="#ffffff"/>` +
          `<text x="${mid.x}" y="${mid.y + 4}" font-size="12" fill="${MUTED}" text-anchor="middle">${esc(text)}</text>`,
      );
      extents.push({ x: mid.x - w / 2, y: mid.y - 9, width: w, height: 18 });
    }
    const steps = e.steps ?? [];
    if (steps.length) {
      const at = stepAnchor(start, startSide);
      const widths = steps.map((n) => (n < 10 ? 20 : 26));
      let x = at.x - (widths.reduce((s, w) => s + w, 0) + (steps.length - 1) * 3) / 2;
      steps.forEach((n, i) => {
        parts.labels.push(
          `<rect x="${x}" y="${at.y - 10}" width="${widths[i]}" height="20" rx="4" fill="#0B6BCB"/>` +
            `<text x="${x + widths[i] / 2}" y="${at.y + 4}" font-size="12" font-weight="700" fill="#ffffff" text-anchor="middle">${n}</text>`,
        );
        x += widths[i] + 3;
      });
      extents.push({ x: at.x - 30, y: at.y - 10, width: 60, height: 20 });
    }
  }

  // Shapes, components and notes, back to front.
  for (const n of diagram.nodes.filter((x) => x.kind !== "zone").sort((a, b) => (a.z ?? 0) - (b.z ?? 0))) {
    const b = box(n);
    if (n.kind === "shape") {
      const { svg, extent } = shapeMarkup(n, b);
      parts.nodes.push(svg);
      extents.push(extent);
    } else if (n.kind === "component") {
      const lines = [n.label || "Unnamed", n.tech].filter((l): l is string => !!l);
      const cx = b.x + b.width / 2;
      parts.nodes.push(
        `<image xlink:href="${componentIcon(n)}" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}"/>` +
          `<text x="${cx}" y="${b.y + b.height + 18}" font-size="13" font-weight="500" fill="${INK}" text-anchor="middle">${esc(lines[0])}</text>` +
          (lines[1] ? `<text x="${cx}" y="${b.y + b.height + 34}" font-size="11" fill="${MUTED}" text-anchor="middle">${esc(lines[1])}</text>` : ""),
      );
      const w = Math.max(b.width, ...lines.map((l) => textWidth(l, 13)));
      extents.push({ x: cx - w / 2, y: b.y, width: w, height: b.height + NAME_SPACE });
    } else if (n.kind === "note") {
      const [title, ...rest] = n.label.split("\n");
      const bodyLines = n.legendFor ? rest.flatMap((l) => wrap(l, b.width - 24, 12.5)) : wrap(n.label, b.width - 24, 13);
      const height = Math.max(b.height, (n.legendFor ? 34 : 18) + bodyLines.length * 18);
      let y = b.y + 22;
      let body = "";
      if (n.legendFor) {
        body += `<text x="${b.x + 12}" y="${y}" font-size="14" font-weight="700" fill="${INK}">${esc(title)}</text>`;
        y += 22;
      }
      for (const line of bodyLines) {
        body += `<text x="${b.x + 12}" y="${y}" font-size="${n.legendFor ? 12.5 : 13}" fill="${INK}" xml:space="preserve">${esc(line)}</text>`;
        y += 18;
      }
      parts.nodes.push(`<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${height}" rx="4" fill="#ffffff" stroke="#D5DBDB"/>${body}`);
      extents.push({ ...b, height });
    }
  }

  const bounds = union(extents) ?? { x: 0, y: 0, width: 200, height: 100 };
  const pad = 32;
  const vx = Math.floor(bounds.x - pad);
  const vy = Math.floor(bounds.y - pad);
  const width = Math.ceil(bounds.width + pad * 2);
  const height = Math.ceil(bounds.height + pad * 2);
  const defs = used.map((u) => markerSvg(u.id, u.kind, u.colour, u.width, "#ffffff")).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${vx} ${vy} ${width} ${height}" font-family="${FONT}">` +
    `<defs>${defs}</defs>` +
    `<rect x="${vx}" y="${vy}" width="${width}" height="${height}" fill="#ffffff"/>` +
    parts.zones.join("") +
    parts.edges.join("") +
    parts.nodes.join("") +
    parts.labels.join("") +
    `</svg>`;
  return { svg, width, height };
}

/** The diagram as an image URL, for previews. */
export function diagramToSvgDataUrl(diagram: Diagram): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(diagramToSvg(diagram).svg)}`;
}

/** Rasterise an SVG at `scale` times its size. */
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode the PNG"))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}
