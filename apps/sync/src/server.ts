// StackSketch sync server: Hocuspocus serving one Yjs document per board.
//
//   PORT          WebSocket + HTTP port (default 1234)
//   API_URL       FastAPI service (default http://127.0.0.1:8000)
//   DATA_DIR      where the SQLite database lives (default ./data)

import { resolve } from "node:path";
import { Database } from "@hocuspocus/extension-database";
import { Server } from "@hocuspocus/server";
import {
  dismissedMap,
  findingsMap,
  questionsMap,
  readGraph,
  voteTally,
} from "@stacksketch/graph";
import * as Y from "yjs";
import { Api } from "./api";
import { StackSketchReviewer } from "./reviewer";
import { Store } from "./store";

const PORT = Number(process.env.PORT ?? 1234);
const API_URL = (process.env.API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
const DATA_DIR = resolve(process.env.DATA_DIR ?? "data");
const BOARD_NAME = /^[A-Za-z0-9_-]{1,64}$/;

const store = new Store(resolve(DATA_DIR, "stacksketch.db"));
const api = new Api(API_URL);

function json(response: import("node:http").ServerResponse, status: number, body: unknown): never {
  response.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
  });
  response.end(JSON.stringify(body));
  // Hocuspocus treats a falsy rejection from onRequest as "handled".
  throw null;
}

/** Usage signals for one board: the spec's supporting metrics. */
function boardStats(name: string, live: Y.Doc | undefined) {
  let doc = live;
  if (!doc) {
    const state = store.load(name);
    if (!state) return null;
    doc = new Y.Doc();
    Y.applyUpdate(doc, state);
  }
  const tally = voteTally(doc);
  let useful = 0;
  let notUseful = 0;
  for (const t of tally.values()) {
    useful += t.useful;
    notUseful += t.not_useful;
  }
  const graph = readGraph(doc);
  return {
    board: name,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    open_findings: findingsMap(doc).size,
    open_questions: questionsMap(doc).size,
    dismissed_questions: dismissedMap(doc).size,
    votes: { useful, not_useful: notUseful, useful_share: useful + notUseful ? useful / (useful + notUseful) : null },
    reviews_logged: store.reviewCount(name),
  };
}

const server = new Server({
  name: "stacksketch-sync",
  port: PORT,
  quiet: true,
  debounce: 2000,
  maxDebounce: 10000,
  extensions: [
    new Database({
      fetch: async ({ documentName }) => store.load(documentName),
      store: async ({ documentName, state }) => store.save(documentName, state),
    }),
    new StackSketchReviewer(api, store, {
      deriveDebounceMs: 150,
      reviewDebounceMs: Number(process.env.REVIEW_DEBOUNCE_MS ?? 1200),
      refineDebounceMs: Number(process.env.REFINE_DEBOUNCE_MS ?? 4000),
      refineMinIntervalMs: Number(process.env.REFINE_MIN_INTERVAL_MS ?? 15000),
    }),
  ],
  async onConnect({ documentName }) {
    if (!BOARD_NAME.test(documentName)) throw new Error("Invalid board name");
  },
  async onRequest({ request, response }) {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/health") {
      json(response, 200, {
        ok: true,
        api: API_URL,
        llm: await api.llmEnabled(),
        documents: server.hocuspocus.getDocumentsCount(),
        connections: server.hocuspocus.getConnectionsCount(),
      });
    }
    if (url.pathname === "/boards") json(response, 200, store.documents());
    const match = url.pathname.match(/^\/stats\/([A-Za-z0-9_-]{1,64})$/);
    if (match) {
      const stats = boardStats(match[1], server.hocuspocus.documents.get(match[1]));
      json(response, stats ? 200 : 404, stats ?? { error: "unknown board" });
    }
  },
});

await server.listen();
console.log(`StackSketch sync server on ws://localhost:${PORT}  (API ${API_URL}, data ${DATA_DIR})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    server.hocuspocus.flushPendingStores();
    await server.destroy();
    process.exit(0);
  });
}
