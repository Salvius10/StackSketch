import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  type CanvasElement,
  type DiagramEdge,
  type DiagramNode,
  type Graph,
  META_KEY,
  absoluteBox,
  deriveFromDiagram,
  diagramFromElements,
  diagramFromLayout,
  layoutGraph,
  readDiagram,
  writeDiagram,
} from "../src";

const sequence = () => {
  let n = 0;
  return () => `id${++n}`;
};

const comp = (id: string, label: string, over: Partial<DiagramNode> = {}): DiagramNode => ({ id, kind: "component", x: 0, y: 0, label, ...over });
const conn = (id: string, source: string, target: string, over: Partial<DiagramEdge> = {}): DiagramEdge => ({ id, source, target, ...over });

describe("deriveFromDiagram", () => {
  const { graph, issues } = deriveFromDiagram({
    nodes: [
      { id: "z", kind: "zone", x: 0, y: 0, w: 600, h: 300, label: "System", zone: "system" },
      comp("a", "Order Service", { type: "service", tech: "FastAPI", parent: "z" }),
      comp("b", "Orders DB", { type: "database", replicas: 2 }),
      comp("c", "Kafka"),
      comp("d", ""),
      { id: "n", kind: "note", x: 0, y: 0, w: 120, h: 40, label: "remember to shard" },
    ],
    edges: [
      conn("e1", "a", "b", { label: "SELECT orders timeout 2s", protocol: "SQL" }),
      conn("e2", "a", "c", { kind: "async", label: "order.created", retry: false }),
      conn("e3", "a", "nowhere"),
      conn("e4", "z", "a"),
    ],
  });

  it("turns components into typed nodes and ignores zones and notes", () => {
    expect(graph.nodes.map((n) => [n.id, n.type, n.tech, n.canvas_id, n.confidence])).toEqual([
      ["order-service", "service", "FastAPI", "a", 1],
      ["orders-db", "database", null, "b", 1],
      ["kafka", "queue", null, "c", 0.7],
      ["service-d", "service", null, "d", 0.4],
    ]);
    expect(graph.nodes.find((n) => n.id === "orders-db")!.replicas).toBe(2);
  });

  it("takes connector fields over what the label says, and fills the rest from it", () => {
    const sql = graph.edges.find((e) => e.id === "order-service->orders-db")!;
    expect(sql).toMatchObject({ kind: "sync", protocol: "SQL", timeout_ms: 2000, canvas_id: "e1" });
    const async = graph.edges.find((e) => e.id === "order-service->kafka")!;
    expect(async).toMatchObject({ kind: "async", endpoint: "order.created", retry: false });
    expect(graph.edges).toHaveLength(2);
  });

  it("reports unnamed components and loose connectors", () => {
    expect(issues.map((i) => i.canvas_id).sort()).toEqual(["d", "e3", "e4"]);
  });
});

describe("diagram geometry and the document", () => {
  it("positions children relative to their zone", () => {
    const nodes = new Map<string, DiagramNode>([
      ["outer", { id: "outer", kind: "zone", x: 100, y: 50, w: 500, h: 400, label: "Cloud" }],
      ["inner", { id: "inner", kind: "zone", x: 20, y: 30, w: 200, h: 200, label: "VPC", parent: "outer" }],
      ["svc", comp("svc", "API", { x: 10, y: 15, parent: "inner" })],
    ]);
    expect(absoluteBox(nodes.get("svc")!, nodes)).toEqual({ x: 130, y: 95, width: 64, height: 64 });
    expect(absoluteBox(nodes.get("inner")!, nodes)).toEqual({ x: 120, y: 80, width: 200, height: 200 });
  });

  it("writes and reads the diagram in one transaction", () => {
    const doc = new Y.Doc();
    writeDiagram(doc, { nodes: [comp("a", "A"), comp("b", "B")], edges: [conn("e", "a", "b")] });
    writeDiagram(doc, {}, { nodes: ["b"], edges: ["e"] });
    expect(readDiagram(doc)).toEqual({ nodes: [comp("a", "A")], edges: [] });
  });
});

const shop: Graph = {
  nodes: [
    { id: "web", type: "client", label: "Web App", tech: null, replicas: null, dlq: null, canvas_id: null, source: "ai", confidence: 0.6 },
    { id: "api", type: "service", label: "API", tech: "FastAPI", replicas: null, dlq: null, canvas_id: null, source: "ai", confidence: 0.6 },
    { id: "db", type: "database", label: "DB", tech: "Postgres", replicas: null, dlq: null, canvas_id: null, source: "ai", confidence: 0.6 },
  ],
  edges: [
    { id: "web->api", from: "web", to: "api", kind: "sync", protocol: "REST", endpoint: "POST /todos", retry: null, timeout_ms: null, hot_path: true, canvas_id: null, source: "ai", confidence: 0.6 },
    { id: "api->db", from: "api", to: "db", kind: "sync", protocol: "SQL", endpoint: null, retry: null, timeout_ms: null, hot_path: null, canvas_id: null, source: "ai", confidence: 0.6 },
  ],
};

describe("diagramFromLayout", () => {
  it("puts components in their zones and keeps everything the graph said", async () => {
    const layout = await layoutGraph(shop);
    const diagram = diagramFromLayout(shop, layout, sequence());
    const zones = diagram.nodes.filter((n) => n.kind === "zone");
    expect(zones.map((z) => [z.label, z.zone])).toEqual([
      ["Clients", "clients"],
      ["System", "system"],
    ]);
    const byLabel = new Map(diagram.nodes.map((n) => [n.label, n]));
    const all = new Map(diagram.nodes.map((n) => [n.id, n]));
    expect(byLabel.get("API")!.parent).toBe(byLabel.get("System")!.id);
    // Relative position + zone position = where the layout put the icon.
    expect(absoluteBox(byLabel.get("API")!, all)).toMatchObject({ x: layout.boxes.get("api")!.x, y: layout.boxes.get("api")!.y });
    const first = diagram.edges.find((e) => e.endpoint === "POST /todos")!;
    expect(first).toMatchObject({ kind: "sync", hot_path: true, origin: "ai", sourceSide: "right", targetSide: "left" });

    // Deriving it again gives back the same graph.
    const { graph } = deriveFromDiagram(diagram);
    const sorted = <T extends unknown[]>(rows: T[]) => rows.sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
    expect(sorted(graph.nodes.map((n) => [n.id, n.type, n.tech, n.source]))).toEqual([
      ["api", "service", "FastAPI", "ai"],
      ["db", "database", "Postgres", "ai"],
      ["web-app", "client", null, "ai"],
    ]);
    expect(sorted(graph.edges.map((e) => [e.id, e.protocol, e.endpoint]))).toEqual([
      ["api->db", "SQL", null],
      ["web-app->api", "REST", "POST /todos"],
    ]);
  });
});

describe("diagramFromElements (boards from the old canvas)", () => {
  let seq = 0;
  const el = (over: Partial<CanvasElement>): CanvasElement => ({
    id: `el${++seq}`,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    index: `a${String(++seq).padStart(4, "0")}`,
    ...over,
  });

  it("keeps components, zones, connectors and notes", () => {
    const elements: CanvasElement[] = [
      el({ id: "zone", x: 0, y: 0, width: 500, height: 300, groupIds: ["gz"], customData: { [META_KEY]: { role: "zone", zone: "system" } } }),
      el({ id: "zone-title", type: "text", text: "Shop", originalText: "Shop", groupIds: ["gz"], customData: { [META_KEY]: { role: "zone" } } }),
      el({ id: "icon", type: "image", x: 40, y: 40, width: 64, height: 64, groupIds: ["g1"], customData: { [META_KEY]: { role: "node", type: "service" } } }),
      el({ id: "icon-name", type: "text", x: 30, y: 112, text: "Order API\nFastAPI", originalText: "Order API\nFastAPI", groupIds: ["g1"], customData: { [META_KEY]: { role: "label" } } }),
      el({ id: "box", x: 700, y: 100, width: 160, height: 80 }),
      el({ id: "box-text", type: "text", text: "Orders DB\nPostgres", originalText: "Orders DB\nPostgres", containerId: "box" }),
      el({ id: "arrow", type: "arrow", startBinding: { elementId: "icon" }, endBinding: { elementId: "box" }, endArrowhead: "triangle" }),
      el({ id: "arrow-text", type: "text", text: "SQL", originalText: "SQL", containerId: "arrow" }),
      el({ id: "free", type: "text", x: 40, y: 200, width: 150, height: 20, text: "TODO: add a cache", originalText: "TODO: add a cache" }),
    ];
    const diagram = diagramFromElements(elements, sequence());
    const byLabel = new Map(diagram.nodes.map((n) => [n.label, n]));
    expect(byLabel.get("Shop")).toMatchObject({ kind: "zone", w: 500, h: 300, zone: "system" });
    expect(byLabel.get("Order API")).toMatchObject({ kind: "component", type: "service", tech: "FastAPI", x: 40, y: 40, parent: byLabel.get("Shop")!.id });
    // A sketched box becomes an icon at its centre, outside the zone.
    expect(byLabel.get("Orders DB")).toMatchObject({ type: "database", tech: "Postgres", x: 748, y: 108, parent: null });
    expect(byLabel.get("TODO: add a cache")).toMatchObject({ kind: "note", parent: byLabel.get("Shop")!.id });
    expect(diagram.edges).toHaveLength(1);
    expect(diagram.edges[0]).toMatchObject({ label: "SQL", protocol: "SQL", source: byLabel.get("Order API")!.id, target: byLabel.get("Orders DB")!.id });

    const { graph } = deriveFromDiagram(diagram);
    expect(graph.edges.map((e) => e.id)).toEqual(["order-api->orders-db"]);
  });
});
