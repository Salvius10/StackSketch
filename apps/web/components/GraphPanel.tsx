"use client";

import { type Graph, validateGraph } from "@stacksketch/graph";
import { useMemo, useState } from "react";

export function GraphPanel({ graph }: { graph: Graph }) {
  const [copied, setCopied] = useState(false);
  const json = useMemo(() => JSON.stringify(graph, null, 2), [graph]);
  const problems = useMemo(() => validateGraph(graph), [graph]);
  const unknown = useMemo(() => {
    let n = 0;
    for (const node of graph.nodes) n += Number(node.replicas === null) + Number(node.tech === null);
    for (const e of graph.edges) n += Number(e.timeout_ms === null) + Number(e.retry === null);
    return n;
  }, [graph]);

  return (
    <div className="panel-body">
      <div className="graph-stats">
        <span>
          <strong>{graph.nodes.length}</strong> components
        </span>
        <span>
          <strong>{graph.edges.length}</strong> connections
        </span>
        <span title="Fields still null: replicas, tech, timeout, retry">
          <strong>{unknown}</strong> unknown fields
        </span>
        <span className={problems.length ? "error" : "ok"}>{problems.length ? `${problems.length} schema problems` : "valid"}</span>
      </div>
      {problems.map((p) => (
        <p key={p} className="error">
          {p}
        </p>
      ))}
      <div className="row-between">
        <p className="fine">The typed graph every feature reads. It updates live as you draw.</p>
        <button
          className="btn small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(json);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard blocked */
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="json">{json}</pre>
    </div>
  );
}
