// Draw the diagram as a standalone SVG for export: pure SVG (no embedded HTML),
// so it opens in any editor, always in the light palette, with exactly the
// connector geometry the canvas uses. PNG export rasterises this SVG.

import {
  type Box,
  type Diagram,
  type DiagramNode,
  type Side,
  absoluteBox,
  sidesBetween,
} from "@stacksketch/graph";
import { NAME_SPACE, union } from "./arrange";
import { componentIcon } from "./library";
import { connectorPath, sidePoint, stepAnchor } from "./routes";

const INK = "#232F3E";
const MUTED = "#545B64";
const FONT = "Helvetica, Arial, sans-serif";
const DASH: Record<string, string> = { async: "7 5", stream: "2 4" };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const textWidth = (s: string, size: number) => s.length * size * 0.56;

function wrap(text: string, width: number, size: number): string[] {
  const max = Math.max(8, Math.floor(width / (size * 0.56)));
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

export function diagramToSvg(diagram: Diagram): { svg: string; width: number; height: number } {
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const box = (n: DiagramNode) => absoluteBox(n, byId);
  const parts: { zones: string[]; edges: string[]; labels: string[]; nodes: string[] } = { zones: [], edges: [], labels: [], nodes: [] };
  const extents: Box[] = [];

  // Zones, outermost first so inner ones draw on top.
  const depth = (n: DiagramNode) => {
    let d = 0;
    for (let p = n.parent ? byId.get(n.parent) : undefined; p && d < 20; p = p.parent ? byId.get(p.parent) : undefined) d++;
    return d;
  };
  for (const z of diagram.nodes.filter((n) => n.kind === "zone").sort((a, b) => depth(a) - depth(b))) {
    const b = box(z);
    const s = ZONE_STYLE[z.zone ?? "system"];
    extents.push(b);
    parts.zones.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/>` +
        `<text x="${b.x + 12}" y="${b.y + 21}" font-size="13" font-weight="600" fill="${INK}">${esc(z.label)}</text>`,
    );
  }

  // Connectors.
  for (const e of diagram.edges) {
    const a = byId.get(e.source);
    const t = byId.get(e.target);
    if (!a || !t || a.kind !== "component" || t.kind !== "component") continue;
    const ab = box(a);
    const tb = box(t);
    const [defStart, defEnd] = sidesBetween(ab, tb);
    const startSide: Side = e.sourceSide ?? defStart;
    const endSide: Side = e.targetSide ?? defEnd;
    const start = sidePoint(ab, startSide);
    const end = sidePoint(tb, endSide);
    const { path, mid } = connectorPath(start, startSide, end, endSide, e.points);
    const dash = DASH[e.kind ?? "sync"];
    parts.edges.push(
      `<path d="${path}" fill="none" stroke="${INK}" stroke-width="${e.hot_path ? 2.4 : 1.4}"${dash ? ` stroke-dasharray="${dash}"` : ""} marker-end="url(#arrow)"/>`,
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

  // Components and notes.
  for (const n of diagram.nodes) {
    const b = box(n);
    if (n.kind === "component") {
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
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${vx} ${vy} ${width} ${height}" font-family="${FONT}">` +
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${INK}"/></marker></defs>` +
    `<rect x="${vx}" y="${vy}" width="${width}" height="${height}" fill="#ffffff"/>` +
    parts.zones.join("") +
    parts.edges.join("") +
    parts.nodes.join("") +
    parts.labels.join("") +
    `</svg>`;
  return { svg, width, height };
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
