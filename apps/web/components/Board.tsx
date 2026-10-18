"use client";

import { CaptureUpdateAction, Excalidraw, MainMenu, WelcomeScreen, exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { AppState, Collaborator, ExcalidrawImperativeAPI, SocketId } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, ExcalidrawFreeDrawElement } from "@excalidraw/excalidraw/element/types";
import {
  type Box,
  type EdgeKind,
  EDGE_KINDS,
  type Flow,
  type Graph,
  type GraphNode,
  ICON_SIZE,
  type NodeType,
  NODE_TYPES,
  type Question,
  type Vote,
  chatArray,
  dismissedMap,
  elementsMap,
  flowsMap,
  getMeta,
  iconDataUrl,
  iconFor,
  kindToStroke,
  metaMap,
  toDrawio,
  toMermaid,
  votesMap,
} from "@stacksketch/graph";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";
import { type EntryPoint, type Health, api } from "@/lib/api";
import { ExcalidrawBinding } from "@/lib/binding";
import {
  FONT,
  NODE_LABEL,
  clearStepNumbers,
  iconFiles,
  insertGraph,
  insertNode,
  normalizeArrows,
  numberFlow,
  refreshIcons,
  tidyUp,
  updateMeta,
  zonesOnCanvas,
} from "@/lib/canvas";
import { quietFontWorkerFallback } from "@/lib/fontWorker";
import { type Identity, getIdentity, rememberBoard, saveIdentity } from "@/lib/identity";
import { snapStroke } from "@/lib/snap";
import { useBoard } from "@/lib/useBoard";
import { getView, setView } from "@/lib/viewStore";
import { ChatPanel } from "./ChatPanel";
import { FlowPanel, type Player } from "./FlowPanel";
import { GraphPanel } from "./GraphPanel";
import { ImportDialog, IdeaDialog } from "./Dialogs";
import { InspectPanel } from "./InspectPanel";
import { Overlay } from "./Overlay";
import { ReviewPanel, ReviewerBadge } from "./ReviewPanel";

type Tab = "review" | "inspect" | "flow" | "chat" | "graph";

const KIND_HINT: Record<EdgeKind, string> = {
  sync: "Solid arrow: the caller waits for the reply",
  async: "Dashed arrow: fire-and-forget message or event",
  stream: "Dotted arrow: continuous stream of data",
};

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stepDuration = (phase: string) => (phase === "return" ? 900 : 1900);

/** Whatever is drawn by hand comes out crisp: straight lines, a sans font, elbow arrows. */
const INITIAL_DATA = {
  appState: {
    currentItemRoughness: 0,
    currentItemFontFamily: FONT,
    currentItemFontSize: 16,
    currentItemStrokeWidth: 1,
    currentItemStrokeColor: "#232f3e",
    currentItemRoundness: "sharp" as const,
    currentItemArrowType: "elbow" as const,
    currentItemEndArrowhead: "triangle" as const,
  },
};

const PALETTE_ICONS = Object.fromEntries(NODE_TYPES.map((t) => [t, iconDataUrl(iconFor({ type: t, label: NODE_LABEL[t] }))])) as Record<
  NodeType,
  string
>;

quietFontWorkerFallback();

export default function Board({ boardId }: { boardId: string }) {
  const [me, setMe] = useState<Identity>(getIdentity);
  const { doc, provider, state, connection, synced, peers } = useBoard(boardId, me);
  const [excalidraw, setExcalidraw] = useState<ExcalidrawImperativeAPI | null>(null);
  const binding = useRef<ExcalidrawBinding | null>(null);
  const [tab, setTab] = useState<Tab>("review");
  const [focus, setFocus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [player, setPlayer] = useState<Player | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [snapOn, setSnapOn] = useState(true);
  const [edgeKind, setEdgeKind] = useState<EdgeKind>("sync");
  const [dialog, setDialog] = useState<null | "idea" | "import">(null);
  const [toast, setToast] = useState<{ text: string; kind: "info" | "error" } | null>(null);
  const [menu, setMenu] = useState<null | "export">(null);
  const viewFrame = useRef<number | null>(null);
  const freedrawBefore = useRef<Set<string>>(new Set());
  const llm = !!health?.llm;

  const notify = useCallback((text: string, kind: "info" | "error" = "info") => {
    setToast({ text, kind });
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), kind === "error" ? 7000 : 4500);
  }, []);

  // --- API health (whether the AI layer is on) -------------------------------------------
  useEffect(() => {
    const check = () => void api.health().then(setHealth);
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, []);

  // --- Canvas <-> shared document --------------------------------------------------------
  useEffect(() => {
    // Icons are built in, so every client registers the same files instead of syncing them.
    excalidraw?.addFiles(iconFiles());
  }, [excalidraw]);

  useEffect(() => {
    if (!excalidraw || !synced) return;
    // Renames and type changes can call for a different icon; fix it up after Excalidraw's own update.
    const b = new ExcalidrawBinding(excalidraw, elementsMap(doc) as unknown as Y.Map<ExcalidrawElement>, (changed) =>
      window.setTimeout(() => refreshIcons(excalidraw, changed), 0),
    );
    binding.current = b;
    // Push anything drawn before the connection finished syncing.
    b.onLocalChange(excalidraw.getSceneElementsIncludingDeleted());
    normalizeArrows(excalidraw);
    if (excalidraw.getSceneElements().length > 0) excalidraw.scrollToContent(undefined, { fitToContent: true });
    return () => {
      b.destroy();
      binding.current = null;
    };
  }, [excalidraw, synced, doc]);

  useEffect(() => {
    rememberBoard(boardId, state.name || boardId);
  }, [boardId, state.name]);

  // --- Presence: remote cursors on the canvas ----------------------------------------------
  useEffect(() => {
    if (!excalidraw) return;
    const collaborators = new Map<SocketId, Collaborator>();
    for (const p of peers) {
      collaborators.set(String(p.clientId) as SocketId, {
        id: p.user.id,
        username: p.user.name,
        color: { background: p.user.color, stroke: p.user.color },
        pointer: p.pointer,
        button: p.button,
        selectedElementIds: p.selectedElementIds,
      });
    }
    excalidraw.updateScene({ collaborators });
  }, [excalidraw, peers]);

  const lastPointer = useRef(0);
  const onPointerUpdate = useCallback(
    (payload: { pointer: { x: number; y: number; tool: "pointer" | "laser" }; button: "down" | "up" }) => {
      const now = performance.now();
      if (now - lastPointer.current < 40) return;
      lastPointer.current = now;
      provider?.awareness?.setLocalState({
        ...provider.awareness.getLocalState(),
        pointer: payload.pointer,
        button: payload.button,
      });
    },
    [provider],
  );

  // --- Local changes ---------------------------------------------------------------------------
  const onChange = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      binding.current?.onLocalChange(elements);
      if (viewFrame.current !== null) return;
      viewFrame.current = requestAnimationFrame(() => {
        viewFrame.current = null;
        const live = new Map<string, ExcalidrawElement>();
        for (const el of elements) if (!el.isDeleted) live.set(el.id, el);
        const sel = Object.keys(appState.selectedElementIds).filter((id) => appState.selectedElementIds[id]);
        const prev = getView();
        setView({
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
          zoom: appState.zoom.value,
          width: appState.width,
          height: appState.height,
          theme: appState.theme,
          elements: live,
          selectedIds: sel,
        });
        if (sel.join() !== prev.selectedIds.join()) {
          setSelected(sel);
          const local = provider?.awareness?.getLocalState();
          if (local) provider?.awareness?.setLocalState({ ...local, selectedElementIds: appState.selectedElementIds });
        }
        if (appState.theme !== prev.theme) document.documentElement.dataset.theme = appState.theme;
        const kind = EDGE_KINDS.find((k) => kindToStroke(k) === appState.currentItemStrokeStyle) ?? "sync";
        setEdgeKind((cur) => (cur === kind ? cur : kind));
      });
    },
    [provider],
  );

  // --- Snap-to-shape ---------------------------------------------------------------------------
  // Runs in the capture phase, before Excalidraw inserts the new stroke on pointer down.
  const rememberStrokes = useCallback(() => {
    if (!excalidraw) return;
    freedrawBefore.current = new Set(excalidraw.getSceneElements().filter((e) => e.type === "freedraw").map((e) => e.id));
  }, [excalidraw]);

  const onPointerUp = useCallback(
    (activeTool: AppState["activeTool"]) => {
      if (!excalidraw || !snapOn || activeTool.type !== "freedraw") return;
      window.setTimeout(() => {
        const stroke = excalidraw
          .getSceneElements()
          .find((e) => e.type === "freedraw" && !freedrawBefore.current.has(e.id)) as ExcalidrawFreeDrawElement | undefined;
        if (stroke) snapStroke(excalidraw, stroke);
      }, 30);
    },
    [excalidraw, snapOn],
  );

  // --- Graph lookups -----------------------------------------------------------------------
  const graph = state.graph;
  // Selecting an icon also selects its name, so look for exactly one component in the selection.
  const selectedNode: GraphNode | null = useMemo(() => {
    const nodes = graph.nodes.filter((n) => n.canvas_id && selected.includes(n.canvas_id));
    return nodes.length === 1 ? nodes[0] : null;
  }, [graph, selected]);

  const mutedFindings = useMemo(() => {
    const t = new Map<string, number>();
    for (const v of state.votes) t.set(v.finding, (t.get(v.finding) ?? 0) + (v.vote === "useful" ? 1 : -1));
    return new Set([...t].filter(([, n]) => n < 0).map(([id]) => id));
  }, [state.votes]);

  const reveal = useCallback(
    (canvasId: string) => {
      if (!excalidraw) return;
      const el = excalidraw.getSceneElements().find((e) => e.id === canvasId);
      if (!el) return;
      excalidraw.updateScene({ appState: { selectedElementIds: { [canvasId]: true } }, captureUpdate: CaptureUpdateAction.NEVER });
      excalidraw.scrollToContent([el], { animate: true, duration: 300 });
    },
    [excalidraw],
  );

  // --- Palette ---------------------------------------------------------------------------------
  const addNode = (type: NodeType) => {
    if (!excalidraw) return;
    const s = excalidraw.getAppState();
    const center = {
      x: -s.scrollX + s.width / 3 / s.zoom.value,
      y: -s.scrollY + s.height / 3 / s.zoom.value,
    };
    insertNode(excalidraw, type, center);
  };

  const chooseKind = (kind: EdgeKind) => {
    if (!excalidraw) return;
    setEdgeKind(kind);
    excalidraw.updateScene({ appState: { currentItemStrokeStyle: kindToStroke(kind) } });
    const arrows = graph.edges.filter((e) => e.canvas_id && selected.includes(e.canvas_id));
    if (arrows.length) for (const e of arrows) updateMeta(excalidraw, e.canvas_id!, { kind });
    else excalidraw.setActiveTool({ type: "arrow" });
  };

  // --- Reviewer interactions -----------------------------------------------------------------
  const answer = (q: Question, value: boolean | number | string) => {
    if (!excalidraw || !q.canvas_id) return;
    // The card under the pointer is about to disappear, so it never gets mouseleave.
    setFocus(null);
    updateMeta(excalidraw, q.canvas_id, { [q.field]: value });
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
  const onPin = (canvasId: string) => {
    setTab("review");
    setFocus(canvasId);
    reveal(canvasId);
  };

  // --- Flow explainer ---------------------------------------------------------------------------
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
    }, stepDuration(step?.phase ?? "call"));
    return () => clearTimeout(t);
  }, [player]);

  const currentStep = player ? (player.flow.steps[player.index] ?? null) : null;

  const numberSteps = (flow: Flow) => {
    if (!excalidraw) return;
    const n = numberFlow(excalidraw, graph, flow);
    notify(n ? `Numbered ${n} steps on the diagram, with the list beside it.` : "None of this flow's arrows are on the canvas any more.", n ? "info" : "error");
  };

  // --- Chat -----------------------------------------------------------------------------------------
  const sendChat = (text: string, askAi: boolean) => {
    chatArray(doc).push([
      {
        id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        role: "user",
        author: me.name,
        text,
        ts: Date.now(),
        ...(askAi ? { status: "pending" as const } : {}),
      },
    ]);
  };

  // --- Export --------------------------------------------------------------------------------------
  const baseName = (state.name || boardId).replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
  /** Icon boxes for the exporter; a sketched shape exports as an icon at its centre. */
  const boxesByNode = (): Map<string, Box> => {
    const out = new Map<string, Box>();
    const els = new Map(excalidraw?.getSceneElements().map((e) => [e.id, e]) ?? []);
    for (const n of graph.nodes) {
      const el = n.canvas_id ? els.get(n.canvas_id) : undefined;
      if (!el) continue;
      if (el.type === "image") out.set(n.id, { x: el.x, y: el.y, width: el.width, height: el.height });
      else out.set(n.id, { x: el.x + el.width / 2 - ICON_SIZE / 2, y: el.y + el.height / 2 - ICON_SIZE / 2, width: ICON_SIZE, height: ICON_SIZE });
    }
    return out;
  };
  const doExport = async (format: "drawio" | "mermaid" | "png" | "svg" | "json") => {
    setMenu(null);
    try {
      if (format === "json") download(`${baseName}.graph.json`, new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" }));
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
      if (format === "drawio") {
        const zones = excalidraw ? zonesOnCanvas(excalidraw) : [];
        download(`${baseName}.drawio`, new Blob([toDrawio(graph, boxesByNode(), zones)], { type: "application/xml" }));
      }
      if (!excalidraw) return;
      const elements = excalidraw.getSceneElements();
      if ((format === "png" || format === "svg") && elements.length === 0) return notify("Nothing to export yet.", "error");
      const appState = { ...excalidraw.getAppState(), exportBackground: true };
      if (format === "png") {
        // Twice the canvas resolution, so the image stays sharp in slides and docs.
        const blob = await exportToBlob({
          elements,
          appState,
          files: excalidraw.getFiles(),
          mimeType: "image/png",
          exportPadding: 24,
          getDimensions: (width: number, height: number) => ({ width: width * 2, height: height * 2, scale: 2 }),
        });
        download(`${baseName}.png`, blob);
      }
      if (format === "svg") {
        const svg = await exportToSvg({ elements, appState, files: excalidraw.getFiles(), exportPadding: 24 });
        download(`${baseName}.svg`, new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
      }
    } catch (err) {
      notify(`Export failed: ${(err as Error).message}`, "error");
    }
  };

  const systemName = state.name.trim() || undefined;
  const importGraph = async (g: Graph, boxes: Map<string, Box> | undefined, notes: string[]) => {
    if (!excalidraw) return;
    await insertGraph(excalidraw, g, boxes, { systemName });
    setTab("review");
    notify(`Added ${g.nodes.length} components and ${g.edges.length} connections. ${notes.join(" ")}`.trim());
  };

  const tidy = async () => {
    if (!excalidraw) return;
    if (graph.nodes.length === 0) return notify("Nothing to tidy yet: add a few components first.");
    try {
      const n = await tidyUp(excalidraw, graph, { systemName });
      notify(`Redrew ${n} components as a clean diagram. Ctrl+Z puts the old drawing back.`);
    } catch (err) {
      notify(`Couldn't tidy the board: ${(err as Error).message}`, "error");
    }
  };

  const renameBoard = (name: string) => metaMap(doc).set("name", name.trim().slice(0, 80));
  const renameMe = () => {
    const name = window.prompt("Your name, as others in the room see it:", me.name)?.trim();
    if (!name) return;
    const next = { ...me, name: name.slice(0, 40) };
    saveIdentity(next);
    setMe(next);
  };

  const explicitMeta = useCallback(
    (canvasId: string) => {
      const el = excalidraw?.getSceneElements().find((e) => e.id === canvasId);
      return el ? getMeta(el as never) : {};
    },
    [excalidraw],
  );

  const highQuestions = state.questions.length;
  const openFindings = state.findings.filter((f) => !mutedFindings.has(f.id)).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row">
          <Link href="/" className="brand" title="All boards">
            <span className="brand-mark">◇</span> StackSketch
          </Link>
          <input
            className="board-name"
            defaultValue={state.name}
            key={state.name}
            placeholder="Untitled board"
            aria-label="Board name"
            onBlur={(e) => e.target.value.trim() !== state.name && renameBoard(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <span className={`conn conn-${connection}`} title={`Sync server: ${connection}`} />
          <ReviewerBadge reviewer={state.reviewer} llmAvailable={llm} />
          <div className="spacer" />
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
          <button className="btn" onClick={() => setDialog("idea")} title="Describe a system and get a first-draft architecture">
            ✦ Idea → architecture
          </button>
          <button className="btn" onClick={tidy} title="Redraw the board as a clean diagram: icons, zones and right-angle connectors">
            Tidy up
          </button>
          <button className="btn" onClick={() => setDialog("import")}>
            Import
          </button>
          <div className="menu-wrap">
            <button className="btn" onClick={() => setMenu(menu ? null : "export")} aria-expanded={menu === "export"}>
              Export ▾
            </button>
            {menu === "export" && (
              <div className="menu" onMouseLeave={() => setMenu(null)}>
                <button onClick={() => doExport("drawio")}>draw.io (.drawio)</button>
                <button onClick={() => doExport("mermaid")}>Mermaid (.mmd)</button>
                <button onClick={() => doExport("png")}>PNG image</button>
                <button onClick={() => doExport("svg")}>SVG image</button>
                <button onClick={() => doExport("json")}>Graph JSON</button>
              </div>
            )}
          </div>
          <button
            className="btn primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href);
                notify("Board link copied. Anyone with it can edit.");
              } catch {
                notify(window.location.href);
              }
            }}
          >
            Share
          </button>
        </div>
        <div className="topbar-row palette">
          <span className="palette-label">Add</span>
          {NODE_TYPES.map((t) => (
            <button key={t} className="chip node-chip" onClick={() => addNode(t)} title={`Add a ${t}`}>
              <img src={PALETTE_ICONS[t]} alt="" width={18} height={18} />
              {NODE_LABEL[t]}
            </button>
          ))}
          <span className="palette-sep" />
          <span className="palette-label">Arrow</span>
          {EDGE_KINDS.map((k) => (
            <button key={k} className={`chip kind${edgeKind === k ? " on" : ""}`} onClick={() => chooseKind(k)} title={KIND_HINT[k]}>
              <span className={`legend-line ${kindToStroke(k)}`} /> {k}
            </button>
          ))}
          <span className="palette-sep" />
          <label className="check" title="A closed freehand stroke becomes a component; a stroke between two components becomes a connector">
            <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} /> Turn sketches into components
          </label>
        </div>
      </header>

      <main className="main">
        <div className="canvas-wrap">
          <div className="excalidraw-host" onPointerDownCapture={rememberStrokes}>
            <Excalidraw
              excalidrawAPI={setExcalidraw}
              initialData={INITIAL_DATA}
              onChange={onChange}
              onPointerUpdate={onPointerUpdate}
              onPointerUp={onPointerUp}
              isCollaborating={peers.length > 0}
              name={state.name || "StackSketch board"}
              UIOptions={{
                canvasActions: { loadScene: false, saveToActiveFile: false, export: false },
                tools: { image: false },
              }}
            >
              <MainMenu>
                <MainMenu.DefaultItems.SaveAsImage />
                <MainMenu.DefaultItems.SearchMenu />
                <MainMenu.DefaultItems.ClearCanvas />
                <MainMenu.Separator />
                <MainMenu.DefaultItems.ToggleTheme />
                <MainMenu.DefaultItems.ChangeCanvasBackground />
                <MainMenu.DefaultItems.Help />
              </MainMenu>
              <WelcomeScreen>
                <WelcomeScreen.Center>
                  <div className="welcome">
                    <div className="welcome-title">Start your architecture</div>
                    <p>
                      Add components from the bar above, describe a system with <b>Idea → architecture</b>, or <b>Import</b> a draw.io
                      or docker-compose file. The reviewer flags design flaws as you go.
                    </p>
                  </div>
                </WelcomeScreen.Center>
              </WelcomeScreen>
            </Excalidraw>
          </div>
          <Overlay
            graph={graph}
            findings={state.findings}
            questions={state.questions}
            mutedFindings={mutedFindings}
            focusCanvasId={focus}
            step={currentStep}
            onPin={onPin}
          />
          {currentStep && (
            <div className={`caption step-${currentStep.kind}`}>
              <span className="caption-count">
                {player!.index + 1}/{player!.flow.steps.length}
              </span>
              {currentStep.narration}
            </div>
          )}
          {!synced && <div className="sync-banner">{connection === "disconnected" ? "Can't reach the sync server on port 1234. Retrying…" : "Connecting to the board…"}</div>}
          {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
        </div>

        <aside className="side">
          <nav className="tabs" role="tablist">
            {(
              [
                ["review", `Review${openFindings + highQuestions ? ` (${openFindings + highQuestions})` : ""}`],
                ["inspect", "Inspect"],
                ["flow", "Flow"],
                ["chat", `Chat${state.chat.length ? ` (${state.chat.length})` : ""}`],
                ["graph", "Graph"],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={`tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
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
          {tab === "inspect" && (
            <InspectPanel
              graph={graph}
              selectedIds={selected}
              explicit={explicitMeta}
              onUpdate={(id, patch) => excalidraw && updateMeta(excalidraw, id, patch)}
            />
          )}
          {tab === "flow" && (
            <FlowPanel
              graph={graph}
              selectedNode={selectedNode}
              flows={state.flows}
              llmAvailable={llm}
              player={player}
              onExplain={explain}
              onPlay={(flow) => setPlayer({ flow, index: 0, playing: true })}
              onStep={(d) => setPlayer((p) => (p ? { ...p, playing: false, index: Math.min(Math.max(p.index + d, 0), p.flow.steps.length - 1) } : p))}
              onToggle={() =>
                setPlayer((p) => (p ? (p.playing ? { ...p, playing: false } : { ...p, playing: true, index: p.index >= p.flow.steps.length - 1 ? 0 : p.index }) : p))
              }
              onStop={() => setPlayer(null)}
              onNumber={numberSteps}
              onClearNumbers={() => excalidraw && clearStepNumbers(excalidraw)}
            />
          )}
          {tab === "chat" && <ChatPanel messages={state.chat} status={state.chatStatus} llmAvailable={llm} meName={me.name} onSend={sendChat} />}
          {tab === "graph" && <GraphPanel graph={graph} />}
        </aside>
      </main>

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
    </div>
  );
}
