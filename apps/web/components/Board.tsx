"use client";

// One board, laid out like draw.io: menu bar and toolbar on top, the shape
// library on the left, the diagram in the middle, and on the right the format
// panel with the reviewer, flow explainer and room chat beside it.

import {
  type Box,
  type ChatMessage,
  type ConnectorStyle,
  type Diagram,
  type EdgeKind,
  type Flow,
  type Graph,
  type GraphNode,
  type LineStyle,
  type Question,
  type Severity,
  type Vote,
  chatArray,
  diagramToDrawio,
  dismissedMap,
  flowsMap,
  metaMap,
  patchChatMessage,
  toMermaid,
  votesMap,
} from "@stacksketch/graph";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyChange, planEdits } from "@/lib/ai-edits";
import { type EntryPoint, type Health, api } from "@/lib/api";
import {
  type AlignHow,
  type Clip,
  align,
  autoLayout,
  clearNumbers,
  copy,
  distribute,
  freeSpot,
  groupInZone,
  insertDiagram,
  insertGraph,
  numberFlow,
  paste,
  restack,
  snap,
  ungroup,
} from "@/lib/arrange";
import { useDiagram } from "@/lib/diagram";
import { type FlowView, flowView, stepMs } from "@/lib/flow-view";
import { type Identity, getIdentity, newBoardId, rememberBoard, saveIdentity } from "@/lib/identity";
import { DEFAULT_LIBRARIES, LIBRARIES, type LibraryItem, componentIcon, itemSize, nodeFromItem } from "@/lib/library";
import { diagramToSvg, svgToPng } from "@/lib/render-svg";
import { useBoard } from "@/lib/useBoard";
import { ChatPanel } from "./ChatPanel";
import { ImportDialog, IdeaDialog, Modal } from "./Dialogs";
import { Canvas, type CanvasHandle } from "./editor/Canvas";
import { MenuBar, type MenuItem, Toolbar } from "./editor/Chrome";
import { FormatPanel } from "./editor/FormatPanel";
import { MoreShapesDialog, TemplatesDialog } from "./editor/Gallery";
import { ShapeLibrary } from "./editor/ShapeLibrary";
import { FlowCaption, FlowPanel, type Player } from "./FlowPanel";
import { GraphPanel } from "./GraphPanel";
import { ReviewPanel, ReviewerBadge } from "./ReviewPanel";

type Tab = "format" | "review" | "flow" | "chat";
type Dialog = null | "idea" | "import" | "shortcuts" | "graph" | "templates" | "libraries";

const SEV_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
/** Room left at the foot of the canvas for the flow's playback card. */
const CAPTION_SPACE = 200;
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function usePref(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`stacksketch.${key}`);
      if (raw !== null) setValue(raw === "1");
    } catch {
      /* storage blocked: defaults are fine */
    }
  }, [key]);
  const set = useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        localStorage.setItem(`stacksketch.${key}`, v ? "1" : "0");
      } catch {
        /* storage blocked */
      }
    },
    [key],
  );
  return [value, set];
}

/** The shape libraries you've switched on, kept in this browser. */
function useLibraries(): [string[], (ids: string[]) => void] {
  const [ids, setIds] = useState<string[]>(DEFAULT_LIBRARIES);
  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("stacksketch.libraries") ?? "null") as unknown;
      if (Array.isArray(raw)) setIds(raw.filter((id): id is string => typeof id === "string" && LIBRARIES.some((l) => l.id === id)));
    } catch {
      /* storage blocked or garbled: defaults are fine */
    }
  }, []);
  const set = useCallback((next: string[]) => {
    setIds(next);
    try {
      localStorage.setItem("stacksketch.libraries", JSON.stringify(next));
    } catch {
      /* storage blocked */
    }
  }, []);
  return [ids, set];
}

const SHORTCUTS: [string, string][] = [
  ["Drag from the library", "Add a shape (drop it on a zone to put it inside)"],
  ["Drag from a blue point", "Connect to another shape; drop on empty space to add one"],
  ["Double-click / F2", "Edit the text"],
  ["Delete / Backspace", "Delete the selection"],
  ["Ctrl+Z / Ctrl+Y", "Undo / redo (only your own edits)"],
  ["Ctrl+C / Ctrl+V / Ctrl+D", "Copy / paste / duplicate"],
  ["Ctrl+A / Esc", "Select all / nothing"],
  ["Ctrl+G / Ctrl+Shift+G", "Put the selection in a zone / remove a zone"],
  ["Ctrl+Shift+F / Ctrl+Shift+B", "Bring to front / send to back"],
  ["Ctrl+Shift+L", "Auto layout"],
  ["Arrow keys", "Move the selection by 10 (Shift: by 1)"],
  ["Scroll / Ctrl+scroll", "Pan / zoom"],
  ["Space+drag, right-drag", "Pan"],
  ["Ctrl+= / Ctrl+- / Ctrl+0", "Zoom in / out / actual size"],
  ["Ctrl+Shift+H", "Fit the diagram"],
];

export default function Board({ boardId }: { boardId: string }) {
  const router = useRouter();
  const [me, setMe] = useState<Identity>(getIdentity);
  const { doc, provider, state, connection, synced, peers } = useBoard(boardId, me);
  const model = useDiagram(doc);
  const { diagram, byId, actions } = model;
  const graph = state.graph;
  const canvas = useRef<CanvasHandle | null>(null);
  const clipboard = useRef<Clip | null>(null);
  /** This browser tab: it applies the AI's edits for the messages it sent. */
  const [tabId] = useState(() => Math.random().toString(36).slice(2, 10));

  const [tab, setTab] = useState<Tab>("format");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selection, setSelection] = useState<{ nodes: string[]; edges: string[] }>({ nodes: [], edges: [] });
  const [focus, setFocus] = useState<string | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [speed, setSpeed] = useState(1);
  const [health, setHealth] = useState<Health | null>(null);
  const [connector, setConnector] = useState<ConnectorStyle>({ kind: "sync", endArrow: "arrow" });
  const [libraries, setLibraries] = useLibraries();
  const [zoom, setZoom] = useState(1);
  const [toast, setToast] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [grid, setGrid] = usePref("grid", true);
  const [minimap, setMinimap] = usePref("minimap", false);
  const [libraryOpen, setLibraryOpen] = usePref("library", true);
  const [panelOpen, setPanelOpen] = usePref("panel", true);
  const [dark, setDarkPref] = usePref("dark", false);
  const llm = !!health?.llm;

  const notify = useCallback((text: string, kind: "info" | "error" = "info") => {
    setToast({ text, kind });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), kind === "error" ? 7000 : 4500);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  useEffect(() => {
    const check = () => void api.health().then(setHealth);
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    rememberBoard(boardId, state.name || boardId);
  }, [boardId, state.name]);

  // --- presence -----------------------------------------------------------------------------
  const onPointer = useCallback((p: { x: number; y: number } | null) => provider?.awareness?.setLocalStateField("pointer", p), [provider]);
  const onSelection = useCallback(
    (sel: { nodes: string[]; edges: string[] }) => {
      const key = (s: { nodes: string[]; edges: string[] }) => `${s.nodes.join()}|${s.edges.join()}`;
      setSelection((prev) => (key(prev) === key(sel) ? prev : sel));
      provider?.awareness?.setLocalStateField("selection", [...sel.nodes, ...sel.edges]);
    },
    [provider],
  );

  // --- reviewer overlay -----------------------------------------------------------------------
  const mutedFindings = useMemo(() => {
    const t = new Map<string, number>();
    for (const v of state.votes) t.set(v.finding, (t.get(v.finding) ?? 0) + (v.vote === "useful" ? 1 : -1));
    return new Set([...t].filter(([, n]) => n < 0).map(([id]) => id));
  }, [state.votes]);

  const pins = useMemo(() => {
    const by = new Map<string, { worst: Severity; count: number }>();
    for (const f of state.findings) {
      if (!f.canvas_id || mutedFindings.has(f.id)) continue;
      const cur = by.get(f.canvas_id);
      if (!cur) by.set(f.canvas_id, { worst: f.severity, count: 1 });
      else {
        cur.count += 1;
        if (SEV_RANK[f.severity] < SEV_RANK[cur.worst]) cur.worst = f.severity;
      }
    }
    return by;
  }, [state.findings, mutedFindings]);
  const asked = useMemo(() => new Set(state.questions.map((q) => q.canvas_id).filter((id): id is string => !!id)), [state.questions]);
  const unsure = useMemo(
    () => new Map(graph.nodes.filter((n) => n.canvas_id && n.confidence < 0.6).map((n) => [n.canvas_id!, n.type])),
    [graph],
  );
  const remoteSelection = useMemo(() => {
    const out = new Map<string, string>();
    for (const p of peers) for (const id of p.selection ?? []) out.set(id, p.user.color);
    return out;
  }, [peers]);

  const currentStep = player ? (player.flow.steps[player.index] ?? null) : null;
  const view: FlowView | null = useMemo(() => (player ? flowView(player.flow, player.index, graph, speed) : null), [player, graph, speed]);

  const reveal = useCallback((canvasId: string) => {
    canvas.current?.select([canvasId]);
    canvas.current?.reveal([canvasId]);
  }, []);
  const onPin = useCallback(
    (canvasId: string) => {
      setTab("review");
      setPanelOpen(true);
      setFocus(canvasId);
      reveal(canvasId);
    },
    [reveal, setPanelOpen],
  );
  const overlay = useMemo(() => ({ pins, asked, unsure, remoteSelection, flow: view, onPin }), [pins, asked, unsure, remoteSelection, view, onPin]);

  // --- commands -------------------------------------------------------------------------------
  const selectedIds = [...selection.nodes, ...selection.edges];
  const systemName = state.name.trim() || undefined;

  /** A connector style from the library: new connectors use it, and so does the selected one. */
  const applyConnector = (item: LibraryItem) => {
    if (item.kind !== "connector") return;
    const style: ConnectorStyle = { kind: "sync", endArrow: "arrow", ...item.edge };
    setConnector(style);
    if (selection.edges.length) {
      actions.patchEdges(selection.edges.map((id) => ({ id, patch: { ...style, startArrow: style.startArrow ?? "none", line: style.line, width: style.width } })));
      notify(`${item.name} applied to the selected connector${selection.edges.length > 1 ? "s" : ""}.`);
    } else notify(`New connectors: ${item.name}. Drag from a shape's blue point to draw one.`);
  };

  const addItem = (item: LibraryItem) => {
    if (item.kind === "connector") return applyConnector(item);
    const center = canvas.current?.viewCenter() ?? { x: 0, y: 0 };
    const size = itemSize(item);
    const at =
      item.kind === "component"
        ? freeSpot(center, model.current())
        : item.kind === "zone"
          ? { x: snap(center.x - size.w / 2), y: snap(center.y - size.h / 2) }
          : freeSpot(center, model.current(), size);
    const node = nodeFromItem(item, at);
    if (!node) return;
    actions.put({ nodes: [node] });
    canvas.current?.select([node.id]);
  };

  const insertClip = (clip: Diagram, at?: { x: number; y: number }) => {
    const ids = insertDiagram(clip, model.current(), actions, at);
    canvas.current?.select(ids);
    return ids;
  };
  const insertTemplate = (fragment: Diagram, name: string) => {
    const empty = model.current().nodes.length === 0;
    const ids = insertClip(fragment);
    window.setTimeout(() => (empty ? canvas.current?.fit(1) : canvas.current?.reveal(ids)), 80);
    notify(`Added the ${name} template. Ctrl+Z takes it out again.`);
  };

  const removeSelection = () => {
    if (selectedIds.length) actions.remove({ nodes: selection.nodes, edges: selection.edges });
  };
  const copySelection = () => {
    clipboard.current = copy(selection.nodes, model.current());
    return clipboard.current;
  };
  const pasteClipboard = () => {
    if (!clipboard.current) return;
    const ids = paste(clipboard.current, actions);
    canvas.current?.select(ids);
    // Paste again lands a little further along.
    clipboard.current = { ...clipboard.current, nodes: clipboard.current.nodes.map((n) => (n.parent ? n : { ...n, x: n.x + 30, y: n.y + 30 })) };
  };
  const duplicate = () => {
    const clip = copy(selection.nodes, model.current());
    if (clip) canvas.current?.select(paste(clip, actions));
  };
  const selectAll = () => canvas.current?.select([...diagram.nodes.map((n) => n.id), ...diagram.edges.map((e) => e.id)]);
  const rename = () => {
    if (selectedIds.length === 1) canvas.current?.startEditing(selectedIds[0]);
  };
  const group = () => {
    const id = groupInZone(selection.nodes, model.current(), actions);
    if (id) {
      canvas.current?.select([id]);
      canvas.current?.startEditing(id);
    }
  };
  const ungroupSelection = () => {
    const zone = selection.nodes.map((id) => byId.get(id)).find((n) => n?.kind === "zone");
    if (zone) ungroup(zone.id, model.current(), actions);
  };
  const layout = async () => {
    try {
      const n = await autoLayout(model.current(), actions, systemName);
      if (n === 0) return notify("Nothing to lay out yet: add a few components first.");
      notify(`Laid out ${n} components. Ctrl+Z puts them back.`);
      // Bring the new layout into view without zooming in past 100%.
      window.setTimeout(() => canvas.current?.fit(1), 50);
    } catch (err) {
      notify(`Auto layout failed: ${(err as Error).message}`, "error");
    }
  };
  const nudge = (dx: number, dy: number) => {
    const ids = new Set(selection.nodes);
    const top = selection.nodes.map((id) => byId.get(id)).filter((n) => n && !(n.parent && ids.has(n.parent)));
    actions.patchNodes(top.map((n) => ({ id: n!.id, patch: { x: n!.x + dx, y: n!.y + dy } })));
  };
  const setKind = (kind: EdgeKind) => {
    setConnector((c) => ({ ...c, kind }));
    if (selection.edges.length) actions.patchEdges(selection.edges.map((id) => ({ id, patch: { kind, origin: "user" as const } })));
  };
  const setLine = (line: LineStyle) => {
    setConnector((c) => ({ ...c, line: line === "orthogonal" ? undefined : line }));
    if (selection.edges.length) actions.patchEdges(selection.edges.map((id) => ({ id, patch: { line: line === "orthogonal" ? undefined : line } })));
  };
  const toFront = () => restack(selection.nodes, "front", model.current(), actions);
  const toBack = () => restack(selection.nodes, "back", model.current(), actions);

  // --- exports and imports ----------------------------------------------------------------------
  const baseName = (state.name || boardId).replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  const doExport = async (format: "png" | "svg" | "drawio" | "mermaid" | "json") => {
    const current = model.current();
    if (current.nodes.length === 0) return notify("Nothing to export yet.", "error");
    try {
      if (format === "json") download(`${baseName}.graph.json`, new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" }));
      if (format === "drawio") download(`${baseName}.drawio`, new Blob([diagramToDrawio(current, graph)], { type: "application/xml" }));
      if (format === "mermaid") {
        const text = toMermaid(graph);
        download(`${baseName}.mmd`, new Blob([text], { type: "text/plain" }));
        try {
          await navigator.clipboard.writeText(text);
          notify("Mermaid downloaded and copied to the clipboard.");
        } catch {
          /* clipboard blocked: the download is enough */
        }
      }
      if (format === "svg" || format === "png") {
        const { svg, width, height } = diagramToSvg(current);
        if (format === "svg") download(`${baseName}.svg`, new Blob([svg], { type: "image/svg+xml" }));
        else download(`${baseName}.png`, await svgToPng(svg, width, height, 2));
      }
    } catch (err) {
      notify(`Export failed: ${(err as Error).message}`, "error");
    }
  };

  const importGraph = async (g: Graph, boxes: Map<string, Box> | undefined, notes: string[]) => {
    const ids = await insertGraph(g, model.current(), actions, { boxes, systemName });
    canvas.current?.select(ids);
    window.setTimeout(() => canvas.current?.reveal(ids), 120);
    setTab("review");
    notify(`Added ${g.nodes.length} components and ${g.edges.length} connections. ${notes.join(" ")}`.trim());
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      notify("Board link copied. Anyone with it can edit.");
    } catch {
      notify(window.location.href);
    }
  };

  // --- reviewer interactions ------------------------------------------------------------------
  const answer = (q: Question, value: boolean | number | string) => {
    if (!q.canvas_id) return;
    setFocus(null);
    if (byId.has(q.canvas_id)) actions.patchNode(q.canvas_id, { [q.field]: value });
    else actions.patchEdge(q.canvas_id, { [q.field]: value, origin: "user" });
  };
  const dismiss = (q: Question) => {
    setFocus(null);
    dismissedMap(doc).set(q.id, { by: me.name, at: Date.now() });
  };
  const vote = (findingId: string, v: Vote["vote"]) => {
    const key = `${findingId}|${me.id}`;
    const votes = votesMap(doc);
    if (votes.get(key)?.vote === v) votes.delete(key);
    else votes.set(key, { finding: findingId, user: me.id, vote: v, at: Date.now() });
  };

  // --- flow explainer -------------------------------------------------------------------------
  const selectedNode: GraphNode | null = useMemo(() => {
    const nodes = graph.nodes.filter((n) => n.canvas_id && selection.nodes.includes(n.canvas_id));
    return nodes.length === 1 ? nodes[0] : null;
  }, [graph, selection.nodes]);

  const explain = async (node: GraphNode, entry: EntryPoint, narrate: boolean) => {
    const res = await api.explain(graph, node.id, entry.edge_id, narrate);
    const flow: Flow = {
      id: `flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      node_id: node.id,
      entry: entry.label,
      steps: res.steps,
      summary: res.summary,
      created_at: Date.now(),
      created_by: me.name,
    };
    flowsMap(doc).set(flow.id, flow);
    setPlayer({ flow, index: 0, playing: true });
  };

  useEffect(() => {
    if (!player?.playing) return;
    const step = player.flow.steps[player.index];
    const t = window.setTimeout(() => {
      setPlayer((p) => {
        if (!p) return p;
        if (p.index >= p.flow.steps.length - 1) return { ...p, playing: false };
        return { ...p, index: p.index + 1 };
      });
    }, stepMs(step, speed));
    return () => clearTimeout(t);
  }, [player, speed]);

  // Frame the whole flow when it starts, then keep the request in view as it moves.
  const framed = useRef<string | null>(null);
  const hopKey = view?.hop?.key;
  useEffect(() => {
    if (!player || !view) {
      framed.current = null;
      return;
    }
    if (framed.current !== player.flow.id) {
      framed.current = player.flow.id;
      canvas.current?.follow([...view.nodes], { fit: true, bottom: CAPTION_SPACE });
    } else if (view.hop) {
      canvas.current?.follow([view.hop.from, view.hop.to].filter((id): id is string => !!id), { bottom: CAPTION_SPACE });
    }
    // Only when the flow or the step changes, not on every graph update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player?.flow.id, hopKey]);

  const flowControls = {
    onStep: (d: number) => setPlayer((p) => (p ? { ...p, playing: false, index: Math.min(Math.max(p.index + d, 0), p.flow.steps.length - 1) } : p)),
    onJump: (i: number) => setPlayer((p) => (p ? { ...p, playing: false, index: i } : p)),
    onToggle: () =>
      setPlayer((p) => (p ? (p.playing ? { ...p, playing: false } : { ...p, playing: true, index: p.index >= p.flow.steps.length - 1 ? 0 : p.index }) : p)),
    onStop: () => setPlayer(null),
  };
  const describe = (graphId: string) => {
    const node = graph.nodes.find((n) => n.id === graphId);
    const shape = node?.canvas_id ? byId.get(node.canvas_id) : undefined;
    return { label: node?.label ?? graphId, icon: shape?.kind === "component" ? componentIcon(shape) : null };
  };

  const numbered = diagram.nodes.some((n) => n.legendFor) || diagram.edges.some((e) => e.steps?.length);
  const numberSteps = (flow: Flow) => {
    const n = numberFlow(flow, graph, model.current(), actions);
    notify(n ? `Numbered ${n} steps on the diagram, with the list beside it.` : "None of this flow's connectors are on the diagram any more.", n ? "info" : "error");
    // The list goes beside the drawing, often out of view.
    if (n) window.setTimeout(() => canvas.current?.fit(1), 80);
  };

  const sendChat = (text: string, askAi: boolean) => {
    chatArray(doc).push([
      {
        id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        role: "user",
        author: me.name,
        text,
        ts: Date.now(),
        ...(askAi ? { status: "pending" as const, tab: tabId } : {}),
      },
    ]);
  };

  // --- the AI's edits to the board ------------------------------------------------------------
  const showNodes = (ids: string[]) => {
    const onBoard = new Set(model.current().nodes.map((n) => n.id));
    const present = ids.filter((id) => onBoard.has(id));
    if (present.length === 0) return;
    canvas.current?.select(present);
    window.setTimeout(() => canvas.current?.reveal(present), 120);
  };
  const applyReply = async (m: ChatMessage) => {
    if (!m.edits) return;
    try {
      const plan = await planEdits(m.edits, model.current(), systemName);
      let applied = false;
      actions.batch(() => {
        // Someone else may have applied it meanwhile.
        const now = chatArray(doc).toArray().find((x) => x.id === m.id);
        if (!now || now.edit_state === "applied") return;
        applyChange(plan.change, actions);
        patchChatMessage(doc, m.id, { edit_state: "applied", edit_note: plan.note, edit_undo: plan.undo, edit_ids: plan.touched });
        applied = true;
      });
      if (applied) showNodes(plan.touched);
    } catch (err) {
      doc.transact(() => patchChatMessage(doc, m.id, { edit_state: "failed", edit_note: err instanceof Error ? err.message : String(err) }));
    }
  };
  const undoReply = (m: ChatMessage) => {
    if (!m.edit_undo) return;
    actions.batch(() => {
      applyChange(m.edit_undo!, actions);
      patchChatMessage(doc, m.id, { edit_state: "undone" });
    });
  };
  // The tab that asked applies the AI's edits as soon as they arrive.
  const autoApplied = useRef(new Set<string>());
  useEffect(() => {
    for (const m of state.chat) {
      if (m.role !== "assistant" || m.edit_state !== "proposed" || autoApplied.current.has(m.id)) continue;
      if (state.chat.find((q) => q.id === m.reply_to)?.tab !== tabId) continue;
      autoApplied.current.add(m.id);
      void applyReply(m);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.chat, tabId]);

  const renameBoard = (name: string) => metaMap(doc).set("name", name.trim().slice(0, 80));
  const renameMe = () => {
    const name = window.prompt("Your name, as others in the room see it:", me.name)?.trim();
    if (!name) return;
    const next = { ...me, name: name.slice(0, 40) };
    saveIdentity(next);
    setMe(next);
  };

  // --- keyboard -------------------------------------------------------------------------------
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (isTyping(e.target) || dialog) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const run = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    if (mod && k === "z" && !e.shiftKey) return run(actions.undo);
    if (mod && (k === "y" || (k === "z" && e.shiftKey))) return run(actions.redo);
    if (mod && k === "c" && selection.nodes.length) return run(() => void copySelection());
    if (mod && k === "x" && selection.nodes.length) return run(() => (copySelection(), removeSelection()));
    if (mod && k === "v") return run(pasteClipboard);
    if (mod && k === "d") return run(duplicate);
    if (mod && k === "a") return run(selectAll);
    if (mod && k === "g" && e.shiftKey) return run(ungroupSelection);
    if (mod && k === "g") return run(group);
    if (mod && e.shiftKey && k === "l") return run(() => void layout());
    if (mod && e.shiftKey && k === "h") return run(() => canvas.current?.fit());
    if (mod && e.shiftKey && k === "f" && selection.nodes.length) return run(toFront);
    if (mod && e.shiftKey && k === "b" && selection.nodes.length) return run(toBack);
    if (mod && (k === "=" || k === "+")) return run(() => canvas.current?.zoomIn());
    if (mod && k === "-") return run(() => canvas.current?.zoomOut());
    if (mod && k === "0") return run(() => canvas.current?.zoomTo(1));
    if (e.key === "F2") return run(rename);
    if (e.key === "Escape") return run(() => canvas.current?.select([]));
    if (e.key === "?") return run(() => setDialog("shortcuts"));
    if (!mod && selection.nodes.length && e.key.startsWith("Arrow")) {
      const step = e.shiftKey ? 1 : 10;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) return run(() => nudge(d[0], d[1]));
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // --- menus ------------------------------------------------------------------------------------
  const one = selectedIds.length === 1;
  const many = selection.nodes.length >= 2;
  const alignItem = (how: AlignHow, label: string): MenuItem => ({ label: `Align ${label}`, disabled: !many, run: () => align(selection.nodes, how, model.current(), actions) });
  const menus: { title: string; items: MenuItem[] }[] = [
    {
      title: "File",
      items: [
        { label: "New board", run: () => router.push(`/b/${newBoardId()}`) },
        { label: "Insert a template…", run: () => setDialog("templates") },
        { label: "All boards", run: () => router.push("/") },
        "-",
        { label: "Import draw.io, compose or JSON…", run: () => setDialog("import") },
        "-",
        { label: "Export as PNG", run: () => void doExport("png") },
        { label: "Export as SVG", run: () => void doExport("svg") },
        { label: "Export as draw.io", run: () => void doExport("drawio") },
        { label: "Export as Mermaid", run: () => void doExport("mermaid") },
        { label: "Export graph JSON", run: () => void doExport("json") },
        "-",
        { label: "Copy share link", run: () => void share() },
      ],
    },
    {
      title: "Edit",
      items: [
        { label: "Undo", shortcut: "Ctrl+Z", disabled: !model.canUndo, run: actions.undo },
        { label: "Redo", shortcut: "Ctrl+Y", disabled: !model.canRedo, run: actions.redo },
        "-",
        { label: "Copy", shortcut: "Ctrl+C", disabled: !selection.nodes.length, run: () => void copySelection() },
        { label: "Paste", shortcut: "Ctrl+V", run: pasteClipboard },
        { label: "Duplicate", shortcut: "Ctrl+D", disabled: !selection.nodes.length, run: duplicate },
        { label: "Delete", shortcut: "Del", disabled: !selectedIds.length, run: removeSelection },
        "-",
        { label: "Rename", shortcut: "F2", disabled: !one, run: rename },
        { label: "Select all", shortcut: "Ctrl+A", run: selectAll },
        { label: "Select none", shortcut: "Esc", run: () => canvas.current?.select([]) },
      ],
    },
    {
      title: "View",
      items: [
        { label: "Shape library", checked: libraryOpen, run: () => setLibraryOpen(!libraryOpen) },
        { label: "More shapes…", run: () => (setLibraryOpen(true), setDialog("libraries")) },
        { label: "Format panel", checked: panelOpen, run: () => setPanelOpen(!panelOpen) },
        "-",
        { label: "Grid", checked: grid, run: () => setGrid(!grid) },
        { label: "Minimap", checked: minimap, run: () => setMinimap(!minimap) },
        { label: "Dark mode", checked: dark, run: () => setDarkPref(!dark) },
        "-",
        { label: "Zoom in", shortcut: "Ctrl+=", run: () => canvas.current?.zoomIn() },
        { label: "Zoom out", shortcut: "Ctrl+-", run: () => canvas.current?.zoomOut() },
        { label: "Actual size", shortcut: "Ctrl+0", run: () => canvas.current?.zoomTo(1) },
        { label: "Fit the diagram", shortcut: "Ctrl+Shift+H", run: () => canvas.current?.fit() },
        "-",
        { label: "Graph data", run: () => setDialog("graph") },
      ],
    },
    {
      title: "Arrange",
      items: [
        { label: "Auto layout", shortcut: "Ctrl+Shift+L", run: () => void layout() },
        "-",
        { label: "Put in a zone", shortcut: "Ctrl+G", disabled: !selection.nodes.length, run: group },
        { label: "Remove zone, keep contents", shortcut: "Ctrl+Shift+G", disabled: !selection.nodes.some((id) => byId.get(id)?.kind === "zone"), run: ungroupSelection },
        "-",
        { label: "To front", shortcut: "Ctrl+Shift+F", disabled: !selection.nodes.length, run: toFront },
        { label: "To back", shortcut: "Ctrl+Shift+B", disabled: !selection.nodes.length, run: toBack },
        "-",
        alignItem("left", "left"),
        alignItem("center", "center"),
        alignItem("right", "right"),
        alignItem("top", "top"),
        alignItem("middle", "middle"),
        alignItem("bottom", "bottom"),
        "-",
        { label: "Distribute horizontally", disabled: selection.nodes.length < 3, run: () => distribute(selection.nodes, "x", model.current(), actions) },
        { label: "Distribute vertically", disabled: selection.nodes.length < 3, run: () => distribute(selection.nodes, "y", model.current(), actions) },
      ],
    },
    {
      title: "AI",
      items: [
        { label: "Idea → architecture…", run: () => setDialog("idea") },
        { label: "Review findings", run: () => (setPanelOpen(true), setTab("review")) },
        { label: "Explain a request flow", run: () => (setPanelOpen(true), setTab("flow")) },
        { label: "Ask the room AI", run: () => (setPanelOpen(true), setTab("chat")) },
      ],
    },
    {
      title: "Help",
      items: [
        { label: "Keyboard shortcuts", shortcut: "?", run: () => setDialog("shortcuts") },
        { label: "How to draw", run: () => (canvas.current?.select([]), setPanelOpen(true), setTab("format")) },
      ],
    },
  ];

  const openFindings = state.findings.filter((f) => !mutedFindings.has(f.id)).length + state.questions.length;
  const components = diagram.nodes.filter((n) => n.kind === "component").length;
  const shapes = diagram.nodes.filter((n) => n.kind === "shape").length;

  return (
    <div className="ss-app">
      <header className="ss-header">
        <Link href="/" className="ss-brand" title="All boards">
          <span className="brand-mark">◇</span> StackSketch
        </Link>
        <div className="ss-title">
          <input
            className="ss-board-name"
            defaultValue={state.name}
            key={state.name}
            placeholder="Untitled diagram"
            aria-label="Board name"
            onBlur={(e) => e.target.value.trim() !== state.name && renameBoard(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
          <MenuBar menus={menus} />
        </div>
        <div className="spacer" />
        <ReviewerBadge reviewer={state.reviewer} llmAvailable={llm} />
        <div className="peers">
          {peers.map((p) => (
            <span key={p.clientId} className="avatar" style={{ background: p.user.color }} title={p.user.name}>
              {p.user.name.slice(0, 1)}
            </span>
          ))}
          <button className="avatar me" style={{ background: me.color }} title={`You are ${me.name}. Click to rename.`} onClick={renameMe}>
            {me.name.slice(0, 1)}
          </button>
        </div>
        <button className="btn primary small" onClick={() => void share()}>
          Share
        </button>
      </header>

      <Toolbar
        zoom={zoom}
        canUndo={model.canUndo}
        canRedo={model.canRedo}
        hasSelection={selectedIds.length > 0}
        connector={connector}
        grid={grid}
        libraryOpen={libraryOpen}
        panelOpen={panelOpen}
        onLibrary={() => setLibraryOpen(!libraryOpen)}
        onPanel={() => setPanelOpen(!panelOpen)}
        onUndo={actions.undo}
        onRedo={actions.redo}
        onZoomIn={() => canvas.current?.zoomIn()}
        onZoomOut={() => canvas.current?.zoomOut()}
        onZoomReset={() => canvas.current?.zoomTo(1)}
        onFit={() => canvas.current?.fit()}
        onDelete={removeSelection}
        onDuplicate={duplicate}
        onKind={setKind}
        onLine={setLine}
        onTemplates={() => setDialog("templates")}
        onLayout={() => void layout()}
        onZone={group}
        onGrid={() => setGrid(!grid)}
      />

      <main className="ss-main">
        {libraryOpen && (
          <ShapeLibrary
            enabled={libraries}
            onAdd={addItem}
            selectionClip={() => copy(selection.nodes, model.current())}
            onInsertClip={(clip) => {
              const c = canvas.current?.viewCenter() ?? { x: 0, y: 0 };
              insertClip(clip, { x: snap(c.x - 60), y: snap(c.y - 40) });
            }}
            onMoreShapes={() => setDialog("libraries")}
            onTemplates={() => setDialog("templates")}
          />
        )}
        <div className="ss-stage">
          <Canvas
            model={model}
            connector={connector}
            onConnectorItem={applyConnector}
            grid={grid}
            minimap={minimap}
            dark={dark}
            overlay={overlay}
            peers={peers}
            onSelection={onSelection}
            onPointer={onPointer}
            onZoom={setZoom}
            handleRef={canvas}
          />
          {synced && diagram.nodes.length === 0 && (
            <div className="ss-empty">
              <div className="ss-empty-title">Start a diagram</div>
              <p>
                Drag shapes from the library on the left, start from a template, describe a system with <b>AI → Idea → architecture</b>, or{" "}
                <b>File → Import</b> a draw.io or docker-compose file.
              </p>
              <button type="button" className="btn primary" onClick={() => setDialog("templates")}>
                Browse templates
              </button>
            </div>
          )}
          {player && currentStep && (
            <FlowCaption flow={player.flow} index={player.index} playing={player.playing} describe={describe} {...flowControls} />
          )}
          {!synced && <div className="sync-banner">{connection === "disconnected" ? "Can't reach the sync server on port 1234. Retrying…" : "Connecting to the board…"}</div>}
          {toast && <div className={`toast ${toast.kind}${player ? " raised" : ""}`}>{toast.text}</div>}
        </div>

        {panelOpen && (
          <aside className="side ss-side">
            <nav className="tabs" role="tablist">
              {(
                [
                  ["format", "Format"],
                  ["review", `Review${openFindings ? ` (${openFindings})` : ""}`],
                  ["flow", "Flow"],
                  ["chat", `Chat${state.chat.length ? ` (${state.chat.length})` : ""}`],
                ] as [Tab, string][]
              ).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} className={`tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </nav>
            {tab === "format" && (
              <FormatPanel
                model={model}
                graph={graph}
                findings={state.findings.filter((f) => !mutedFindings.has(f.id))}
                selection={selection}
                grid={grid}
                minimap={minimap}
                onToggleGrid={() => setGrid(!grid)}
                onToggleMinimap={() => setMinimap(!minimap)}
                onAlign={(how) => align(selection.nodes, how, model.current(), actions)}
                onDistribute={(axis) => distribute(selection.nodes, axis, model.current(), actions)}
                onGroup={group}
                onUngroup={(id) => ungroup(id, model.current(), actions)}
                onRestack={(to) => (to === "front" ? toFront() : toBack())}
                onExplain={() => setTab("flow")}
                onFinding={(id) => onPin(id)}
              />
            )}
            {tab === "review" && (
              <ReviewPanel
                graph={graph}
                findings={state.findings}
                questions={state.questions}
                issues={state.issues}
                votes={state.votes}
                reviewer={state.reviewer}
                meId={me.id}
                llmAvailable={llm}
                focusCanvasId={focus}
                onAnswer={answer}
                onDismiss={dismiss}
                onVote={vote}
                onFocus={setFocus}
                onReveal={reveal}
              />
            )}
            {tab === "flow" && (
              <FlowPanel
                graph={graph}
                selectedNode={selectedNode}
                flows={state.flows}
                llmAvailable={llm}
                player={player}
                numbered={numbered}
                onExplain={explain}
                speed={speed}
                onSpeed={setSpeed}
                onPlay={(flow) => setPlayer({ flow, index: 0, playing: true })}
                {...flowControls}
                onNumber={numberSteps}
                onClearNumbers={() => clearNumbers(model.current(), actions)}
              />
            )}
            {tab === "chat" && (
              <ChatPanel
                messages={state.chat}
                status={state.chatStatus}
                llmAvailable={llm}
                meName={me.name}
                tabId={tabId}
                onSend={sendChat}
                onApply={(m) => void applyReply(m)}
                onUndo={undoReply}
                onShow={(m) => showNodes(m.edit_ids ?? [])}
              />
            )}
          </aside>
        )}
      </main>

      <footer className="ss-status">
        <span>
          {components} component{components === 1 ? "" : "s"} · {shapes} shape{shapes === 1 ? "" : "s"} · {diagram.edges.length} connector
          {diagram.edges.length === 1 ? "" : "s"}
        </span>
        {selectedIds.length > 0 && <span>{selectedIds.length} selected</span>}
        <span className="spacer" />
        <span>{health ? (llm ? `AI: ${health.provider ?? ""} ${health.model ?? ""}` : "AI off (rules only)") : "API offline"}</span>
        <span className={`conn conn-${connection}`} title={`Sync server: ${connection}`} />
        <span>{connection === "connected" ? "Saved" : connection}</span>
      </footer>

      {dialog === "idea" && (
        <IdeaDialog
          llmAvailable={llm}
          onClose={() => setDialog(null)}
          onGenerate={async (prompt) => {
            const res = await api.generate(prompt);
            await importGraph(res.graph, undefined, res.notes);
            setDialog(null);
          }}
        />
      )}
      {dialog === "import" && (
        <ImportDialog
          onClose={() => setDialog(null)}
          onImport={async (g, boxes, notes) => {
            await importGraph(g, boxes, notes);
            setDialog(null);
          }}
        />
      )}
      {dialog === "templates" && <TemplatesDialog onClose={() => setDialog(null)} onInsert={(fragment, t) => insertTemplate(fragment, t.name)} />}
      {dialog === "libraries" && <MoreShapesDialog enabled={libraries} onApply={setLibraries} onClose={() => setDialog(null)} />}
      {dialog === "shortcuts" && (
        <Modal title="Keyboard shortcuts" onClose={() => setDialog(null)}>
          <table className="ss-shortcuts">
            <tbody>
              {SHORTCUTS.map(([keys, what]) => (
                <tr key={keys}>
                  <td className="mono">{keys}</td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
      {dialog === "graph" && (
        <Modal title="Graph data" onClose={() => setDialog(null)}>
          <div className="ss-graph-dialog">
            <GraphPanel graph={graph} />
          </div>
        </Modal>
      )}
    </div>
  );
}
