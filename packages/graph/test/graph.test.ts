import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  type CanvasElement,
  type Graph,
  META_KEY,
  deriveGraph,
  diffGraphs,
  fromDrawio,
  graphFingerprint,
  isEmptyDiff,
  layoutGraph,
  parseEdgeLabel,
  parseNodeLabel,
  readGraph,
  toDrawio,
  toMermaid,
  validateGraph,
  writeGraph,
} from "../src";

let seq = 0;
const base = (over: Partial<CanvasElement>): CanvasElement => ({
  id: `el${++seq}`,
  type: "rectangle",
  x: 0,
  y: 0,
  width: 100,
  height: 60,
  strokeStyle: "solid",
  index: `a${seq}`,
  ...over,
});

function shape(id: string, label: string, extra: Partial<CanvasElement> = {}): CanvasElement[] {
  return [
    base({ id, ...extra }),
    base({ id: `${id}-t`, type: "text", text: label, originalText: label, containerId: id }),
  ];
}

function arrow(id: string, from: string, to: string, label = "", extra: Partial<CanvasElement> = {}): CanvasElement[] {
  const els = [
    base({ id, type: "arrow", startBinding: { elementId: from }, endBinding: { elementId: to }, endArrowhead: "arrow", ...extra }),
  ];
  if (label) els.push(base({ id: `${id}-t`, type: "text", text: label, originalText: label, containerId: id }));
  return els;
}

describe("label parsing", () => {
  it("splits label, tech and replicas", () => {
    expect(parseNodeLabel("Order Service\nFastAPI")).toEqual({ label: "Order Service", tech: "FastAPI", replicas: null });
    expect(parseNodeLabel("Order Service (FastAPI) x3")).toEqual({ label: "Order Service", tech: "FastAPI", replicas: 3 });
    expect(parseNodeLabel("Orders DB\nPostgres\nsingle instance")).toEqual({ label: "Orders DB", tech: "Postgres", replicas: 1 });
    expect(parseNodeLabel("Workers\n4 replicas")).toEqual({ label: "Workers", tech: null, replicas: 4 });
  });

  it("parses edge details from arrow labels", () => {
    expect(parseEdgeLabel("POST /checkout retry timeout 3s hot")).toEqual({
      protocol: "REST",
      endpoint: "POST /checkout",
      retry: true,
      timeout_ms: 3000,
      hot_path: true,
    });
    expect(parseEdgeLabel("kafka order.created")).toMatchObject({ protocol: "Kafka", endpoint: "order.created" });
    expect(parseEdgeLabel("gRPC CreateOrder, no retry, no timeout")).toMatchObject({
      protocol: "gRPC",
      endpoint: "CreateOrder",
      retry: false,
      timeout_ms: 0,
    });
    expect(parseEdgeLabel("")).toEqual({ protocol: null, endpoint: null, retry: null, timeout_ms: null, hot_path: null });
  });
});

describe("deriveGraph", () => {
  const elements: CanvasElement[] = [
    ...shape("c", "Web App"),
    ...shape("gw", "API Gateway\nnginx"),
    ...shape("svc", "Order Service\nFastAPI x2"),
    ...shape("db", "Orders DB\nPostgres"),
    ...shape("q", "Kafka"),
    ...shape("w", "Box", { customData: { [META_KEY]: { role: "node", type: "worker", tech: "Celery" } } }),
    ...arrow("a1", "c", "gw", "POST /checkout"),
    ...arrow("a2", "gw", "svc", "POST /checkout timeout 2s"),
    ...arrow("a3", "svc", "db"),
    ...arrow("a4", "svc", "q", "order.created", { strokeStyle: "dashed" }),
    ...arrow("a5", "q", "w", "", { strokeStyle: "dashed", customData: { [META_KEY]: { role: "edge", retry: true } } }),
    ...arrow("dangling", "svc", "nowhere"),
  ];
  const { graph, issues } = deriveGraph(elements);

  it("produces a valid typed graph", () => {
    expect(validateGraph(graph)).toEqual([]);
    expect(Object.fromEntries(graph.nodes.map((n) => [n.id, n.type]))).toEqual({
      "web-app": "client",
      "api-gateway": "gateway",
      "order-service": "service",
      "orders-db": "database",
      kafka: "queue",
      box: "worker",
    });
  });

  it("keeps explicit metadata over inference and marks inferred confidence", () => {
    const worker = graph.nodes.find((n) => n.id === "box")!;
    expect(worker).toMatchObject({ type: "worker", tech: "Celery", confidence: 1, source: "user" });
    const svc = graph.nodes.find((n) => n.id === "order-service")!;
    expect(svc).toMatchObject({ tech: "FastAPI", replicas: 2, confidence: 0.4 });
  });

  it("maps arrows to typed edges", () => {
    const e = graph.edges.find((x) => x.id === "api-gateway->order-service")!;
    expect(e).toMatchObject({ kind: "sync", protocol: "REST", endpoint: "POST /checkout", timeout_ms: 2000, canvas_id: "a2" });
    expect(graph.edges.find((x) => x.id === "order-service->kafka")!.kind).toBe("async");
    expect(graph.edges.find((x) => x.id === "kafka->box")!.retry).toBe(true);
    expect(graph.edges).toHaveLength(5);
  });

  it("reports arrows that are not attached at both ends", () => {
    expect(issues.some((i) => i.canvas_id === "dangling")).toBe(true);
  });

  it("ignores deleted elements and reverses backwards arrows", () => {
    const g = deriveGraph([
      ...shape("x", "Alpha"),
      ...shape("y", "Beta"),
      ...shape("z", "Gone", { isDeleted: true }),
      ...arrow("r", "x", "y", "", { startArrowhead: "arrow", endArrowhead: null }),
    ]).graph;
    expect(g.nodes.map((n) => n.id)).toEqual(["alpha", "beta"]);
    expect(g.edges[0]).toMatchObject({ from: "beta", to: "alpha" });
  });

  it("dedupes ids for duplicate labels", () => {
    const g = deriveGraph([...shape("p", "Cache"), ...shape("q2", "Cache")]).graph;
    expect(g.nodes.map((n) => n.id)).toEqual(["cache", "cache-2"]);
  });
});

const sample: Graph = {
  nodes: [
    { id: "web", type: "client", label: "Web", tech: null, replicas: null, dlq: null, canvas_id: null, source: "user", confidence: 1 },
    { id: "api-gw", type: "gateway", label: "API Gateway", tech: "Envoy", replicas: 2, dlq: null, canvas_id: null, source: "user", confidence: 1 },
    { id: "order-svc", type: "service", label: "Order Service", tech: "FastAPI", replicas: null, dlq: null, canvas_id: null, source: "code", confidence: 0.9 },
    { id: "orders", type: "queue", label: "Orders \"topic\"", tech: "Kafka", replicas: null, dlq: false, canvas_id: null, source: "infra", confidence: 0.9 },
  ],
  edges: [
    { id: "web->api-gw", from: "web", to: "api-gw", kind: "sync", protocol: "REST", endpoint: "POST /checkout", retry: null, timeout_ms: null, hot_path: true, canvas_id: null, source: "user", confidence: 1 },
    { id: "api-gw->order-svc", from: "api-gw", to: "order-svc", kind: "sync", protocol: "REST", endpoint: "POST /checkout", retry: true, timeout_ms: 3000, hot_path: true, canvas_id: null, source: "user", confidence: 1 },
    { id: "order-svc->orders", from: "order-svc", to: "orders", kind: "async", protocol: "Kafka", endpoint: "order.created", retry: null, timeout_ms: null, hot_path: null, canvas_id: null, source: "ai", confidence: 0.6 },
  ],
};

describe("exports", () => {
  it("writes Mermaid with shapes per type and arrows per kind", () => {
    const m = toMermaid(sample);
    expect(m).toContain('api_gw{{"API Gateway<br/>Envoy"}}');
    expect(m).toContain('orders>"Orders #quot;topic#quot;<br/>Kafka"]');
    expect(m).toContain('order_svc -.->|"order.created"| orders');
    expect(m).toContain('web -->|"POST /checkout"| api_gw');
  });

  it("round-trips through draw.io XML without losing fields", () => {
    const xml = toDrawio(sample);
    expect(xml).toContain("<mxfile");
    const back = fromDrawio(xml);
    expect(back.graph.nodes.map((n) => ({ ...n }))).toEqual(sample.nodes);
    expect(back.graph.edges).toEqual(sample.edges);
    expect(back.boxes.get("api-gw")).toBeDefined();
  });

  it("imports a plain draw.io diagram by inferring types from styles and labels", () => {
    const xml = `<mxfile><diagram name="p"><mxGraphModel><root>
      <mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="a" value="Checkout API" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="10" y="20" width="120" height="60" as="geometry"/></mxCell>
      <mxCell id="b" value="Main&lt;br&gt;Postgres" style="shape=cylinder3;" vertex="1" parent="1"><mxGeometry x="300" y="20" width="80" height="80" as="geometry"/></mxCell>
      <mxCell id="c" value="Stripe" style="ellipse;shape=cloud;" vertex="1" parent="1"><mxGeometry x="300" y="200" width="120" height="80" as="geometry"/></mxCell>
      <mxCell id="e1" value="" style="dashed=1;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>
      <mxCell id="l1" value="SELECT orders" style="edgeLabel;" vertex="1" connectable="0" parent="e1"><mxGeometry relative="1" as="geometry"/></mxCell>
      <mxCell id="e2" value="POST /charges" edge="1" parent="1" source="a" target="c"><mxGeometry relative="1" as="geometry"/></mxCell>
    </root></mxGraphModel></diagram></mxfile>`;
    const { graph, boxes } = fromDrawio(xml);
    expect(graph.nodes.map((n) => [n.id, n.type, n.tech])).toEqual([
      ["checkout-api", "service", null],
      ["main", "database", "Postgres"],
      ["stripe", "external", null],
    ]);
    expect(graph.edges[0]).toMatchObject({ from: "checkout-api", to: "main", kind: "async", protocol: "SQL" });
    expect(graph.edges[1]).toMatchObject({ to: "stripe", endpoint: "POST /charges", protocol: "REST" });
    expect(boxes.get("checkout-api")).toEqual({ x: 10, y: 20, width: 120, height: 60 });
  });

  it("reads compressed draw.io diagrams", async () => {
    const { deflateSync, strToU8 } = await import("fflate");
    const inner = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="Redis" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel>`;
    const packed = deflateSync(strToU8(encodeURIComponent(inner)));
    const b64 = btoa(String.fromCharCode(...packed));
    const { graph } = fromDrawio(`<mxfile><diagram id="x">${b64}</diagram></mxfile>`);
    expect(graph.nodes[0]).toMatchObject({ id: "redis", type: "cache" });
  });
});

describe("diff, doc and layout", () => {
  it("diffs graphs and ignores canvas ids", () => {
    const moved: Graph = { ...sample, nodes: sample.nodes.map((n) => ({ ...n, canvas_id: "zzz" })) };
    expect(isEmptyDiff(diffGraphs(sample, moved))).toBe(true);
    expect(graphFingerprint(sample)).toBe(graphFingerprint(moved));
    const changed: Graph = { ...sample, nodes: sample.nodes.map((n) => (n.id === "order-svc" ? { ...n, replicas: 3 } : n)) };
    expect(diffGraphs(sample, changed).changed_nodes).toEqual(["order-svc"]);
  });

  it("writes only changed entries into the Yjs doc", () => {
    const doc = new Y.Doc();
    expect(writeGraph(doc, sample)).toBe(true);
    expect(writeGraph(doc, sample)).toBe(false);
    expect(readGraph(doc).nodes.map((n) => n.id).sort()).toEqual(sample.nodes.map((n) => n.id).sort());
  });

  it("lays out nodes left to right with routed edges", async () => {
    const { boxes, routes } = await layoutGraph(sample);
    expect(boxes.size).toBe(4);
    expect(boxes.get("web")!.x).toBeLessThan(boxes.get("api-gw")!.x);
    expect(boxes.get("api-gw")!.x).toBeLessThan(boxes.get("order-svc")!.x);
    const route = routes.get("web->api-gw")!;
    const web = boxes.get("web")!;
    expect(route.length).toBeGreaterThanOrEqual(2);
    expect(route[0].x).toBeCloseTo(web.x + web.width, 0);
  });
});
