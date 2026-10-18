import type { Graph, NodeType } from "./schema";

const SHAPES: Record<NodeType, [string, string]> = {
  client: ["([", "])"],
  gateway: ["{{", "}}"],
  service: ["[", "]"],
  worker: ["[[", "]]"],
  database: ["[(", ")]"],
  cache: ["((", "))"],
  queue: [">", "]"],
  external: ["[/", "/]"],
};

const mermaidId = (id: string) => id.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "n_$1");

// Mermaid labels are quoted; quotes inside become the #quot; entity.
const quote = (text: string) => `"${text.replace(/"/g, "#quot;").replace(/\n/g, "<br/>")}"`;

export function toMermaid(graph: Graph, direction: "LR" | "TD" = "LR"): string {
  const lines = [`flowchart ${direction}`];
  for (const n of graph.nodes) {
    const [open, close] = SHAPES[n.type];
    const label = n.tech ? `${n.label}\n${n.tech}` : n.label;
    lines.push(`  ${mermaidId(n.id)}${open}${quote(label)}${close}`);
  }
  for (const e of graph.edges) {
    const arrow = e.kind === "async" ? "-.->" : e.kind === "stream" ? "==>" : "-->";
    const label = e.endpoint ?? e.protocol;
    const text = label ? `|${quote(label)}|` : "";
    lines.push(`  ${mermaidId(e.from)} ${arrow}${text} ${mermaidId(e.to)}`);
  }
  const byType = new Map<NodeType, string[]>();
  for (const n of graph.nodes) byType.set(n.type, [...(byType.get(n.type) ?? []), mermaidId(n.id)]);
  const fills: Partial<Record<NodeType, string>> = {
    database: "fill:#d3f9d8,stroke:#2b8a3e",
    cache: "fill:#ffe8cc,stroke:#d9480f",
    queue: "fill:#fff3bf,stroke:#e67700",
    external: "fill:#f1f3f5,stroke:#495057,stroke-dasharray: 4 3",
    gateway: "fill:#e5dbff,stroke:#5f3dc4",
    worker: "fill:#f3d9fa,stroke:#862e9c",
    service: "fill:#d0ebff,stroke:#1864ab",
  };
  for (const [type, ids] of byType) {
    const style = fills[type];
    if (!style) continue;
    lines.push(`  classDef ${type} ${style}`);
    lines.push(`  class ${ids.join(",")} ${type}`);
  }
  return lines.join("\n") + "\n";
}
