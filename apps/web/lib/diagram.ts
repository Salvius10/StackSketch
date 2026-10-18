"use client";

// The editor's model: the diagram in the shared Yjs document, mirrored into
// React state. Every edit is a Yjs transaction tagged with this client's origin,
// so undo and redo only ever revert your own edits, never a teammate's.

import {
  type Diagram,
  type DiagramEdge,
  type DiagramNode,
  diagramEdgesMap,
  diagramNodesMap,
  readDiagram,
} from "@stacksketch/graph";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as Y from "yjs";

export const LOCAL_ORIGIN = { source: "stacksketch-editor" };

export interface DiagramActions {
  /** Add or replace whole nodes and edges. */
  put(changes: Partial<Diagram>): void;
  patchNode(id: string, patch: Partial<DiagramNode>): void;
  patchNodes(patches: { id: string; patch: Partial<DiagramNode> }[]): void;
  patchEdge(id: string, patch: Partial<DiagramEdge>): void;
  patchEdges(patches: { id: string; patch: Partial<DiagramEdge> }[]): void;
  remove(ids: { nodes?: string[]; edges?: string[] }): void;
  /** Several edits as one undo step. */
  batch(fn: () => void): void;
  undo(): void;
  redo(): void;
}

/** Undefined in a patch removes the field (back to "unknown"). */
function merge<T extends object>(current: T, patch: Partial<T>): T {
  const next: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return next as T;
}

export function useDiagram(doc: Y.Doc) {
  const nodes = useMemo(() => diagramNodesMap(doc), [doc]);
  const edges = useMemo(() => diagramEdgesMap(doc), [doc]);
  const [diagram, setDiagram] = useState<Diagram>(() => readDiagram(doc));
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });

  const undoManager = useMemo(
    () => new Y.UndoManager([nodes, edges], { trackedOrigins: new Set([LOCAL_ORIGIN]), captureTimeout: 400 }),
    [nodes, edges],
  );

  useEffect(() => {
    let frame: number | null = null;
    const refresh = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        setDiagram(readDiagram(doc));
      });
    };
    nodes.observe(refresh);
    edges.observe(refresh);
    refresh();
    const onStack = () => setHistory({ canUndo: undoManager.canUndo(), canRedo: undoManager.canRedo() });
    undoManager.on("stack-item-added", onStack);
    undoManager.on("stack-item-popped", onStack);
    undoManager.on("stack-cleared", onStack);
    return () => {
      nodes.unobserve(refresh);
      edges.unobserve(refresh);
      undoManager.off("stack-item-added", onStack);
      undoManager.off("stack-item-popped", onStack);
      undoManager.off("stack-cleared", onStack);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [doc, nodes, edges, undoManager]);

  useEffect(() => () => undoManager.destroy(), [undoManager]);

  const transact = useCallback((fn: () => void) => doc.transact(fn, LOCAL_ORIGIN), [doc]);

  const actions: DiagramActions = useMemo(
    () => ({
      put(changes) {
        transact(() => {
          for (const n of changes.nodes ?? []) nodes.set(n.id, n);
          for (const e of changes.edges ?? []) edges.set(e.id, e);
        });
      },
      patchNode(id, patch) {
        transact(() => {
          const current = nodes.get(id);
          if (current) nodes.set(id, merge(current, patch));
        });
      },
      patchNodes(patches) {
        transact(() => {
          for (const { id, patch } of patches) {
            const current = nodes.get(id);
            if (current) nodes.set(id, merge(current, patch));
          }
        });
      },
      patchEdge(id, patch) {
        transact(() => {
          const current = edges.get(id);
          if (current) edges.set(id, merge(current, patch));
        });
      },
      patchEdges(patches) {
        transact(() => {
          for (const { id, patch } of patches) {
            const current = edges.get(id);
            if (current) edges.set(id, merge(current, patch));
          }
        });
      },
      remove({ nodes: nodeIds = [], edges: edgeIds = [] }) {
        transact(() => {
          const gone = new Set(nodeIds);
          // Connectors to a removed component go with it.
          const attached = Array.from(edges.entries()).filter(([, e]) => gone.has(e.source) || gone.has(e.target));
          for (const [id] of attached) edges.delete(id);
          for (const id of edgeIds) edges.delete(id);
          for (const id of nodeIds) nodes.delete(id);
        });
      },
      batch(fn) {
        transact(fn);
      },
      undo() {
        undoManager.undo();
      },
      redo() {
        undoManager.redo();
      },
    }),
    [transact, nodes, edges, undoManager],
  );

  const byId = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n])), [diagram]);
  const edgesById = useMemo(() => new Map(diagram.edges.map((e) => [e.id, e])), [diagram]);
  /** The document as it is right now, ahead of the next render. */
  const current = useCallback(() => readDiagram(doc), [doc]);

  return { diagram, byId, edgesById, actions, current, ...history };
}

export type DiagramModel = ReturnType<typeof useDiagram>;
