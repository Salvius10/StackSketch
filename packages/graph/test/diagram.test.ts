import { describe, expect, it } from "vitest";
import {
  type CanvasElement,
  type Graph,
  ICON_SIZE,
  META_KEY,
  allIcons,
  deriveGraph,
  fromDrawio,
  iconFor,
  iconForElement,
  iconId,
  iconSvg,
  layoutGraph,
  parseIconId,
  toDrawio,
} from "../src";

describe("icons", () => {
  it("picks the icon from type, then name and technology", () => {
    expect(iconFor({ type: "database", label: "Orders DB", tech: "Postgres" })).toEqual({ glyph: "database", outline: false });
    expect(iconFor({ type: "database", label: "Product Images", tech: "S3" }).glyph).toBe("bucket");
    expect(iconFor({ type: "queue", label: "Order Events", tech: "Kafka" }).glyph).toBe("stream");
    expect(iconFor({ type: "queue", label: "Jobs", tech: "SQS" }).glyph).toBe("queue");
    expect(iconFor({ type: "gateway", label: "CDN", tech: "CloudFront" }).glyph).toBe("cdn");
    expect(iconFor({ type: "service", label: "Auth Service", tech: "Keycloak" }).glyph).toBe("auth");
    expect(iconFor({ type: "client", label: "Mobile App" })).toEqual({ glyph: "mobile", outline: true });
    expect(iconFor({ type: "external", label: "Stripe" })).toEqual({ glyph: "payment", outline: true });
    expect(iconFor({ type: "external", label: "Weather API" }).glyph).toBe("cloud");
  });

  it("resolves canvas metadata and label the way deriveGraph does", () => {
    // No explicit type: the label decides, so renaming changes the icon.
    expect(iconForElement({}, "Service").glyph).toBe("service");
    expect(iconForElement({}, "Orders DB\nPostgres").glyph).toBe("database");
    // An explicit type wins over the label.
    expect(iconForElement({ type: "worker" }, "Orders DB").glyph).toBe("worker");
  });

  it("round-trips ids and renders standalone SVG", () => {
    for (const { id, spec } of allIcons()) expect(parseIconId(id)).toEqual(spec);
    expect(parseIconId("ss-icon-nope")).toBeNull();
    const svg = iconSvg({ glyph: "database", outline: false });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('fill="#C925D1"');
    expect(iconSvg({ glyph: "users", outline: true })).not.toContain("<rect width");
    expect(iconId({ glyph: "cloud", outline: true })).toBe("ss-icon-cloud-outline");
  });
});

let seq = 0;
const el = (over: Partial<CanvasElement>): CanvasElement => ({
  id: `e${++seq}`,
  type: "rectangle",
  x: 0,
  y: 0,
  width: 64,
  height: 64,
  index: `a${String(seq).padStart(3, "0")}`,
  ...over,
});

function iconNode(id: string, label: string, x: number, meta: Record<string, unknown> = {}): CanvasElement[] {
  const group = `g-${id}`;
  return [
    el({ id, type: "image", x, groupIds: [group], customData: { [META_KEY]: { role: "node", ...meta } } }),
    el({ type: "text", x: x - 8, y: 72, width: 80, height: 18, text: label, originalText: label, groupIds: [group], customData: { [META_KEY]: { role: "label" } } }),
  ];
}

describe("deriveGraph with icon components", () => {
  const elements: CanvasElement[] = [
    ...iconNode("api", "Order Service\nFastAPI", 0, { type: "service" }),
    ...iconNode("db", "Orders DB\nPostgres", 200),
    el({ id: "arrow", type: "arrow", startBinding: { elementId: "api" }, endBinding: { elementId: "db" }, endArrowhead: "triangle" }),
    // Annotations the graph ignores: a zone with its title, a numbered step, and an image that isn't a component.
    el({ type: "rectangle", width: 600, height: 300, groupIds: ["z"], customData: { [META_KEY]: { role: "zone" } } }),
    el({ type: "text", text: "System", originalText: "System", groupIds: ["z"], customData: { [META_KEY]: { role: "zone" } } }),
    el({ type: "rectangle", width: 24, height: 24, customData: { [META_KEY]: { role: "step" } } }),
    el({ type: "image" }),
  ];
  const { graph, issues } = deriveGraph(elements);

  it("reads icons as components named by their grouped label", () => {
    expect(graph.nodes.map((n) => [n.id, n.type, n.tech, n.confidence])).toEqual([
      ["order-service", "service", "FastAPI", 1],
      ["orders-db", "database", "Postgres", 0.7],
    ]);
    expect(graph.edges).toMatchObject([{ id: "order-service->orders-db", canvas_id: "arrow" }]);
    expect(issues).toEqual([]);
  });

  it("finds the name under an icon after an ungroup", () => {
    const ungrouped = iconNode("q", "Kafka", 0).map((e) => ({ ...e, groupIds: [] }));
    expect(deriveGraph(ungrouped).graph.nodes[0]).toMatchObject({ id: "kafka", type: "queue" });
  });
});

const shop: Graph = {
  nodes: [
    { id: "web", type: "client", label: "Web App", tech: "React", replicas: null, dlq: null, canvas_id: null, source: "user", confidence: 1 },
    { id: "api", type: "service", label: "API", tech: null, replicas: null, dlq: null, canvas_id: null, source: "user", confidence: 1 },
    { id: "db", type: "database", label: "DB", tech: "Postgres", replicas: null, dlq: null, canvas_id: null, source: "user", confidence: 1 },
    { id: "stripe", type: "external", label: "Stripe", tech: null, replicas: null, dlq: null, canvas_id: null, source: "user", confidence: 1 },
  ],
  edges: [
    { id: "web->api", from: "web", to: "api", kind: "sync", protocol: "REST", endpoint: null, retry: null, timeout_ms: null, hot_path: null, canvas_id: null, source: "user", confidence: 1 },
    { id: "api->db", from: "api", to: "db", kind: "sync", protocol: "SQL", endpoint: null, retry: null, timeout_ms: null, hot_path: null, canvas_id: null, source: "user", confidence: 1 },
    { id: "api->stripe", from: "api", to: "stripe", kind: "sync", protocol: "REST", endpoint: null, retry: null, timeout_ms: null, hot_path: null, canvas_id: null, source: "user", confidence: 1 },
  ],
};

describe("zoned layout", () => {
  it("puts clients, the system and outside services in zones, left to right", async () => {
    const { boxes, routes, zones } = await layoutGraph(shop, { systemName: "Shop" });
    expect(zones.map((z) => [z.kind, z.label, z.members])).toEqual([
      ["clients", "Clients", ["web"]],
      ["system", "Shop", ["api", "db"]],
      ["external", "External services", ["stripe"]],
    ]);
    const [clients, system, external] = zones.map((z) => z.box);
    expect(clients.x + clients.width).toBeLessThan(system.x);
    expect(system.x + system.width).toBeLessThan(external.x);
    for (const z of zones) {
      for (const id of z.members) {
        const b = boxes.get(id)!;
        expect(b).toMatchObject({ width: ICON_SIZE, height: ICON_SIZE });
        expect(b.x).toBeGreaterThan(z.box.x);
        expect(b.y + b.height).toBeLessThan(z.box.y + z.box.height);
      }
    }
    // Every route is orthogonal.
    for (const pts of routes.values()) {
      for (let i = 1; i < pts.length; i++) expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y).toBe(true);
    }
  });

  it("can lay out without zones", async () => {
    const { zones, boxes } = await layoutGraph(shop, { zones: false });
    expect(zones).toEqual([]);
    expect(boxes.size).toBe(4);
  });
});

describe("draw.io export in the diagram style", () => {
  it("writes icons inside zone containers and reads them back", async () => {
    const { boxes, zones } = await layoutGraph(shop);
    const xml = toDrawio(shop, boxes, zones);
    expect(xml.match(/shape=image/g)).toHaveLength(4);
    expect(xml).toContain("image=data:image/svg+xml,PHN2Zy");
    expect(xml).not.toContain("svg+xml;base64");
    expect(xml.match(/ss_role="zone"/g)).toHaveLength(3);
    expect(xml).toContain('parent="ss-z-2"');

    const back = fromDrawio(xml);
    expect(back.graph.nodes.map((n) => n.id)).toEqual(["web", "api", "db", "stripe"]);
    expect(back.graph.edges).toHaveLength(3);
    // Absolute positions survive being nested in a zone.
    expect(back.boxes.get("api")).toMatchObject({ x: Math.round(boxes.get("api")!.x), y: Math.round(boxes.get("api")!.y) });
  });
});
