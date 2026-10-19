"use client";

// The diagram canvas: React Flow wired to the shared model. Drag shapes and
// components in from the library (into a zone if you drop them on one), connect
// them by dragging from a connection point onto another, drag things in and out
// of zones, double-click to edit text. Teammates' cursors and selections show live.

import {
  type ConnectorStyle,
  type Diagram,
  type DiagramEdge,
  type DiagramNode,
  type Side,
  absoluteBox,
  newDiagramId,
  rowsLayout,
  shapeDef,
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
  MiniMap,
  type NodeChange,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  applyEdgeChanges,
  applyNodeChanges,
  getViewportForBounds,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GRID, addConnected, connectable, contentBounds, footprint, insertDiagram, putInside, reparentAfterDrag, snap, union, zoneAt } from "@/lib/arrange";
import type { DiagramModel } from "@/lib/diagram";
import { DRAG_MIME, LIBRARIES, type LibraryItem, SCRATCH_MIME, componentIcon, itemPreview, itemSize, libraryItem, nodeFromItem } from "@/lib/library";
import type { Peer } from "@/lib/useBoard";
import { EditorContext, type EditorContextValue } from "./context";
import { type FlowEdge, edgeTypes } from "./edges";
import { type FlowNode, nodeTypes } from "./nodes";

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;

export interface CanvasHandle {
  /** Fit the whole diagram in view, zooming in no further than `maxZoom`. */
  fit(maxZoom?: number): void;
  zoomIn(): void;
  zoomOut(): void;
  zoomTo(zoom: number): void;
  /** Scroll so these elements are in view. */
  reveal(ids: string[]): void;
  /**
   * Keep these components in view, leaving `bottom` pixels clear at the foot of the
   * canvas; with `fit`, frame them as large as reads well.
   */
  follow(ids: string[], options?: { fit?: boolean; bottom?: number }): void;
  /** Select these elements (now, or as soon as they arrive from the document). */
  select(ids: string[]): void;
  /** The canvas point at the middle of the view. */
  viewCenter(): { x: number; y: number };
  startEditing(id: string): void;
}

interface Props {
  model: DiagramModel;
  /** What connectors drawn now look like. */
  connector: ConnectorStyle;
  /** A connector style was dropped from the library. */
  onConnectorItem(item: LibraryItem): void;
  grid: boolean;
  minimap: boolean;
  dark: boolean;
  overlay: Pick<EditorContextValue, "pins" | "asked" | "unsure" | "remoteSelection" | "flow" | "onPin">;
  peers: Peer[];
  onSelection(selection: { nodes: string[]; edges: string[] }): void;
  onPointer(point: { x: number; y: number } | null): void;
  onZoom(zoom: number): void;
  handleRef: MutableRefObject<CanvasHandle | null>;
}

const SELECT = "#1a73e8";
const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/** What "add and connect" offers after a connection from a shape is dropped on empty canvas. */
const INSERT_SHAPES = [
  "general:rectangle",
  "general:rounded-rectangle",
  "general:ellipse",
  "flowchart:decision",
  "flowchart:terminator",
  "flowchart:data",
  "general:process",
  "general:document",
  "general:cylinder",
  "general:hexagon",
  "general:cloud",
  "general:note",
];

function depthOf(n: DiagramNode, byId: Map<string, DiagramNode>): number {
  let d = 0;
  for (let p = n.parent ? byId.get(n.parent) : undefined; p && d < 50; p = p.parent ? byId.get(p.parent) : undefined) d++;
  return d;
}

/** Stacking on the canvas: zones at the back, then everything else by its z. */
const zIndexOf = (n: DiagramNode) => (n.kind === "zone" ? 0 : Math.max(1, 10 + Math.min(n.z ?? 0, 1000)));

/** What to offer after a connection from `from` is dropped on empty canvas. */
function insertChoices(from: DiagramNode | undefined): LibraryItem[] {
  if (from?.kind === "shape") return INSERT_SHAPES.map((k) => libraryItem(k)).filter((i): i is LibraryItem => !!i);
  return LIBRARIES.find((l) => l.id === "architecture")!.items.filter((i) => i.kind === "component");
}

function ItemThumb({ item }: { item: LibraryItem }) {
  if (item.kind === "component") return <img src={componentIcon(item)} alt="" width={28} height={28} />;
  const svg = itemPreview(item);
  return svg ? <span className="ss-thumb-box" dangerouslySetInnerHTML={{ __html: svg }} /> : null;
}

/** A new node for an item, centred on a canvas point, inside the zone there. */
function placeItem(item: LibraryItem, point: { x: number; y: number }, diagram: Diagram, byId: Map<string, DiagramNode>): DiagramNode | null {
  const size = itemSize(item);
  const topLeft = { x: snap(point.x - size.w / 2), y: snap(point.y - (item.kind === "zone" ? 20 : size.h / 2)) };
  const zone = zoneAt(point, diagram);
  const zoneBox = zone ? absoluteBox(zone, byId) : null;
  return nodeFromItem(item, zoneBox ? { x: topLeft.x - zoneBox.x, y: topLeft.y - zoneBox.y } : topLeft, zone?.id ?? null);
}

export function Canvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ model, connector, onConnectorItem, grid, minimap, dark, overlay, peers, onSelection, onPointer, onZoom, handleRef }: Props) {
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
    // Updaters must stay pure (React may run them twice), so read the pending selection here.
    const pending = new Set(pendingSelect.current);
    for (const d of diagram.nodes) pendingSelect.current.delete(d.id);
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      // Parents before children (React Flow needs that), then back to front.
      const ordered = diagram.nodes.slice().sort((a, b) => {
        const za = a.kind === "zone" ? 0 : 1;
        const zb = b.kind === "zone" ? 0 : 1;
        if (za !== zb) return za - zb;
        if (za === 0) return depthOf(a, byId) - depthOf(b, byId) || (a.z ?? 0) - (b.z ?? 0);
        return (a.z ?? 0) - (b.z ?? 0) || depthOf(a, byId) - depthOf(b, byId);
      });
      return ordered.map((d): FlowNode => {
        const was = old.get(d.id);
        const parentId = d.parent && byId.has(d.parent) ? d.parent : undefined;
        const sized = d.kind === "component" ? {} : { width: d.w ?? 200, height: d.h ?? 120 };
        const selected = was?.selected ?? pending.has(d.id);
        return {
          id: d.id,
          type: d.kind,
          position: was?.dragging ? was.position : { x: d.x, y: d.y },
          data: { node: d },
          ...(parentId ? { parentId } : {}),
          ...sized,
          zIndex: zIndexOf(d),
          selected,
          ...(was?.measured ? { measured: was.measured } : {}),
          ...(was?.dragging ? { dragging: true } : {}),
        };
      });
    });
  }, [diagram.nodes, byId]);

  useEffect(() => {
    const pending = new Set(pendingSelect.current);
    for (const e of diagram.edges) pendingSelect.current.delete(e.id);
    setEdges((prev) => {
      const old = new Map(prev.map((e) => [e.id, e]));
      return diagram.edges
        .filter((e) => connectable(byId.get(e.source)) && connectable(byId.get(e.target)))
        .map((e): FlowEdge => {
          const selected = old.get(e.id)?.selected ?? pending.has(e.id);
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
          };
        });
    });
  }, [diagram.edges, byId]);

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
      if (!connectable(a) || !connectable(b)) return;
      const [s, t] = sidesBetween(absoluteBox(a, byId), absoluteBox(b, byId));
      const edge: DiagramEdge = { id: newDiagramId(), source, target, ...connector, sourceSide: sourceSide ?? s, targetSide: targetSide ?? t };
      actions.put({ edges: [edge] });
    },
    [actions, byId, connector],
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
    const node = placeItem(item, insert.at, diagram, byId);
    if (!node) return;
    const edges: DiagramEdge[] = from
      ? [{ id: newDiagramId(), source: from.id, target: node.id, ...connector, sourceSide: insert.side, targetSide: OPPOSITE[insert.side] }]
      : [];
    putInside([node], edges, diagram, actions);
    setInsert(null);
    pendingSelect.current = new Set([node.id]);
    setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)));
    setEditingId(node.id);
  };

  // React Flow re-reports the selection whenever this callback changes, so keep it stable.
  // As in draw.io: a plain click (no drag) on one of several selected shapes selects just that one.
  const onNodeClick = useCallback((event: React.MouseEvent, node: FlowNode) => {
    if (event.shiftKey || event.ctrlKey || event.metaKey) return;
    setNodes((nds) => (nds.some((n) => n.selected && n.id !== node.id) ? nds.map((n) => (n.selected !== (n.id === node.id) ? { ...n, selected: n.id === node.id } : n)) : nds));
    setEdges((eds) => (eds.some((e) => e.selected) ? eds.map((e) => (e.selected ? { ...e, selected: false } : e)) : eds));
  }, []);

  const onSelectionChange = useCallback(
    ({ nodes: ns, edges: es }: { nodes: FlowNode[]; edges: FlowEdge[] }) => onSelection({ nodes: ns.map((n) => n.id), edges: es.map((e) => e.id) }),
    [onSelection],
  );

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
    if (!event.dataTransfer.types.includes(DRAG_MIME) && !event.dataTransfer.types.includes(SCRATCH_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      const point = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const deselect = () => setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)));
      const scratch = event.dataTransfer.getData(SCRATCH_MIME);
      if (scratch) {
        // A scratchpad entry, centred where it's dropped.
        event.preventDefault();
        let clip: Diagram;
        try {
          clip = JSON.parse(scratch) as Diagram;
        } catch {
          return;
        }
        const b = union(clip.nodes.filter((n) => !n.parent).map((n) => ({ x: n.x, y: n.y, width: n.w ?? 64, height: n.h ?? 64 })));
        if (!b) return;
        pendingSelect.current = new Set(insertDiagram(clip, model.current(), actions, { x: point.x - b.width / 2, y: point.y - b.height / 2 }));
        deselect();
        return;
      }
      const item = libraryItem(event.dataTransfer.getData(DRAG_MIME));
      if (!item) return;
      event.preventDefault();
      if (item.kind === "connector") return onConnectorItem(item);
      const node = placeItem(item, point, diagram, byId);
      if (!node) return;
      putInside([node], [], diagram, actions);
      pendingSelect.current = new Set([node.id]);
      deselect();
    },
    [actions, byId, diagram, flow, model, onConnectorItem],
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
      // From the model rather than the rendered nodes, so what was just added counts.
      fit: (maxZoom = MAX_ZOOM) => {
        const bounds = contentBounds(model.current());
        const rect = wrapper.current?.getBoundingClientRect();
        if (bounds && rect) void flow.setViewport(getViewportForBounds(bounds, rect.width, rect.height, MIN_ZOOM, maxZoom, 0.1), { duration: 250 });
      },
      zoomIn: () => flow.zoomIn({ duration: 150 }),
      zoomOut: () => flow.zoomOut({ duration: 150 }),
      zoomTo: (z) => flow.zoomTo(z, { duration: 150 }),
      reveal: (ids) => {
        const set = new Set(ids);
        const nodeIds = new Set(ids.filter((id) => byId.has(id)));
        for (const e of diagram.edges) if (set.has(e.id)) [e.source, e.target].forEach((n) => nodeIds.add(n));
        if (nodeIds.size) flow.fitView({ nodes: [...nodeIds].map((id) => ({ id })), padding: 0.6, maxZoom: 1.2, duration: 300 });
      },
      follow: (ids, { fit = false, bottom = 0 } = {}) => {
        const bounds = union(ids.flatMap((id) => (byId.has(id) ? [footprint(byId.get(id)!, byId)] : [])));
        const rect = wrapper.current?.getBoundingClientRect();
        if (!bounds || !rect) return;
        const height = Math.max(rect.height - bottom, 160);
        const view = flow.getViewport();
        if (!fit) {
          const m = 48;
          const inView =
            bounds.x >= (m - view.x) / view.zoom &&
            bounds.y >= (m - view.y) / view.zoom &&
            bounds.x + bounds.width <= (rect.width - m - view.x) / view.zoom &&
            bounds.y + bounds.height <= (height - m - view.y) / view.zoom;
          if (inView) return;
        }
        // Following keeps the zoom unless the hop doesn't fit; framing zooms in, but not past 110%.
        const viewport = getViewportForBounds(bounds, rect.width, height, MIN_ZOOM, fit ? 1.1 : view.zoom, 0.12);
        void flow.setViewport(viewport, { duration: fit ? 500 : 400 });
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
        const node = byId.get(id);
        if (!node) return actions.patchEdge(id, { label: label || undefined });
        // A class or table grows to show every row.
        const def = node.kind === "shape" ? shapeDef(node.shape) : null;
        const needs = def?.rows && def.rows !== "table" ? rowsLayout(def.rows, label).height : 0;
        actions.patchNode(id, needs > (node.h ?? 0) ? { label, h: Math.ceil(needs / GRID) * GRID } : { label });
      },
      onQuickAdd: (id, side) => {
        const created = addConnected(id, side, model.current(), actions, connector);
        if (created) {
          pendingSelect.current = new Set([created]);
          setNodes((nds) => nds.map((n) => (n.selected ? { ...n, selected: false } : n)));
          setEditingId(created);
        }
      },
    }),
    [overlay, editingId, dark, byId, actions, model, connector],
  );

  const multi = nodes.filter((n) => n.selected).length > 1;

  return (
    <EditorContext.Provider value={context}>
      <div
        ref={wrapper}
        className={`ss-canvas${connecting ? " connecting" : ""}${grid ? "" : " no-grid"}${multi ? " multi" : ""}${overlay.flow ? " flow-on" : ""}`}
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
          onNodeClick={onNodeClick}
          onNodeDoubleClick={(_, node) => {
            const d = node.data.node;
            if (d.kind !== "shape" || shapeDef(d.shape).label !== "none") setEditingId(node.id);
          }}
          onEdgeDoubleClick={(_, edge) => setEditingId(edge.id)}
          onPaneClick={() => setInsert(null)}
          onSelectionChange={onSelectionChange}
          onMove={(_, viewport) => onZoom(viewport.zoom)}
          onDragOver={onDragOver}
          onDrop={onDrop}
          isValidConnection={(c) => c.source !== c.target && connectable(byId.get(c.source)) && connectable(byId.get(c.target))}
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
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
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
          <div
            className="ss-insert"
            // Kept inside the canvas: near the bottom or right edge it opens up or to the left.
            style={{
              left: Math.max(0, Math.min(insert.screen.x, (wrapper.current?.clientWidth ?? 1e4) - 340)),
              top: Math.max(0, Math.min(insert.screen.y, (wrapper.current?.clientHeight ?? 1e4) - 350)),
            }}
          >
            <div className="ss-insert-title">Add and connect</div>
            <div className="ss-insert-grid">
              {insertChoices(byId.get(insert.from)).map((item) => (
                <button key={item.key} type="button" className="ss-insert-item" title={item.name} onClick={() => insertConnected(item)}>
                  <ItemThumb item={item} />
                  <span>{item.name}</span>
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
