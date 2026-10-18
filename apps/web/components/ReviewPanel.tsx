"use client";

import type { DeriveIssue, Finding, Graph, Question, ReviewerStatus, Vote } from "@stacksketch/graph";
import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  graph: Graph;
  findings: Finding[];
  questions: Question[];
  issues: DeriveIssue[];
  votes: Vote[];
  reviewer: ReviewerStatus | null;
  meId: string;
  llmAvailable: boolean;
  focusCanvasId: string | null;
  onAnswer: (q: Question, value: boolean | number | string) => void;
  onDismiss: (q: Question) => void;
  onVote: (findingId: string, vote: Vote["vote"]) => void;
  onFocus: (canvasId: string | null) => void;
  onReveal: (canvasId: string) => void;
}

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

export function ReviewerBadge({ reviewer, llmAvailable }: { reviewer: ReviewerStatus | null; llmAvailable: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);
  if (!reviewer) return <span className="status-pill">Reviewer waiting for the first change</span>;
  const label =
    reviewer.state === "running"
      ? "Checking rules…"
      : reviewer.state === "refining"
        ? "AI reviewing…"
        : reviewer.state === "error"
          ? "Reviewer error"
          : `Reviewed ${ago(reviewer.at)}`;
  return (
    <span className={`status-pill st-${reviewer.state}`} title={reviewer.error ?? undefined}>
      {(reviewer.state === "running" || reviewer.state === "refining") && <span className="spinner" />}
      {label}
      <span className="muted"> · {llmAvailable ? "rules + AI" : "rules only"}</span>
    </span>
  );
}

function QuestionCard({ q, onAnswer, onDismiss, onFocus }: { q: Question; onAnswer: Props["onAnswer"]; onDismiss: Props["onDismiss"]; onFocus: Props["onFocus"] }) {
  const [value, setValue] = useState("");
  const submit = () => {
    if (q.answer_type === "number") {
      const n = Number(value);
      if (value.trim() === "" || Number.isNaN(n) || n < 0) return;
      onAnswer(q, Math.round(n));
    } else if (value.trim()) onAnswer(q, value.trim());
  };
  return (
    <div className="card question-card" onMouseEnter={() => onFocus(q.canvas_id)} onMouseLeave={() => onFocus(null)}>
      <div className="q-prompt">{q.prompt}</div>
      <div className="q-actions">
        {q.answer_type === "boolean" ? (
          <>
            <button className="btn small" onClick={() => onAnswer(q, true)}>Yes</button>
            <button className="btn small" onClick={() => onAnswer(q, false)}>No</button>
          </>
        ) : (
          <form
            className="q-form"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              className="input small"
              inputMode={q.answer_type === "number" ? "numeric" : "text"}
              placeholder={q.unit ?? "answer"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label={q.prompt}
            />
            <button className="btn small" type="submit">Save</button>
          </form>
        )}
        <button className="btn small ghost" onClick={() => onDismiss(q)} title="Stop asking this">
          Skip
        </button>
      </div>
      <div className="fine">Unblocks the {q.blocks} check</div>
    </div>
  );
}

export function ReviewPanel(props: Props) {
  const { graph, findings, questions, issues, votes, meId, focusCanvasId, onVote, onFocus, onReveal } = props;
  const listRef = useRef<HTMLDivElement>(null);

  const tally = useMemo(() => {
    const t = new Map<string, { useful: number; not_useful: number; mine?: Vote["vote"] }>();
    for (const v of votes) {
      const cur = t.get(v.finding) ?? { useful: 0, not_useful: 0 };
      cur[v.vote] += 1;
      if (v.user === meId) cur.mine = v.vote;
      t.set(v.finding, cur);
    }
    return t;
  }, [votes, meId]);

  const muted = (f: Finding) => {
    const t = tally.get(f.id);
    return !!t && t.not_useful > t.useful;
  };
  const visible = findings.filter((f) => !muted(f));
  const hidden = findings.filter(muted);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of graph.nodes) m.set(n.id, n.label);
    for (const e of graph.edges) m.set(e.id, `${m.get(e.from) ?? e.from} → ${m.get(e.to) ?? e.to}`);
    return m;
  }, [graph]);

  useEffect(() => {
    if (!focusCanvasId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-canvas="${CSS.escape(focusCanvasId)}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusCanvasId]);

  const renderFinding = (f: Finding) => {
    const t = tally.get(f.id);
    return (
      <div
        key={f.id}
        data-canvas={f.canvas_id ?? ""}
        className={`card finding sev-${f.severity}${f.canvas_id && f.canvas_id === focusCanvasId ? " focused" : ""}`}
        onMouseEnter={() => onFocus(f.canvas_id)}
        onMouseLeave={() => onFocus(null)}
      >
        <div className="finding-head">
          <span className={`sev-dot sev-${f.severity}`} aria-label={f.severity} />
          <span className="finding-title">{f.title}</span>
        </div>
        <button className="finding-target" onClick={() => f.canvas_id && onReveal(f.canvas_id)} title="Show on the canvas">
          {names.get(f.target) ?? f.target}
        </button>
        <p className="finding-msg">{f.message}</p>
        <p className="finding-fix">
          <strong>Fix:</strong> {f.fix}
        </p>
        <div className="finding-foot">
          <span className="tag" title={f.origin === "llm" ? "Judgement call by the AI layer" : `Deterministic rule${f.refined ? ", worded by the AI layer" : ""}`}>
            {f.origin === "llm" ? "AI judgement" : f.rule}
            {f.origin === "rule" && f.refined ? " · AI-worded" : ""}
          </span>
          <span className="votes">
            <button className={`vote${t?.mine === "useful" ? " on" : ""}`} onClick={() => onVote(f.id, "useful")} title="Useful">
              👍 {t?.useful ?? 0}
            </button>
            <button className={`vote${t?.mine === "not_useful" ? " on" : ""}`} onClick={() => onVote(f.id, "not_useful")} title="Not useful: hide it and steer the AI away from advice like this">
              👎 {t?.not_useful ?? 0}
            </button>
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="panel-body" ref={listRef}>
      {questions.length > 0 && (
        <section>
          <h3 className="section-title">Questions ({questions.length})</h3>
          <p className="fine">The reviewer needs these to finish a check. It never guesses.</p>
          {questions.map((q) => (
            <QuestionCard key={q.id} q={q} onAnswer={props.onAnswer} onDismiss={props.onDismiss} onFocus={onFocus} />
          ))}
        </section>
      )}

      <section>
        <h3 className="section-title">Findings ({visible.length})</h3>
        {graph.nodes.length === 0 ? (
          <p className="empty">Draw a few components and connect them. The reviewer checks the design a moment after you stop editing.</p>
        ) : visible.length === 0 ? (
          <p className="empty">No design flaws found by the current checks{questions.length ? " (answer the questions above to finish them)" : ""}.</p>
        ) : (
          visible.map(renderFinding)
        )}
      </section>

      {issues.length > 0 && (
        <section>
          <h3 className="section-title">Drawing notes ({issues.length})</h3>
          {issues.map((i) => (
            <button key={i.canvas_id} className="card issue" onClick={() => onReveal(i.canvas_id)}>
              {i.message}
            </button>
          ))}
        </section>
      )}

      {hidden.length > 0 && (
        <details className="hidden-findings">
          <summary>Voted not useful ({hidden.length})</summary>
          {hidden.map(renderFinding)}
        </details>
      )}
    </div>
  );
}
