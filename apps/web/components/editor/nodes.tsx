"use client";

// The things on the canvas. A component is a 64x64 icon (that box is what
// connectors attach to) with its name underneath; a shape is any outline from the
// shape catalog with its text inside or below; a zone is a container whose
// contents move with it; a note is free text.

import {
  type DiagramNode,
  type Look,
  ROW_H,
  type ShapeDef,
  type Side,
  lookOf,
  nameDrop,
  rowsLayout,
  shapeDef,
  shapeSvg,
  tableLayout,
} from "@stacksketch/graph";
import { Handle, type Node, type NodeProps, NodeResizer, Position } from "@xyflow/react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { flowClass } from "@/lib/flow-view";
import { canvasLook, componentIcon, isOutlineIcon, zoneBadge } from "@/lib/library";
import { useEditor } from "./context";

export type FlowNodeData = { node: DiagramNode };
export type FlowNode = Node<FlowNodeData, DiagramNode["kind"]>;

const SIDES: [Side, Position][] = [
  ["top", Position.Top],
  ["right", Position.Right],
  ["bottom", Position.Bottom],
  ["left", Position.Left],
];

/** Edit text in place. Enter commits (Ctrl+Enter when it's several lines), Escape cancels. */
export function InlineEditor({
  value,
  multiline,
  className,
  placeholder,
  style,
  onCommit,
  onCancel,
}: {
  value: string;
  multiline?: boolean;
  className?: string;
  placeholder?: string;
  style?: CSSProperties;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit(text.trim());
  };
  const shared = {
    ref,
    value: text,
    placeholder,
    style,
    className: `ss-inline nodrag nopan nowheel${className ? ` ${className}` : ""}`,
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      // Keep Delete, arrows and shortcuts away from the canvas while typing.
      e.stopPropagation();
      if (e.key === "Escape") {
        done.current = true;
        onCancel();
      } else if (e.key === "Enter" && (!multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        commit();
      }
    },
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
  };
  return multiline ? <textarea {...shared} /> : <input {...shared} size={Math.max(text.length + 1, 6)} />;
}

/** Connection points on the four sides; `drop` moves the bottom one down, under a component's name. */
function Handles({ drop = 0 }: { drop?: number }) {
  return (
    <>
      {SIDES.map(([side, position]) => (
        <Handle key={side} id={side} type="source" position={position} className="ss-handle" style={side === "bottom" && drop ? { bottom: -drop } : undefined} />
      ))}
    </>
  );
}

/** The reviewer's pins on a component or a reviewed shape. */
function Pins({ id }: { id: string }) {
  const ctx = useEditor();
  const pin = ctx.pins.get(id);
  const guess = ctx.unsure.get(id);
  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    ctx.onPin(id);
  };
  return (
    <>
      {pin && (
        <button type="button" className={`ss-pin sev-${pin.worst} nodrag`} onClick={open} title={`${pin.count} finding${pin.count > 1 ? "s" : ""}: click to see`}>
          {pin.count > 1 ? pin.count : "!"}
        </button>
      )}
      {ctx.asked.has(id) && (
        <button type="button" className="ss-pin question nodrag" onClick={open} title="The reviewer has a question about this">
          ?
        </button>
      )}
      {guess && (
        <span className="ss-guess" title="Guessed from the name. Set the type in the Format panel to confirm.">
          {guess}?
        </span>
      )}
    </>
  );
}

/** draw.io's blue arrows: click one to add a connected copy on that side. */
function QuickAdd({ id }: { id: string }) {
  const ctx = useEditor();
  return (
    <div className="ss-quick">
      {SIDES.map(([side]) => (
        <button
          key={side}
          type="button"
          className={`ss-quick-${side} nodrag nopan`}
          title="Add a connected copy here"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            ctx.onQuickAdd(id, side);
          }}
        >
          <svg viewBox="0 0 10 10" aria-hidden>
            <path d="M2 5h5M5 2.5 7.5 5 5 7.5" />
          </svg>
        </button>
      ))}
    </div>
  );
}

/** The ring round where the request is leaving from or arriving at while a flow plays. */
function FlowHalo({ flow }: { flow: string }) {
  if (flow.includes("flow-to")) return <span className="ss-halo arriving" />;
  if (flow.includes("flow-from")) return <span className="ss-halo" />;
  return null;
}

const remoteStyle = (colour: string | undefined) => (colour ? ({ "--remote": colour } as CSSProperties) : undefined);

export function ComponentNode({ id, data, selected }: NodeProps<FlowNode>) {
  const ctx = useEditor();
  const node = data.node;
  const editing = ctx.editingId === id;
  const remote = ctx.remoteSelection.get(id);
  const flow = flowClass(ctx.flow, id, "node");
  return (
    <div className={`ss-component${selected ? " selected" : ""}${remote ? " remote" : ""}${flow}`} style={remoteStyle(remote)} title={node.label}>
      <FlowHalo flow={flow} />
      <img className={`ss-icon${isOutlineIcon(node) ? " outline" : ""}`} src={componentIcon(node)} alt="" draggable={false} />
      <Handles drop={nameDrop(node)} />
      <div className="ss-name">
        {editing ? (
          <InlineEditor value={node.label} placeholder="Name" onCommit={(t) => ctx.commitLabel(id, t)} onCancel={() => ctx.setEditingId(null)} />
        ) : (
          <>
            <span className="ss-label">{node.label || "Unnamed"}</span>
            {node.tech && <span className="ss-tech">{node.tech}</span>}
          </>
        )}
      </div>
      <Pins id={id} />
      {!editing && <QuickAdd id={id} />}
    </div>
  );
}

// --- shapes ------------------------------------------------------------------------------

const JUSTIFY = { top: "flex-start", middle: "center", bottom: "flex-end" } as const;
const ITEMS = { left: "flex-start", center: "center", right: "flex-end" } as const;

export function textStyle(look: Look): CSSProperties {
  return {
    color: look.fontColor,
    fontSize: look.fontSize,
    fontWeight: look.bold ? 700 : 400,
    fontStyle: look.italic ? "italic" : "normal",
    textDecoration: look.underline ? "underline" : "none",
  };
}

/** Where a shape's text goes while it's being edited. */
function editArea(def: ShapeDef, w: number, h: number) {
  if (def.rows) return { x: 0, y: 0, w, h };
  if (def.label === "below") return { x: Math.min(0, (w - 160) / 2), y: h + 4, w: Math.max(w, 160), h: 48 };
  const t = def.text(w, h);
  const ew = Math.max(t.w, 80);
  const eh = Math.max(t.h, 36);
  return { x: t.x + (t.w - ew) / 2, y: t.y + (t.h - eh) / 2, w: ew, h: eh };
}

/** The text of a shape, laid out as the SVG export lays it out. */
function ShapeText({ label, def, look, w, h }: { label: string; def: ShapeDef; look: Look; w: number; h: number }) {
  const style = textStyle(look);
  if (def.label === "none") return null;
  if (def.rows === "table") {
    const t = tableLayout(label, w, h);
    return (
      <div className="ss-shape-table" style={{ ...style, gridTemplateColumns: `repeat(${t.cols}, 1fr)`, gridTemplateRows: `repeat(${t.cells.length}, 1fr)` }}>
        {t.cells.flatMap((row, r) =>
          Array.from({ length: t.cols }, (_, c) => (
            <div key={`${r}-${c}`} className={r === 0 ? "head" : undefined}>
              {row[c] ?? ""}
            </div>
          )),
        )}
      </div>
    );
  }
  if (def.rows) {
    const layout = rowsLayout(def.rows, label);
    const left = (layout.keyCol ?? 0) + 6;
    return (
      <div className="ss-shape-rows" style={style}>
        <div className="ss-rows-head" style={{ height: layout.headH }}>
          {layout.head.map((line, i) => (
            <div key={i} className={i === layout.head.length - 1 ? "title" : undefined}>
              {line}
            </div>
          ))}
        </div>
        {layout.rows
          .filter((r) => r.y + ROW_H <= h + 4)
          .map((r, i) => (
            <div key={i}>
              {r.key && (
                <div className="ss-rows-key" style={{ top: r.y, width: layout.keyCol }}>
                  {r.key}
                </div>
              )}
              <div className="ss-rows-row" style={{ top: r.y, left, width: w - left - 6, textAlign: look.align }}>
                {r.text}
              </div>
            </div>
          ))}
      </div>
    );
  }
  if (!label) return null;
  if (def.label === "below") {
    return (
      <div className="ss-shape-below" style={{ ...style, top: h + 4 }}>
        {label}
      </div>
    );
  }
  const box = def.text(w, h);
  return (
    <div
      className="ss-shape-text"
      style={{ ...style, left: box.x, top: box.y, width: box.w, height: box.h, textAlign: look.align, justifyContent: JUSTIFY[look.valign], alignItems: ITEMS[look.align] }}
    >
      <span>{label}</span>
    </div>
  );
}

export function ShapeNode({ id, data, selected, width, height }: NodeProps<FlowNode>) {
  const ctx = useEditor();
  const node = data.node;
  const def = shapeDef(node.shape);
  // While resizing, React Flow's size leads the document's by a frame.
  const w = Math.max(width ?? node.w ?? def.w, 2);
  const h = Math.max(height ?? node.h ?? def.h, 2);
  const look = useMemo(() => canvasLook(lookOf(node.style, def)), [node.style, def]);
  const outline = useMemo(() => shapeSvg(def, w, h, look, def.rows ? node.label : ""), [def, w, h, look, node.label]);
  const editing = ctx.editingId === id;
  const remote = ctx.remoteSelection.get(id);
  const area = editing ? editArea(def, w, h) : null;
  const flow = flowClass(ctx.flow, id, "node");
  return (
    <>
      <NodeResizer
        isVisible={selected && !editing}
        minWidth={10}
        minHeight={10}
        color="var(--ss-select)"
        handleClassName="ss-resize-handle"
        lineClassName="ss-resize-line"
      />
      <div className={`ss-shape${selected ? " selected" : ""}${remote ? " remote" : ""}${def.label === "below" ? " below" : ""}${flow}`} style={remoteStyle(remote)}>
        <FlowHalo flow={flow} />
        <svg className="ss-shape-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} overflow="visible" dangerouslySetInnerHTML={{ __html: outline }} />
        {area ? (
          <div className="ss-shape-edit" style={{ left: area.x, top: area.y, width: area.w, height: area.h }}>
            <InlineEditor
              multiline
              value={node.label}
              placeholder={def.rows ? "Title, then one row per line" : "Text"}
              style={{ ...textStyle(look), color: undefined, textAlign: def.rows ? "left" : look.align }}
              onCommit={(t) => ctx.commitLabel(id, t)}
              onCancel={() => ctx.setEditingId(null)}
            />
          </div>
        ) : (
          <ShapeText label={node.label} def={def} look={look} w={w} h={h} />
        )}
        <Handles />
        <Pins id={id} />
        {!editing && <QuickAdd id={id} />}
      </div>
    </>
  );
}

// --- zones and notes -------------------------------------------------------------------------

/** A zone's own colours, when someone (or a library group) gave it some. */
function zoneStyle(zone: DiagramNode): CSSProperties | undefined {
  const s = zone.style;
  if (!s || (s.fill === undefined && s.stroke === undefined && s.dashed === undefined && s.strokeWidth === undefined)) return undefined;
  const look = canvasLook(lookOf({ fill: "none", strokeWidth: 1.2, ...s }, null));
  return {
    borderColor: look.stroke === "none" ? "transparent" : look.stroke,
    borderStyle: look.dashed ? "dashed" : "solid",
    borderWidth: look.strokeWidth,
    ["--zone-fill" as string]: look.fill === "none" ? "transparent" : look.fill,
  };
}

export function ZoneNode({ id, data, selected }: NodeProps<FlowNode>) {
  const ctx = useEditor();
  const zone = data.node;
  const editing = ctx.editingId === id;
  const custom = zoneStyle(zone);
  const lane = zone.shape === "swimlane";
  const badge = zoneBadge(zone);
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={140} minHeight={90} color="var(--ss-select)" handleClassName="ss-resize-handle" lineClassName="ss-resize-line" />
      <div
        className={`ss-zone zone-${zone.zone ?? "system"}${custom ? " custom" : ""}${lane ? " lane" : ""}${selected ? " selected" : ""}`}
        style={custom}
      >
        <div className={`ss-zone-title${badge ? " badged" : ""}`} onDoubleClick={() => ctx.setEditingId(id)}>
          {badge && <img className="ss-zone-badge" src={badge} alt="" draggable={false} />}
          {editing ? (
            <InlineEditor value={zone.label} placeholder="Zone name" onCommit={(t) => ctx.commitLabel(id, t)} onCancel={() => ctx.setEditingId(null)} />
          ) : (
            <span>{zone.label || "Zone"}</span>
          )}
        </div>
      </div>
    </>
  );
}

export function NoteNode({ id, data, selected }: NodeProps<FlowNode>) {
  const ctx = useEditor();
  const note = data.node;
  const editing = ctx.editingId === id;
  const [title, ...rest] = note.label.split("\n");
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={80} minHeight={32} color="var(--ss-select)" handleClassName="ss-resize-handle" lineClassName="ss-resize-line" />
      <div className={`ss-note${note.legendFor ? " legend" : ""}${selected ? " selected" : ""}`}>
        {editing ? (
          <InlineEditor multiline value={note.label} placeholder="Text" onCommit={(t) => ctx.commitLabel(id, t)} onCancel={() => ctx.setEditingId(null)} />
        ) : note.legendFor ? (
          <>
            <div className="ss-note-title">{title}</div>
            {rest.map((line, i) => (
              <div key={i} className="ss-note-line">
                {line}
              </div>
            ))}
          </>
        ) : (
          note.label || "Double-click to write"
        )}
      </div>
    </>
  );
}

export const nodeTypes = { component: ComponentNode, shape: ShapeNode, zone: ZoneNode, note: NoteNode };
