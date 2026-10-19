# StackSketch

**An architecture whiteboard that understands what you draw.** Sketch a system the way you would in draw.io. StackSketch turns the drawing into a typed graph of components and connections, reviews the design live, walks a request through it hop by hop, and lets an AI in the room add to or fix the diagram when you ask.

Boards are shared: send the link and your team edits the same diagram in real time, with live cursors.

## The problem it solves

Architecture diagrams are usually just pictures. A box labelled "Orders DB" and an arrow mean nothing to the tool that drew them, so:

- **Design flaws are found late.** A single server on the hot path, a queue with no dead-letter queue, five services calling each other synchronously, one database shared by everything, an external API called without a timeout: these show up in an incident or a late design review, not while the design is still cheap to change.
- **Review needs a senior engineer in the room.** Small teams and solo developers often have no one to check the design.
- **Request flows live in people's heads.** Explaining what happens when a user hits `POST /checkout`, and which calls wait on which, means talking someone through the diagram.
- **Diagrams look different every time.** Hand-drawn boxes and mismatched icons don't read like the reference architectures people are used to.

StackSketch keeps the diagram and a typed graph in step, so it can:

- **Review while you draw.** Rule checks catch common design flaws a moment after you stop editing. An AI layer rewords each finding for your system and adds judgement calls. When a check needs a fact the diagram doesn't have, it asks instead of guessing.
- **Explain request flows.** Pick a request and watch it travel the graph, with requests, messages and replies in their own colours and one line of narration per hop.
- **Draw for you.** Describe a system in a sentence and get a laid-out, zoned architecture. Or ask the room AI to "add a Redis cache for the app server" or "fix the findings", and undo it in one click.
- **Look professional by default.** Components are drawn as AWS-style category icons in labelled zones, with right-angle arrows, and export to draw.io, PNG, SVG and Mermaid.

## Features

| | |
| --- | --- |
| **Editor** | draw.io-style canvas: shape library with search and extra libraries (AWS, Azure, Kubernetes…), 16 templates, zones as containers, connection points, format panel, align and distribute, auto layout, per-user undo and redo |
| **Live reviewer** | 8 rule checks with clarifying questions, then AI refinement; pins on the canvas; useful / not useful votes |
| **Flow explainer** | entry points per component, call and reply walk, animated playback with speed control, numbered steps on the diagram |
| **Room AI** | one shared chat per board that answers questions about the design and can add, connect, rename, group, remove or fix components, with Undo |
| **Idea → architecture** | describe a system and get a zoned, laid-out diagram |
| **Import and export** | import draw.io, docker-compose and graph JSON; export PNG, SVG, draw.io, Mermaid and graph JSON |
| **Collaboration** | real-time editing with Yjs, live cursors and selections, share by link |

## Tech stack

| Part | Built with |
| --- | --- |
| Web app (`apps/web`) | [Next.js](https://nextjs.org) 16, React 19, TypeScript, [React Flow](https://reactflow.dev) (`@xyflow/react` 12) |
| Real-time collaboration | [Yjs](https://yjs.dev) (CRDT) and [Hocuspocus](https://tiptap.dev/hocuspocus) (WebSocket server and provider) |
| Sync server (`apps/sync`) | Node.js 22 with `tsx`, Hocuspocus server, SQLite through `node:sqlite` |
| Shared graph library (`packages/graph`) | TypeScript: graph schema, diagram → graph derivation, [ELK](https://eclipse.dev/elk/) layout (`elkjs`), draw.io import and export (`fast-xml-parser`, `fflate`), Mermaid export |
| API (`api`) | Python 3.12, [FastAPI](https://fastapi.tiangolo.com), Pydantic 2, Uvicorn, managed with [uv](https://docs.astral.sh/uv/) |
| AI | [OpenRouter](https://openrouter.ai) (any model with structured outputs; default `google/gemini-2.5-flash-lite`) or Claude through the Anthropic API (default `claude-opus-5-5`). Every answer is schema-checked JSON. |
| Tests | Vitest, pytest |

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 22.13 or newer (`node -v`)
- [Python](https://www.python.org) 3.12 or newer
- [uv](https://docs.astral.sh/uv/getting-started/installation/), the Python package manager
- Optional: an [OpenRouter](https://openrouter.ai/settings/keys) or [Anthropic](https://console.anthropic.com) API key for the AI features

### 1. Install

```bash
git clone https://github.com/Salvius10/StackSketch.git
cd StackSketch
npm install
cd api
uv sync
cd ..
```

### 2. Add an AI key (optional)

Copy the example settings file to `.env` at the repo root:

```bash
cp .env.example .env        # macOS / Linux
copy .env.example .env      # Windows
```

Then put one key in it:

```bash
OPENROUTER_API_KEY=sk-or-...   # any OpenRouter model; defaults to the low-cost google/gemini-2.5-flash-lite
# or
ANTHROPIC_API_KEY=sk-ant-...   # Claude directly (or run: ant auth login)
```

Without a key everything still works except the AI parts: the reviewer runs its rule checks only, flows use template narration, and Idea → architecture and the room AI are off.

### 3. Start

```bash
npm run dev
```

This starts all three services together:

| Service | Address | What it does |
| --- | --- | --- |
| Web app | http://localhost:3000 | the editor; open this in your browser |
| Sync server | ws://localhost:1234 | keeps every board's shared state, runs the reviewer and the room AI |
| API | http://localhost:8000 | rule checks, the AI layer, the flow explainer, imports |

Open **http://localhost:3000** and click **New board**.

To check that the AI is on, open http://localhost:8000/health: it reports the provider and model. The bottom-right corner of the editor shows the same.

**Starting the services one by one.** Run each of these in its own terminal. This is useful for reading one service's logs, or for restarting one without the others:

```bash
npm run dev:api     # API on :8000
npm run dev:sync    # sync server on :1234
npm run dev:web     # web app on :3000
```

The web app and the sync server alone are enough for drawing and collaborating. The reviewer, flows and AI need the API too.

**Stopping.** Press `Ctrl+C` in the terminal. If a port is still taken next time (say an earlier `npm run dev` didn't shut down), `npm run dev` stops before starting anything and prints which process holds the port and the command to end it.

## How to use it

1. **Start a board.** On the home page click **New board**, or paste a board link or code and click **Open**. Share the board's URL (or **File → Copy share link**) and anyone who opens it edits with you.
2. **Draw the system.** Pick one of three ways:
   - **Draw it yourself.** Drag components from the shape library on the left onto the canvas, or into a zone. Hover a component and drag from one of its blue connection points to another to connect them. Drop a connection on empty canvas to add a new, already-connected component.
   - **Start from a template** with **File → Insert a template**.
   - **Describe it** with **AI → Idea → architecture**, for example "a photo sharing app with uploads, thumbnails and a feed".
3. **Say how things talk.** Solid connectors are synchronous calls (the caller waits), dashed are asynchronous messages, and dotted are streams. Label a connector like `POST /checkout timeout 2s retry hot` and StackSketch reads the protocol, endpoint, timeout, retry and hot path from it. You can also set these in the Format panel on the right.
4. **Tidy it.** Select components and press `Ctrl+G` to put them in a zone, or use **Arrange → Auto layout** (`Ctrl+Shift+L`) to lay the whole board out in reference-architecture style.
5. **Read the review.** The **Review** tab fills in a moment after you stop editing. Each finding is pinned on the canvas. Answer the reviewer's questions (for example "does the worker retry?") to sharpen the advice, and vote findings useful or not.
6. **Walk a request through it.** Select a component, open the **Flow** tab and pick a request, such as `POST /checkout (from Web app)`. The view frames the flow and fades everything else. A numbered marker travels each connector: blue for a request that waits, orange for a message that doesn't, purple for a stream, green for the reply. Play, pause, step or jump from the card on the canvas or the timeline in the panel. **Number steps on diagram** leaves numbered badges and a step list on the board.
7. **Ask the room AI.** In the **Chat** tab, ask about the design ("what happens if the payments API is down?") or ask for changes ("add a Redis cache for the app server", "fix the findings"). Changes appear on the board straight away, with **Undo** and **Show**.
8. **Share the result.** Use **File → Export** for PNG, SVG, draw.io, Mermaid or graph JSON. **File → Import** brings in draw.io files and docker-compose topologies.

### Keyboard shortcuts

Press `?` in the editor for the full list.

| Keys | Action |
| --- | --- |
| `Ctrl+Z` / `Ctrl+Y` | undo / redo (your own edits only, never a teammate's) |
| `Ctrl+C` / `Ctrl+V` / `Ctrl+D` | copy / paste / duplicate |
| `Del` | delete the selection |
| `F2` or double-click | rename, or edit text |
| `Ctrl+G` / `Ctrl+Shift+G` | put the selection in a zone / remove a zone and keep its contents |
| `Ctrl+Shift+L` | auto layout |
| `Ctrl+Shift+H` / `Ctrl+0` | fit the diagram / actual size |
| Wheel, `Space`+drag | scroll and pan |
| `Ctrl`+wheel | zoom |

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
- When the room AI changes the board, the API returns structured edits by graph id and drops any that don't fit the graph. The browser tab that asked places the new components beside what they connect to and applies everything as one undoable step.

Boards drawn in the earlier Excalidraw-based editor are converted when they are first opened. The old elements stay in the document.

### Diagram style

Components are drawn the way reference architectures are: an icon tile in the component's category colour (compute orange, networking purple, data magenta, storage green, integration pink, security red) with its name and technology underneath. Users, clients and outside services are plain line icons. The icon follows the type and the technology: a database labelled `S3` is a bucket, a queue on `Kafka` is a stream, an outside service called `Stripe` is a card, `SendGrid` an envelope. The icons are StackSketch's own SVGs, so exports look the same everywhere.

- **Connectors** are right-angle arrows attached to the components' sides, so they re-route when you move a component.
- **Zones** box in the clients, the system (titled with the board name) and external services when a graph is laid out.
- **Auto layout** keeps your zones, names and fields, the reviewer's findings stay attached, and `Ctrl+Z` puts the old layout back.

### Diagram → graph

| On the canvas | In the graph |
| --- | --- |
| A component from the library | a node; its type comes from the shape, the Format panel, or keywords in the name (`Postgres` → database, `Kafka` → queue …) |
| Name `Orders DB`, technology `Postgres`, replicas `3` | `label: "Orders DB"`, `tech: "Postgres"`, `replicas: 3` |
| Solid / dashed / dotted connector | `sync` / `async` / `stream` edge |
| Connector label `POST /checkout timeout 2s retry hot` | `protocol: REST`, `endpoint`, `timeout_ms: 2000`, `retry: true`, `hot_path: true`; fields set in the Format panel win over the label |

Unknown fields stay `null`. Every node and edge records its `source` (user, infra, code, ai) and `confidence`.

### Reviewer rules

Deterministic rules run first, so the advice is tied to the actual graph. When a rule needs a field that is `null`, it asks (at most 3 questions at a time) instead of guessing.

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

The LLM layer rewrites each finding for this design and adds up to 3 judgement calls. It runs on any OpenRouter model that supports structured outputs (requests are routed only to providers that enforce the JSON schema), or on Claude through the Anthropic API (structured outputs, with server-side refusal fallbacks enabled). Every id it returns is checked against the graph before it's used. Findings voted "not useful" are hidden and passed back to the LLM as advice to avoid.

## Repository

| Path | What |
| --- | --- |
| `packages/graph` | shared TypeScript: schema, the diagram model and diagram → graph derivation, shapes, libraries and templates, conversion of old Excalidraw boards, diff, component icons, Mermaid and draw.io export, draw.io import, zoned ELK layout, Yjs document layout |
| `apps/web` | Next.js + React Flow: the editor (shape library, menus, toolbar, format panel, zones, quick-add, auto layout, numbered steps, SVG/PNG export), Yjs binding with per-user undo, review, flow and chat panels, the room AI's board edits |
| `apps/sync` | Hocuspocus server: persistence (SQLite), graph derivation, reviewer orchestration, room chat; `scripts/smoke.ts` is an end-to-end check |
| `api` | FastAPI: rules, LLM layer, explainer, docker-compose ingestion; `spike/` is the Phase 0 harness |
| `docs/BUILDSPEC.md` | the build spec |

## Commands

Run these from the repo root.

| Command | What it does |
| --- | --- |
| `npm run dev` | start the API, sync server and web app together |
| `npm run dev:api` / `dev:sync` / `dev:web` | start one of them |
| `npm test` | all tests: graph, sync and web (Vitest) and the API (pytest) |
| `npm run typecheck` | type-check every TypeScript workspace |
| `npm run smoke` | with the stack running: draws a board over Yjs and waits for findings |
| `npm run build` | production build of the web app |

### Configuration

The API and the sync server read `.env` at the repo root (see `.env.example`); variables set in the shell win. The web app reads `apps/web/.env.local` (see `apps/web/.env.example`).

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

Storage is SQLite (`apps/sync/data/stacksketch.db`): the Yjs documents plus a review log of graph snapshots and findings. Postgres, as in the spec, is the next step for a hosted deployment.

### Troubleshooting

- **The AI parts are missing or greyed out.** Check http://localhost:8000/health. If `llm` is `false`, add a key to `.env` and restart. The editor checks the AI only when the page loads, so reload the board after restarting the API.
- **"Can't reach the sync server on port 1234"** means the sync server isn't running: start it with `npm run dev` or `npm run dev:sync`.
- **A port is already in use.** An earlier run is still holding it. `npm run dev` prints the process and the command to end it. On Windows, `taskkill /F /T /PID <pid>` also stops its child processes.

## Status against the build spec

| Phase | State |
| --- | --- |
| 0. Spike | Harness ready: `cd api && uv run python spike/sketch_to_graph.py <folder>` scores sketch images against expected graph JSON. Needs 10 sketches and a key. |
| 1. Canvas + graph | Done: draw.io-style editor on React Flow (shape library, connection points, zones as containers, format panel, per-user undo), graph in the Yjs doc, live graph view. Old Excalidraw boards convert on first open. |
| 2. Reviewer | Done: 8 rules, batched questions, LLM refinement, pins on canvas, useful / not useful votes. |
| 3. Explainer | Done: entry points, call/reply walk, animated playback that frames and follows the flow, template or AI narration, saved flows, numbered steps. |
| 4. Export + idea → architecture | Done: draw.io (icons in zone containers), Mermaid, PNG (2×), SVG, JSON export; draw.io, docker-compose and JSON import; idea → graph → zoned ELK layout. |
| 5. GitHub | Started: docker-compose topology parser only. Not built yet: GitHub App, Kubernetes/Terraform parsers, Python/FastAPI code parser, drift detection, PR comment. |
| 6. Multiplayer + shared AI | Done: Hocuspocus sync, presence cursors, one room AI thread that can edit the board, shared findings. No auth yet: anyone with a board link can edit. |
