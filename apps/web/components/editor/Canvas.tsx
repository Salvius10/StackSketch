"use client";

// The diagram canvas: React Flow wired to the shared model. Drag components in
// from the library (into a zone if you drop them on one), connect them by
// dragging from a connection point onto another component, drag things in and
// out of zones, double-click to rename. Teammates' cursors and selections show live.

import {
  type DiagramEdge,
  type DiagramNode,
  type EdgeKind,
  type Side,
  absoluteBox,
  newDiagramId,
  sidesBetween,
} from "@stacksketch/graph";
import {
  Background,
  BackgroundVariant,
  type Connection,
  ConnectionLineType,
  ConnectionMode,
  type EdgeChange,
  type FinalConnectionState,
  MarkerType,
  MiniMap,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GRID, addConnected, reparentAfterDrag, snap, zoneAt } from "@/lib/arrange";
import type { DiagramModel } from "@/lib/diagram";
import { DRAG_MIME, LIBRARY, type LibraryItem, itemByKey, itemIcon, nodeFromItem } from "@/lib/library";
import type { Peer } from "@/lib/useBoard";
import { EditorContext, type EditorContextValue } from "./context";
import { type FlowEdge, edgeTypes } from "./edges";
import { type FlowNode, nodeTypes } from "./nodes";

export interface CanvasHandle {
  fit(): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomTo(zoom: number): void;
  /** Scroll so these elements are in view. */
  reveal(ids: string[]): void;
  /** Select these elements (now, or as soon as they arrive from the document). */
  select(ids: string[]): void;
  /** The canvas point at the middle of the view. */
  viewCenter(): { x: number; y: number };
  startEditing(id: string): void;
}

interface Props {
  model: DiagramModel;
  connectorKind: EdgeKind;
  grid: boolean;
  minimap: boolean;
  dark: boolean;
  overlay: Pick<EditorContextValue, "pins" | "asked" | "unsure" | "remoteSelection" | "hop" | "onPin">;
  peers: Peer[];
  onSelection(selection: { nodes: string[]; edges: string[] }): void;
  onPointer(point: { x: number; y: number } | null): void;
  onZoom(zoom: number): void;
  handleRef: MutableRefObject<CanvasHandle | null>;
}

const INK = { light: "#232f3e", dark: "#c9d1d9" };
const SELECT = "#1a73e8";
const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

function depthOf(n: DiagramNode, byId: Map<string, DiagramNode>): number {
  let d = 0;
  for (let p = n.parent ? byId.get(n.parent) : undefined; p && d < 50; p = p.parent ? byId.get(p.parent) : undefined) d++;
  return d;
}

export function Canvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ model, connectorKind, grid, minimap, dark, overlay, peers, onSelection, onPointer, onZoom, handleRef }: Props) {
  const { diagram, byId, actions } = model;
  const flow = useReactFlow<FlowNode, FlowEdge>();
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [insert, setInsert] = useState<{ screen: { x: number; y: number }; at: { x: number; y: number }; from: string; side: Side } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const pendingSelect = useRef<Set<string>>(new Set());
  const wrapper = useRef<HTMLDivElement>(null);
  const fitted = useRef(false);

  // --- model -> view ------------------------------------------------------------------------
  useEffect(() => {
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      const ordered = diagram.nodes.slice().sort((a, b) => {
        const za = a.kind === "zone" ? 0 : 1;
        const zb = b.kind === "zone" ? 0 : 1;
        return za - zb || depthOf(a, byId) - depthOf(b, byId);
      });
      return ordered.map((d): FlowNode => {
        const was = old.get(d.id);
        const parentId = d.parent && byId.has(d.parent) ? d.parent : undefined;
        const sized = d.kind === "component" ? {} : { width: d.w ?? 200, height: d.h ?? 120 };
        const selected = was?.selected ?? pendingSelect.current.has(d.id);
        pendingSelect.current.delete(d.id);
        return {
          id: d.id,
          type: d.kind,
          position: was?.dragging ? was.position : { x: d.x, y: d.y },
          data: { node: d },
          ...(parentId ? { parentId } : {}),
          ...sized,
          zIndex: d.kind === "zone" ? 0 : 10,
          selected,
          ...(was?.measured ? { measured: was.measured } : {}),
          ...(was?.dragging ? { dragging: true } : {}),
        };
      });
    });
  }, [diagram.nodes, byId]);

  useEffect(() => {
    const ink = dark ? INK.dark : INK.light;
    setEdges((prev) => {
      const old = new Map(prev.map((e) => [e.id, e]));
      return diagram.edges
        .filter((e) => byId.get(e.source)?.kind === "component" && byId.get(e.target)?.kind === "component")
        .map((e): FlowEdge => {
          const selected = old.get(e.id)?.selected ?? pendingSelect.current.has(e.id);
          pendingSelect.current.delete(e.id);
          let { sourceSide, targetSide } = e;
          if (!sourceSide || !targetSide) {
            const [s, t] = sidesBetween(absoluteBox(byId.get(e.source)!, byId), absoluteBox(byId.get(e.target)!, byId));
            sourceSide ??= s;
            targetSide ??= t;
          }
          return {
            id: e.id,
            type: "arch",
            source: e.source,
            target: e.target,
            sourceHandle: sourceSide,
            targetHandle: targetSide,
            data: { edge: e },
            selected,
            zIndex: 5,
            markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: selected ? SELECT : ink },
          };
        });
    });
  }, [diagram.edges, byId, dark]);

  // Show the drawing the first time it arrives.
  useEffect(() => {
    if (fitted.current || diagram.nodes.length === 0) return;
    fitted.current = true;
    requestAnimationFrame(() => flow.fitView({ padding: 0.15, maxZoom: 1 }));
  }, [diagram.nodes.length, flow]);

  // --- view -> model ------------------------------------------------------------------------
  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
      const patches = new Map<string, Partial<DiagramNode>>();
      const removed: string[] = [];
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          patches.set(c.id, { ...patches.get(c.id), x: Math.round(c.position.x), y: Math.round(c.position.y) });
        } else if (c.type === "dimensions" && c.resizing && c.dimensions) {
          patches.set(c.id, { ...patches.get(c.id), w: Math.round(c.dimensions.width), h: Math.round(c.dimensions.height) });
        } else if (c.type === "remove") removed.push(c.id);
      }
      if (patches.size) actions.patchNodes([...patches].map(([id, patch]) => ({ id, patch })));
      if (removed.length) actions.remove({ nodes: removed });
    },
    [actions],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
      const removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
      if (removed.length) actions.remove({ edges: removed });
    },
    [actions],
  );

  const connect = useCallback(
    (source: string, target: string, sourceSide: Side | null, targetSide: Side | null) => {
      if (source === target) return;
      const a = byId.get(source);
      const b = byId.get(target);
      if (a?.kind !== "component" || b?.kind !== "component") return;
      const [s, t] = sidesBetween(absoluteBox(a, byId), absoluteBox(b, byId));
      const edge: DiagramEdge = { id: newDiagramId(), source, target, sourceSide: sourceSide ?? s, targetSide: targetSide ?? t, kind: connectorKind };
      actions.put({ edges: [edge] });
    },
    [actions, byId, connectorKind],
  );

  const onConnect = useCallback(
    (c: Connection) => connect(c.source, c.target, (c.sourceHandle as Side) ?? null, (c.targetHandle as Side) ?? null),
    [connect],
  );

  // Dropped on a component's body rather than a connection point: connect to it anyway.
  // Dropped on empty canvas: offer to add a component there, already connected.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      setConnecting(false);
      if (state.isValid || !state.fromNode) return;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      const hit = document.elementFromPoint(point.clientX, point.clientY)?.closest(".react-flow__node") as HTMLElement | null;
      const fromSide = ((state.fromHandle?.id as Side | undefined) ?? "right") as Side;
      if (hit?.dataset.id && hit.dataset.id !== state.fromNode.id) {
        connect(state.fromNode.id, hit.dataset.id, fromSide, null);
        return;
      }
      if (!hit && wrapper.current) {
        const rect = wrapper.current.getBoundingClientRect();
        setInsert({
          screen: { x: point.clientX - rect.left, y: point.clientY - rect.top },
          at: flow.screenToFlowPosition({ x: point.clientX, y: point.clientY }),
          from: state.fromNode.id,
          side: fromSide,
        });
      }
    },
    [connect, flow],
  );

  const insertConnected = (item: LibraryItem) => {
    if (!insert) return;
    const from = byId.get(insert.from);
    const at = { x: snap(insert.at.x - 32), y: snap(insert.at.y - 32) };
    const zone = zoneAt({ x: insert.at.x, y: insert.at.y }, diagram);
    const zoneBox = zone ? absoluteBox(zone, byId) : null;
    const node = nodeFromItem(item, zoneBox ? { x: at.x - zoneBox.x, y: at.y - zoneBox.y } : at, zone?.id ?? null);
    const edges: DiagramEdge[] = from
      ? [{ id: newDiagramId(), source: from.id, target: node.id, sourceSide: insert.side, targetSide: OPPOSITE[insert.side], kind: connectorKind }]
      : [];
    actions.put({ nodes: [node], edges });
    setInsert(null);
    pendingSelect.current = new Set([node.id]);
    setEditingId(node.id);
  };

  const onReconnect = useCallback(
    (old: FlowEdge, c: Connection) => {
      if (c.source === c.target) return;
      actions.patchEdge(old.id, { source: c.source, target: c.target, sourceSide: (c.sourceHandle as Side) ?? null, targetSide: (c.targetHandle as Side) ?? null, points: null });
    },
    [actions],
  );

  // After a drag: join or leave zones, and drop stale auto-layout routes.
  const onNodeDragStop = useCallback(
    (_: unknown, __: FlowNode, dragged: FlowNode[]) => {
      const current = model.current();
      const ids = dragged.map((n) => n.id);
      const moved = new Set(ids);
      for (const n of current.nodes) {
        for (let p = n.parent; p; p = current.nodes.find((x) => x.id === p)?.parent ?? null) {
          if (moved.has(p)) {
            moved.add(n.id);
            break;
          }
        }
      }
      actions.batch(() => {
        reparentAfterDrag(ids, current, actions);
        const stale = current.edges.filter((e) => e.points && (moved.has(e.source) || moved.has(e.target)));
        if (stale.length) actions.patchEdges(stale.map((e) => ({ id: e.id, patch: { points: null } })));
      });
    },
    [actions, model],
  );

  // --- the shape library drops here -----------------------------------------------------------
  const onDragOver = useCallback((event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      const item = itemByKey.get(event.dataTransfer.getData(DRAG_MIME));
      if (!item) return;
      event.preventDefault();
      const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const size = item.kind === "component" ? { w: 64, h: 64 } : item.kind === "zone" ? { w: 360, h: 240 } : { w: 200, h: 64 };
      const topLeft = { x: snap(point.x - size.w / 2), y: snap(point.y - (item.kind === "zone" ? 20 : size.h / 2)) };
      const zone = zoneAt(point, diagram);
      const zoneBox = zone ? absoluteBox(zone, byId) : null;
      const node = nodeFromItem(item, zoneBox ? { x: topLeft.x - zoneBox.x, y: topLeft.y - zoneBox.y } : topLeft, zone?.id ?? null);
      actions.put({ nodes: [node] });
      pendingSelect.current = new Set([node.id]);
      setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)));
    },
    [actions, byId, diagram, flow],
  );

  // --- presence -----------------------------------------------------------------------------
  const lastPointer = useRef(0);
  const onPointerMove = (event: React.PointerEvent) => {
    const now = performance.now();
    if (now - lastPointer.current < 50) return;
    lastPointer.current = now;
    onPointer(flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  };

  // --- imperative handle for the menus and toolbar --------------------------------------------
  useEffect(() => {
    handleRef.current = {
      fit: () => flow.fitView({ padding: 0.15, duration: 250 }),
      zoomIn: () => flow.zoomIn({ duration: 150 }),
      zoomOut: () => flow.zoomOut({ duration: 150 }),
      zoomTo: (z) => flow.zoomTo(z, { duration: 150 }),
      reveal: (ids) => {
        const set = new Set(ids);
        const nodeIds = new Set(ids.filter((id) => byId.has(id)));
        for (const e of diagram.edges) if (set.has(e.id)) [e.source, e.target].forEach((n) => nodeIds.add(n));
        if (nodeIds.size) flow.fitView({ nodes: [...nodeIds].map((id) => ({ id })), padding: 0.6, maxZoom: 1.2, duration: 300 });
      },
      select: (ids) => {
        const set = new Set(ids);
        pendingSelect.current = new Set(ids);
        setNodes((nds) => nds.map((n) => (n.selected !== set.has(n.id) ? { ...n, selected: set.has(n.id) } : n)));
        setEdges((eds) => eds.map((e) => (e.selected !== set.has(e.id) ? { ...e, selected: set.has(e.id) } : e)));
      },
      viewCenter: () => {
        const rect = wrapper.current?.getBoundingClientRect();
        return rect ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) : { x: 0, y: 0 };
      },
      startEditing: (id) => setEditingId(id),
    };
  }, [flow, handleRef, byId, diagram.edges]);

  const context: EditorContextValue = useMemo(
    () => ({
      ...overlay,
      editingId,
      setEditingId,
      dark,
      commitLabel: (id, label) => {
        setEditingId(null);
        if (byId.has(id)) actions.patchNode(id, { label });
        else actions.patchEdge(id, { label: label || undefined });
      },
      onQuickAdd: (id, side) => {
        const created = addConnected(id, side, model.current(), actions, connectorKind);
        if (created) {
          pendingSelect.current = new Set([created]);
          setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)));
          setEditingId(created);
        }
      },
    }),
    [overlay, editingId, dark, byId, actions, model, connectorKind],
  );

  return (
    <EditorContext.Provider value={context}>
      <div
        ref={wrapper}
        className={`ss-canvas${connecting ? " connecting" : ""}${grid ? "" : " no-grid"}`}
        onPointerMove={onPointerMove}
        onPointerLeave={() => onPointer(null)}
      >
        <ReactFlow<FlowNode, FlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onConnectStart={() => setConnecting(true)}
          onConnectEnd={onConnectEnd}
          onReconnect={onReconnect}
          edgesReconnectable
          onNodeDragStop={onNodeDragStop}
          onNodeDoubleClick={(_, node) => setEditingId(node.id)}
          onEdgeDoubleClick={(_, edge) => setEditingId(edge.id)}
          onPaneClick={() => setInsert(null)}
          onSelectionChange={({ nodes: ns, edges: es }) => onSelection({ nodes: ns.map((n) => n.id), edges: es.map((e) => e.id) })}
          onMove={(_, viewport) => onZoom(viewport.zoom)}
          onDragOver={onDragOver}
          onDrop={onDrop}
          isValidConnection={(c) => c.source !== c.target && byId.get(c.source)?.kind === "component" && byId.get(c.target)?.kind === "component"}
          connectionMode={ConnectionMode.Loose}
          connectionLineType={ConnectionLineType.SmoothStep}
          connectionLineStyle={{ stroke: SELECT, strokeWidth: 1.5 }}
          connectionRadius={28}
          snapToGrid
          snapGrid={[GRID, GRID]}
          // draw.io-style navigation: drag on empty canvas selects; wheel scrolls; Ctrl+wheel or pinch zooms;
          // space-drag, middle or right drag pans.
          selectionOnDrag
          panOnDrag={[1, 2]}
          panActivationKeyCode="Space"
          panOnScroll
          zoomActivationKeyCode={["Control", "Meta"]}
          deleteKeyCode={["Delete", "Backspace"]}
          multiSelectionKeyCode={["Shift", "Control", "Meta"]}
          elevateNodesOnSelect={false}
          minZoom={0.15}
          maxZoom={3}
          colorMode={dark ? "dark" : "light"}
          proOptions={{ hideAttribution: false }}
        >
          {grid && <Background id="minor" variant={BackgroundVariant.Lines} gap={GRID} color="var(--ss-grid)" lineWidth={1} />}
          {grid && <Background id="major" variant={BackgroundVariant.Lines} gap={GRID * 5} color="var(--ss-grid-major)" lineWidth={1} />}
          {minimap && <MiniMap pannable zoomable nodeStrokeWidth={2} className="ss-minimap" />}
          <ViewportPortal>
            <Cursors peers={peers} />
          </ViewportPortal>
        </ReactFlow>
        {insert && (
          <div className="ss-insert" style={{ left: insert.screen.x, top: insert.screen.y }}>
            <div className="ss-insert-title">Add and connect</div>
            <div className="ss-insert-grid">
              {LIBRARY.flatMap((g) => g.items)
                .filter((i) => i.kind === "component")
                .map((item) => (
                  <button key={item.key} type="button" className="ss-insert-item" title={item.label} onClick={() => insertConnected(item)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={itemIcon(item)!} alt="" width={28} height={28} />
                    <span>{item.label}</span>
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>
    </EditorContext.Provider>
  );
}

function Cursors({ peers }: { peers: Peer[] }) {
  const zoom = useStore((s) => s.transform[2]);
  return (
    <>
      {peers
        .filter((p) => p.pointer)
        .map((p) => (
          <div key={p.clientId} className="ss-cursor" style={{ transform: `translate(${p.pointer!.x}px, ${p.pointer!.y}px) scale(${1 / zoom})` }}>
            <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden>
              <path d="M1 1 L1 16 L5 12 L8 19 L11 18 L8 11 L14 11 Z" fill={p.user.color} stroke="#fff" strokeWidth="1.2" />
            </svg>
            <span style={{ background: p.user.color }}>{p.user.name}</span>
          </div>
        ))}
    </>
  );
}
