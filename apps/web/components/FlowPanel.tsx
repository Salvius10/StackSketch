"use client";

import { type Flow, type Graph, type GraphNode, META_KEY } from "@stacksketch/graph";
import { useEffect, useState } from "react";
import { type EntryPoint, api } from "@/lib/api";
import { useView } from "@/lib/viewStore";

export interface Player {
  flow: Flow;
  index: number;
  playing: boolean;
}

interface Props {
  graph: Graph;
  selectedNode: GraphNode | null;
  flows: Flow[];
  llmAvailable: boolean;
  player: Player | null;
  onExplain: (node: GraphNode, entry: EntryPoint, narrate: boolean) => Promise<void>;
  onPlay: (flow: Flow) => void;
  onStep: (delta: number) => void;
  onToggle: () => void;
  onStop: () => void;
  onNumber: (flow: Flow) => void;
  onClearNumbers: () => void;
}

export function FlowPanel({
  graph,
  selectedNode,
  flows,
  llmAvailable,
  player,
  onExplain,
  onPlay,
  onStep,
  onToggle,
  onStop,
  onNumber,
  onClearNumbers,
}: Props) {
  const view = useView();
  const numbered = [...view.elements.values()].some((e) => (e.customData?.[META_KEY] as { role?: string } | undefined)?.role === "step");
  const [entries, setEntries] = useState<EntryPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [narrate, setNarrate] = useState(false);
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

  const name = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <div className="panel-body">
      {player ? (
        <section>
          <h3 className="section-title">{player.flow.entry}</h3>
          <p className="fine">{player.flow.summary}</p>
          <div className="player-controls">
            <button className="btn small" onClick={() => onStep(-1)} disabled={player.index <= 0}>
              ◀ Back
            </button>
            <button className="btn small primary" onClick={onToggle}>
              {player.playing ? "Pause" : player.index >= player.flow.steps.length - 1 ? "Replay" : "Play"}
            </button>
            <button className="btn small" onClick={() => onStep(1)} disabled={player.index >= player.flow.steps.length - 1}>
              Next ▶
            </button>
            <button className="btn small ghost" onClick={onStop}>
              Close
            </button>
          </div>
          <ol className="steps">
            {player.flow.steps.map((s, i) => (
              <li
                key={i}
                className={`step step-${s.kind} step-${s.phase}${i === player.index ? " current" : ""}${i < player.index ? " done" : ""}`}
                style={{ paddingLeft: 8 + s.depth * 12 }}
              >
                <span className="step-kind">{s.phase === "return" ? "↩" : s.kind === "sync" ? "→" : s.kind === "async" ? "⇢" : "⇉"}</span>
                <span>{s.narration}</span>
              </li>
            ))}
          </ol>
          <div className="player-controls">
            <button className="btn small" onClick={() => onNumber(player.flow)} title="Numbered badges on the arrows, and the steps listed beside the diagram">
              Number steps on diagram
            </button>
            {numbered && (
              <button className="btn small ghost" onClick={onClearNumbers}>
                Clear numbers
              </button>
            )}
          </div>
        </section>
      ) : (
        <section>
          <h3 className="section-title">Explain a request flow</h3>
          {!selectedNode ? (
            <p className="empty">Select a component on the canvas, then pick the request to follow, for example POST /checkout.</p>
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
                    className="btn entry"
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
                    {busy === e.id ? <span className="spinner" /> : "▶"} {e.label}
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
      )}

      {flows.length > 0 && (
        <section>
          <h3 className="section-title">Saved flows</h3>
          {flows.slice(0, 12).map((f) => (
            <button key={f.id} className="card flow-card" onClick={() => onPlay(f)}>
              <strong>{f.entry}</strong>
              <span className="fine">
                via {name(f.node_id)} · {f.steps.filter((s) => s.phase === "call").length} hops · by {f.created_by}
              </span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
