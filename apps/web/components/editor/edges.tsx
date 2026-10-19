"use client";

// A connector: a right-angle line (or the route an auto-layout found), a straight
// line or a curve, with its arrowheads, its label, step numbers when a flow is
// numbered, the reviewer's pin, and the moving request when a flow plays.

import { type DiagramEdge, INK, type Side, safeColour } from "@stacksketch/graph";
import { BaseEdge, type Edge, type EdgeProps, EdgeLabelRenderer, useStore } from "@xyflow/react";
import { useLayoutEffect, useRef } from "react";
import { type Hop, flowClass } from "@/lib/flow-view";
import { onCanvas } from "@/lib/library";
import { markerId, markerSvg } from "@/lib/markers";
import { connectorPath, stepAnchor } from "@/lib/routes";
import { useEditor } from "./context";
import { InlineEditor } from "./nodes";

export type FlowEdgeData = { edge: DiagramEdge };
export type FlowEdge = Edge<FlowEdgeData, "arch">;

const POSITION_SIDE: Record<string, Side> = { top: "top", right: "right", bottom: "bottom", left: "left" };

export const DASH: Record<string, string | undefined> = { sync: undefined, async: "7 5", stream: "2 4" };

export function edgeText(edge: DiagramEdge): string {
  return edge.label?.trim() || edge.endpoint || edge.protocol || "";
}

export function ArchEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<FlowEdge>) {
  const ctx = useEditor();
  const edge = data!.edge;
  const startSide = POSITION_SIDE[sourcePosition] ?? "right";
  const endSide = POSITION_SIDE[targetPosition] ?? "left";
  const start = { x: sourceX, y: sourceY };
  const { path, mid } = connectorPath(start, startSide, { x: targetX, y: targetY }, endSide, edge.points, edge.line);
  const kind = edge.kind ?? "sync";
  const text = edgeText(edge);
  const editing = ctx.editingId === id;
  const pin = ctx.pins.get(id);
  const flow = ctx.flow;
  const hop = flow?.hop?.canvasId === id ? flow.hop : null;
  const role = flowClass(flow, id, "edge");
  // While a flow plays, a connector the request has crossed takes the colour of how it was called.
  const travelled = flow?.travelled.get(id);
  const remote = ctx.remoteSelection.get(id);
  const stroke = travelled ? `var(--flow-${travelled})` : selected ? "var(--ss-select)" : (remote ?? onCanvas(safeColour(edge.stroke, INK)));
  const plain = edge.width ?? (edge.hot_path ? 2.4 : 1.4);
  const width = travelled || hop ? Math.max(plain, 2.2) : plain;
  const startId = markerId(id, "s");
  const endId = markerId(id, "e");
  const startMarker = markerSvg(startId, edge.startArrow ?? "none", stroke, width, "var(--ss-canvas)");
  const endMarker = markerSvg(endId, edge.endArrow ?? "arrow", stroke, width, "var(--ss-canvas)");
  const steps = edge.steps ?? [];
  const anchor = stepAnchor(start, startSide);

  return (
    <>
      <g className={role ? `ss-flow-edge${role}` : undefined}>
        {(startMarker || endMarker) && <defs dangerouslySetInnerHTML={{ __html: startMarker + endMarker }} />}
        {hop && <path d={path} className={`ss-hop-glow tone-${hop.tone}`} />}
        <BaseEdge
          id={id}
          path={path}
          markerStart={startMarker ? `url(#${startId})` : undefined}
          markerEnd={endMarker ? `url(#${endId})` : undefined}
          interactionWidth={16}
          style={{ stroke, strokeWidth: width, strokeDasharray: DASH[kind] }}
        />
        {hop && <HopTravel key={hop.key} id={id} path={path} hop={hop} />}
      </g>
      <EdgeLabelRenderer>
        {(text || editing) && (
          <div
            className={`ss-edge-label nodrag nopan${selected ? " selected" : ""}${role}${hop ? ` tone-${hop.tone}` : ""}`}
            style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)` }}
            onDoubleClick={() => ctx.setEditingId(id)}
          >
            {editing ? (
              <InlineEditor value={edge.label ?? text} placeholder="e.g. POST /orders" onCommit={(t) => ctx.commitLabel(id, t)} onCancel={() => ctx.setEditingId(null)} />
            ) : (
              text
            )}
          </div>
        )}
        {steps.length > 0 && (
          <div className="ss-steps" style={{ transform: `translate(-50%, -50%) translate(${anchor.x}px, ${anchor.y}px)` }}>
            {steps.map((n) => (
              <span key={n} className="ss-step">
                {n}
              </span>
            ))}
          </div>
        )}
        {pin && (
          <button
            type="button"
            className={`ss-pin edge sev-${pin.worst} nodrag nopan`}
            style={{ transform: `translate(-50%, -50%) translate(${mid.x + 14}px, ${mid.y - 16}px)` }}
            onClick={() => ctx.onPin(id)}
            title={`${pin.count} finding${pin.count > 1 ? "s" : ""}: click to see`}
          >
            {pin.count > 1 ? pin.count : "!"}
          </button>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

/**
 * The request crossing a connector: the line lights up behind it in the colour of the
 * call (or green for a reply, which runs backwards) and a numbered marker rides the front.
 */
function HopTravel({ id, path, hop }: { id: string; path: string; hop: Hop }) {
  const reveal = useRef<SVGPathElement>(null);
  const packet = useRef<SVGGElement>(null);
  // Bigger when zoomed out, so it stays easy to see.
  const scale = useStore((s) => Math.min(Math.max(1 / s.transform[2], 1), 2.2));
  const back = hop.phase === "return";
  const mask = `ss-hop-${id.replace(/[^\w-]/g, "_")}`;

  useLayoutEffect(() => {
    const line = reveal.current;
    const dot = packet.current;
    if (!line || !dot) return;
    const length = line.getTotalLength();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    line.style.strokeDasharray = `${length} ${length}`;
    const start = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const t = still ? 1 : Math.min(1, (now - start) / hop.travel);
      const done = length * (t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2);
      line.style.strokeDashoffset = String(back ? done - length : length - done);
      const at = line.getPointAtLength(back ? length - done : done);
      dot.setAttribute("transform", `translate(${at.x} ${at.y})`);
      if (t < 1) frame = requestAnimationFrame(draw);
    };
    draw(start);
    return () => cancelAnimationFrame(frame);
  }, [path, hop.travel, back]);

  return (
    <g className={`ss-hop tone-${hop.tone}`}>
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse" x={-1e5} y={-1e5} width={2e5} height={2e5}>
          <path ref={reveal} d={path} fill="none" stroke="#fff" strokeWidth={24} />
        </mask>
      </defs>
      <path d={path} mask={`url(#${mask})`} className="ss-hop-line" />
      <g ref={packet} className="ss-packet">
        <g transform={`scale(${scale})`}>
          <circle className="ss-packet-ring" r={12} />
          {hop.kind === "async" && !back ? <rect className="ss-packet-body" x={-14} y={-10} width={28} height={20} rx={5} /> : <circle className="ss-packet-body" r={12} />}
          <text className="ss-packet-n" textAnchor="middle" dominantBaseline="central">
            {hop.n}
          </text>
        </g>
      </g>
    </g>
  );
}

export const edgeTypes = { arch: ArchEdge };
