# AI Architecture Whiteboard — Build Spec

Oct 18, 2026 · @MellySally

## Summary

A whiteboard where teams and solo devs sketch an architecture, and an AI reviews it for real design flaws and explains its request flows. The goal is real teams opening it every week.

- **Wedge:** the live reviewer and the flow explainer. Everything else supports these two.
- **Users:** small engineering teams and solo devs, designing a new system or maintaining an existing one.
- **Not the goal:** drawing faster. Drawing is the cheap part of design; deciding is the expensive part.

## Core principle: one typed graph

Every feature reads or writes one shared graph of components (nodes) and connections (edges). Get the graph right and each feature is a thin layer on top.

| Mode | When | Where edge details come from |
| --- | --- | --- |
| Design mode | No code yet | Snap-to-shape, arrow styles, AI questions |
| Live mode | Repo connected | Infra files, then code, then AI questions |

Both modes write the same schema, so the reviewer and explainer behave identically on either.

## Canvas: Excalidraw, with draw.io as an export format

Build the editor on Excalidraw. Use draw.io's file format for import and export, not its editor.

|  | Excalidraw | draw.io |
| --- | --- | --- |
| Licence | MIT | Apache 2.0 for the code |
| How you embed it | npm React component | iframe + postMessage; no npm package |
| Self-hosted real-time collab | Yes, via a separate excalidraw-room server | No; the README says it is not supported |
| Sketch feel | Native hand-drawn style | Pick-a-shape-from-a-panel first |
| Data model | Elements; arrows bind to shapes | mxGraph XML: cells with source and target (graph-native) |
| AI flags drawn on the canvas | Easy: you own the React tree | Hard: you sit outside the iframe |
| Upstream contributions | Open | Code pull requests not accepted |

**Why not draw.io as the base:** no live collaboration when self-hosted, and drawing AI overlays from outside an iframe fights the tool.

**Where draw.io wins:** its XML is graph-native and widely used, so `.drawio` export and import is high value.

**Fallback:** tldraw has a strong SDK with built-in sync, but production use needs a licence key. \[Likely\]

Sources: [draw.io FAQ](https://github.com/jgraph/drawio/wiki/FAQ), [draw.io developer wiki](https://github.com/jgraph/drawio/wiki/Home), [Excalidraw vs draw.io](https://instapods.com/apps/excalidraw/vs/drawio/), [Excalidraw self-hosted collab](https://sliplane.io/blog/self-hosting-excalidraw-the-easy-way)

## Graph schema

Every node and edge records where its data came from and how sure we are. Unknown fields stay `null`; the AI asks rather than guesses.

```json
{
  "nodes": [
    { "id": "order-svc", "type": "service", "label": "Order Service",
      "tech": "FastAPI", "replicas": null, "canvas_id": "ex_8f2a",
      "source": "code", "confidence": 0.9 }
  ],
  "edges": [
    { "id": "e1", "from": "api-gw", "to": "order-svc",
      "kind": "sync", "protocol": "REST", "endpoint": "POST /checkout",
      "retry": true, "timeout_ms": 3000, "hot_path": true,
      "source": "user", "confidence": 1.0 }
  ]
}
```

| Field | Values |
| --- | --- |
| Node `type` | client, gateway, service, worker, database, cache, queue, external |
| Edge `kind` | sync (solid arrow), async (dashed), stream (double) |
| `source` | user, infra, code, ai |
| `confidence` | 0 to 1; low confidence on a field a finding needs → AI asks |
| `canvas_id` | the Excalidraw element this node maps to |

## Feature specs

The reviewer and explainer are the product; the other four are cheap once the graph exists.

### 1. Live reviewer

Catches real design flaws while you draw and pins each one to the node or edge it is about.

- **Trigger:** a short pause after edits; runs on the graph diff, with the full graph as context.
- **Two layers:** deterministic rule checks first, then the LLM for judgement calls and wording. Rules stop the advice from going generic.
- **Starter rules:** single point of failure on the hot path; sync call chains deeper than a set limit; queue with no retry or dead-letter queue; one database shared by several services; external call with no timeout.
- **Finding shape:** target id, severity, rule, message, suggested fix, plus a "useful / not useful" vote.
- **Questions:** asked only when a `null` field blocks a finding; batched, at most 3 at a time.

### 2. Flow explainer

Click a component, pick an entry point (for example `POST /checkout`), and watch the request travel the graph step by step with a one-line narration per hop. Sync hops and async hops animate differently.

### 3. Export

`.drawio` XML, Mermaid, PNG/SVG and the raw graph JSON. All are serialisations of the same graph.

### 4. Idea to architecture

The LLM writes graph JSON (validated against the schema), auto-layout places it on the canvas, and the reviewer runs on it immediately.

### 5. GitHub ingestion

A read-only GitHub App fills the graph in layers:

1. **Topology** from `docker-compose.yml`, Kubernetes manifests and Terraform; from code when none exist.
2. **Edge details** from code, always. Python/FastAPI first: HTTP clients, Kafka/Celery producers, `@retry` decorators, ORM sessions.
3. **Gaps** go to the user as AI questions.

On each push or PR it runs **drift detection**: where the drawing and the code disagree, it flags it and a human decides. It never overwrites the drawing. A PR comment shows the diagram diff and any new findings; this is the weekly trigger.

### 6. Shared AI context

The graph, findings and one room chat thread live in the shared sync document, so every user's AI call reads the same state. No per-user AI memory to reconcile.

## Real-time sync: Yjs + Hocuspocus

Use Yjs for both the canvas elements and the typed graph, in one shared document, served by Hocuspocus. Do not write sync code yourself.

*CRDT: a data structure that lets several people edit the same thing at once and always merge to the same result, with no central lock.*

| Option | What it is | Fit |
| --- | --- | --- |
| **Yjs + Hocuspocus** | CRDT library + WebSocket server with auth and persistence hooks | **Pick** |
| Yjs + y-websocket | Same CRDT, minimal reference server | Fine for the first prototype |
| excalidraw-room | Excalidraw's own relay server; passes messages, no CRDT, no storage | Quickest demo; you will outgrow it |
| Automerge | Alternative CRDT with JSON-like documents | Viable; smaller canvas ecosystem \[Likely\] |
| Liveblocks | Hosted sync service | Skip: not open source |

**Why one shared document:** the reviewer writes findings into it, so every user sees the same flags without any extra API call, and shared AI context comes for free.

**Start with it on day one:** use the Yjs document even in single-user mode. Turning on multiplayer later is then a server switch, not a rewrite.

Community Excalidraw–Yjs bindings exist; check how actively they are maintained before depending on one. \[Guessing\]

Sources: [Excalidraw self-hosted collab setup](https://ramnode.com/guides/excalidraw), [excalidraw-room requirement](https://sliplane.io/blog/self-hosting-excalidraw-the-easy-way)

## System architecture and stack

The browser, the API and every user talk through one Yjs document; nothing calls the browser directly.

&#91;embedded content: system architecture · browser, sync server, API, external services\]

The reviewer and explainer write their results back into the shared document, so every user's overlay shows the same flags.

| Layer | Choice |
| --- | --- |
| Frontend | Next.js + TypeScript, Excalidraw npm package |
| Sync | Yjs + Hocuspocus |
| Backend | FastAPI (Python): graph service, reviewer, explainer |
| Ingestion | Background worker + GitHub App webhooks |
| Storage | Postgres for projects, graph snapshots, findings |
| Auto-layout | ELK.js for idea-to-architecture graphs |

## Build phases

Phase 0 is a one-week spike that tests the riskiest assumption before anything else is built. Each phase ships only when its exit check passes.

| Phase | Scope | Exit check |
| --- | --- | --- |
| 0. Spike | 10 messy sketches → snap-to-shape + vision model → graph JSON | At least 8 of 10 graphs correct (threshold is a starting guess) |
| 1. Canvas + graph | Excalidraw, snap-to-shape, typed arrows, graph schema in a Yjs document | Drawing produces valid graph JSON live |
| 2. Reviewer | Rule checks, LLM layer, batched questions, flags on canvas | Finds at least 1 flaw your team agrees is real, on a real design |
| 3. Explainer | Path walk, hop animation, narration | A teammate new to the system explains a flow back correctly |
| 4. Export + idea to architecture | `.drawio`, Mermaid, PNG/SVG, JSON; LLM → graph → auto-layout | A `.drawio` export opens cleanly in draw.io |
| 5. GitHub | Read-only app, infra parsers, Python/FastAPI code parser, drift flags, PR comment | Drift flagged correctly on a real PR |
| 6. Multiplayer + shared AI | Hocuspocus server, presence, one room AI thread | 3 people edit at once and see the same findings |

## Validation plan

The one metric that matters: **teams that reopen it the following week without being asked.**

- **First users:** your own team, on its next real design. Then hackathon teammates as solo-dev and small-team testers.
- **Before building much:** ask the team which weekly moment they would open this in (PR review, design discussion, onboarding). No clear answer = rethink the trigger.
- **Supporting signals:**
  - Share of reviewer findings voted "useful" (low share = advice is too generic)
  - Share of AI questions answered rather than dismissed
  - Drift flags acted on after a PR

## Risks, assumptions and open decisions

The biggest risk is a reviewer whose advice feels generic; the rule layer and the usefulness vote exist to catch that early.

| Risk | Confidence | Mitigation |
| --- | --- | --- |
| Reviewer advice too generic | Guessing | Rule checks first; track "useful" votes from phase 2 |
| Sketch → graph extraction inaccurate | Likely | Phase 0 spike; snap-to-shape over pure freehand |
| Teams use it once, never return | Likely | PR comments and drift flags as the weekly trigger |
| Code parsing too broad to finish | Likely | Infra files first; one stack (Python/FastAPI) before any other |
| Too many AI questions annoy users | Guessing | Ask only when a finding is blocked; batch, max 3 |
| Teams already pay for Miro / Eraser / Lucid | Likely | Lead with the reviewer and drift checks, which those tools are weaker at |

**Open decisions**

- [x] Product name: StackSketch
- [ ] Which LLM for the reviewer, and its cost per review
- [ ] Where graph snapshots persist: Postgres alone, or also a graph database
- [ ] Starter rule list for the reviewer: which 10 rules ship first
- [ ] Self-host only, or a hosted version too
