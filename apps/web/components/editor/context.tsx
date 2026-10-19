"use client";

// What the canvas's nodes and edges need beyond their own data: reviewer pins,
// teammates' selections, the flow animation and inline editing.

import type { Severity, Side } from "@stacksketch/graph";
import { createContext, useContext } from "react";
import type { FlowView } from "@/lib/flow-view";

export interface EditorContextValue {
  /** Canvas id -> worst open finding on it. */
  pins: Map<string, { worst: Severity; count: number }>;
  /** Canvas ids the reviewer has a question about. */
  asked: Set<string>;
  /** Canvas id -> the type StackSketch guessed but isn't sure of. */
  unsure: Map<string, string>;
  /** Canvas id -> colour of a teammate who has it selected. */
  remoteSelection: Map<string, string>;
  /** The request flow playing now, if any. */
  flow: FlowView | null;
  editingId: string | null;
  setEditingId(id: string | null): void;
  commitLabel(id: string, label: string): void;
  onPin(canvasId: string): void;
  onQuickAdd(id: string, side: Side): void;
  dark: boolean;
}

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error("useEditor outside the canvas");
  return ctx;
}
