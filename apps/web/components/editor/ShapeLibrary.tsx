"use client";

// The left sidebar, as in draw.io: search, a scratchpad of your own pieces, then
// the shape libraries you've switched on. Drag a shape onto the canvas, or click
// it to add it in the middle of the view; a connector style applies to the
// connectors you draw next. "+ More Shapes" switches libraries on and off.

import { type Diagram, INK, lookOf } from "@stacksketch/graph";
import { useEffect, useMemo, useState } from "react";
import {
  DRAG_MIME,
  LIBRARIES,
  type Library,
  type LibraryItem,
  SCRATCH_MIME,
  componentIcon,
  isOutlineIcon,
  itemPreview,
  searchLibraries,
} from "@/lib/library";
import { diagramToSvgDataUrl } from "@/lib/render-svg";

export interface ScratchEntry {
  id: string;
  name: string;
  clip: Diagram;
}

const SCRATCH_KEY = "stacksketch.scratchpad";
const SCRATCH_MAX = 30;

function loadScratch(): ScratchEntry[] {
  try {
    const raw = localStorage.getItem(SCRATCH_KEY);
    const list = raw ? (JSON.parse(raw) as ScratchEntry[]) : [];
    return Array.isArray(list) ? list.filter((e) => e && Array.isArray(e.clip?.nodes)) : [];
  } catch {
    return [];
  }
}

function saveScratch(list: ScratchEntry[]) {
  try {
    localStorage.setItem(SCRATCH_KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked: the scratchpad lasts this session */
  }
}

/** A library item's picture in the sidebar. */
export function ItemTile({ item }: { item: LibraryItem }) {
  if (item.kind === "component") {
    return <img src={componentIcon(item)} alt="" draggable={false} className={`ss-tile-icon${isOutlineIcon(item) ? " outline" : ""}`} />;
  }
  if (item.kind === "note") return <span className="ss-lib-note">Aa</span>;
  if (item.kind === "shape" && item.shape === "text") {
    const look = lookOf(item.style, null);
    return (
      <span
        className="ss-thumb-text"
        style={{ fontWeight: look.bold ? 700 : 400, textDecoration: look.underline ? "underline" : "none", color: look.fontColor !== INK ? look.fontColor : undefined }}
      >
        {item.label.split("\n")[0] || "Text"}
      </span>
    );
  }
  const svg = itemPreview(item);
  return svg ? <span className="ss-thumb-box" dangerouslySetInnerHTML={{ __html: svg }} /> : null;
}

/** Libraries of icons read better with names under them. */
const labelled = (lib: Library) => lib.items.filter((i) => i.kind === "component").length > lib.items.length / 2;

function Grid({ items, named, onAdd }: { items: LibraryItem[]; named: boolean; onAdd: (item: LibraryItem) => void }) {
  return (
    <div className={`ss-library-grid${named ? " named" : ""}`}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className="ss-library-item"
          draggable
          title={item.kind === "connector" ? `${item.name}: click to use for new connectors` : `${item.name}: drag onto the canvas, or click to add`}
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_MIME, item.key);
            e.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => onAdd(item)}
        >
          <ItemTile item={item} />
          {named && <span className="ss-library-name">{item.name}</span>}
        </button>
      ))}
    </div>
  );
}

function Section({ title, open, onToggle, extra, children }: { title: string; open: boolean; onToggle: () => void; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="ss-library-head">
        <button type="button" className="ss-library-title" aria-expanded={open} onClick={onToggle}>
          <span className={`ss-caret${open ? " open" : ""}`}>▸</span> {title}
        </button>
        {extra}
      </div>
      {open && children}
    </section>
  );
}

export function ShapeLibrary({
  enabled,
  onAdd,
  selectionClip,
  onInsertClip,
  onMoreShapes,
  onTemplates,
}: {
  /** Library ids to show, in order. */
  enabled: string[];
  onAdd: (item: LibraryItem) => void;
  /** The selection, to keep in the scratchpad. */
  selectionClip: () => Diagram | null;
  onInsertClip: (clip: Diagram) => void;
  onMoreShapes: () => void;
  onTemplates: () => void;
}) {
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set(["scratchpad"]));
  const [scratch, setScratch] = useState<ScratchEntry[]>([]);
  useEffect(() => setScratch(loadScratch()), []);
  const q = query.trim();
  const results = useMemo(() => (q ? searchLibraries(q) : []), [q]);
  const libraries = enabled.map((id) => LIBRARIES.find((l) => l.id === id)).filter((l): l is Library => !!l);
  const toggle = (id: string) =>
    setClosed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const keepSelection = () => {
    const clip = selectionClip();
    if (!clip || clip.nodes.length === 0) return;
    const name = clip.nodes.map((n) => n.label.split("\n")[0]).find(Boolean) ?? "Shapes";
    const next = [{ id: `${Date.now().toString(36)}`, name: clip.nodes.length > 1 ? `${name} +${clip.nodes.length - 1}` : name, clip }, ...scratch].slice(0, SCRATCH_MAX);
    setScratch(next);
    saveScratch(next);
    setClosed((s) => {
      const n = new Set(s);
      n.delete("scratchpad");
      return n;
    });
  };
  const forget = (id: string) => {
    const next = scratch.filter((e) => e.id !== id);
    setScratch(next);
    saveScratch(next);
  };

  return (
    <aside className="ss-library" aria-label="Shapes">
      <div className="ss-library-search">
        <input
          className="input small"
          placeholder="Search shapes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") setQuery("");
          }}
          aria-label="Search shapes"
        />
      </div>
      <div className="ss-library-groups">
        {q ? (
          results.length ? (
            <Section title={`Results (${results.length})`} open onToggle={() => setQuery("")}>
              <Grid items={results} named={false} onAdd={onAdd} />
            </Section>
          ) : (
            <p className="ss-library-empty">No shapes match “{query}”. Search looks in every library, switched on or not.</p>
          )
        ) : (
          <>
            <Section
              title="Scratchpad"
              open={!closed.has("scratchpad")}
              onToggle={() => toggle("scratchpad")}
              extra={
                <button type="button" className="ss-library-add" title="Keep the selection here, to reuse on any board" onClick={keepSelection}>
                  +
                </button>
              }
            >
              {scratch.length === 0 ? (
                <p className="ss-library-empty">Select shapes and click + to keep them here for any board.</p>
              ) : (
                <div className="ss-library-grid named">
                  {scratch.map((entry) => (
                    <div key={entry.id} className="ss-scratch">
                      <button
                        type="button"
                        className="ss-library-item"
                        draggable
                        title={`${entry.name}: drag onto the canvas, or click to add`}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(SCRATCH_MIME, JSON.stringify(entry.clip));
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => onInsertClip(entry.clip)}
                      >
                        <ScratchThumb entry={entry} />
                        <span className="ss-library-name">{entry.name}</span>
                      </button>
                      <button type="button" className="ss-scratch-remove" title="Remove from the scratchpad" onClick={() => forget(entry.id)}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Section>
            {libraries.map((lib) => (
              <Section key={lib.id} title={lib.title} open={!closed.has(lib.id)} onToggle={() => toggle(lib.id)}>
                <Grid items={lib.items} named={labelled(lib)} onAdd={onAdd} />
              </Section>
            ))}
          </>
        )}
      </div>
      <div className="ss-library-foot">
        <button type="button" className="btn small" onClick={onMoreShapes}>
          + More Shapes
        </button>
        <button type="button" className="btn small" onClick={onTemplates}>
          Templates
        </button>
      </div>
    </aside>
  );
}

const thumbs = new Map<string, string>();

function ScratchThumb({ entry }: { entry: ScratchEntry }) {
  let url = thumbs.get(entry.id);
  if (!url) {
    url = diagramToSvgDataUrl(entry.clip);
    thumbs.set(entry.id, url);
  }
  return <img src={url} alt="" draggable={false} className="ss-tile-icon scratch" />;
}
