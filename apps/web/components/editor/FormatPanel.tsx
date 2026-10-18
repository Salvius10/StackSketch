"use client";

// The right-hand panel, as in draw.io: it shows what the selection is and lets you
// change it. Nothing selected: the diagram. A component, connector, zone or note:
// its fields. Several things: alignment and grouping.

import {
  EDGE_KINDS,
  type EdgeKind,
  type Finding,
  GLYPH_NAMES,
  type Glyph,
  type Graph,
  NODE_TYPES,
  type NodeType,
  type ZoneKind,
} from "@stacksketch/graph";
import { useEffect, useState } from "react";
import type { AlignHow } from "@/lib/arrange";
import type { DiagramModel } from "@/lib/diagram";
import { componentIcon } from "@/lib/library";

interface Props {
  model: DiagramModel;
  graph: Graph;
  findings: Finding[];
  selection: { nodes: string[]; edges: string[] };
  grid: boolean;
  minimap: boolean;
  onToggleGrid(): void;
  onToggleMinimap(): void;
  onAlign(how: AlignHow): void;
  onDistribute(axis: "x" | "y"): void;
  onGroup(): void;
  onUngroup(zoneId: string): void;
  onExplain(): void;
  onFinding(canvasId: string): void;
}

function Tri({ label, value, onChange }: { label: string; value: boolean | null | undefined; onChange: (v: boolean | undefined) => void }) {
  const current = value === null || value === undefined ? "unknown" : value ? "yes" : "no";
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="seg">
        {(["unknown", "yes", "no"] as const).map((opt) => (
          <button key={opt} type="button" className={`seg-btn${current === opt ? " on" : ""}`} onClick={() => onChange(opt === "unknown" ? undefined : opt === "yes")}>
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function Text({
  label,
  value,
  placeholder,
  numeric,
  onCommit,
}: {
  label: string;
  value: string | number | null | undefined;
  placeholder?: string;
  numeric?: boolean;
  onCommit: (v: string | number | undefined) => void;
}) {
  const shown = value === null || value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    const t = draft.trim();
    if (t === shown) return;
    if (t === "") return onCommit(undefined);
    if (numeric) {
      const n = Number(t);
      if (Number.isNaN(n) || n < 0) return setDraft(shown);
      return onCommit(Math.round(n));
    }
    onCommit(t);
  };
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className="input small"
        value={draft}
        placeholder={placeholder ?? "unknown"}
        inputMode={numeric ? "numeric" : "text"}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

function Findings({ findings, canvasId, onFinding }: { findings: Finding[]; canvasId: string; onFinding: (id: string) => void }) {
  const mine = findings.filter((f) => f.canvas_id === canvasId);
  if (mine.length === 0) return null;
  return (
    <div className="ss-format-findings">
      <h3 className="section-title">Reviewer</h3>
      {mine.map((f) => (
        <button key={f.id} type="button" className={`ss-format-finding sev-${f.severity}`} onClick={() => onFinding(canvasId)}>
          <span className="dot" /> {f.title}
        </button>
      ))}
    </div>
  );
}

const ZONE_STYLES: [ZoneKind, string][] = [
  ["system", "System boundary"],
  ["clients", "Clients"],
  ["external", "External"],
];

export function FormatPanel(props: Props) {
  const { model, graph, findings, selection } = props;
  const { byId, edgesById, actions } = model;
  const nodes = selection.nodes.map((id) => byId.get(id)).filter((n) => !!n);
  const edges = selection.edges.map((id) => edgesById.get(id)).filter((e) => !!e);

  if (nodes.length + edges.length === 0) {
    return (
      <div className="panel-body ss-format">
        <h3 className="section-title">Diagram</h3>
        <label className="check">
          <input type="checkbox" checked={props.grid} onChange={props.onToggleGrid} /> Grid
        </label>
        <label className="check">
          <input type="checkbox" checked={props.minimap} onChange={props.onToggleMinimap} /> Minimap
        </label>
        <div className="legend">
          <h3 className="section-title">Connectors</h3>
          <div className="legend-row"><span className="legend-line solid" /> sync: the caller waits for the reply</div>
          <div className="legend-row"><span className="legend-line dashed" /> async: fire and forget</div>
          <div className="legend-row"><span className="legend-line dotted" /> stream: continuous data</div>
          <h3 className="section-title">How to</h3>
          <ul className="ss-tips">
            <li>Drag a shape from the left onto the canvas, or onto a zone to put it inside.</li>
            <li>Hover a component and drag from a blue point to another component to connect them. Drop on empty space to add a connected component.</li>
            <li>Click a blue arrow next to a selected component to add a connected copy.</li>
            <li>Double-click anything to rename it. Drag on empty canvas to select several; Ctrl+G puts them in a zone.</li>
            <li>Scroll to pan, Ctrl+scroll to zoom, Space+drag to move around.</li>
          </ul>
        </div>
      </div>
    );
  }

  if (nodes.length + edges.length > 1) {
    const many = nodes.length;
    return (
      <div className="panel-body ss-format">
        <h3 className="section-title">
          {many} shape{many === 1 ? "" : "s"}
          {edges.length ? `, ${edges.length} connector${edges.length === 1 ? "" : "s"}` : ""}
        </h3>
        {many >= 2 && (
          <>
            <span className="field-label">Align</span>
            <div className="ss-align">
              {(
                [
                  ["left", "Left"],
                  ["center", "Center"],
                  ["right", "Right"],
                  ["top", "Top"],
                  ["middle", "Middle"],
                  ["bottom", "Bottom"],
                ] as [AlignHow, string][]
              ).map(([how, label]) => (
                <button key={how} type="button" className="btn small" onClick={() => props.onAlign(how)}>
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
        {many >= 3 && (
          <>
            <span className="field-label">Distribute</span>
            <div className="ss-align">
              <button type="button" className="btn small" onClick={() => props.onDistribute("x")}>
                Horizontally
              </button>
              <button type="button" className="btn small" onClick={() => props.onDistribute("y")}>
                Vertically
              </button>
            </div>
          </>
        )}
        {many >= 1 && (
          <button type="button" className="btn small" onClick={props.onGroup}>
            Put in a zone (Ctrl+G)
          </button>
        )}
      </div>
    );
  }

  if (edges.length === 1) {
    const e = edges[0]!;
    const g = graph.edges.find((x) => x.canvas_id === e.id);
    const name = (id: string) => byId.get(id)?.label || "?";
    const patch = (p: Parameters<typeof actions.patchEdge>[1]) => actions.patchEdge(e.id, { ...p, origin: "user" });
    return (
      <div className="panel-body ss-format">
        <h3 className="section-title">
          {name(e.source)} → {name(e.target)}
        </h3>
        <div className="field">
          <span className="field-label">Kind</span>
          <div className="seg">
            {EDGE_KINDS.map((k) => (
              <button key={k} type="button" className={`seg-btn${(e.kind ?? "sync") === k ? " on" : ""}`} onClick={() => patch({ kind: k as EdgeKind })}>
                {k}
              </button>
            ))}
          </div>
        </div>
        <Text label="Label" value={e.label} placeholder="e.g. POST /orders timeout 2s" onCommit={(v) => patch({ label: v as string | undefined })} />
        <Text label="Protocol" value={g?.protocol ?? e.protocol} placeholder="REST, gRPC, Kafka…" onCommit={(v) => patch({ protocol: v as string | undefined })} />
        <Text label="Endpoint / topic" value={g?.endpoint ?? e.endpoint} placeholder="POST /checkout" onCommit={(v) => patch({ endpoint: v as string | undefined })} />
        <Text label="Timeout (ms, 0 = none)" value={g?.timeout_ms ?? e.timeout_ms} numeric onCommit={(v) => patch({ timeout_ms: v as number | undefined })} />
        <Tri label="Retries on failure" value={g?.retry ?? e.retry} onChange={(v) => patch({ retry: v })} />
        <Tri label="On the hot path" value={g?.hot_path ?? e.hot_path} onChange={(v) => patch({ hot_path: v })} />
        <button
          type="button"
          className="btn small"
          onClick={() => patch({ source: e.target, target: e.source, sourceSide: e.targetSide, targetSide: e.sourceSide, points: null })}
        >
          Reverse direction
        </button>
        <Findings findings={findings} canvasId={e.id} onFinding={props.onFinding} />
      </div>
    );
  }

  const n = nodes[0]!;
  if (n.kind === "zone") {
    return (
      <div className="panel-body ss-format">
        <h3 className="section-title">Zone</h3>
        <Text label="Title" value={n.label} onCommit={(v) => actions.patchNode(n.id, { label: (v as string) ?? "" })} />
        <div className="field">
          <span className="field-label">Style</span>
          <div className="seg">
            {ZONE_STYLES.map(([k, label]) => (
              <button key={k} type="button" className={`seg-btn${(n.zone ?? "system") === k ? " on" : ""}`} onClick={() => actions.patchNode(n.id, { zone: k })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="btn small" onClick={() => props.onUngroup(n.id)}>
          Remove zone, keep what’s inside
        </button>
        <p className="fine">Drag shapes into the zone to add them; they move with it. Drag the corners to resize.</p>
      </div>
    );
  }

  if (n.kind === "note") {
    return (
      <div className="panel-body ss-format">
        <h3 className="section-title">{n.legendFor ? "Step list" : "Note"}</h3>
        <p className="fine">Double-click the note to edit its text. Drag the corners to resize. Notes are not part of the reviewed design.</p>
      </div>
    );
  }

  const g = graph.nodes.find((x) => x.canvas_id === n.id);
  const type = (g?.type ?? n.type ?? "service") as NodeType;
  const confidence = g?.confidence ?? n.confidence ?? 1;
  return (
    <div className="panel-body ss-format">
      <div className="ss-format-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={componentIcon(n)} alt="" width={40} height={40} />
        <div>
          <h3 className="section-title">{n.label || "Unnamed"}</h3>
          {g && <p className="fine mono">id: {g.id}</p>}
        </div>
      </div>
      <Text label="Name" value={n.label} onCommit={(v) => actions.patchNode(n.id, { label: (v as string) ?? "" })} />
      <label className="field">
        <span className="field-label">Type</span>
        <select
          className="input small"
          value={type}
          onChange={(e) => actions.patchNode(n.id, { type: e.target.value as NodeType, icon: undefined, confidence: 1, origin: "user" })}
        >
          {NODE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {confidence < 1 && (
          <span className="fine warn row">
            {n.origin === "ai" ? "Suggested by the AI" : "Guessed"} ({Math.round(confidence * 100)}% sure).
            <button type="button" className="btn small" onClick={() => actions.patchNode(n.id, { type, confidence: 1, origin: "user" })}>
              Confirm {type}
            </button>
          </span>
        )}
      </label>
      <label className="field">
        <span className="field-label">Icon</span>
        <select className="input small" value={n.icon ?? ""} onChange={(e) => actions.patchNode(n.id, { icon: (e.target.value || undefined) as Glyph | undefined })}>
          <option value="">Automatic (from type and name)</option>
          {GLYPH_NAMES.map((glyph) => (
            <option key={glyph} value={glyph}>
              {glyph}
            </option>
          ))}
        </select>
      </label>
      <Text label="Technology" value={n.tech} placeholder="e.g. FastAPI, Postgres 16" onCommit={(v) => actions.patchNode(n.id, { tech: v as string | undefined })} />
      <Text label="Replicas in production" value={n.replicas} numeric onCommit={(v) => actions.patchNode(n.id, { replicas: v as number | undefined })} />
      {type === "queue" && <Tri label="Dead-letter queue" value={g?.dlq ?? n.dlq} onChange={(v) => actions.patchNode(n.id, { dlq: v })} />}
      <button type="button" className="btn small" onClick={props.onExplain}>
        Explain a request through it…
      </button>
      <Findings findings={findings} canvasId={n.id} onFinding={props.onFinding} />
    </div>
  );
}
