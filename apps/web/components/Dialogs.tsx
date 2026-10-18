"use client";

import { type Box, type Graph, type GraphEdge, type GraphNode, fromDrawio, isEdgeKind, isNodeType, validateGraph } from "@stacksketch/graph";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const EXAMPLES = [
  "A food delivery app: customers order from restaurants on mobile, couriers get assigned in real time, payments through Stripe, and restaurants get a tablet dashboard.",
  "A URL shortener with click analytics, a public API with rate limiting, and a nightly report email.",
  "A SaaS invoicing tool: web app, PDF generation in the background, email delivery, and webhooks to customers' accounting systems.",
];

export function IdeaDialog({ llmAvailable, onClose, onGenerate }: { llmAvailable: boolean; onClose: () => void; onGenerate: (prompt: string) => Promise<void> }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal title="Idea → architecture" onClose={onClose}>
      <p className="fine">
        Describe the system. The AI drafts a typed graph, StackSketch lays it out on the canvas, and the reviewer checks it straight away.
        Unknowns stay unknown: expect a few questions.
      </p>
      <textarea
        className="input"
        rows={6}
        autoFocus
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="What are you building? Who uses it, what does it store, what does it call?"
      />
      <div className="examples">
        {EXAMPLES.map((ex) => (
          <button key={ex} className="chip example" onClick={() => setPrompt(ex)}>
            {ex.split(":")[0]}
          </button>
        ))}
      </div>
      {!llmAvailable && (
        <p className="error">The AI layer is off. Put OPENROUTER_API_KEY (or ANTHROPIC_API_KEY) in .env at the repo root, then restart npm run dev.</p>
      )}
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn primary"
          disabled={busy || prompt.trim().length < 3 || !llmAvailable}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onGenerate(prompt.trim());
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <>
              <span className="spinner" /> Drafting…
            </>
          ) : (
            "Draft architecture"
          )}
        </button>
      </div>
    </Modal>
  );
}

/** Accept a graph JSON written by hand or another tool: fill in what is missing. */
export function normalizeGraph(raw: unknown): Graph {
  const r = raw as { nodes?: Partial<GraphNode>[]; edges?: (Partial<GraphEdge> & { source_id?: string })[] };
  if (!r || !Array.isArray(r.nodes) || !Array.isArray(r.edges)) throw new Error("JSON must have nodes and edges arrays.");
  const nodes: GraphNode[] = r.nodes.map((n, i) => ({
    id: String(n.id ?? `node-${i + 1}`),
    type: isNodeType(n.type) ? n.type : "service",
    label: String(n.label ?? n.id ?? `Node ${i + 1}`),
    tech: n.tech ?? null,
    replicas: typeof n.replicas === "number" ? n.replicas : null,
    dlq: typeof n.dlq === "boolean" ? n.dlq : null,
    canvas_id: null,
    source: n.source ?? "user",
    confidence: typeof n.confidence === "number" ? n.confidence : 1,
  }));
  const edges: GraphEdge[] = r.edges.map((e, i) => ({
    id: String(e.id ?? `e${i + 1}`),
    from: String(e.from),
    to: String(e.to),
    kind: isEdgeKind(e.kind) ? e.kind : "sync",
    protocol: e.protocol ?? null,
    endpoint: e.endpoint ?? null,
    retry: typeof e.retry === "boolean" ? e.retry : null,
    timeout_ms: typeof e.timeout_ms === "number" ? e.timeout_ms : null,
    hot_path: typeof e.hot_path === "boolean" ? e.hot_path : null,
    canvas_id: null,
    source: e.source ?? "user",
    confidence: typeof e.confidence === "number" ? e.confidence : 1,
  }));
  const graph = { nodes, edges };
  const problems = validateGraph(graph);
  if (problems.length) throw new Error(`Graph JSON has problems: ${problems.slice(0, 3).join("; ")}`);
  return graph;
}

export function ImportDialog({ onClose, onImport }: { onClose: () => void; onImport: (g: Graph, boxes: Map<string, Box> | undefined, notes: string[]) => Promise<void> }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const t = text.trim();
      if (/<mxfile|<mxGraphModel/.test(t)) {
        const { graph, boxes } = fromDrawio(t);
        if (graph.nodes.length === 0) throw new Error("No components found in that draw.io diagram.");
        await onImport(graph, boxes, ["Imported from draw.io."]);
      } else if (t.startsWith("{")) {
        await onImport(normalizeGraph(JSON.parse(t)), undefined, ["Imported graph JSON."]);
      } else if (/(^|\n)services\s*:/.test(t)) {
        const res = await api.compose(t);
        await onImport(res.graph, undefined, res.notes);
      } else {
        throw new Error("Paste a .drawio file, a docker-compose.yml or a StackSketch graph JSON.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Import" onClose={onClose}>
      <p className="fine">
        Bring in an existing design. <strong>draw.io</strong> keeps its layout; <strong>docker-compose.yml</strong> becomes topology (services,
        dependencies, connection strings); <strong>graph JSON</strong> is the StackSketch schema. Imported components land next to what is
        already on the board.
      </p>
      <div className="row">
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Choose file…
        </button>
        <span className="fine">{fileName ?? ".drawio, .xml, .yml, .yaml, .json"}</span>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".drawio,.xml,.yml,.yaml,.json"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setFileName(f.name);
            setText(await f.text());
          }}
        />
      </div>
      <textarea className="input mono" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="…or paste the file contents here" />
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy || !text.trim()} onClick={run}>
          {busy ? <span className="spinner" /> : null} Import
        </button>
      </div>
    </Modal>
  );
}
