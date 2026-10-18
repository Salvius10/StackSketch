"use client";

// The three kinds of things on the canvas. A component is a 64x64 icon (that box
// is what connectors attach to) with its name underneath; a zone is a container
// whose contents move with it; a note is free text.

import type { DiagramNode, Side } from "@stacksketch/graph";
import { Handle, type Node, type NodeProps, NodeResizer, Position } from "@xyflow/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { componentIcon } from "@/lib/library";
import { useEditor } from "./context";

export type FlowNodeData = { node: DiagramNode };
export type FlowNode = Node<FlowNodeData, "component" | "zone" | "note">;

const SIDES: [Side, Position][] = [
  ["top", Position.Top],
  ["right", Position.Right],
  ["bottom", Position.Bottom],
  ["left", Position.Left],
];

/** Edit text in place. Enter commits (Ctrl+Enter in a note), Escape cancels. */
export function InlineEditor({
  value,
  multiline,
  className,
  placeholder,
  onCommit,
  onCancel,
}: {
  value: string;
  multiline?: boolean;
  className?: string;
  placeholder?: string;
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

export function ComponentNode({ id, data, selected }: NodeProps<FlowNode>) {
  const ctx = useEditor();
  const node = data.node;
  const editing = ctx.editingId === id;
  const pin = ctx.pins.get(id);
  const guess = ctx.unsure.get(id);
  const remote = ctx.remoteSelection.get(id);
  const outline = node.type === "client" || node.type === "external";
  const style = remote ? ({ "--remote": remote } as CSSProperties) : undefined;
  return (
    <div className={`ss-component${selected ? " selected" : ""}${remote ? " remote" : ""}`} style={style} title={node.label}>
      <img className={`ss-icon${outline ? " outline" : ""}`} src={componentIcon(node)} alt="" draggable={false} />
      {SIDES.map(([side, position]) => (
        <Handle key={side} id={side} type="source" position={position} className="ss-handle" />
      ))}
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
      {pin && (
        <button
          type="button"
          className={`ss-pin sev-${pin.worst} nodrag`}
          onClick={(e) => {
            e.stopPropagation();
            ctx.onPin(id);
          }}
          title={`${pin.count} finding${pin.count > 1 ? "s" : ""}: click to see`}
        >
          {pin.count > 1 ? pin.count : "!"}
        </button>
      )}
      {ctx.asked.has(id) && (
        <button
          type="button"
          className="ss-pin question nodrag"
          onClick={(e) => {
            e.stopPropagation();
            ctx.onPin(id);
          }}
          title="The reviewer has a question about this"
        >
          ?
        </button>
      )}
      {guess && (
        <span className="ss-guess" title={`Guessed from the name. Set the type in the Format panel to confirm.`}>
          {guess}?
        </span>
      )}
      {!editing && (
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
      )}
    </div>
  );
}

export function ZoneNode({ id, data, selected }: NodeProps<FlowNode>) {
  const ctx = useEditor();
  const zone = data.node;
  const editing = ctx.editingId === id;
  return (
    <>
      <NodeResizer isVisible={selected} minWidth={140} minHeight={90} color="var(--ss-select)" handleClassName="ss-resize-handle" lineClassName="ss-resize-line" />
      <div className={`ss-zone zone-${zone.zone ?? "system"}${selected ? " selected" : ""}`}>
        <div className="ss-zone-title" onDoubleClick={() => ctx.setEditingId(id)}>
          {editing ? (
            <InlineEditor value={zone.label} placeholder="Zone name" onCommit={(t) => ctx.commitLabel(id, t)} onCancel={() => ctx.setEditingId(null)} />
          ) : (
            zone.label || "Zone"
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

export const nodeTypes = { component: ComponentNode, zone: ZoneNode, note: NoteNode };
