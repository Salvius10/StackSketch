import type { Flow, Graph } from "@stacksketch/graph";
import { describe, expect, it } from "vitest";
import { flowClass, flowStats, flowView } from "../lib/flow-view";

const node = (id: string, canvas_id: string | null) => ({ id, label: id, type: "service" as const, canvas_id, source: "user" as const, confidence: 1 });
const edge = (from: string, to: string, kind: "sync" | "async", canvas_id: string | null) => ({
  id: `${from}->${to}`,
  from,
  to,
  kind,
  canvas_id,
  source: "user" as const,
  confidence: 1,
});

// web -> api (sync) -> db (sync); api -> queue (async). The cache isn't on the flow.
const graph = {
  nodes: [node("web", "c-web"), node("api", "c-api"), node("db", "c-db"), node("queue", "c-q"), node("cache", "c-cache")],
  edges: [edge("web", "api", "sync", "e1"), edge("api", "db", "sync", "e2"), edge("api", "queue", "async", "e3"), edge("api", "cache", "sync", "e4")],
} as unknown as Graph;

const step = (index: number, from: string, to: string, kind: "sync" | "async", phase: "call" | "return") => ({
  index,
  edge_id: `${from}->${to}`,
  from,
  to,
  kind,
  phase,
  depth: 0,
  narration: `${index}`,
});

const flow: Flow = {
  id: "f1",
  node_id: "api",
  entry: "POST /orders",
  summary: "",
  created_at: 0,
  created_by: "me",
  steps: [
    step(0, "web", "api", "sync", "call"),
    step(1, "api", "db", "sync", "call"),
    step(2, "api", "db", "sync", "return"),
    step(3, "api", "queue", "async", "call"),
    step(4, "web", "api", "sync", "return"),
  ],
};

describe("the flow view", () => {
  it("knows what the flow touches and fades the rest", () => {
    const v = flowView(flow, 0, graph);
    expect([...v.nodes].sort()).toEqual(["c-api", "c-db", "c-q", "c-web"]);
    expect([...v.edges].sort()).toEqual(["e1", "e2", "e3"]);
    expect(flowClass(v, "c-cache", "node")).toBe(" flow-off");
    expect(flowClass(v, "e4", "edge")).toBe(" flow-off");
    expect(flowClass(v, "c-db", "node")).toBe(" flow-ahead");
    expect(flowClass(null, "c-cache", "node")).toBe("");
  });

  it("marks where the request leaves and arrives, and what it has crossed", () => {
    const v = flowView(flow, 1, graph, 2);
    expect(v.hop).toMatchObject({ canvasId: "e2", from: "c-api", to: "c-db", tone: "sync", n: 2, travel: 600, key: "f1-1" });
    expect([...v.travelled]).toEqual([["e1", "sync"]]);
    expect(flowClass(v, "c-db", "node")).toBe(" flow-to tone-sync");
    expect(flowClass(v, "c-api", "node")).toBe(" flow-from tone-sync");
    expect(flowClass(v, "c-web", "node")).toBe(" flow-reached");
    expect(flowClass(v, "e1", "edge")).toBe(" flow-travelled");
    expect(flowClass(v, "e2", "edge")).toBe(" flow-current");
  });

  it("sends a reply back from the callee to the caller", () => {
    const v = flowView(flow, 2, graph);
    expect(v.hop).toMatchObject({ canvasId: "e2", from: "c-db", to: "c-api", tone: "return" });
    expect(v.travelled.get("e2")).toBe("sync");
  });

  it("counts hops by kind", () => {
    expect(flowStats(flow)).toEqual({ components: 4, hops: 3, waits: 2, async: 1 });
  });
});
