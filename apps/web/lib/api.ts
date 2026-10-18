// Browser -> FastAPI, through the Next.js /api proxy.

import type { FlowStep, Graph } from "@stacksketch/graph";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Could not reach the StackSketch API. Is it running on port 8000?");
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { detail?: unknown };
      if (typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data.detail)) detail = data.detail.map((d: { msg?: string }) => d.msg ?? "").join("; ");
    } catch {
      /* not JSON */
    }
    if (res.status >= 500 && res.status !== 503) detail = "The StackSketch API is not responding. Is it running on port 8000?";
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export interface EntryPoint {
  id: string;
  label: string;
  edge_id: string;
}

export interface Health {
  ok: boolean;
  llm: boolean;
  provider: "anthropic" | "openrouter" | null;
  model: string | null;
}

export const api = {
  async health(): Promise<Health | null> {
    try {
      const res = await fetch("/api/health");
      return res.ok ? ((await res.json()) as Health) : null;
    } catch {
      return null;
    }
  },
  entries: (graph: Graph, nodeId: string) => post<{ entries: EntryPoint[] }>("/explain/entries", { graph, node_id: nodeId }),
  explain: (graph: Graph, nodeId: string, entryEdgeId: string, narrate: boolean) =>
    post<{ steps: FlowStep[]; summary: string; llm: boolean }>("/explain", {
      graph,
      node_id: nodeId,
      entry_edge_id: entryEdgeId,
      narrate_with_llm: narrate,
    }),
  generate: (prompt: string) => post<{ graph: Graph; notes: string[] }>("/generate", { prompt }),
  compose: (text: string) => post<{ graph: Graph; notes: string[] }>("/ingest/compose", { text }),
};
