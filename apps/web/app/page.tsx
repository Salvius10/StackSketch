"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { type RecentBoard, newBoardId, recentBoards } from "@/lib/identity";

export default function Home() {
  const router = useRouter();
  const [boards, setBoards] = useState<RecentBoard[]>([]);
  const [code, setCode] = useState("");

  useEffect(() => setBoards(recentBoards()), []);

  return (
    <main className="home">
      <section className="home-hero">
        <h1>
          <span className="brand-mark">◇</span> StackSketch
        </h1>
        <p className="lede">
          Sketch an architecture with your team. A live reviewer flags real design flaws while you draw, and the flow explainer walks a request
          through the system hop by hop.
        </p>
        <div className="row">
          <button className="btn primary large" onClick={() => router.push(`/b/${newBoardId()}`)}>
            New board
          </button>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              const id = code.trim().split("/").pop() ?? "";
              if (/^[A-Za-z0-9_-]{1,64}$/.test(id)) router.push(`/b/${id}`);
            }}
          >
            <input className="input" placeholder="Board link or code" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Board link or code" />
            <button className="btn" type="submit">
              Open
            </button>
          </form>
        </div>
      </section>

      <section className="home-grid">
        <div className="home-card">
          <h3>Draw</h3>
          <p>Pick a typed component or sketch a box: it snaps to a shape. Solid arrows are sync calls, dashed are async, dotted are streams.</p>
        </div>
        <div className="home-card">
          <h3>Get reviewed</h3>
          <p>Rule checks run a moment after you stop editing, then the AI rewrites them for your design. When it needs a fact, it asks.</p>
        </div>
        <div className="home-card">
          <h3>Explain flows</h3>
          <p>Select a component, pick a request like POST /checkout, and watch it travel the graph with one line of narration per hop.</p>
        </div>
        <div className="home-card">
          <h3>Take it anywhere</h3>
          <p>Export to draw.io, Mermaid, PNG, SVG or graph JSON. Import draw.io files and docker-compose topologies.</p>
        </div>
      </section>

      {boards.length > 0 && (
        <section className="home-recent">
          <h2>Your recent boards</h2>
          <ul>
            {boards.map((b) => (
              <li key={b.id}>
                <Link href={`/b/${b.id}`}>{b.name || b.id}</Link>
                <span className="fine"> · opened {new Date(b.openedAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
