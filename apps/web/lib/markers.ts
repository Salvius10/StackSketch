// Arrowheads as SVG markers, shared by the canvas and the SVG export so both draw
// the same ones: plain and open arrows, UML's hollow triangle and diamonds, and
// crow's foot cardinality for entity diagrams. Each is drawn pointing along +x with
// its tip where the line ends; at the start of a line it is turned round.

import type { ArrowKind } from "@stacksketch/graph";

interface Head {
  /** Width of the drawing; it is 10 high, centred on y = 5. */
  w: number;
  /** Where along it the line ends. */
  ref: number;
  draw(ink: string, bg: string): string;
}

const line = (d: string, ink: string) => `<path d="${d}" style="fill:none;stroke:${ink};stroke-width:1.3;stroke-dasharray:none"/>`;
const solid = (d: string, ink: string) => `<path d="${d}" style="fill:${ink};stroke:${ink};stroke-width:1;stroke-dasharray:none;stroke-linejoin:round"/>`;
const hollow = (d: string, ink: string, bg: string) => `<path d="${d}" style="fill:${bg};stroke:${ink};stroke-width:1.3;stroke-dasharray:none;stroke-linejoin:round"/>`;
const ring = (cx: number, ink: string, bg: string) => `<circle cx="${cx}" cy="5" r="3.5" style="fill:${bg};stroke:${ink};stroke-width:1.3;stroke-dasharray:none"/>`;

const HEADS: Record<Exclude<ArrowKind, "none">, Head> = {
  arrow: { w: 10, ref: 9, draw: (ink) => solid("M0.5 1 9.5 5 0.5 9Z", ink) },
  open: { w: 10, ref: 9.3, draw: (ink) => line("M0.8 0.8 9.3 5 0.8 9.2", ink) },
  triangle: { w: 11, ref: 10.4, draw: (ink, bg) => hollow("M0.7 0.7 10.4 5 0.7 9.3Z", ink, bg) },
  diamond: { w: 16, ref: 15.5, draw: (ink) => solid("M0.5 5 8 1 15.5 5 8 9Z", ink) },
  "diamond-open": { w: 16, ref: 15.5, draw: (ink, bg) => hollow("M0.5 5 8 1 15.5 5 8 9Z", ink, bg) },
  circle: { w: 9, ref: 8.5, draw: (ink) => `<circle cx="4.5" cy="5" r="3.8" style="fill:${ink};stroke:none"/>` },
  "er-one": { w: 14, ref: 14, draw: (ink) => line("M6 0.5V9.5M10 0.5V9.5", ink) },
  "er-many": { w: 14, ref: 14, draw: (ink) => line("M14 0.5 2 5 14 9.5M2 5H14", ink) },
  "er-zero-many": { w: 22, ref: 22, draw: (ink, bg) => line("M22 0.5 10 5 22 9.5M10 5H22", ink) + ring(4.5, ink, bg) },
  "er-one-many": { w: 22, ref: 22, draw: (ink) => line("M22 0.5 10 5 22 9.5M10 5H22M6 0.5V9.5", ink) },
  "er-zero-one": { w: 22, ref: 22, draw: (ink, bg) => line("M16 0.5V9.5", ink) + ring(4.5, ink, bg) },
};

/** A safe id for a marker, from an edge id and which end it is for. */
export const markerId = (scope: string, end: "s" | "e") => `ss-m-${scope.replace(/[^\w-]/g, "_")}-${end}`;

/**
 * One arrowhead as an SVG <marker>, or "" for none. Sizes are in canvas units, a
 * little bigger on thicker lines; `bg` fills hollow heads so the line doesn't show through.
 */
export function markerSvg(id: string, kind: ArrowKind | undefined, ink: string, width: number, bg: string): string {
  if (!kind || kind === "none") return "";
  const head = HEADS[kind];
  if (!head) return "";
  const s = Math.min(Math.max(0.85 + width * 0.15, 1), 2);
  return (
    `<marker id="${id}" viewBox="0 0 ${head.w} 10" markerUnits="userSpaceOnUse" markerWidth="${(head.w * s).toFixed(2)}" markerHeight="${(10 * s).toFixed(2)}" ` +
    `refX="${head.ref}" refY="5" orient="auto-start-reverse">${head.draw(ink, bg)}</marker>`
  );
}

export const ARROW_NAMES: Record<ArrowKind, string> = {
  none: "None",
  arrow: "Arrow",
  open: "Open arrow",
  triangle: "Hollow triangle (inherits)",
  diamond: "Filled diamond (composition)",
  "diamond-open": "Hollow diamond (aggregation)",
  circle: "Dot",
  "er-one": "One (mandatory)",
  "er-many": "Many",
  "er-zero-many": "Zero or many",
  "er-one-many": "One or many",
  "er-zero-one": "Zero or one",
};
