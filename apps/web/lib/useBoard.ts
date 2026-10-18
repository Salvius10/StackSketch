"use client";

// One board = one Yjs document served by the sync server. This hook owns the
// connection and exposes the parts of the document the UI renders.

import { HocuspocusProvider } from "@hocuspocus/provider";
import {
  type ChatMessage,
  type DeriveIssue,
  type Finding,
  type Flow,
  type Graph,
  type Question,
  type ReviewerStatus,
  type Vote,
  KEYS,
  chatArray,
  dismissedMap,
  flowsMap,
  metaMap,
  readFindings,
  readGraph,
  readIssues,
  readQuestions,
  readReviewerStatus,
  votesMap,
} from "@stacksketch/graph";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import type { Identity } from "./identity";

export const SYNC_URL = process.env.NEXT_PUBLIC_SYNC_URL ?? "ws://localhost:1234";

export interface Peer {
  clientId: number;
  user: Identity;
  /** Pointer position on the canvas (diagram coordinates). */
  pointer?: { x: number; y: number } | null;
  /** Ids of the components, zones and connectors they have selected. */
  selection?: string[];
}

export interface BoardState {
  graph: Graph;
  findings: Finding[];
  questions: Question[];
  issues: DeriveIssue[];
  votes: Vote[];
  dismissed: string[];
  flows: Flow[];
  chat: ChatMessage[];
  reviewer: ReviewerStatus | null;
  chatStatus: { state: "idle" | "thinking"; replying_to?: string } | null;
  name: string;
}

// The diagram itself is mirrored separately (lib/diagram.ts); this is everything around it.
const WATCHED = [KEYS.nodes, KEYS.edges, KEYS.findings, KEYS.questions, KEYS.votes, KEYS.dismissed, KEYS.flows, KEYS.chat, KEYS.meta];

function snapshot(doc: Y.Doc): BoardState {
  const meta = metaMap(doc);
  return {
    graph: readGraph(doc),
    findings: readFindings(doc),
    questions: readQuestions(doc),
    issues: readIssues(doc),
    votes: Array.from(votesMap(doc).values()),
    dismissed: Array.from(dismissedMap(doc).keys()),
    flows: Array.from(flowsMap(doc).values()).sort((a, b) => b.created_at - a.created_at),
    chat: chatArray(doc).toArray(),
    reviewer: readReviewerStatus(doc),
    chatStatus: (meta.get("chat") as BoardState["chatStatus"]) ?? null,
    name: (meta.get("name") as string | undefined) ?? "",
  };
}

export type Connection = "connecting" | "connected" | "disconnected";

export function useBoard(boardId: string, me: Identity) {
  const doc = useMemo(() => new Y.Doc(), [boardId]);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [state, setState] = useState<BoardState>(() => snapshot(doc));
  const [connection, setConnection] = useState<Connection>("connecting");
  const [synced, setSynced] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const frame = useRef<number | null>(null);
  const meRef = useRef(me);
  meRef.current = me;

  useEffect(() => {
    const p = new HocuspocusProvider({ url: SYNC_URL, name: boardId, document: doc });
    setProvider(p);
    p.on("status", ({ status }: { status: Connection }) => setConnection(status));
    p.on("synced", () => setSynced(true));

    const watched = new Set(WATCHED.map((k) => doc.share.get(k) ?? null));
    const refresh = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setState(snapshot(doc));
      });
    };
    const onTx = (tr: Y.Transaction) => {
      for (const type of tr.changed.keys()) {
        // Shared types are created lazily, so look them up again when unsure.
        if (watched.has(type) || WATCHED.some((k) => doc.share.get(k) === type)) {
          refresh();
          return;
        }
      }
    };
    doc.on("afterTransaction", onTx);

    const awareness = p.awareness!;
    awareness.setLocalStateField("user", meRef.current);
    const onAwareness = () => {
      const list: Peer[] = [];
      awareness.getStates().forEach((s, clientId) => {
        if (clientId === awareness.clientID || !s.user) return;
        list.push({ clientId, ...(s as Omit<Peer, "clientId">) });
      });
      setPeers(list);
    };
    awareness.on("change", onAwareness);

    return () => {
      doc.off("afterTransaction", onTx);
      awareness.off("change", onAwareness);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      p.destroy();
      setProvider(null);
    };
  }, [doc, boardId]);

  // Renaming yourself updates presence without reconnecting.
  useEffect(() => {
    provider?.awareness?.setLocalStateField("user", me);
  }, [provider, me]);

  return { doc, provider, state, connection, synced, peers };
}
