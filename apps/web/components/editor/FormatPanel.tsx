"use client";

// The right-hand panel, as in draw.io: it shows what the selection is and lets you
// change it. Nothing selected: the diagram. A shape: its style, text and
// arrangement, and whether the reviewer should read it as part of the
// architecture. A component, connector, zone or note: its fields. Several
// things: alignment, grouping and a quick colour.

import {
  ARROW_KINDS,
  type ArrowKind,
  type DiagramEdge,
  type DiagramNode,
  EDGE_KINDS,
  type EdgeKind,
  type Finding,
  GLYPH_NAMES,
  type Glyph,
  type Graph,
  ICON_FRAMES,
  INK,
  type IconFrame,
  LINE_STYLES,
  type LineStyle,
  NODE_TYPES,
  type NodeStyle,
  type NodeType,
  SHAPES,
  type ZoneKind,
  lookOf,
  shapeDef,
} from "@stacksketch/graph";
import { useEffect, useState } from "react";
import type { AlignHow } from "@/lib/arrange";
import type { DiagramModel } from "@/lib/diagram";
import { componentIcon } from "@/lib/library";
import { ARROW_NAMES } from "@/lib/markers";

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
  onRestack(to: "front" | "back"): void;
  onExplain(): void;
  onFinding(canvasId: string): void;
}

type Tab = "style" | "text" | "arrange";

// --- fields -----------------------------------------------------------------------------

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

function Seg<T extends string>({ label, options, value, onChange }: { label?: string; options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="field">
      {label && <span className="field-label">{label}</span>}
      <div className="seg">
        {options.map(([v, text]) => (
          <button key={v} type="button" className={`seg-btn${value === v ? " on" : ""}`} onClick={() => onChange(v)}>
            {text}
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
  signed,
  multiline,
  onCommit,
}: {
  label: string;
  value: string | number | null | undefined;
  placeholder?: string;
  numeric?: boolean;
  /** Numbers may be negative (positions). */
  signed?: boolean;
  multiline?: boolean;
  onCommit: (v: string | number | undefined) => void;
}) {
  const shown = value === null || value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    const t = multiline ? draft.replace(/\s+$/, "") : draft.trim();
    if (t === shown) return;
    if (t === "") return onCommit(undefined);
    if (numeric) {
      const n = Number(t);
      if (Number.isNaN(n) || (!signed && n < 0)) return setDraft(shown);
      return onCommit(Math.round(n));
    }
    onCommit(t);
  };
  const props = {
    className: "input small",
    value: draft,
    placeholder: placeholder ?? "unknown",
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.stopPropagation();
      if (e.key === "Enter" && (!multiline || e.ctrlKey || e.metaKey)) (e.target as HTMLElement).blur();
    },
  };
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {multiline ? <textarea {...props} rows={3} /> : <input {...props} inputMode={numeric ? "numeric" : "text"} />}
    </label>
  );
}

/** A hex colour an <input type="color"> accepts. */
function hex(c: string | undefined, fallback: string): string {
  if (c && /^#[0-9a-f]{6}$/i.test(c)) return c;
  if (c && /^#[0-9a-f]{3}$/i.test(c)) return `#${[...c.slice(1)].map((d) => d + d).join("")}`;
  return fallback;
}

/** A colour, with a checkbox for "none" (no fill) or "automatic" (the default). */
function Colour({
  label,
  value,
  fallback,
  empty,
  onChange,
}: {
  label: string;
  value: string | undefined;
  fallback: string;
  empty?: "None" | "Automatic";
  onChange: (c: string | undefined) => void;
}) {
  const off = empty === "None" ? value === "none" : empty === "Automatic" ? value === undefined : false;
  return (
    <div className="field ss-colour">
      <span className="field-label">{label}</span>
      <div className="row">
        <input type="color" value={hex(value, fallback)} disabled={off} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label={label} />
        {empty && (
          <label className="check">
            <input type="checkbox" checked={off} onChange={(e) => onChange(e.target.checked ? (empty === "None" ? "none" : undefined) : hex(value, fallback).toUpperCase())} />{" "}
            {empty}
          </label>
        )}
      </div>
    </div>
  );
}

/** draw.io's colour presets: a fill and its matching line. */
const SWATCHES: NodeStyle[] = [
  { fill: "#FFFFFF", stroke: INK },
  { fill: "#F5F5F5", stroke: "#666666" },
  { fill: "#DAE8FC", stroke: "#6C8EBF" },
  { fill: "#D5E8D4", stroke: "#82B366" },
  { fill: "#FFE6CC", stroke: "#D79B00" },
  { fill: "#FFF2CC", stroke: "#D6B656" },
  { fill: "#F8CECC", stroke: "#B85450" },
  { fill: "#E1D5E7", stroke: "#9673A6" },
  { fill: "#1168BD", stroke: "#0B4884", fontColor: "#FFFFFF" },
  { fill: "none", stroke: INK },
];

function Swatches({ onPick }: { onPick: (s: NodeStyle) => void }) {
  return (
    <div className="ss-swatches">
      {SWATCHES.map((s, i) => (
        <button
          key={i}
          type="button"
          className="ss-swatch"
          title={s.fill === "none" ? "No fill" : `${s.fill} / ${s.stroke}`}
          style={{ background: s.fill === "none" ? "transparent" : s.fill, borderColor: s.stroke }}
          onClick={() => onPick(s)}
        />
      ))}
    </div>
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
  ["system", "System"],
  ["clients", "Clients"],
  ["external", "External"],
];

const SHAPE_CHOICES = SHAPES.filter((s) => !s.rows).sort((a, b) => a.name.localeCompare(b.name));

// --- the panel ----------------------------------------------------------------------------

export function FormatPanel(props: Props) {
  const { model, graph, findings, selection } = props;
  const { byId, edgesById, actions } = model;
  const [tab, setTab] = useState<Tab>("style");
  const nodes = selection.nodes.map((id) => byId.get(id)).filter((n) => !!n);
  const edges = selection.edges.map((id) => edgesById.get(id)).filter((e) => !!e);

  /** Merge into a node's style; undefined removes a setting. */
  const setStyle = (targets: DiagramNode[], patch: Partial<NodeStyle>) =>
    actions.patchNodes(
      targets.map((n) => {
        const next: Record<string, unknown> = { ...n.style };
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined) delete next[k];
          else next[k] = v;
        }
        return { id: n.id, patch: { style: Object.keys(next).length ? (next as NodeStyle) : undefined } };
      }),
    );

  const arrange = (n: DiagramNode, sized: boolean) => (
    <>
      <span className="field-label">Position{sized ? " and size" : ""}</span>
      <div className="ss-grid2">
        <Text label="Left" value={n.x} numeric signed onCommit={(v) => v !== undefined && actions.patchNode(n.id, { x: v as number })} />
        <Text label="Top" value={n.y} numeric signed onCommit={(v) => v !== undefined && actions.patchNode(n.id, { y: v as number })} />
        {sized && (
          <>
            <Text label="Width" value={n.w} numeric onCommit={(v) => v && actions.patchNode(n.id, { w: Math.max(v as number, 10) })} />
            <Text label="Height" value={n.h} numeric onCommit={(v) => v && actions.patchNode(n.id, { h: Math.max(v as number, 10) })} />
          </>
        )}
      </div>
      <div className="ss-align">
        <button type="button" className="btn small" onClick={() => props.onRestack("front")}>
          To front
        </button>
        <button type="button" className="btn small" onClick={() => props.onRestack("back")}>
          To back
        </button>
      </div>
    </>
  );

  const tabs = (
    <div className="seg ss-format-tabs">
      {(["style", "text", "arrange"] as const).map((t) => (
        <button key={t} type="button" className={`seg-btn${tab === t ? " on" : ""}`} onClick={() => setTab(t)}>
          {t[0].toUpperCase() + t.slice(1)}
        </button>
      ))}
    </div>
  );

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
            <li>Drag a shape from the left onto the canvas, or onto a zone to put it inside. More libraries (AWS, Azure, Kubernetes…) are under + More Shapes.</li>
            <li>Hover a shape and drag from a blue point to another to connect them. Drop on empty space to add a connected shape.</li>
            <li>Click a connector style in the library (UML, crow’s foot…) to draw with it.</li>
            <li>The reviewer reads components, and shapes you give a type under Style. Plain drawings are left alone.</li>
            <li>Double-click to edit text. Drag on empty canvas to select several; Ctrl+G puts them in a zone.</li>
            <li>Scroll to pan, Ctrl+scroll to zoom, Space+drag to move around.</li>
          </ul>
        </div>
      </div>
    );
  }

  if (nodes.length + edges.length > 1) {
    const many = nodes.length;
    const styled = nodes.filter((n) => n.kind === "shape" || n.kind === "zone");
    return (
      <div className="panel-body ss-format">
        <h3 className="section-title">
          {many} shape{many === 1 ? "" : "s"}
          {edges.length ? `, ${edges.length} connector${edges.length === 1 ? "" : "s"}` : ""}
        </h3>
        {styled.length > 0 && (
          <>
            <span className="field-label">Colour</span>
            <Swatches onPick={(s) => setStyle(styled, s.fontColor ? s : { ...s, fontColor: undefined })} />
          </>
        )}
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
          <div className="ss-align">
            <button type="button" className="btn small" onClick={props.onGroup}>
              Put in a zone (Ctrl+G)
            </button>
            <button type="button" className="btn small" onClick={() => props.onRestack("front")}>
              To front
            </button>
            <button type="button" className="btn small" onClick={() => props.onRestack("back")}>
              To back
            </button>
          </div>
        )}
      </div>
    );
  }

  if (edges.length === 1) return <EdgePanel e={edges[0]!} {...props} />;

  const n = nodes[0]!;

  if (n.kind === "shape") {
    const def = shapeDef(n.shape);
    const look = lookOf(n.style, def);
    const g = graph.nodes.find((x) => x.canvas_id === n.id);
    return (
      <div className="panel-body ss-format">
        <h3 className="section-title">{def.name}</h3>
        {tabs}
        {tab === "style" && (
          <>
            <Swatches onPick={(s) => setStyle([n], s.fontColor ? s : { ...s, fontColor: undefined })} />
            <div className="ss-grid2">
              <Colour label="Fill" value={look.fill} fallback="#FFFFFF" empty="None" onChange={(c) => setStyle([n], { fill: c })} />
              <Colour label="Line" value={look.stroke} fallback={INK} empty="None" onChange={(c) => setStyle([n], { stroke: c })} />
              <Text label="Line width" value={look.strokeWidth} numeric onCommit={(v) => setStyle([n], { strokeWidth: v as number | undefined })} />
              <label className="field">
                <span className="field-label">Opacity</span>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={Math.round(look.opacity * 100)}
                  onChange={(e) => setStyle([n], { opacity: Number(e.target.value) >= 100 ? undefined : Number(e.target.value) / 100 })}
                />
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={look.dashed} onChange={(e) => setStyle([n], { dashed: e.target.checked || undefined })} /> Dashed line
            </label>
            {!def.rows && (
              <label className="field">
                <span className="field-label">Shape</span>
                <select className="input small" value={def.key} onChange={(e) => actions.patchNode(n.id, { shape: e.target.value })}>
                  {SHAPE_CHOICES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <h3 className="section-title">Reviewer</h3>
            <label className="field">
              <span className="field-label">Reviewed as</span>
              <select
                className="input small"
                value={n.type ?? ""}
                onChange={(e) => actions.patchNode(n.id, { type: (e.target.value || undefined) as NodeType | undefined, origin: "user", confidence: 1 })}
              >
                <option value="">Nothing: just drawing</option>
                {NODE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            {n.type ? (
              <>
                <Text label="Technology" value={n.tech} placeholder="e.g. FastAPI, Postgres 16" onCommit={(v) => actions.patchNode(n.id, { tech: v as string | undefined })} />
                <Text label="Replicas in production" value={n.replicas} numeric onCommit={(v) => actions.patchNode(n.id, { replicas: v as number | undefined })} />
                {n.type === "queue" && <Tri label="Dead-letter queue" value={g?.dlq ?? n.dlq} onChange={(v) => actions.patchNode(n.id, { dlq: v })} />}
                {g && <p className="fine mono">id: {g.id}</p>}
              </>
            ) : (
              <p className="fine">Give it a type to have the reviewer check it with the rest of the architecture.</p>
            )}
            <Findings findings={findings} canvasId={n.id} onFinding={props.onFinding} />
          </>
        )}
        {tab === "text" && (
          <>
            {def.label === "none" ? (
              <p className="fine">This shape has no text.</p>
            ) : (
              <Text
                label={def.rows === "table" ? "Cells (one row per line, | between cells)" : def.rows ? "Title, then one row per line" : "Text"}
                value={n.label}
                placeholder="Text"
                multiline
                onCommit={(v) => actions.patchNode(n.id, { label: (v as string) ?? "" })}
              />
            )}
            <div className="ss-grid2">
              <Text label="Font size" value={look.fontSize} numeric onCommit={(v) => setStyle([n], { fontSize: v as number | undefined })} />
              <Colour label="Font colour" value={look.fontColor} fallback={INK} onChange={(c) => setStyle([n], { fontColor: c })} />
            </div>
            <div className="seg ss-font">
              {(
                [
                  ["bold", "B"],
                  ["italic", "I"],
                  ["underline", "U"],
                ] as const
              ).map(([k, text]) => (
                <button key={k} type="button" className={`seg-btn ss-font-${k}${look[k] ? " on" : ""}`} onClick={() => setStyle([n], { [k]: !look[k] || undefined })}>
                  {text}
                </button>
              ))}
            </div>
            <Seg
              label="Align"
              options={[
                ["left", "Left"],
                ["center", "Center"],
                ["right", "Right"],
              ]}
              value={look.align}
              onChange={(align) => setStyle([n], { align })}
            />
            <Seg
              label="Vertical"
              options={[
                ["top", "Top"],
                ["middle", "Middle"],
                ["bottom", "Bottom"],
              ]}
              value={look.valign}
              onChange={(valign) => setStyle([n], { valign })}
            />
          </>
        )}
        {tab === "arrange" && arrange(n, true)}
      </div>
    );
  }

  if (n.kind === "zone") {
    const look = lookOf({ fill: "none", ...n.style }, null);
    return (
      <div className="panel-body ss-format">
        <h3 className="section-title">{n.shape === "swimlane" ? "Swimlane" : "Zone"}</h3>
        <Text label="Title" value={n.label} onCommit={(v) => actions.patchNode(n.id, { label: (v as string) ?? "" })} />
        <Seg label="Style" options={ZONE_STYLES} value={n.style ? ("" as ZoneKind) : (n.zone ?? "system")} onChange={(k) => actions.patchNode(n.id, { zone: k, style: undefined })} />
        <div className="ss-grid2">
          <Colour label="Line" value={n.style?.stroke} fallback={INK} empty="Automatic" onChange={(c) => setStyle([n], { stroke: c })} />
          <Colour label="Fill" value={n.style ? look.fill : undefined} fallback="#F7F9FB" empty={n.style ? "None" : "Automatic"} onChange={(c) => setStyle([n], { fill: c ?? "none" })} />
        </div>
        <label className="check">
          <input type="checkbox" checked={!!n.style?.dashed} onChange={(e) => setStyle([n], { dashed: e.target.checked })} /> Dashed line
        </label>
        <label className="check">
          <input type="checkbox" checked={n.shape === "swimlane"} onChange={(e) => actions.patchNode(n.id, { shape: e.target.checked ? "swimlane" : undefined })} /> Swimlane (title on the left)
        </label>
        <div className="ss-grid2">
          <label className="field">
            <span className="field-label">Badge</span>
            <select className="input small" value={n.icon ?? ""} onChange={(e) => actions.patchNode(n.id, { icon: (e.target.value || undefined) as Glyph | undefined })}>
              <option value="">None</option>
              {GLYPH_NAMES.map((glyph) => (
                <option key={glyph} value={glyph}>
                  {glyph}
                </option>
              ))}
            </select>
          </label>
          {n.icon && <Colour label="Badge colour" value={n.tint} fallback="#232F3E" empty="Automatic" onChange={(c) => actions.patchNode(n.id, { tint: c })} />}
        </div>
        {arrange(n, true)}
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
        {arrange(n, true)}
      </div>
    );
  }

  const g = graph.nodes.find((x) => x.canvas_id === n.id);
  const type = (g?.type ?? n.type ?? "service") as NodeType;
  const confidence = g?.confidence ?? n.confidence ?? 1;
  return (
    <div className="panel-body ss-format">
      <div className="ss-format-head">
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
          value={n.type === null ? "" : type}
          onChange={(e) =>
            actions.patchNode(n.id, e.target.value ? { type: e.target.value as NodeType, icon: n.tint ? n.icon : undefined, confidence: 1, origin: "user" } : { type: null })
          }
        >
          <option value="">Nothing: not reviewed</option>
          {NODE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {confidence < 1 && n.type !== null && (
          <span className="fine warn row">
            {n.origin === "ai" ? "Suggested by the AI" : "Guessed"} ({Math.round(confidence * 100)}% sure).
            <button type="button" className="btn small" onClick={() => actions.patchNode(n.id, { type, confidence: 1, origin: "user" })}>
              Confirm {type}
            </button>
          </span>
        )}
      </label>
      <div className="ss-grid2">
        <label className="field">
          <span className="field-label">Icon</span>
          <select className="input small" value={n.icon ?? ""} onChange={(e) => actions.patchNode(n.id, { icon: (e.target.value || undefined) as Glyph | undefined })}>
            <option value="">Automatic</option>
            {GLYPH_NAMES.map((glyph) => (
              <option key={glyph} value={glyph}>
                {glyph}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Frame</span>
          <select className="input small" value={n.frame ?? ""} onChange={(e) => actions.patchNode(n.id, { frame: (e.target.value || undefined) as IconFrame | undefined })}>
            <option value="">Automatic</option>
            {ICON_FRAMES.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Colour label="Icon colour" value={n.tint} fallback="#ED7100" empty="Automatic" onChange={(c) => actions.patchNode(n.id, { tint: c })} />
      <Text label="Technology" value={n.tech} placeholder="e.g. FastAPI, Postgres 16" onCommit={(v) => actions.patchNode(n.id, { tech: v as string | undefined })} />
      <Text label="Replicas in production" value={n.replicas} numeric onCommit={(v) => actions.patchNode(n.id, { replicas: v as number | undefined })} />
      {type === "queue" && <Tri label="Dead-letter queue" value={g?.dlq ?? n.dlq} onChange={(v) => actions.patchNode(n.id, { dlq: v })} />}
      <button type="button" className="btn small" onClick={props.onExplain}>
        Explain a request through it…
      </button>
      <Findings findings={findings} canvasId={n.id} onFinding={props.onFinding} />
      {arrange(n, false)}
    </div>
  );
}

function EdgePanel({ e, model, graph, findings, onFinding }: Props & { e: DiagramEdge }) {
  const { byId, actions } = model;
  const g = graph.edges.find((x) => x.canvas_id === e.id);
  const name = (id: string) => byId.get(id)?.label.split("\n")[0] || "?";
  const patch = (p: Partial<DiagramEdge>) => actions.patchEdge(e.id, { ...p, origin: "user" });
  const arrowSelect = (label: string, value: ArrowKind, set: (a: ArrowKind) => void) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <select className="input small" value={value} onChange={(ev) => set(ev.target.value as ArrowKind)}>
        {ARROW_KINDS.map((k) => (
          <option key={k} value={k}>
            {ARROW_NAMES[k]}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="panel-body ss-format">
      <h3 className="section-title">
        {name(e.source)} → {name(e.target)}
      </h3>
      <Seg
        label="Line"
        options={LINE_STYLES.map((l): [LineStyle, string] => [l, l === "orthogonal" ? "Right-angled" : l === "straight" ? "Straight" : "Curved"])}
        value={e.line ?? "orthogonal"}
        onChange={(line) => patch({ line: line === "orthogonal" ? undefined : line })}
      />
      <Seg
        label={g ? "Kind" : "Pattern"}
        options={EDGE_KINDS.map((k): [EdgeKind, string] => [k, g ? k : k === "sync" ? "Solid" : k === "async" ? "Dashed" : "Dotted"])}
        value={e.kind ?? "sync"}
        onChange={(kind) => patch({ kind })}
      />
      <div className="ss-grid2">
        {arrowSelect("Start", e.startArrow ?? "none", (startArrow) => patch({ startArrow }))}
        {arrowSelect("End", e.endArrow ?? "arrow", (endArrow) => patch({ endArrow }))}
        <Colour label="Colour" value={e.stroke} fallback={INK} empty="Automatic" onChange={(stroke) => patch({ stroke })} />
        <Text label="Width" value={e.width} placeholder="1.4" numeric onCommit={(v) => patch({ width: v ? Math.min(v as number, 12) : undefined })} />
      </div>
      <Text label="Label" value={e.label} placeholder={g ? "e.g. POST /orders timeout 2s" : "Text on the line"} onCommit={(v) => patch({ label: v as string | undefined })} />
      {g ? (
        <>
          <Text label="Protocol" value={g.protocol ?? e.protocol} placeholder="REST, gRPC, Kafka…" onCommit={(v) => patch({ protocol: v as string | undefined })} />
          <Text label="Endpoint / topic" value={g.endpoint ?? e.endpoint} placeholder="POST /checkout" onCommit={(v) => patch({ endpoint: v as string | undefined })} />
          <Text label="Timeout (ms, 0 = none)" value={g.timeout_ms ?? e.timeout_ms} numeric onCommit={(v) => patch({ timeout_ms: v as number | undefined })} />
          <Tri label="Retries on failure" value={g.retry ?? e.retry} onChange={(v) => patch({ retry: v })} />
          <Tri label="On the hot path" value={g.hot_path ?? e.hot_path} onChange={(v) => patch({ hot_path: v })} />
        </>
      ) : (
        <p className="fine">Between drawings, so the reviewer leaves it alone. Connect components (or shapes with a type) to have it checked.</p>
      )}
      <button type="button" className="btn small" onClick={() => patch({ source: e.target, target: e.source, sourceSide: e.targetSide, targetSide: e.sourceSide, points: null })}>
        Reverse direction
      </button>
      <Findings findings={findings} canvasId={e.id} onFinding={onFinding} />
    </div>
  );
}
