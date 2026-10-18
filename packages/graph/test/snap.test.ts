import { describe, expect, it } from "vitest";
import { classifyStroke } from "../src";

// Deterministic wobble so the tests do not flake.
let seed = 7;
const wobble = (amp: number) => {
  seed = (seed * 16807) % 2147483647;
  return ((seed / 2147483647) - 0.5) * amp;
};

function rectStroke(w: number, h: number, amp = 6): [number, number][] {
  const pts: [number, number][] = [];
  for (let x = 0; x <= w; x += 8) pts.push([x, wobble(amp)]);
  for (let y = 0; y <= h; y += 8) pts.push([w + wobble(amp), y]);
  for (let x = w; x >= 0; x -= 8) pts.push([x, h + wobble(amp)]);
  for (let y = h; y >= 6; y -= 8) pts.push([wobble(amp), y]);
  return pts;
}

function ellipseStroke(rx: number, ry: number, amp = 5): [number, number][] {
  const pts: [number, number][] = [];
  for (let a = 0; a <= Math.PI * 2 + 0.15; a += 0.12) pts.push([rx + rx * Math.cos(a) + wobble(amp), ry + ry * Math.sin(a) + wobble(amp)]);
  return pts;
}

function diamondStroke(w: number, h: number, amp = 5): [number, number][] {
  const corners: [number, number][] = [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2], [w / 2, 0]];
  const pts: [number, number][] = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[i + 1];
    for (let t = 0; t < 1; t += 0.08) pts.push([ax + (bx - ax) * t + wobble(amp), ay + (by - ay) * t + wobble(amp)]);
  }
  pts.push([w / 2 + 3, 2]);
  return pts;
}

describe("snap-to-shape", () => {
  it("recognises wobbly closed strokes", () => {
    expect(classifyStroke(rectStroke(180, 90))).toBe("rectangle");
    expect(classifyStroke(rectStroke(60, 140))).toBe("rectangle");
    expect(classifyStroke(ellipseStroke(90, 50))).toBe("ellipse");
    expect(classifyStroke(ellipseStroke(60, 60))).toBe("ellipse");
    expect(classifyStroke(diamondStroke(160, 110))).toBe("diamond");
  });

  it("leaves open strokes, scribbles and dots alone", () => {
    const line: [number, number][] = Array.from({ length: 20 }, (_, i) => [i * 10, i * 4]);
    expect(classifyStroke(line)).toBeNull();
    const open = rectStroke(180, 90).slice(0, -12);
    expect(classifyStroke(open)).toBeNull();
    expect(classifyStroke([[0, 0], [2, 2], [1, 3]])).toBeNull();
    expect(classifyStroke(rectStroke(10, 10, 1))).toBeNull();
  });
});
