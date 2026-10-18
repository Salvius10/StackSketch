"use client";

// Excalidraw fires onChange on every pointer move. The overlay needs the
// viewport and element geometry, but nothing else should re-render that
// often, so this small store sits outside React state.

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useSyncExternalStore } from "react";

export interface View {
  scrollX: number;
  scrollY: number;
  zoom: number;
  width: number;
  height: number;
  theme: "light" | "dark";
  elements: Map<string, ExcalidrawElement>;
  selectedIds: string[];
}

let view: View = {
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
  width: 0,
  height: 0,
  theme: "light",
  elements: new Map(),
  selectedIds: [],
};
const listeners = new Set<() => void>();

export function setView(next: View): void {
  view = next;
  for (const l of listeners) l();
}

export function getView(): View {
  return view;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useView(): View {
  return useSyncExternalStore(subscribe, getView, getView);
}

/** Scene coordinates to coordinates inside the canvas container. */
export function toScreen(v: View, x: number, y: number): { x: number; y: number } {
  return { x: (x + v.scrollX) * v.zoom, y: (y + v.scrollY) * v.zoom };
}

/** Points of an arrow in scene coordinates. */
export function arrowPoints(el: ExcalidrawElement): [number, number][] {
  const pts = (el as { points?: readonly (readonly [number, number])[] }).points ?? [];
  return pts.map(([px, py]) => [el.x + px, el.y + py]);
}

export function midpoint(points: [number, number][]): [number, number] {
  if (points.length === 0) return [0, 0];
  let total = 0;
  const segs: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    segs.push(d);
    total += d;
  }
  let half = total / 2;
  for (let i = 1; i < points.length; i++) {
    if (half <= segs[i - 1]) {
      const t = segs[i - 1] ? half / segs[i - 1] : 0;
      return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t];
    }
    half -= segs[i - 1];
  }
  return points[points.length - 1];
}
