// What the canvas shows while a request flow plays: which components and connectors
// the flow touches (everything else fades), how far the request has got, and the hop
// it is travelling now.

import type { EdgeKind, Flow, FlowStep, Graph } from "@stacksketch/graph";

/** How a step travels: a call of one of the three kinds, or a reply coming back. */
export type Tone = EdgeKind | "return";

export const toneOf = (s: FlowStep): Tone => (s.phase === "return" ? "return" : s.kind);

export const TONES: Record<Tone, { name: string; how: string }> = {
  sync: { name: "Request", how: "waits for the reply" },
  async: { name: "Message", how: "doesn't wait" },
  stream: { name: "Stream", how: "continuous data" },
  return: { name: "Reply", how: "back to the caller" },
};

export const SPEEDS = [
  { value: 0.5, label: "Slow" },
  { value: 1, label: "Normal" },
  { value: 2, label: "Fast" },
] as const;

/** How long a step stays on screen, and how much of that the request spends on the line. */
export const stepMs = (s: FlowStep | undefined, speed: number) => (s?.phase === "return" ? 1300 : 2200) / speed;
const travelMs = (s: FlowStep, speed: number) => (s.phase === "return" ? 700 : 1200) / speed;

export interface Hop {
  /** The connector the request is on. */
  canvasId: string;
  /** Where it leaves from and arrives at on this step: a reply goes from callee to caller. */
  from: string | null;
  to: string | null;
  phase: FlowStep["phase"];
  kind: EdgeKind;
  tone: Tone;
  /** The step's number, from 1. */
  n: number;
  /** How long it takes to cross the connector, in ms. */
  travel: number;
  /** Changes every step, so the animation restarts. */
  key: string;
}

export interface FlowView {
  /** Components the flow passes through. */
  nodes: Set<string>;
  /** Connectors it travels. */
  edges: Set<string>;
  /** Components the request has been at before this step's destination. */
  reached: Set<string>;
  /** Connectors already travelled -> how they were called. */
  travelled: Map<string, Tone>;
  hop: Hop | null;
}

/** Steps whose connector or components are no longer on the canvas are left out. */
export function flowView(flow: Flow, index: number, graph: Graph, speed = 1): FlowView {
  const nodeCanvas = new Map(graph.nodes.map((n) => [n.id, n.canvas_id ?? null]));
  const edgeCanvas = new Map(graph.edges.map((e) => [e.id, e.canvas_id ?? null]));
  const view: FlowView = { nodes: new Set(), edges: new Set(), reached: new Set(), travelled: new Map(), hop: null };
  flow.steps.forEach((s, i) => {
    const edge = edgeCanvas.get(s.edge_id) ?? null;
    const caller = nodeCanvas.get(s.from) ?? null;
    const callee = nodeCanvas.get(s.to) ?? null;
    const [from, to] = s.phase === "return" ? [callee, caller] : [caller, callee];
    for (const id of [from, to]) if (id) view.nodes.add(id);
    if (edge) view.edges.add(edge);
    if (i < index) {
      for (const id of [from, to]) if (id) view.reached.add(id);
      if (edge && s.phase === "call" && !view.travelled.has(edge)) view.travelled.set(edge, s.kind);
    } else if (i === index) {
      if (from) view.reached.add(from);
      if (edge) {
        view.hop = { canvasId: edge, from, to, phase: s.phase, kind: s.kind, tone: toneOf(s), n: i + 1, travel: travelMs(s, speed), key: `${flow.id}-${i}` };
      }
    }
  });
  return view;
}

/** The flow's role for one component or connector, as class names for the canvas. */
export function flowClass(view: FlowView | null, id: string, kind: "node" | "edge"): string {
  if (!view) return "";
  if (kind === "edge") {
    if (view.hop?.canvasId === id) return " flow-current";
    if (view.travelled.has(id)) return " flow-travelled";
    return view.edges.has(id) ? " flow-ahead" : " flow-off";
  }
  if (view.hop?.to === id) return ` flow-to tone-${view.hop.tone}`;
  if (view.hop?.from === id) return ` flow-from tone-${view.hop.tone}`;
  if (view.reached.has(id)) return " flow-reached";
  return view.nodes.has(id) ? " flow-ahead" : " flow-off";
}

/** Counts for the flow's summary line. */
export function flowStats(flow: Flow) {
  const calls = flow.steps.filter((s) => s.phase === "call");
  return {
    components: new Set(flow.steps.flatMap((s) => [s.from, s.to])).size,
    hops: calls.length,
    waits: calls.filter((s) => s.kind === "sync").length,
    async: calls.filter((s) => s.kind !== "sync").length,
  };
}
