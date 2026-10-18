// Thin client for the FastAPI service.

import type { Finding, Graph, Question } from "@stacksketch/graph";

export interface ReviewResult {
  findings: Finding[];
  questions: Question[];
  diff: Record<string, string[]>;
}

export interface RefineResult {
  findings: Finding[];
  llm: boolean;
  model: string | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }

  /** Unreachable, timed out or a server error: worth trying again later. Status 0 means no response. */
  get transient(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

export class Api {
  private health: { until: number; llm: boolean } | null = null;

  constructor(private baseUrl: string) {}

  private async post<T>(path: string, body: unknown, timeoutMs = 120_000): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new ApiError(0, `the API at ${this.baseUrl} did not answer within ${timeoutMs / 1000}s`);
      }
      const code = err instanceof Error ? (err.cause as { code?: string } | undefined)?.code : undefined;
      throw new ApiError(0, `can't reach the API at ${this.baseUrl}${code ? ` (${code})` : ""}`);
    }
    if (!res.ok) {
      let detail = res.statusText;
      try {
        detail = ((await res.json()) as { detail?: string }).detail ?? detail;
      } catch {
        /* not JSON */
      }
      throw new ApiError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return (await res.json()) as T;
  }

  /** Whether the API has AI credentials (Claude or OpenRouter); cached for a minute. */
  async llmEnabled(): Promise<boolean> {
    if (this.health && Date.now() < this.health.until) return this.health.llm;
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      const body = (await res.json()) as { llm: boolean };
      this.health = { until: Date.now() + 60_000, llm: !!body.llm };
    } catch {
      // The API may still be starting: ask again soon rather than in a minute.
      this.health = { until: Date.now() + 5_000, llm: false };
    }
    return this.health.llm;
  }

  review(graph: Graph, previous: Graph | null, dismissed: string[]): Promise<ReviewResult> {
    return this.post("/review", { graph, previous, dismissed_questions: dismissed }, 15_000);
  }

  refine(graph: Graph, diff: Record<string, string[]> | null, findings: Finding[], notUseful: string[]): Promise<RefineResult> {
    return this.post("/review/refine", { graph, diff, findings, not_useful: notUseful });
  }

  chat(
    graph: Graph,
    findings: Finding[],
    messages: { role: "user" | "assistant"; author: string; text: string }[],
  ): Promise<{ reply: string }> {
    return this.post("/chat", { graph, findings, messages });
  }
}
