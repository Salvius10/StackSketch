"use client";

// Edit the typed fields of the selected component or connection. Values are
// stored on the canvas element itself, so they travel with copy and paste.

import { EDGE_KINDS, type EdgeKind, type ElementMeta, type Graph, type GraphEdge, type GraphNode, NODE_TYPES } from "@stacksketch/graph";
import { useEffect, useState } from "react";

type Patch = { [K in keyof ElementMeta]?: ElementMeta[K] | undefined };

interface Props {
  graph: Graph;
  selectedIds: string[];
  explicit: (canvasId: string) => ElementMeta;
  onUpdate: (canvasId: string, patch: Patch) => void;
}

function Tri({ label, value, explicit, onChange }: { label: string; value: boolean | null; explicit: boolean; onChange: (v: boolean | undefined) => void }) {
  const current = value === null ? "unknown" : value ? "yes" : "no";
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <div className="seg">
        {(["unknown", "yes", "no"] as const).map((opt) => (
          <button
            key={opt}
            className={`seg-btn${current === opt ? " on" : ""}`}
            onClick={() => onChange(opt === "unknown" ? undefined : opt === "yes")}
            type="button"
          >
            {opt}
          </button>
        ))}
      </div>
      {!explicit && value !== null && <span className="fine">from the label</span>}
    </label>
  );
}

function TextField({
  label,
  value,
  placeholder,
  numeric,
  onCommit,
}: {
  label: string;
  value: string | number | null;
  placeholder?: string;
  numeric?: boolean;
  onCommit: (v: string | number | undefined) => void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  useEffect(() => setDraft(value === null ? "" : String(value)), [value]);
  const commit = () => {
    const t = draft.trim();
    if (t === (value === null ? "" : String(value))) return;
    if (t === "") return onCommit(undefined);
    if (numeric) {
      const n = Number(t);
      if (Number.isNaN(n) || n < 0) return setDraft(value === null ? "" : String(value));
      return onCommit(Math.round(n));
    }
    onCommit(t);
  };
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className="input"
        value={draft}
        placeholder={placeholder ?? "unknown"}
        inputMode={numeric ? "numeric" : "text"}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          e.stopPropagation();
        }}
      />
    </label>
  );
}

function Provenance({ item }: { item: GraphNode | GraphEdge }) {
  return (
    <p className="fine">
      Source: {item.source} · confidence {Math.round(item.confidence * 100)}%
    </p>
  );
}

export function InspectPanel({ graph, selectedIds, explicit, onUpdate }: Props) {
  const nodes = graph.nodes.filter((n) => n.canvas_id && selectedIds.includes(n.canvas_id));
  const edges = graph.edges.filter((e) => e.canvas_id && selectedIds.includes(e.canvas_id));

  if (nodes.length + edges.length === 0) {
    return (
      <div className="panel-body">
        <p className="empty">
          Select a component or an arrow to see and edit what StackSketch knows about it. Fields left unknown stay null; the reviewer asks
          when it needs one.
        </p>
        <div className="legend">
          <h3 className="section-title">Arrow styles</h3>
          <div className="legend-row"><span className="legend-line solid" /> sync: the caller waits</div>
          <div className="legend-row"><span className="legend-line dashed" /> async: fire and forget</div>
          <div className="legend-row"><span className="legend-line dotted" /> stream: continuous data</div>
          <h3 className="section-title">Labels the graph understands</h3>
          <p className="fine">Component: <code>Orders DB</code> then <code>Postgres</code> on a second line, <code>x3</code> for replicas.</p>
          <p className="fine">Arrow: <code>POST /checkout timeout 2s retry hot</code>, <code>kafka order.created</code>.</p>
        </div>
      </div>
    );
  }
  if (nodes.length + edges.length > 1) {
    return (
      <div className="panel-body">
        <p className="empty">
          {nodes.length} components and {edges.length} connections selected. Select one to edit it.
        </p>
      </div>
    );
  }

  if (nodes.length === 1) {
    const n = nodes[0];
    const cid = n.canvas_id!;
    const meta = explicit(cid);
    return (
      <div className="panel-body">
        <h3 className="section-title">{n.label}</h3>
        <p className="fine mono">id: {n.id}</p>
        <label className="field">
          <span className="field-label">Type</span>
          <select className="input" value={n.type} onChange={(e) => onUpdate(cid, { type: e.target.value as GraphNode["type"] })}>
            {NODE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {n.confidence < 1 && (
            <span className="fine warn row">
              {meta.type ? `Set by ${n.source}` : "Guessed from the label"} ({Math.round(n.confidence * 100)}% sure).
              <button type="button" className="btn small" onClick={() => onUpdate(cid, { type: n.type })}>
                Confirm {n.type}
              </button>
            </span>
          )}
        </label>
        <TextField label="Technology" value={n.tech} placeholder="e.g. FastAPI, Postgres 16" onCommit={(v) => onUpdate(cid, { tech: v as string | undefined })} />
        <TextField label="Replicas in production" value={n.replicas} numeric onCommit={(v) => onUpdate(cid, { replicas: v as number | undefined })} />
        {n.type === "queue" && (
          <Tri label="Dead-letter queue" value={n.dlq} explicit={meta.dlq !== undefined} onChange={(v) => onUpdate(cid, { dlq: v })} />
        )}
        <Provenance item={n} />
        <p className="fine">Rename it by double-clicking its name on the canvas.</p>
      </div>
    );
  }

  const e = edges[0];
  const cid = e.canvas_id!;
  const meta = explicit(cid);
  const name = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  return (
    <div className="panel-body">
      <h3 className="section-title">
        {name(e.from)} → {name(e.to)}
      </h3>
      <label className="field">
        <span className="field-label">Kind</span>
        <div className="seg">
          {EDGE_KINDS.map((k) => (
            <button key={k} type="button" className={`seg-btn${e.kind === k ? " on" : ""}`} onClick={() => onUpdate(cid, { kind: k as EdgeKind })}>
              {k}
            </button>
          ))}
        </div>
      </label>
      <TextField label="Protocol" value={e.protocol} placeholder="REST, gRPC, Kafka…" onCommit={(v) => onUpdate(cid, { protocol: v as string | undefined })} />
      <TextField label="Endpoint / topic" value={e.endpoint} placeholder="POST /checkout" onCommit={(v) => onUpdate(cid, { endpoint: v as string | undefined })} />
      <TextField label="Timeout (ms, 0 = none)" value={e.timeout_ms} numeric onCommit={(v) => onUpdate(cid, { timeout_ms: v as number | undefined })} />
      <Tri label="Retries on failure" value={e.retry} explicit={meta.retry !== undefined} onChange={(v) => onUpdate(cid, { retry: v })} />
      <Tri label="On the hot path" value={e.hot_path} explicit={meta.hot_path !== undefined} onChange={(v) => onUpdate(cid, { hot_path: v })} />
      <Provenance item={e} />
    </div>
  );
}
