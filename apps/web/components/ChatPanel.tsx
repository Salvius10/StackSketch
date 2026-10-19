"use client";

import type { ChatMessage } from "@stacksketch/graph";
import { useEffect, useRef, useState } from "react";

interface Props {
  messages: ChatMessage[];
  status: { state: "idle" | "thinking" } | null;
  llmAvailable: boolean;
  meName: string;
  /** This browser tab: it applies the edits the AI made for its own messages. */
  tabId: string;
  onSend: (text: string, askAi: boolean) => void;
  onApply: (m: ChatMessage) => void;
  onUndo: (m: ChatMessage) => void;
  onShow: (m: ChatMessage) => void;
}

export function ChatPanel({ messages, status, llmAvailable, meName, tabId, onSend, onApply, onUndo, onShow }: Props) {
  const [text, setText] = useState("");
  const [askAi, setAskAi] = useState(true);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, status?.state]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t, askAi && llmAvailable);
    setText("");
  };

  /** The line under an AI reply that changed the board: what it did, and undo or apply. */
  const edits = (m: ChatMessage) => {
    if (!m.edits || !m.edit_state) return null;
    const mine = messages.find((q) => q.id === m.reply_to)?.tab === tabId;
    switch (m.edit_state) {
      case "proposed":
        return mine ? (
          <div className="msg-edits">
            <span className="spinner" /> Drawing on the board…
          </div>
        ) : (
          <div className="msg-edits">
            <span>Changes for the board</span>
            <button className="btn small" type="button" onClick={() => onApply(m)}>
              Apply
            </button>
          </div>
        );
      case "applied":
        return (
          <div className="msg-edits">
            <span>✓ {m.edit_note}</span>
            <span className="msg-edit-actions">
              {(m.edit_ids?.length ?? 0) > 0 && (
                <button className="btn small ghost" type="button" onClick={() => onShow(m)}>
                  Show
                </button>
              )}
              <button className="btn small" type="button" onClick={() => onUndo(m)}>
                Undo
              </button>
            </span>
          </div>
        );
      case "undone":
        return (
          <div className="msg-edits">
            <span>Undone.</span>
            <button className="btn small" type="button" onClick={() => onApply(m)}>
              Apply again
            </button>
          </div>
        );
      case "failed":
        return (
          <div className="msg-edits failed">
            <span>Could not change the board: {m.edit_note}</span>
            <button className="btn small" type="button" onClick={() => onApply(m)}>
              Try again
            </button>
          </div>
        );
    }
  };

  return (
    <div className="panel-body chat">
      <p className="fine">
        One thread for the whole room. The AI reads the same graph and findings everyone sees, and can change the board when you ask it to.
      </p>
      <div className="chat-list">
        {messages.length === 0 && (
          <p className="empty">
            No messages yet. Ask the AI why a finding matters, or to change the design: &ldquo;add a Redis cache in front of the database&rdquo;, &ldquo;fix the
            findings&rdquo;, &ldquo;draw a serverless image pipeline&rdquo;.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}${m.author === meName ? " mine" : ""}`}>
            <div className="msg-author">
              {m.author}
              {m.status === "pending" && <span className="fine"> · waiting for AI</span>}
            </div>
            <div className="msg-text">{m.text}</div>
            {edits(m)}
            {m.status === "error" && <div className="error">AI could not answer: {m.error}</div>}
          </div>
        ))}
        {status?.state === "thinking" && (
          <div className="msg assistant">
            <div className="msg-author">StackSketch AI</div>
            <div className="msg-text">
              <span className="spinner" /> thinking…
            </div>
          </div>
        )}
        <div ref={end} />
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          className="input"
          rows={2}
          value={text}
          placeholder="Message the room…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="chat-actions">
          <label className="check">
            <input type="checkbox" checked={askAi && llmAvailable} disabled={!llmAvailable} onChange={(e) => setAskAi(e.target.checked)} />
            Ask the AI {llmAvailable ? "" : "(needs an API key in .env)"}
          </label>
          <button className="btn small primary" type="submit">
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
