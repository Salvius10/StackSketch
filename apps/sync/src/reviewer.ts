// The server half of StackSketch, as a Hocuspocus extension.
//
// For every open board it watches the shared document and:
//  1. derives the typed graph from the diagram (single writer, so no conflicts),
//  2. runs the rule reviewer after a short pause in editing,
//  3. asks the LLM layer to reword findings and add judgement calls,
//  4. answers room chat messages addressed to the AI.
// Results are written back into the document, so every user sees the same flags.

import type { Document, Extension, afterLoadDocumentPayload, beforeUnloadDocumentPayload } from "@hocuspocus/server";
import {
  type ChatMessage,
  type Finding,
  type Graph,
  type ReviewerStatus,
  chatArray,
  deriveFromDiagram,
  diagramEdgesMap,
  diagramFromElements,
  diagramNodesMap,
  dismissedMap,
  elementsMap,
  findingsMap,
  graphFingerprint,
  metaMap,
  questionsMap,
  readDiagram,
  readElements,
  readFindings,
  readGraph,
  syncMap,
  voteTally,
  writeGraph,
  zonesOf,
} from "@stacksketch/graph";
import type * as Y from "yjs";
import { type Api, ApiError } from "./api";
import type { Store } from "./store";

/** Transaction origin for everything the server writes. */
export const SERVER_ORIGIN = { source: "local" as const, context: { stacksketch: "server" } };

/** Set in the board's meta once its Excalidraw canvas has been converted to the diagram. */
const CONVERTED_KEY = "diagram_converted_at";

export interface ReviewerOptions {
  deriveDebounceMs: number;
  reviewDebounceMs: number;
  refineDebounceMs: number;
  refineMinIntervalMs: number;
}

interface BoardState {
  name: string;
  doc: Document;
  disposed: boolean;
  timers: Partial<Record<"derive" | "review" | "refine", ReturnType<typeof setTimeout>>>;
  cleanup: (() => void)[];
  reviewing: boolean;
  reviewAgain: boolean;
  /** Consecutive failed reviews; sets the retry backoff and logs one line per outage. */
  reviewFailures: number;
  refining: boolean;
  lastReviewedFp: string | null;
  lastReviewed: Graph | null;
  lastDiff: Record<string, string[]> | null;
  ruleFindings: Finding[];
  refinements: Map<string, { fp: string; finding: Finding }>;
  llmFindings: Finding[];
  lastRefineAt: number;
  chatBusy: boolean;
}

const findingFp = (f: Finding) => `${f.rule}|${f.target}|${f.severity}|${f.message}`;

export class StackSketchReviewer implements Extension {
  extensionName = "stacksketch-reviewer";
  private boards = new Map<string, BoardState>();

  constructor(
    private api: Api,
    private store: Store,
    private opts: ReviewerOptions,
  ) {}

  async afterLoadDocument({ document, documentName }: afterLoadDocumentPayload): Promise<void> {
    const state: BoardState = {
      name: documentName,
      doc: document,
      disposed: false,
      timers: {},
      cleanup: [],
      reviewing: false,
      reviewAgain: false,
      reviewFailures: 0,
      refining: false,
      lastReviewedFp: null,
      lastReviewed: null,
      lastDiff: null,
      ruleFindings: [],
      refinements: new Map(),
      llmFindings: [],
      lastRefineAt: 0,
      chatBusy: false,
    };
    this.boards.set(documentName, state);

    const observe = <T extends Y.AbstractType<any>>(type: T, fn: () => void) => {
      const handler = (_: unknown, tr: Y.Transaction) => {
        if (tr.origin !== SERVER_ORIGIN) fn();
      };
      type.observe(handler);
      state.cleanup.push(() => type.unobserve(handler));
    };
    // Boards drawn with the earlier Excalidraw canvas are converted to the diagram once.
    // The old elements stay in the document untouched, so going back to that editor still works.
    const meta = metaMap(document);
    if (elementsMap(document).size > 0 && !meta.get(CONVERTED_KEY)) {
      if (diagramNodesMap(document).size > 0) {
        // Already drawn on in the new editor: that work is newer than the old canvas, keep it.
        document.transact(() => meta.set(CONVERTED_KEY, Date.now()), SERVER_ORIGIN);
      } else {
        const diagram = diagramFromElements(readElements(document));
        document.transact(() => {
          diagramEdgesMap(document).clear();
          for (const n of diagram.nodes) diagramNodesMap(document).set(n.id, n);
          for (const e of diagram.edges) diagramEdgesMap(document).set(e.id, e);
          meta.set(CONVERTED_KEY, Date.now());
        }, SERVER_ORIGIN);
        console.log(`[${documentName}] converted the old canvas: ${diagram.nodes.length} shapes, ${diagram.edges.length} connectors`);
      }
    }

    observe(diagramNodesMap(document), () => this.schedule(state, "derive", this.opts.deriveDebounceMs));
    observe(diagramEdgesMap(document), () => this.schedule(state, "derive", this.opts.deriveDebounceMs));
    observe(dismissedMap(document), () => this.schedule(state, "review", 300));
    observe(chatArray(document), () => void this.answerChat(state));

    // A stored board may predate the current derive rules: derive and review once on load.
    // Keep the stored LLM judgements until the next refine replaces them.
    state.ruleFindings = readFindings(document).filter((f) => f.origin === "rule");
    state.llmFindings = readFindings(document).filter((f) => f.origin === "llm");
    this.derive(state, true);
    void this.answerChat(state);
  }

  async beforeUnloadDocument({ documentName }: beforeUnloadDocumentPayload): Promise<void> {
    const state = this.boards.get(documentName);
    if (!state) return;
    state.disposed = true;
    for (const t of Object.values(state.timers)) clearTimeout(t);
    for (const fn of state.cleanup) fn();
    this.boards.delete(documentName);
  }

  private schedule(state: BoardState, what: "derive" | "review" | "refine", delay: number): void {
    if (state.disposed) return;
    clearTimeout(state.timers[what]);
    state.timers[what] = setTimeout(() => {
      if (state.disposed) return;
      if (what === "derive") this.derive(state, false);
      else if (what === "review") void this.review(state);
      else void this.refine(state);
    }, delay);
  }

  private setStatus(state: BoardState, patch: Partial<ReviewerStatus>): void {
    const meta = metaMap(state.doc);
    const prev = (meta.get("reviewer") as ReviewerStatus | undefined) ?? { state: "idle", at: 0, llm: false };
    state.doc.transact(() => meta.set("reviewer", { ...prev, ...patch, at: Date.now() }), SERVER_ORIGIN);
  }

  // --- 1. diagram -> graph ---------------------------------------------------------------

  private derive(state: BoardState, force: boolean): void {
    const { doc } = state;
    const { graph, issues } = deriveFromDiagram(readDiagram(doc));
    doc.transact(() => {
      const changed = writeGraph(doc, graph, SERVER_ORIGIN);
      const meta = metaMap(doc);
      if (JSON.stringify(meta.get("issues") ?? []) !== JSON.stringify(issues)) meta.set("issues", issues);
      // Components can be redrawn under the same name: keep finding pins on the current one.
      if (changed) this.repin(doc, graph);
    }, SERVER_ORIGIN);

    const fp = graphFingerprint(graph);
    if (force || fp !== state.lastReviewedFp) this.schedule(state, "review", force ? 50 : this.opts.reviewDebounceMs);
  }

  private repin(doc: Document, graph: Graph): void {
    const canvas = new Map<string, string | null>([
      ...graph.nodes.map((n) => [n.id, n.canvas_id] as const),
      ...graph.edges.map((e) => [e.id, e.canvas_id] as const),
    ]);
    const repinMap = <T extends { target: string; canvas_id: string | null }>(map: Y.Map<T>) => {
      for (const [id, item] of map.entries()) {
        const next = canvas.get(item.target);
        if (next !== undefined && next !== item.canvas_id) map.set(id, { ...item, canvas_id: next });
      }
    };
    repinMap(findingsMap(doc));
    repinMap(questionsMap(doc));
  }

  // --- 2. rule reviewer -------------------------------------------------------------------

  private async review(state: BoardState): Promise<void> {
    if (state.reviewing) {
      state.reviewAgain = true;
      return;
    }
    state.reviewing = true;
    const { doc } = state;
    try {
      const graph = readGraph(doc);
      const llm = await this.api.llmEnabled();
      this.setStatus(state, { state: "running", llm, error: null });
      const started = Date.now();
      const res = await this.api.review(graph, state.lastReviewed, Array.from(dismissedMap(doc).keys()));
      if (state.disposed) return;

      state.lastReviewed = graph;
      state.lastReviewedFp = graphFingerprint(graph);
      state.lastDiff = res.diff;
      state.ruleFindings = res.findings;
      const findings = this.merge(state, readGraph(doc));
      doc.transact(() => {
        syncMap(findingsMap(doc), findings);
        syncMap(questionsMap(doc), res.questions);
      }, SERVER_ORIGIN);
      this.setStatus(state, { state: "idle", llm, rules_ms: Date.now() - started });
      this.store.logReview(state.name, false, graph, res.findings, res.questions);
      if (state.reviewFailures > 0) console.log(`[${state.name}] review is working again`);
      state.reviewFailures = 0;

      const changed = Object.values(res.diff).some((ids) => ids.length > 0);
      if (llm && graph.nodes.length > 0 && changed) this.schedule(state, "refine", this.opts.refineDebounceMs);
    } catch (err) {
      // The API may be starting or reloading: keep retrying while the board is open.
      const transient = err instanceof ApiError && err.transient;
      if (!state.disposed) {
        this.setStatus(state, { state: "error", error: errorText(err) });
        if (transient) this.schedule(state, "review", Math.min(1000 * 2 ** state.reviewFailures, 30_000));
      }
      // One line per outage while retrying; errors that won't be retried are always reported.
      if (state.reviewFailures === 0 || !transient) console.error(`[${state.name}] review failed: ${errorText(err)}${transient ? "; retrying" : ""}`);
      state.reviewFailures++;
    } finally {
      state.reviewing = false;
      if (state.reviewAgain && !state.disposed) {
        state.reviewAgain = false;
        this.schedule(state, "review", 100);
      }
    }
  }

  /** Rule findings, with LLM rewording where the underlying facts have not changed, plus LLM judgements. */
  private merge(state: BoardState, graph: Graph): Finding[] {
    const canvas = new Map<string, string | null>([
      ...graph.nodes.map((n) => [n.id, n.canvas_id] as const),
      ...graph.edges.map((e) => [e.id, e.canvas_id] as const),
    ]);
    const out: Finding[] = state.ruleFindings.map((f) => {
      const r = state.refinements.get(f.id);
      return r && r.fp === findingFp(f) ? { ...r.finding, canvas_id: f.canvas_id } : f;
    });
    const taken = new Set(out.map((f) => f.id));
    for (const f of state.llmFindings) {
      const target = canvas.get(f.target);
      if (target === undefined || taken.has(f.id)) continue;
      out.push({ ...f, canvas_id: target });
    }
    return out;
  }

  // --- 3. LLM layer --------------------------------------------------------------------------

  private async refine(state: BoardState): Promise<void> {
    if (state.refining) return;
    const wait = state.lastRefineAt + this.opts.refineMinIntervalMs - Date.now();
    if (wait > 0) {
      this.schedule(state, "refine", wait);
      return;
    }
    state.refining = true;
    state.lastRefineAt = Date.now();
    const { doc } = state;
    try {
      const graph = readGraph(doc);
      if (graph.nodes.length === 0) return;
      this.setStatus(state, { state: "refining", error: null });
      const tally = voteTally(doc);
      const notUseful = [...tally].filter(([, t]) => t.not_useful > t.useful).map(([id]) => id);
      const base = state.ruleFindings;
      const res = await this.api.refine(graph, state.lastDiff, base, notUseful);
      if (state.disposed) return;
      if (res.llm) {
        const originals = new Map(base.map((f) => [f.id, f]));
        for (const f of res.findings) {
          const orig = originals.get(f.id);
          if (f.origin === "rule" && f.refined && orig) state.refinements.set(f.id, { fp: findingFp(orig), finding: f });
        }
        state.llmFindings = res.findings.filter((f) => f.origin === "llm");
        const merged = this.merge(state, readGraph(doc));
        doc.transact(() => syncMap(findingsMap(doc), merged), SERVER_ORIGIN);
        this.store.logReview(state.name, true, graph, merged, []);
      }
      this.setStatus(state, { state: "idle", llm: res.llm });
    } catch (err) {
      // Rules-only findings stay on the board; the LLM layer is best effort.
      if (!state.disposed) this.setStatus(state, { state: "idle", error: `AI layer: ${errorText(err)}` });
      console.error(`[${state.name}] refine failed:`, errorText(err));
    } finally {
      state.refining = false;
    }
  }

  // --- 4. room chat ------------------------------------------------------------------------

  private async answerChat(state: BoardState): Promise<void> {
    if (state.chatBusy || state.disposed) return;
    const arr = chatArray(state.doc);
    const messages = arr.toArray();
    const pending = messages.find((m) => m.role === "user" && m.status === "pending");
    if (!pending) return;

    state.chatBusy = true;
    const meta = metaMap(state.doc);
    state.doc.transact(() => meta.set("chat", { state: "thinking", at: Date.now(), replying_to: pending.id }), SERVER_ORIGIN);
    const settle = (patch: Partial<ChatMessage>, reply?: ChatMessage) => {
      state.doc.transact(() => {
        const i = arr.toArray().findIndex((m) => m.id === pending.id);
        if (i >= 0) {
          const current = arr.get(i);
          arr.delete(i, 1);
          arr.insert(i, [{ ...current, ...patch }]);
        }
        if (reply) arr.push([reply]);
        meta.set("chat", { state: "idle", at: Date.now() });
      }, SERVER_ORIGIN);
    };
    try {
      const upTo = messages.indexOf(pending);
      const history = messages
        .slice(0, upTo + 1)
        .filter((m) => m.status !== "error")
        .map((m) => ({ role: m.role, author: m.author, text: m.text }));
      const graph = readGraph(state.doc);
      const res = await this.api.chat(graph, zonesOf(readDiagram(state.doc), graph), readFindings(state.doc), history);
      if (state.disposed) return;
      // Edits go out as a proposal; the browser tab that asked lays them out and applies them.
      const edits = res.edits ? { edits: res.edits, edit_state: "proposed" as const } : {};
      settle(
        { status: "answered" },
        { id: `ai-${pending.id}`, role: "assistant", author: "StackSketch AI", text: res.reply, ts: Date.now(), reply_to: pending.id, ...edits },
      );
    } catch (err) {
      if (!state.disposed) settle({ status: "error", error: errorText(err) });
    } finally {
      state.chatBusy = false;
      if (!state.disposed) void this.answerChat(state);
    }
  }
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
