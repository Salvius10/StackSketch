"use client";

// Everything StackSketch draws on top of the canvas: type badges, finding and
// question pins, and the flow explainer's moving request.

import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Finding, FlowStep, Graph, Question, Severity } from "@stacksketch/graph";
import { useEffect, useMemo, useRef, useState } from "react";
import { type View, arrowPoints, midpoint, toScreen, useView } from "@/lib/viewStore";

const SEV_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

interface Props {
  graph: Graph;
  findings: Finding[];
  questions: Question[];
  mutedFindings: Set<string>;
  focusCanvasId: string | null;
  step: FlowStep | null;
  onPin: (canvasId: string) => void;
}

function anchor(v: View, el: ExcalidrawElement, corner: "tr" | "tl"): { x: number; y: number } {
  if (el.type === "arrow") {
    const [mx, my] = midpoint(arrowPoints(el));
    const p = toScreen(v, mx, my);
    return corner === "tr" ? { x: p.x + 10, y: p.y - 10 } : { x: p.x - 10, y: p.y - 10 };
  }
  const p = toScreen(v, corner === "tr" ? el.x + el.width : el.x, el.y);
  return p;
}

export function Overlay({ graph, findings, questions, mutedFindings, focusCanvasId, step, onPin }: Props) {
  const v = useView();

  const pins = useMemo(() => {
    const by = new Map<string, { worst: Severity; count: number; llm: boolean }>();
    for (const f of findings) {
      if (!f.canvas_id || mutedFindings.has(f.id)) continue;
      const cur = by.get(f.canvas_id);
      if (!cur) by.set(f.canvas_id, { worst: f.severity, count: 1, llm: f.origin === "llm" });
      else {
        cur.count += 1;
        if (SEV_RANK[f.severity] < SEV_RANK[cur.worst]) cur.worst = f.severity;
      }
    }
    return by;
  }, [findings, mutedFindings]);

  const asked = useMemo(() => new Set(questions.map((q) => q.canvas_id).filter(Boolean) as string[]), [questions]);
  const showBadges = v.zoom >= 0.45;

  return (
    <div className="overlay" aria-hidden={false}>
      {showBadges &&
        graph.nodes.map((n) => {
          const el = n.canvas_id ? v.elements.get(n.canvas_id) : undefined;
          if (!el || el.isDeleted) return null;
          const p = toScreen(v, el.x, el.y);
          const unsure = n.confidence < 0.6;
          // An icon already shows the type; say it only when it is a guess.
          if (el.type === "image" && !unsure) return null;
          return (
            <div
              key={`badge-${n.id}`}
              className={`type-badge t-${n.type}${unsure ? " unsure" : ""}`}
              style={{ left: p.x, top: p.y - 20 }}
              title={unsure ? `Guessed "${n.type}" from the label. Set the type in Inspect to confirm.` : `${n.type} · ${n.source}`}
            >
              {n.type}
              {unsure ? "?" : ""}
            </div>
          );
        })}

      {[...pins].map(([canvasId, pin]) => {
        const el = v.elements.get(canvasId);
        if (!el || el.isDeleted) return null;
        const p = anchor(v, el, "tr");
        return (
          <button
            key={`pin-${canvasId}`}
            className={`pin sev-${pin.worst}`}
            style={{ left: p.x - 11, top: p.y - 11 }}
            onClick={() => onPin(canvasId)}
            title={`${pin.count} finding${pin.count > 1 ? "s" : ""}: click to see`}
          >
            {pin.count > 1 ? pin.count : "!"}
          </button>
        );
      })}

      {[...asked].map((canvasId) => {
        const el = v.elements.get(canvasId);
        if (!el || el.isDeleted) return null;
        const p = anchor(v, el, "tl");
        return (
          <button
            key={`q-${canvasId}`}
            className="pin question"
            style={{ left: p.x - 11, top: p.y - 11 }}
            onClick={() => onPin(canvasId)}
            title="The reviewer has a question about this"
          >
            ?
          </button>
        );
      })}

      {focusCanvasId && <FocusRing view={v} canvasId={focusCanvasId} />}
      {step && <FlowHop key={`${step.index}-${step.edge_id}`} view={v} graph={graph} step={step} />}
    </div>
  );
}

function FocusRing({ view, canvasId }: { view: View; canvasId: string }) {
  const el = view.elements.get(canvasId);
  if (!el || el.isDeleted) return null;
  if (el.type === "arrow") {
    const pts = arrowPoints(el).map(([x, y]) => toScreen(view, x, y));
    return (
      <svg className="overlay-svg">
        <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} className="focus-line" />
      </svg>
    );
  }
  const p = toScreen(view, el.x, el.y);
  return (
    <div
      className="focus-ring"
      style={{ left: p.x - 8, top: p.y - 8, width: el.width * view.zoom + 16, height: el.height * view.zoom + 16 }}
    />
  );
}

function along(points: { x: number; y: number }[], t: number): { x: number; y: number } {
  if (points.length === 1) return points[0];
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    lens.push(d);
    total += d;
  }
  let dist = t * total;
  for (let i = 1; i < points.length; i++) {
    if (dist <= lens[i - 1] || i === points.length - 1) {
      const k = lens[i - 1] ? Math.min(dist / lens[i - 1], 1) : 0;
      return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * k, y: points[i - 1].y + (points[i].y - points[i - 1].y) * k };
    }
    dist -= lens[i - 1];
  }
  return points[points.length - 1];
}

/** One hop of a flow: the arrow lights up and a request travels along it. */
function FlowHop({ view, graph, step }: { view: View; graph: Graph; step: FlowStep }) {
  const [t, setT] = useState(0);
  const raf = useRef<number | null>(null);
  const duration = step.phase === "return" ? 650 : step.kind === "sync" ? 950 : 1200;

  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const k = Math.min((now - start) / duration, 1);
      setT(k);
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [duration]);

  const edge = graph.edges.find((e) => e.id === step.edge_id);
  const el = edge?.canvas_id ? view.elements.get(edge.canvas_id) : undefined;
  if (!edge || !el) return null;
  const fromNode = graph.nodes.find((n) => n.id === edge.from);
  let pts = arrowPoints(el).map(([x, y]) => toScreen(view, x, y));
  const binding = (el as { startBinding?: { elementId: string } | null }).startBinding;
  if (binding && fromNode && binding.elementId !== fromNode.canvas_id) pts = pts.reverse();
  if (step.phase === "return") pts = [...pts].reverse();
  if (pts.length === 0) return null;

  const eased = 1 - Math.pow(1 - t, 3);
  const dot = along(pts, eased);
  const cls = `hop hop-${step.kind} hop-${step.phase}`;
  const trail = step.kind === "stream" ? [0.0, 0.12, 0.24].map((d) => along(pts, Math.max(eased - d, 0))) : [];

  return (
    <svg className="overlay-svg">
      <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} className={`${cls} hop-line`} />
      {trail.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={5 - i} className={`${cls} hop-trail`} />
      ))}
      <circle cx={dot.x} cy={dot.y} r={step.phase === "return" ? 6 : 8} className={`${cls} hop-dot`} />
    </svg>
  );
}
