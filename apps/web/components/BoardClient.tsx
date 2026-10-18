"use client";

import dynamic from "next/dynamic";

// Excalidraw touches window on import, so the board only renders in the browser.
const Board = dynamic(() => import("./Board"), {
  ssr: false,
  loading: () => <div className="loading-screen">Loading board…</div>,
});

export function BoardClient({ boardId }: { boardId: string }) {
  return <Board boardId={boardId} />;
}
