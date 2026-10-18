// Connector geometry, shared by the canvas and the SVG export so both draw the
// same lines: right-angle paths between the sides of two components, or the
// route an auto-layout found, fitted to where the ends are now.

import { getSmoothStepPath, Position } from "@xyflow/react";
import type { Box, Point, Side } from "@stacksketch/graph";

export const SIDE_POSITION: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/** Where a connector leaves a box: the middle of a side, just outside it (as React Flow's handles do). */
export function sidePoint(box: Box, side: Side, gap = 4): Point {
  switch (side) {
    case "top":
      return { x: box.x + box.width / 2, y: box.y - gap };
    case "bottom":
      return { x: box.x + box.width / 2, y: box.y + box.height + gap };
    case "left":
      return { x: box.x - gap, y: box.y + box.height / 2 };
    case "right":
      return { x: box.x + box.width + gap, y: box.y + box.height / 2 };
  }
}

/** A stored route with its ends moved to the current handles, keeping every segment straight. */
export function fitRoute(route: Point[], start: Point, end: Point): Point[] {
  const pts = route.map((p) => ({ ...p }));
  const n = pts.length;
  const horizontal = (a: Point, b: Point) => Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const firstHorizontal = horizontal(route[0], route[1]);
  const lastHorizontal = horizontal(route[n - 2], route[n - 1]);
  pts[0] = start;
  pts[n - 1] = end;
  if (n > 2) {
    pts[1] = firstHorizontal ? { ...pts[1], y: start.y } : { ...pts[1], x: start.x };
    pts[n - 2] = lastHorizontal ? { ...pts[n - 2], y: end.y } : { ...pts[n - 2], x: end.x };
  }
  return pts;
}

/** An SVG path through points, and the point halfway along it (for the label). */
export function polyline(points: Point[]): { path: string; mid: Point } {
  const path = points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let half = lengths.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (half <= lengths[i] || i === lengths.length - 1) {
      const k = lengths[i] ? Math.min(half / lengths[i], 1) : 0;
      return { path, mid: { x: points[i].x + (points[i + 1].x - points[i].x) * k, y: points[i].y + (points[i + 1].y - points[i].y) * k } };
    }
    half -= lengths[i];
  }
  return { path, mid: points[0] };
}

/** The path a connector takes between two handle points. */
export function connectorPath(
  start: Point,
  startSide: Side,
  end: Point,
  endSide: Side,
  route?: Point[] | null,
): { path: string; mid: Point } {
  if (route && route.length > 2) return polyline(fitRoute(route, start, end));
  const [path, x, y] = getSmoothStepPath({
    sourceX: start.x,
    sourceY: start.y,
    sourcePosition: SIDE_POSITION[startSide],
    targetX: end.x,
    targetY: end.y,
    targetPosition: SIDE_POSITION[endSide],
    borderRadius: 6,
    offset: 24,
  });
  return { path, mid: { x, y } };
}

/** A point just past the start of a connector, beside the line: where step numbers go. */
export function stepAnchor(start: Point, side: Side): Point {
  switch (side) {
    case "right":
      return { x: start.x + 26, y: start.y - 14 };
    case "left":
      return { x: start.x - 26, y: start.y - 14 };
    case "bottom":
      return { x: start.x + 16, y: start.y + 24 };
    case "top":
      return { x: start.x + 16, y: start.y - 24 };
  }
}
