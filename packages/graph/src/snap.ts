// Snap-to-shape geometry: decide whether a freehand stroke is a rectangle,
// an ellipse or a diamond. Pure, so it is shared and testable without a canvas.

type Pt = [number, number];
export type SnapShape = "rectangle" | "ellipse" | "diamond";

function hull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (const p of pts.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function area(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/**
 * Classify a stroke by how much of its bounding box its convex hull fills:
 * a rectangle fills nearly all of it, an ellipse about pi/4, a diamond half.
 */
export function classifyStroke(points: readonly (readonly [number, number])[]): SnapShape | null {
  if (points.length < 8) return null;
  const pts = points.map(([x, y]) => [x, y] as Pt);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  if (w < 24 || h < 24) return null;
  const [fx, fy] = pts[0];
  const [lx, ly] = pts[pts.length - 1];
  const gap = Math.hypot(lx - fx, ly - fy);
  if (gap > 0.25 * Math.max(w, h)) return null;
  const fill = area(hull(pts)) / (w * h);
  if (fill > 0.86) return "rectangle";
  if (fill > 0.66) return "ellipse";
  return "diamond";
}
