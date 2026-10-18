// End-to-end smoke test for the server loop: connect to a board as a client,
// draw a small architecture into the shared diagram, then wait for the sync
// server to derive the graph and the reviewer to write findings back.
//
//   npx tsx scripts/smoke.ts [ws://localhost:1234]

import { HocuspocusProvider } from "@hocuspocus/provider";
import {
  type DiagramEdge,
  type DiagramNode,
  type NodeType,
  diagramEdgesMap,
  diagramNodesMap,
  questionsMap,
  readFindings,
  readGraph,
  readQuestions,
} from "@stacksketch/graph";
import * as Y from "yjs";

const url = process.argv[2] ?? "ws://localhost:1234";
const board = `smoke-${Date.now().toString(36)}`;
const doc = new Y.Doc();
const provider = new HocuspocusProvider({ url, name: board, document: doc });

let col = 0;
const component = (id: string, type: NodeType, label: string, extra: Partial<DiagramNode> = {}): DiagramNode => ({
  id,
  kind: "component",
  x: 160 * col++,
  y: 0,
  label,
  type,
  ...extra,
});
const connector = (id: string, source: string, target: string, label = "", extra: Partial<DiagramEdge> = {}): DiagramEdge => ({
  id,
  source,
  target,
  ...(label ? { label } : {}),
  ...extra,
});

const nodes = [
  component("web", "client", "Web App"),
  component("gw", "gateway", "API Gateway", { replicas: 2 }),
  component("orders", "service", "Order Service", { tech: "FastAPI" }),
  component("db", "database", "Orders DB", { tech: "Postgres", replicas: 2 }),
  component("stripe", "external", "Stripe"),
];
const edges = [
  connector("a1", "web", "gw", "POST /checkout"),
  connector("a2", "gw", "orders", "POST /checkout"),
  connector("a3", "orders", "db"),
  connector("a4", "orders", "stripe", "POST /charges"),
];

const until = async (what: string, check: () => boolean, ms = 15000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`ok  ${what} (${Date.now() - start} ms)`);
};

try {
  await until("connection", () => provider.isSynced);
  doc.transact(() => {
    for (const n of nodes) diagramNodesMap(doc).set(n.id, n);
    for (const e of edges) diagramEdgesMap(doc).set(e.id, e);
  });
  await until("derived graph", () => readGraph(doc).edges.length === 4);
  console.log("    nodes:", readGraph(doc).nodes.map((x) => `${x.id}:${x.type}`).join(", "));
  await until("reviewer questions", () => readQuestions(doc).length > 0);
  console.log("    questions:", readQuestions(doc).map((q) => q.id).join(", "));

  // Answer the questions the way the format panel does: set the field on the component or connector.
  doc.transact(() => {
    const ns = diagramNodesMap(doc);
    ns.set("orders", { ...ns.get("orders")!, replicas: 1 });
    const es = diagramEdgesMap(doc);
    es.set("a4", { ...es.get("a4")!, timeout_ms: 0 });
  });
  await until("findings after answers", () => readFindings(doc).length >= 2 && questionsMap(doc).size === 0);
  for (const f of readFindings(doc)) console.log(`    [${f.severity}] ${f.id} -> canvas ${f.canvas_id}: ${f.title}`);
  console.log(`\nSmoke test passed on board ${board}.`);
  provider.destroy();
  process.exit(0);
} catch (err) {
  console.error("FAILED:", (err as Error).message);
  console.error("graph:", JSON.stringify(readGraph(doc)));
  provider.destroy();
  process.exit(1);
}
