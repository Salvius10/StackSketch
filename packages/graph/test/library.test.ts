import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import {
  type Diagram,
  type Graph,
  LIBRARIES,
  SHAPES,
  SHAPE_DEFAULTS,
  TEMPLATES,
  deriveFromDiagram,
  diagramToDrawio,
  isShapeKey,
  layoutGraph,
  libraryItem,
  lookOf,
  nodeFromItem,
  searchLibraries,
  shapeSvg,
} from "../src";

describe("shape catalog", () => {
  it("has unique keys", () => {
    expect(new Set(SHAPES.map((s) => s.key)).size).toBe(SHAPES.length);
  });

  it("draws every shape at its own size and at odd sizes", () => {
    for (const s of SHAPES) {
      for (const [w, h] of [
        [s.w, s.h],
        [7, 300],
        [400, 12],
      ]) {
        const svg = shapeSvg(s, w, h, SHAPE_DEFAULTS, "Title\nPK id\n--\nrow");
        expect(svg, s.key).not.toMatch(/NaN|Infinity|undefined/);
        expect(svg.startsWith("<g ")).toBe(true);
      }
      const box = s.text(s.w, s.h);
      expect(box.w > 0 && box.h > 0, s.key).toBe(true);
    }
  });

  it("only lets safe colours into the markup", () => {
    const look = lookOf({ fill: 'red" onload="x', stroke: "#123456", fontColor: "var(--ss-ink)" }, null);
    expect(look.fill).toBe(SHAPE_DEFAULTS.fill);
    expect(look.stroke).toBe("#123456");
    expect(look.fontColor).toBe("var(--ss-ink)");
  });
});

describe("libraries", () => {
  const items = LIBRARIES.flatMap((l) => l.items);

  it("has unique item keys", () => {
    const seen = new Map<string, number>();
    for (const i of items) seen.set(i.key, (seen.get(i.key) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1).map(([k]) => k)).toEqual([]);
  });

  it("only uses shapes the catalog has", () => {
    for (const i of items) if (i.kind === "shape") expect(isShapeKey(i.shape), i.key).toBe(true);
  });

  it("makes a node for every item but connectors", () => {
    for (const i of items) {
      const n = nodeFromItem(i, { x: 10.4, y: 20.6 });
      if (i.kind === "connector") expect(n).toBeNull();
      else expect(n).toMatchObject({ x: 10, y: 21, parent: null });
    }
  });

  it("finds items across libraries, once each", () => {
    const db = searchLibraries("database");
    expect(db.length).toBeGreaterThan(3);
    expect(searchLibraries("lambda").map((i) => i.key)).toContain("aws:lambda");
    expect(searchLibraries("")).toEqual([]);
  });
});

describe("what the reviewer reads", () => {
  const rect = libraryItem("general:rectangle")!;
  const service = libraryItem("arch:service")!;
  const c4 = libraryItem("c4:container")!;

  it("ignores plain shapes and the connectors between them", () => {
    const a = { ...nodeFromItem(rect, { x: 0, y: 0 })!, id: "a", label: "Start" };
    const b = { ...nodeFromItem(rect, { x: 200, y: 0 })!, id: "b", label: "End" };
    const { graph, issues } = deriveFromDiagram({ nodes: [a, b], edges: [{ id: "e", source: "a", target: "b" }] });
    expect(graph).toEqual({ nodes: [], edges: [] });
    expect(issues).toEqual([]);
  });

  it("reads shapes given a type, by the first line of their text", () => {
    const a = { ...nodeFromItem(c4, { x: 0, y: 0 })!, id: "a", label: "Orders API\n[Container: Go]\nTakes orders." };
    const b = { ...nodeFromItem(service, { x: 300, y: 0 })!, id: "b", label: "Billing" };
    const plain = { ...nodeFromItem(rect, { x: 0, y: 300 })!, id: "c", label: "Legend" };
    const { graph } = deriveFromDiagram({ nodes: [a, b, plain], edges: [{ id: "e", source: "a", target: "b" }, { id: "f", source: "c", target: "a" }] });
    expect(graph.nodes.map((n) => [n.label, n.type])).toEqual([
      ["Orders API", "service"],
      ["Billing", "service"],
    ]);
    expect(graph.edges.map((e) => e.id)).toEqual(["orders-api->billing"]);
  });
});

describe("templates", () => {
  it("all build into consistent diagrams", async () => {
    for (const t of TEMPLATES) {
      const d: Diagram = await t.build();
      const ids = new Set(d.nodes.map((n) => n.id));
      expect(ids.size, t.id).toBe(d.nodes.length);
      expect(d.nodes.length, t.id).toBeGreaterThan(2);
      for (const n of d.nodes) if (n.parent) expect(ids.has(n.parent), `${t.id} ${n.id}`).toBe(true);
      for (const e of d.edges) expect(ids.has(e.source) && ids.has(e.target), `${t.id} ${e.id}`).toBe(true);
    }
  });

  it("review only what's architecture", async () => {
    const reviewed = async (id: string) => deriveFromDiagram(await TEMPLATES.find((t) => t.id === id)!.build()).graph;
    expect((await reviewed("flowchart")).nodes).toEqual([]);
    expect((await reviewed("uml-class")).nodes).toEqual([]);
    expect((await reviewed("three-tier")).nodes.length).toBe(8);
    expect((await reviewed("c4-context")).nodes.length).toBe(5);
  });

  it("export to draw.io with every shape and connector", async () => {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
    for (const t of TEMPLATES) {
      const d = await t.build();
      const xml = diagramToDrawio(d, deriveFromDiagram(d).graph);
      expect(xml, t.id).not.toMatch(/NaN|undefined/);
      const root = parser.parse(xml).mxfile.diagram.mxGraphModel.root;
      const objects = [root.object ?? []].flat();
      expect(objects.filter((o: { mxCell: { vertex?: string } }) => o.mxCell.vertex === "1").length, t.id).toBe(d.nodes.length);
      expect(objects.filter((o: { mxCell: { edge?: string } }) => o.mxCell.edge === "1").length, t.id).toBe(d.edges.length);
    }
  });
});

describe("layout with shape sizes", () => {
  it("keeps a shape's own size", async () => {
    const node = (id: string) => ({ id, type: "service" as const, label: id, tech: null, replicas: null, dlq: null, canvas_id: null, source: "user" as const, confidence: 1 });
    const graph: Graph = {
      nodes: [node("a"), node("b")],
      edges: [{ id: "a->b", from: "a", to: "b", kind: "sync", protocol: null, endpoint: null, retry: null, timeout_ms: null, hot_path: null, canvas_id: null, source: "user", confidence: 1 }],
    };
    const layout = await layoutGraph(graph, { zones: false, sizes: new Map([["a", { width: 220, height: 120 }]]) });
    expect(layout.boxes.get("a")).toMatchObject({ width: 220, height: 120 });
    expect(layout.boxes.get("b")).toMatchObject({ width: 64, height: 64 });
    expect(layout.boxes.get("b")!.x).toBeGreaterThanOrEqual(layout.boxes.get("a")!.x + 220);
  });
});
