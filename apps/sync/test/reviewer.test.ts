import type { Document } from "@hocuspocus/server";
import { type ReviewerStatus, metaMap } from "@stacksketch/graph";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { type Api, ApiError } from "../src/api";
import { StackSketchReviewer } from "../src/reviewer";
import type { Store } from "../src/store";

const until = async (check: () => boolean, ms = 4000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

const status = (doc: Y.Doc) => (metaMap(doc).get("reviewer") as ReviewerStatus | undefined)?.state;

function setup(review: () => Promise<unknown>) {
  const api = { llmEnabled: async () => false, review } as unknown as Api;
  const store = { logReview: () => {} } as unknown as Store;
  const reviewer = new StackSketchReviewer(api, store, {
    deriveDebounceMs: 10,
    reviewDebounceMs: 10,
    refineDebounceMs: 10,
    refineMinIntervalMs: 10,
  });
  const doc = new Y.Doc();
  const load = () => reviewer.afterLoadDocument({ document: doc as unknown as Document, documentName: "test" } as never);
  const unload = () => reviewer.beforeUnloadDocument({ documentName: "test" } as never);
  return { doc, load, unload };
}

describe("reviewer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps retrying while the API is unreachable, then recovers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    let calls = 0;
    const { doc, load, unload } = setup(async () => {
      calls++;
      if (calls === 1) throw new ApiError(0, "can't reach the API at http://127.0.0.1:8000 (ECONNREFUSED)");
      return { findings: [], questions: [], diff: {} };
    });
    await load();
    await until(() => status(doc) === "error");
    await until(() => status(doc) === "idle");
    expect(calls).toBe(2);
    expect(console.error).toHaveBeenCalledTimes(1);
    await unload();
  });

  it("does not retry a request the API rejected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    const { doc, load, unload } = setup(async () => {
      calls++;
      throw new ApiError(422, "graph: unknown node");
    });
    await load();
    await until(() => status(doc) === "error");
    await new Promise((r) => setTimeout(r, 1500));
    expect(calls).toBe(1);
    await unload();
  });
});
