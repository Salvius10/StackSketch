# StackSketch

An architecture whiteboard for small teams and solo devs. You sketch the system and it comes out as a clean reference-architecture diagram; a live reviewer flags real design flaws while you draw, and the flow explainer walks a request through the graph hop by hop.

The build spec is in [docs/BUILDSPEC.md](docs/BUILDSPEC.md).

## Quick start

Prerequisites: Node 22.13+, Python 3.12+, [uv](https://docs.astral.sh/uv/).

```bash
npm install
(cd api && uv sync)
npm run dev          # API :8000, sync server :1234, web :3000
```

Open http://localhost:3000 and start a board. Share the board URL so others can edit it with you.

If port 8000, 1234 or 3000 is still taken (say, by an earlier `npm run dev` that didn't shut down), `npm run dev` stops before starting anything and prints which process holds the port and the command to end it.

The reviewer works without any key (rule checks only). To turn on the AI layer (reworded findings, judgement calls, idea → architecture, AI flow narration, room chat), put a key in `.env` at the repo root (copy `.env.example` if it isn't there) and restart `npm run dev`:

```bash
OPENROUTER_API_KEY=sk-or-...   # any OpenRouter model; defaults to the low-cost google/gemini-2.5-flash-lite
# or
ANTHROPIC_API_KEY=sk-ant-...   # Claude directly (or run: ant auth login)
```

The API logs which provider and model it is using when it starts, and `GET :8000/health` reports them.

## How it works

Everything reads or writes **one typed graph** of components and connections, kept in one shared Yjs document per board.

```
 browser (Next.js + React Flow)          sync server (Hocuspocus)              API (FastAPI)
 ┌──────────────────────────┐   Yjs   ┌───────────────────────────────┐ HTTP ┌─────────────────────┐
 │ diagram: shapes, zones, ─┼────────►│ derive graph from the diagram │─────►│ rule checks         │
 │ connectors, answers      │         │ review after a pause in edits │      │ LLM layer           │
 │ findings, pins, flows ◄──┼─────────│ write findings + questions    │◄─────│ explainer, compose  │
 └──────────────────────────┘         │ answer room chat              │      └─────────────────────┘
            │  /api proxy (explain, generate, import)                 │ SQLite: docs + review log
            └─────────────────────────────────────────────────────────┘
```

- The browser only writes the diagram (components, zones, notes, connectors), votes, dismissed questions, flows and chat into the document.
- The sync server is the single writer of the graph and the findings, so every user sees the same flags. It derives the graph about 150 ms after an edit, runs the rules about 1.2 s after edits stop, and asks the LLM layer to refine them (at most every 15 s per board).
- The API is stateless: every request carries the graph it is about.

### The editor

The editor works like draw.io:

- **Shape library** on the left: drag a shape onto the canvas (or into a zone), or click it to add it in view. Search filters it.
- **Connecting**: hover a component and drag from one of its blue connection points to another component. Dropping on empty canvas offers a list of components to add, already connected. The blue arrows beside a selected component add a connected copy on that side.
- **Zones** are containers: drop shapes into a zone to put them inside, drag them out to take them out, and move the zone to move its contents. A zone grows when something added to it doesn't fit. Ctrl+G puts the selection in a new zone.
- **Format panel** on the right shows what can be set on the selection: a component's name, type, icon, technology and replicas; a connector's kind, label, protocol, endpoint, timeout, retry and hot path; alignment and distribution for several shapes.
- **Menus and toolbar**: File (new board, import, export as PNG, SVG, draw.io, Mermaid or JSON), Edit, View, Arrange (auto layout, zones, align, distribute) and AI (idea → architecture, review, flows, room chat). Press `?` for the keyboard shortcuts.
- **Undo and redo** (Ctrl+Z, Ctrl+Y) only touch your own edits, never a teammate's.
- **Request flows** (Flow tab): select a component and pick a request into it. The view frames the flow and fades everything it doesn't touch; a numbered marker travels each connector, lighting it up blue for a request that waits, orange for a message that doesn't, purple for a stream and green for the reply coming back. The components it leaves and reaches get a ring, and the view follows it if it goes off-screen. A card at the foot of the canvas shows the hop, what happens and play, pause, step and close; the panel lists the steps as a timeline (click one to jump there) with Slow / Normal / Fast speeds.
- **The room AI can draw**: ask it in the Chat tab to add, connect, rename, group, remove or fix things ("add a Redis cache for the app server", "fix the findings", or "draw a serverless image pipeline" on an empty board). Its reply lists the edits by graph id; the API drops any that don't fit the graph, and the tab that asked places them beside what they connect to and applies them as one step. The reply then says what changed, with Undo (anyone in the room can use it, also after a reload) and Show. Retry, timeout and hot-path values are kept only when the message or an open finding mentions them, so the reviewer still asks about the rest.

Boards drawn in the earlier Excalidraw-based editor are converted when they are first opened. The old elements stay in the document.

### Diagram style

Components are drawn the way reference architectures are: an icon tile in the component's category colour (compute orange, networking purple, data magenta, storage green, integration pink, security red) with its name and technology underneath. Users, clients and outside services are plain line icons. The icon follows the type and the technology: a database labelled `S3` is a bucket, a queue on `Kafka` is a stream, an outside service called `Stripe` is a card, `SendGrid` an envelope. The icons are StackSketch's own SVGs, so exports look the same everywhere.

- **Connectors** are right-angle arrows attached to the components' sides, so they re-route when you move a component.
- **Zones** box in the clients, the system (titled with the board name) and external services when a graph is laid out.
- **Auto layout** (Ctrl+Shift+L) lays the whole board out again in this style. Your zones, names and fields carry over, the reviewer's findings stay attached, and Ctrl+Z puts the old layout back.
- **Numbered steps**: after explaining a request flow, *Number steps on diagram* puts a numbered badge on each hop and lists the steps beside the drawing.

### Diagram → graph

| On the canvas | In the graph |
| --- | --- |
| A component from the library | a node; its type comes from the shape, the Format panel, or keywords in the name (`Postgres` → database, `Kafka` → queue …) |
| Name `Orders DB`, technology `Postgres`, replicas `3` | `label: "Orders DB"`, `tech: "Postgres"`, `replicas: 3` |
| Solid / dashed / dotted connector | `sync` / `async` / `stream` edge |
| Connector label `POST /checkout timeout 2s retry hot` | `protocol: REST`, `endpoint`, `timeout_ms: 2000`, `retry: true`, `hot_path: true`; fields set in the Format panel win over the label |

Unknown fields stay `null`. Every node and edge records its `source` (user, infra, code, ai) and `confidence`.

### Reviewer

Deterministic rules run first, so the advice is tied to the actual graph; when a rule needs a field that is `null`, it asks (at most 3 questions at a time) instead of guessing.

| Rule | Flags |
| --- | --- |
| `spof-hot-path` | a single-instance component on the hot path (marked hot edges, or sync paths from clients) |
| `sync-chain-depth` | more than 3 synchronous service hops in a row |
| `queue-retry-dlq` | a queue whose consumers don't retry and has no dead-letter queue, or retries with no DLQ |
| `shared-database` | one database used by several services |
| `external-timeout` | a sync call to an external API with no timeout |
| `client-direct-data` | a client talking straight to a database or cache |
| `sync-cycle` | services calling each other synchronously in a loop |
| `queue-no-consumer` | a queue that nothing reads |

The LLM layer rewrites each finding for this design and adds up to 3 judgement calls. It runs on any OpenRouter model that supports structured outputs (requests are routed only to providers that enforce the JSON schema), or on Claude Opus 5.5 through the Anthropic API (structured outputs, with server-side refusal fallbacks enabled). Every id it returns is checked against the graph before it's used. Findings voted "not useful" are hidden and passed back to the LLM as advice to avoid.

## Repository

| Path | What |
| --- | --- |
| `packages/graph` | shared TypeScript: schema, the diagram model and diagram → graph derivation, conversion of old Excalidraw boards, diff, component icons, Mermaid and draw.io export, draw.io import, zoned ELK layout, Yjs document layout |
| `apps/web` | Next.js + React Flow (`@xyflow/react`): the editor (shape library, menus, toolbar, format panel, zones, quick-add, auto layout, numbered steps, SVG/PNG export), Yjs binding with per-user undo, review, flow and chat panels |
| `apps/sync` | Hocuspocus server: persistence (SQLite), graph derivation, reviewer orchestration, room chat; `scripts/smoke.ts` is an end-to-end check |
| `api` | FastAPI: rules, LLM layer, explainer, docker-compose ingestion; `spike/` is the Phase 0 harness |

## Commands

```bash
npm run dev         # everything
npm test            # graph and sync packages (vitest) + API (pytest)
npm run typecheck   # all TypeScript workspaces
npm run smoke       # with the stack running: draws a board over Yjs and waits for findings
npm run build       # production build of the web app
```

### Configuration

The API and the sync server read `.env` at the repo root (see `.env.example`); variables set in the shell win. The web app reads `apps/web/.env.local`.

| Variable | Where | Default |
| --- | --- | --- |
| `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` | API | unset: rules only |
| `STACKSKETCH_PROVIDER` | API | `openrouter` if its key is set, else `anthropic` |
| `STACKSKETCH_MODEL` | API | `google/gemini-2.5-flash-lite` on OpenRouter, `claude-opus-5-5` on Anthropic |
| `STACKSKETCH_EFFORT` | API (Claude only) | `medium` |
| `STACKSKETCH_LLM=off` | API | force rules only |
| `API_URL` | sync, web | `http://127.0.0.1:8000` |
| `PORT`, `DATA_DIR` | sync | `1234`, `./data` |
| `REVIEW_DEBOUNCE_MS`, `REFINE_DEBOUNCE_MS`, `REFINE_MIN_INTERVAL_MS` | sync | `1200`, `4000`, `15000` |
| `NEXT_PUBLIC_SYNC_URL` | web | `ws://localhost:1234` |

## Status against the build spec

| Phase | State |
| --- | --- |
| 0. Spike | Harness ready: `cd api && uv run python spike/sketch_to_graph.py <folder>` scores sketch images against expected graph JSON. Needs your 10 sketches and a key. |
| 1. Canvas + graph | Done: draw.io-style editor on React Flow (shape library, connection points, zones as containers, format panel, per-user undo), graph in the Yjs doc, live graph view. Old Excalidraw boards convert on first open. |
| 2. Reviewer | Done: 8 rules, batched questions, LLM refinement, pins on canvas, useful / not useful votes. |
| 3. Explainer | Done: entry points, call/return walk, sync vs async animation, template or AI narration, saved flows. |
| 4. Export + idea → architecture | Done: draw.io (icons in zone containers), Mermaid, PNG (2×), SVG, JSON export; draw.io, docker-compose and JSON import; idea → graph → zoned ELK layout. |
| 5. GitHub | Started: docker-compose topology parser only. Not built yet: GitHub App, Kubernetes/Terraform parsers, Python/FastAPI code parser, drift detection, PR comment. |
| 6. Multiplayer + shared AI | Done: Hocuspocus sync, presence cursors, one room AI thread, shared findings. No auth yet: anyone with a board link can edit. |

Storage is SQLite (`apps/sync/data/stacksketch.db`): Yjs documents plus a review log of graph snapshots and findings. Postgres, as in the spec, is the next step for a hosted deployment.
