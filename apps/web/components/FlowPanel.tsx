"use client";

import type { Flow, FlowStep, Graph, GraphNode } from "@stacksketch/graph";
import { useEffect, useRef, useState } from "react";
import { type EntryPoint, api } from "@/lib/api";
import { SPEEDS, TONES, type Tone, flowStats, toneOf } from "@/lib/flow-view";

export interface Player {
  flow: Flow;
  index: number;
  playing: boolean;
}

interface Controls {
  onStep: (delta: number) => void;
  onJump: (index: number) => void;
  onToggle: () => void;
  onStop: () => void;
}

interface Props extends Controls {
  graph: Graph;
  selectedNode: GraphNode | null;
  flows: Flow[];
  llmAvailable: boolean;
  player: Player | null;
  speed: number;
  /** Whether a flow is numbered on the diagram right now. */
  numbered: boolean;
  onSpeed: (speed: number) => void;
  onExplain: (node: GraphNode, entry: EntryPoint, narrate: boolean) => Promise<void>;
  onPlay: (flow: Flow) => void;
  onNumber: (flow: Flow) => void;
  onClearNumbers: () => void;
}

/** Where a step leaves from and arrives at: a reply travels from callee to caller. */
const route = (s: FlowStep) => (s.phase === "return" ? [s.to, s.from] : [s.from, s.to]);

const ICONS = {
  prev: "M6 5h2v14H6zM20 5v14L9 12z",
  next: "M16 5h2v14h-2zM4 5l11 7-11 7z",
  play: "M8 5v14l11-7z",
  pause: "M7 5h4v14H7zM13 5h4v14h-4z",
  replay: "M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z",
  close: "M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z",
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d={ICONS[name]} fill="currentColor" />
    </svg>
  );
}

/** One coloured segment per step; with `onJump`, click one to go there. */
export function StepBar({ steps, index, onJump }: { steps: FlowStep[]; index?: number; onJump?: (i: number) => void }) {
  return (
    <div className={`flow-bar${onJump ? "" : " still"}`}>
      {steps.map((s, i) => {
        const cls = `flow-bar-seg tone-${toneOf(s)}${index === undefined || i < index ? " done" : ""}${i === index ? " current" : ""}`;
        return onJump ? (
          <button key={i} type="button" className={cls} onClick={() => onJump(i)} title={`${i + 1}. ${s.narration}`} aria-label={`Go to step ${i + 1}`} />
        ) : (
          <span key={i} className={cls} />
        );
      })}
    </div>
  );
}

function Legend({ tones }: { tones: Set<Tone> }) {
  return (
    <div className="flow-legend">
      {(["sync", "async", "stream", "return"] as Tone[])
        .filter((t) => tones.has(t))
        .map((t) => (
          <span key={t} className={`flow-legend-item tone-${t}`}>
            <i />
            {TONES[t].name} <span>{TONES[t].how}</span>
          </span>
        ))}
    </div>
  );
}

/** The playback card on the canvas: where the request is going now, what happens, and the controls. */
export function FlowCaption({
  flow,
  index,
  playing,
  describe,
  onStep,
  onJump,
  onToggle,
  onStop,
}: Controls & { flow: Flow; index: number; playing: boolean; describe: (graphId: string) => { label: string; icon: string | null } }) {
  const step = flow.steps[index];
  const tone = toneOf(step);
  const [from, to] = route(step).map(describe);
  const last = flow.steps.length - 1;
  return (
    <div className={`flow-stage tone-${tone}`} role="region" aria-label="Request flow" aria-live="polite">
      <div className="flow-stage-top">
        <span className="flow-stage-count">
          Step <b>{index + 1}</b> of {flow.steps.length}
        </span>
        <span className="flow-stage-entry" title={flow.entry}>
          {flow.entry}
        </span>
        <div className="flow-stage-buttons">
          <button type="button" className="flow-ctl" onClick={() => onStep(-1)} disabled={index <= 0} title="Previous step" aria-label="Previous step">
            <Icon name="prev" />
          </button>
          <button type="button" className="flow-ctl main" onClick={onToggle} title={playing ? "Pause" : index >= last ? "Play again" : "Play"} aria-label={playing ? "Pause" : "Play"}>
            <Icon name={playing ? "pause" : index >= last ? "replay" : "play"} />
          </button>
          <button type="button" className="flow-ctl" onClick={() => onStep(1)} disabled={index >= last} title="Next step" aria-label="Next step">
            <Icon name="next" />
          </button>
          <button type="button" className="flow-ctl" onClick={onStop} title="Stop and close" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
      </div>
      <div className="flow-hop">
        <Endpoint {...from} />
        <div className={`flow-wire wire-${tone}`} aria-hidden="true">
          <span className="flow-wire-pill">
            {TONES[tone].name} · {TONES[tone].how}
          </span>
          <span className="flow-wire-line">
            <i key={`${flow.id}-${index}`} />
          </span>
        </div>
        <Endpoint {...to} />
      </div>
      <p className="flow-stage-text">{step.narration}</p>
      <StepBar steps={flow.steps} index={index} onJump={onJump} />
    </div>
  );
}

function Endpoint({ label, icon }: { label: string; icon: string | null }) {
  return (
    <div className="flow-end">
      {icon ? <img src={icon} alt="" width={32} height={32} draggable={false} /> : <span className="flow-end-dot" />}
      <span>{label}</span>
    </div>
  );
}

export function FlowPanel({
  graph,
  selectedNode,
  flows,
  llmAvailable,
  player,
  speed,
  numbered,
  onSpeed,
  onExplain,
  onPlay,
  onStep,
  onJump,
  onToggle,
  onStop,
  onNumber,
  onClearNumbers,
}: Props) {
  const [entries, setEntries] = useState<EntryPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [narrate, setNarrate] = useState(false);
  const current = useRef<HTMLLIElement>(null);
  const nodeId = selectedNode?.id ?? null;

  useEffect(() => {
    setEntries(null);
    setError(null);
    if (!nodeId) return;
    let cancelled = false;
    api
      .entries(graph, nodeId)
      .then((r) => !cancelled && setEntries(r.entries))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
    // Re-fetch when the node or the edges around it change, not on every graph tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, JSON.stringify(graph.edges.filter((e) => e.from === nodeId || e.to === nodeId))]);

  // Keep the step that is playing in view in the list.
  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [player?.index, player?.flow.id]);

  const name = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;

  if (player) {
    const { flow, index } = player;
    const stats = flowStats(flow);
    const last = flow.steps.length - 1;
    return (
      <div className="panel-body flow-panel">
        <section className="flow-head">
          <div className="flow-eyebrow">Request flow</div>
          <h3 className="flow-title">{flow.entry}</h3>
          {flow.summary && <p className="fine">{flow.summary}</p>}
          <div className="flow-chips">
            <span className="flow-chip">{stats.components} components</span>
            <span className="flow-chip">{stats.hops} hops</span>
            {stats.waits > 0 && (
              <span className="flow-chip tone-sync">
                <i /> {stats.waits} wait for a reply
              </span>
            )}
            {stats.async > 0 && (
              <span className="flow-chip tone-async">
                <i /> {stats.async} don't wait
              </span>
            )}
          </div>
        </section>

        <div className="flow-player">
          <div className="flow-player-buttons">
            <button type="button" className="flow-ctl" onClick={() => onStep(-1)} disabled={index <= 0} title="Previous step" aria-label="Previous step">
              <Icon name="prev" />
            </button>
            <button type="button" className="flow-ctl main" onClick={onToggle} aria-label={player.playing ? "Pause" : "Play"}>
              <Icon name={player.playing ? "pause" : index >= last ? "replay" : "play"} />
              {player.playing ? "Pause" : index >= last ? "Replay" : "Play"}
            </button>
            <button type="button" className="flow-ctl" onClick={() => onStep(1)} disabled={index >= last} title="Next step" aria-label="Next step">
              <Icon name="next" />
            </button>
            <button type="button" className="flow-ctl" onClick={onStop} title="Stop and close" aria-label="Close">
              <Icon name="close" />
            </button>
          </div>
          <div className="flow-speed" role="group" aria-label="Speed">
            {SPEEDS.map((s) => (
              <button key={s.value} type="button" aria-pressed={speed === s.value} className={speed === s.value ? "on" : undefined} onClick={() => onSpeed(s.value)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <StepBar steps={flow.steps} index={index} onJump={onJump} />
        <Legend tones={new Set(flow.steps.map(toneOf))} />

        <ol className="flow-timeline">
          {flow.steps.map((s, i) => {
            const tone = toneOf(s);
            const [a, b] = route(s);
            return (
              <li
                key={i}
                ref={i === index ? current : undefined}
                className={`flow-tl tone-${tone}${i < index ? " done" : ""}${i === index ? " current" : ""}`}
              >
                <button type="button" onClick={() => onJump(i)}>
                  <span className="flow-tl-n">{i + 1}</span>
                  <span className="flow-tl-body">
                    <span className="flow-tl-route">
                      {name(a)}
                      <span className="flow-tl-arrow">{s.phase === "return" ? "↩" : s.kind === "sync" ? "→" : "⇢"}</span>
                      {name(b)}
                      <span className="flow-tl-tag">{TONES[tone].name}</span>
                    </span>
                    <span className="flow-tl-text">{s.narration}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="flow-number">
          <button type="button" className="btn small" onClick={() => onNumber(flow)} title="Numbered badges on the arrows, and the steps listed beside the diagram">
            Number steps on diagram
          </button>
          {numbered && (
            <button type="button" className="btn small ghost" onClick={onClearNumbers}>
              Clear numbers
            </button>
          )}
        </div>
        <SavedFlows flows={flows} playing={flow.id} name={name} onPlay={onPlay} />
      </div>
    );
  }

  return (
    <div className="panel-body flow-panel">
      <section>
        <h3 className="section-title">Explain a request flow</h3>
        {!selectedNode ? (
          <ol className="flow-how">
            <li>
              <span>1</span>Select a component on the canvas.
            </li>
            <li>
              <span>2</span>Pick a request that comes into it, for example POST /checkout.
            </li>
            <li>
              <span>3</span>
              <span>
                Watch it travel hop by hop: <b className="tone-sync">requests</b>, <b className="tone-async">messages</b> and{" "}
                <b className="tone-return">replies</b> each light up in their own colour.
              </span>
            </li>
          </ol>
        ) : (
          <>
            <p className="fine">
              Requests through <strong>{selectedNode.label}</strong>:
            </p>
            {error && <p className="error">{error}</p>}
            {entries === null && !error && <p className="fine">Loading…</p>}
            {entries?.length === 0 && <p className="empty">Nothing connects to {selectedNode.label} yet. Draw an arrow into it first.</p>}
            <div className="entry-list">
              {entries?.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="flow-entry"
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy(e.id);
                    setError(null);
                    try {
                      await onExplain(selectedNode, e, narrate);
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  <span className="flow-play">{busy === e.id ? <span className="spinner" /> : <Icon name="play" />}</span>
                  {e.label}
                </button>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={narrate} disabled={!llmAvailable} onChange={(e) => setNarrate(e.target.checked)} />
              AI narration {llmAvailable ? "" : "(needs an API key in .env)"}
            </label>
          </>
        )}
      </section>
      <SavedFlows flows={flows} name={name} onPlay={onPlay} />
    </div>
  );
}

function SavedFlows({ flows, playing, name, onPlay }: { flows: Flow[]; playing?: string; name: (id: string) => string; onPlay: (f: Flow) => void }) {
  if (flows.length === 0) return null;
  return (
    <section>
      <h3 className="section-title">Saved flows</h3>
      {flows.slice(0, 12).map((f) => (
        <button key={f.id} type="button" className={`card flow-card${f.id === playing ? " on" : ""}`} onClick={() => onPlay(f)}>
          <span className="flow-play">
            <Icon name="play" />
          </span>
          <span className="flow-card-body">
            <strong>{f.entry}</strong>
            <span className="fine">
              via {name(f.node_id)} · {f.steps.filter((s) => s.phase === "call").length} hops · by {f.created_by}
            </span>
            <StepBar steps={f.steps} />
          </span>
        </button>
      ))}
    </section>
  );
}
