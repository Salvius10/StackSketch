"use client";

// A connector: a right-angle line (or the route an auto-layout found) with an
// arrowhead, its label, step numbers when a flow is numbered, the reviewer's pin,
// and the moving request when a flow plays.

import type { DiagramEdge, Side } from "@stacksketch/graph";
import { BaseEdge, type Edge, type EdgeProps, EdgeLabelRenderer } from "@xyflow/react";
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

export function ArchEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd }: EdgeProps<FlowEdge>) {
  const ctx = useEditor();
  const edge = data!.edge;
  const startSide = POSITION_SIDE[sourcePosition] ?? "right";
  const endSide = POSITION_SIDE[targetPosition] ?? "left";
  const start = { x: sourceX, y: sourceY };
  const { path, mid } = connectorPath(start, startSide, { x: targetX, y: targetY }, endSide, edge.points);
  const kind = edge.kind ?? "sync";
  const text = edgeText(edge);
  const editing = ctx.editingId === id;
  const pin = ctx.pins.get(id);
  const hop = ctx.hop?.canvasId === id ? ctx.hop : null;
  const remote = ctx.remoteSelection.get(id);
  const stroke = selected ? "var(--ss-select)" : remote ?? "var(--ss-ink)";
  const steps = edge.steps ?? [];
  const anchor = stepAnchor(start, startSide);
  const duration = hop ? (hop.phase === "return" ? 0.65 : hop.kind === "sync" ? 0.95 : 1.2) : 0;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={16}
        style={{ stroke, strokeWidth: edge.hot_path ? 2.4 : 1.4, strokeDasharray: DASH[kind] }}
      />
      {hop && (
        <g key={hop.key} className={`ss-hop hop-${hop.kind} hop-${hop.phase}`}>
          <path d={path} className="ss-hop-line" />
          <circle r={hop.phase === "return" ? 5 : 7} className="ss-hop-dot">
            <animateMotion dur={`${duration}s`} fill="freeze" path={path} keyPoints={hop.phase === "return" ? "1;0" : "0;1"} keyTimes="0;1" calcMode="linear" />
          </circle>
        </g>
      )}
      <EdgeLabelRenderer>
        {(text || editing) && (
          <div
            className={`ss-edge-label nodrag nopan${selected ? " selected" : ""}`}
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

export const edgeTypes = { arch: ArchEdge };
