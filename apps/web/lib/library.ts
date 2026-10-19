// The shape libraries as the editor uses them: the catalog lives in the graph
// package (so templates and the server agree on it); here are the icons, the
// sidebar previews and the colours shapes take on the canvas.

import {
  type DiagramNode,
  type IconFrame,
  type LibraryItem,
  type Look,
  INK,
  type NodeType,
  iconDataUrl,
  iconOf,
  isGlyph,
  lookOf,
  shapeDef,
  shapeSvg,
} from "@stacksketch/graph";
import { markerId, markerSvg } from "./markers";

export {
  DEFAULT_LIBRARIES,
  LIBRARIES,
  type Library,
  type LibraryItem,
  itemSize,
  libraryItem,
  nodeFromItem,
  searchLibraries,
} from "@stacksketch/graph";

export const DRAG_MIME = "application/x-stacksketch-item";
/** A scratchpad entry being dragged: its index. */
export const SCRATCH_MIME = "application/x-stacksketch-scratch";

const icons = new Map<string, string>();

/** The icon a component shows (its pinned one with its colour and frame, or what its type and name call for), as a data URL. */
export function componentIcon(node: { type?: NodeType | null; label?: string; tech?: string | null; icon?: string; tint?: string; frame?: IconFrame }): string {
  const spec = iconOf(node);
  const key = `${spec.glyph}|${spec.outline}|${spec.tint ?? ""}|${spec.frame ?? ""}`;
  let url = icons.get(key);
  if (!url) {
    url = iconDataUrl(spec);
    icons.set(key, url);
  }
  return url;
}

/** Whether a component's icon is drawn in ink without a frame (dark mode inverts those). */
export function isOutlineIcon(node: Parameters<typeof componentIcon>[0]): boolean {
  return iconOf(node).outline;
}

/** A badge icon for a zone, e.g. the AWS cloud in the corner of an "AWS Cloud" group. */
export function zoneBadge(zone: Pick<DiagramNode, "icon" | "tint">): string | null {
  return isGlyph(zone.icon) ? componentIcon({ icon: zone.icon, tint: zone.tint, frame: zone.tint ? "tile" : undefined, type: "service" }) : null;
}

// --- colours on the canvas -----------------------------------------------------------------

const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

/**
 * A shape's look on the canvas: the default ink and white follow the theme, so a
 * plain rectangle is light-on-dark in dark mode. Colours someone chose stay as they are.
 */
export function canvasLook(look: Look): Look {
  const plain = same(look.fill, "#FFFFFF") || look.fill === "none";
  return {
    ...look,
    fill: same(look.fill, "#FFFFFF") ? "var(--ss-shape-fill)" : look.fill,
    stroke: same(look.stroke, INK) ? "var(--ss-ink)" : look.stroke,
    // Dark text on a light fill someone chose stays dark.
    fontColor: plain && same(look.fontColor, INK) ? "var(--ss-ink)" : look.fontColor,
  };
}

export const onCanvas = (colour: string) => (same(colour, INK) ? "var(--ss-ink)" : colour);

// --- sidebar previews ----------------------------------------------------------------------

const previews = new Map<string, string>();

/**
 * A small picture of a library item, as SVG markup (shapes, groups and connectors).
 * Components show their icon instead, and text items their text.
 */
export function itemPreview(item: LibraryItem): string | null {
  const cached = previews.get(item.key);
  if (cached !== undefined) return cached || null;
  let svg = "";
  if (item.kind === "shape") {
    const def = shapeDef(item.shape);
    const look = canvasLook(lookOf({ ...item.style, strokeWidth: 1.2 }, def));
    const pad = 2;
    svg =
      `<svg class="ss-thumb" viewBox="${-pad} ${-pad} ${item.w + pad * 2} ${item.h + pad * 2}" preserveAspectRatio="xMidYMid meet">` +
      `${shapeSvg(def, item.w, item.h, look, item.label)}</svg>`;
  } else if (item.kind === "zone") {
    const look = canvasLook(lookOf({ fill: "none", ...item.style, strokeWidth: 1.2 }, null));
    const dash = look.dashed ? "stroke-dasharray:3 2;" : "";
    const lane = item.lane ? `<path d="M9 1V27" style="fill:none;stroke:${look.stroke}"/>` : "";
    const badge = item.icon ? `<rect x="1" y="1" width="7" height="7" style="fill:${item.tint ?? "var(--ss-ink)"}"/>` : "";
    svg =
      `<svg class="ss-thumb" viewBox="0 0 36 28">` +
      `<rect x="1" y="1" width="34" height="26" rx="1" style="fill:${look.fill};stroke:${look.stroke};stroke-width:1.2;${dash}"/>${lane}${badge}</svg>`;
  } else if (item.kind === "connector") {
    const e = item.edge;
    const id = `thumb-${item.key}`;
    const ink = "var(--ss-ink)";
    const width = e.width ?? 1.3;
    const d = e.line === "curved" ? "M4 28C20 28 12 4 28 4" : e.line === "straight" ? "M4 28 28 4" : "M4 28H16V4H28";
    const dash = e.kind === "async" ? "4 3" : e.kind === "stream" ? "1.5 3" : "none";
    const start = markerSvg(markerId(id, "s"), e.startArrow ?? "none", ink, width, "var(--panel)");
    const end = markerSvg(markerId(id, "e"), e.endArrow ?? "arrow", ink, width, "var(--panel)");
    svg =
      `<svg class="ss-thumb line" viewBox="0 0 32 32"><defs>${start}${end}</defs>` +
      `<path d="${d}" style="fill:none;stroke:${ink};stroke-width:${width};stroke-dasharray:${dash}"` +
      `${start ? ` marker-start="url(#${markerId(id, "s")})"` : ""}${end ? ` marker-end="url(#${markerId(id, "e")})"` : ""}/></svg>`;
  }
  previews.set(item.key, svg);
  return svg || null;
}
