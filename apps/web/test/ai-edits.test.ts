import { type BoardChange, type BoardEdits, type Diagram, absoluteBox, deriveFromDiagram } from "@stacksketch/graph";
import { describe, expect, it } from "vitest";
import { planEdits } from "../lib/ai-edits";
import { footprint, overlaps } from "../lib/arrange";

const none: BoardEdits = { add_nodes: [], update_nodes: [], remove_nodes: [], add_edges: [], update_edges: [], remove_edges: [], groups: [] };
const edits = (e: Partial<BoardEdits>): BoardEdits => ({ ...none, ...e });
const edge = (from_node: string, to_node: string, more: Partial<BoardEdits["add_edges"][number]> = {}) => ({
  from_node,
  to_node,
  kind: "sync" as const,
  protocol: null,
  endpoint: null,
  retry: null,
  timeout_ms: null,
  hot_path: null,
  ...more,
});

/** A browser-free stand-in for applying a change to the shared document. */
function applyTo(d: Diagram, c: BoardChange): Diagram {
  const nodes = new Map(d.nodes.map((n) => [n.id, n]));
  const edges = new Map(d.edges.map((e) => [e.id, e]));
  const gone = new Set(c.remove.nodes);
  for (const [id, e] of edges) if (gone.has(e.source) || gone.has(e.target)) edges.delete(id);
  c.remove.edges.forEach((id) => edges.delete(id));
  c.remove.nodes.forEach((id) => nodes.delete(id));
  c.put.nodes.forEach((n) => nodes.set(n.id, n));
  c.put.edges.forEach((e) => edges.set(e.id, e));
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
const sorted = (d: Diagram) => ({ nodes: [...d.nodes].sort((a, b) => a.id.localeCompare(b.id)), edges: [...d.edges].sort((a, b) => a.id.localeCompare(b.id)) });

// Web app -> [Backend: App server -> Database]
const board: Diagram = {
  nodes: [
    { id: "z1", kind: "zone", x: 0, y: 0, w: 400, h: 220, label: "Backend", zone: "system", parent: null },
    { id: "c-app", kind: "component", x: 40, y: 60, parent: "z1", label: "App server", type: "service", tech: "Node.js" },
    { id: "c-db", kind: "component", x: 240, y: 60, parent: "z1", label: "Database", type: "database" },
    { id: "c-web", kind: "component", x: -220, y: 60, parent: null, label: "Web app", type: "client" },
  ],
  edges: [
    { id: "e1", source: "c-web", target: "c-app", label: "REST POST /checkout timeout 2s", kind: "sync" },
    { id: "e2", source: "c-app", target: "c-db", kind: "sync" },
  ],
};

describe("the room AI's board edits", () => {
  it("places a new component beside what it connects to, in that zone, and undoes cleanly", async () => {
    const plan = await planEdits(
      edits({
        add_nodes: [{ id: "cache", type: "cache", label: "Cache", tech: "Redis", zone: null }],
        add_edges: [edge("app-server", "cache", { protocol: "RESP" })],
      }),
      board,
      "Shop",
    );
    const after = applyTo(board, plan.change);
    const cache = after.nodes.find((n) => n.label === "Cache")!;
    expect(cache).toMatchObject({ kind: "component", type: "cache", tech: "Redis", parent: "z1", origin: "ai" });
    const byId = new Map(after.nodes.map((n) => [n.id, n]));
    // Clear of every other component, and inside its zone (which grew to hold it).
    for (const other of after.nodes.filter((n) => n.kind === "component" && n.id !== cache.id)) {
      expect(overlaps(footprint(cache, byId), footprint(other, byId))).toBe(false);
    }
    const zone = absoluteBox(byId.get("z1")!, byId);
    const box = footprint(cache, byId);
    expect(box.x >= zone.x && box.y >= zone.y && box.x + box.width <= zone.x + zone.width && box.y + box.height <= zone.y + zone.height).toBe(true);
    const link = after.edges.find((e) => e.target === cache.id)!;
    expect(link).toMatchObject({ source: "c-app", protocol: "RESP", origin: "ai" });
    expect(link.endpoint).toBeUndefined();
    // The reviewer sees it as a typed node and edge.
    const { graph } = deriveFromDiagram(after);
    expect(graph.edges.map((e) => e.id)).toContain("app-server->cache");
    expect(plan.note).toBe("Added 1 component and 1 connection.");
    expect(plan.touched).toEqual([cache.id]);
    expect(sorted(applyTo(after, plan.undo))).toEqual(sorted(board));
  });

  it("renames, changes and removes by graph id, keeping what an old connector label said", async () => {
    const plan = await planEdits(
      edits({
        update_nodes: [{ id: "app-server", label: "API", type: null, tech: null, replicas: 2, dlq: null }],
        update_edges: [{ id: "web-app->app-server", kind: null, protocol: null, endpoint: "POST /orders", retry: null, timeout_ms: null, hot_path: null }],
        remove_nodes: ["database"],
      }),
      board,
    );
    const after = applyTo(board, plan.change);
    expect(after.nodes.find((n) => n.id === "c-app")).toMatchObject({ label: "API", replicas: 2, tech: "Node.js" });
    const e1 = after.edges.find((e) => e.id === "e1")!;
    expect(e1).toMatchObject({ endpoint: "POST /orders", protocol: "REST", timeout_ms: 2000 });
    expect(e1.label).toBeUndefined();
    // The database goes, and its connector with it.
    expect(after.nodes.some((n) => n.id === "c-db")).toBe(false);
    expect(after.edges.map((e) => e.id)).toEqual(["e1"]);
    expect(plan.note).toBe("Changed 2, removed 1.");
    expect(sorted(applyTo(after, plan.undo))).toEqual(sorted(board));
  });

  it("puts new components in a zone it names, and groups existing ones", async () => {
    const plan = await planEdits(
      edits({
        add_nodes: [{ id: "worker", type: "worker", label: "Email worker", tech: null, zone: "backend" }],
        groups: [{ label: "Clients", members: ["web-app"] }],
      }),
      board,
    );
    const after = applyTo(board, plan.change);
    expect(after.nodes.find((n) => n.label === "Email worker")?.parent).toBe("z1");
    const clients = after.nodes.find((n) => n.kind === "zone" && n.label === "Clients")!;
    expect(after.nodes.find((n) => n.id === "c-web")?.parent).toBe(clients.id);
    expect(plan.note).toBe("Added 1 component, made 1 zone.");
    expect(sorted(applyTo(after, plan.undo))).toEqual(sorted(board));
  });

  it("lays out a whole drawing on a board with no components", async () => {
    const empty: Diagram = { nodes: [{ id: "n1", kind: "note", x: 0, y: 0, w: 160, h: 80, label: "Ideas" }], edges: [] };
    const plan = await planEdits(
      edits({
        add_nodes: [
          { id: "app", type: "client", label: "Mobile app", tech: null, zone: null },
          { id: "api", type: "gateway", label: "API Gateway", tech: null, zone: null },
          { id: "fn", type: "service", label: "Resize function", tech: "Lambda", zone: null },
          { id: "bucket", type: "database", label: "Images", tech: "S3", zone: null },
        ],
        add_edges: [edge("app", "api"), edge("api", "fn"), edge("fn", "bucket")],
        groups: [
          { label: "Users", members: ["app"] },
          { label: "AWS", members: ["api", "fn", "bucket"] },
        ],
      }),
      empty,
    );
    const after = applyTo(empty, plan.change);
    const zones = after.nodes.filter((n) => n.kind === "zone");
    expect(zones.map((z) => [z.label, z.zone])).toEqual([
      ["Users", "clients"],
      ["AWS", "system"],
    ]);
    const components = after.nodes.filter((n) => n.kind === "component");
    expect(components.every((c) => c.origin === "ai" && c.parent)).toBe(true);
    expect(after.edges).toHaveLength(3);
    // Beside the note, not on top of it.
    const byId = new Map(after.nodes.map((n) => [n.id, n]));
    expect(components.every((c) => absoluteBox(c, byId).x > 160)).toBe(true);
    expect(plan.note).toBe("Added 4 components and 3 connections, made 2 zones.");
    expect(new Set(plan.touched)).toEqual(new Set(components.map((c) => c.id)));
  });

  it("does nothing when what it names is gone", async () => {
    const plan = await planEdits(edits({ update_nodes: [{ id: "ghost", label: "X", type: null, tech: null, replicas: null, dlq: null }], remove_edges: ["a->b"] }), board);
    expect(plan.change).toEqual({ put: { nodes: [], edges: [] }, remove: { nodes: [], edges: [] } });
    expect(plan.note).toMatch(/^Nothing to change/);
  });
});
