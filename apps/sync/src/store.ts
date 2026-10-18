// Persistence for Yjs documents and a log of reviews (graph snapshot +
// findings each time the reviewer runs), in SQLite via node:sqlite.
// The review log is what drift detection and the "useful" metric read later.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Finding, Graph, Question } from "@stacksketch/graph";

export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS documents (
        name TEXT PRIMARY KEY,
        data BLOB NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc TEXT NOT NULL,
        at INTEGER NOT NULL,
        llm INTEGER NOT NULL,
        graph TEXT NOT NULL,
        findings TEXT NOT NULL,
        questions TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reviews_doc_at ON reviews (doc, at);
    `);
  }

  load(name: string): Uint8Array | null {
    const row = this.db.prepare("SELECT data FROM documents WHERE name = ?").get(name) as { data: Uint8Array } | undefined;
    return row ? new Uint8Array(row.data) : null;
  }

  save(name: string, state: Uint8Array): void {
    this.db
      .prepare(
        "INSERT INTO documents (name, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
      )
      .run(name, state, Date.now());
  }

  logReview(doc: string, llm: boolean, graph: Graph, findings: Finding[], questions: Question[]): void {
    this.db
      .prepare("INSERT INTO reviews (doc, at, llm, graph, findings, questions) VALUES (?, ?, ?, ?, ?, ?)")
      .run(doc, Date.now(), llm ? 1 : 0, JSON.stringify(graph), JSON.stringify(findings), JSON.stringify(questions));
  }

  reviewCount(doc: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE doc = ?").get(doc) as { n: number };
    return row.n;
  }

  documents(): { name: string; updated_at: number }[] {
    return this.db.prepare("SELECT name, updated_at FROM documents ORDER BY updated_at DESC LIMIT 200").all() as {
      name: string;
      updated_at: number;
    }[];
  }
}
