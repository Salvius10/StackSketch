"use client";

import type { ChatMessage } from "@stacksketch/graph";
import { useEffect, useRef, useState } from "react";

interface Props {
  messages: ChatMessage[];
  status: { state: "idle" | "thinking" } | null;
  llmAvailable: boolean;
  meName: string;
  onSend: (text: string, askAi: boolean) => void;
}

export function ChatPanel({ messages, status, llmAvailable, meName, onSend }: Props) {
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

  return (
    <div className="panel-body chat">
      <p className="fine">
        One thread for the whole room. The AI reads the same graph and findings everyone sees.
      </p>
      <div className="chat-list">
        {messages.length === 0 && <p className="empty">No messages yet. Ask the AI why a finding matters, or how a flow should work.</p>}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}${m.author === meName ? " mine" : ""}`}>
            <div className="msg-author">
              {m.author}
              {m.status === "pending" && <span className="fine"> · waiting for AI</span>}
            </div>
            <div className="msg-text">{m.text}</div>
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
