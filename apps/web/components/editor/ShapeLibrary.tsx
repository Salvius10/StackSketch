"use client";

// The left sidebar, as in draw.io: search, then groups of shapes. Drag one onto
// the canvas, or click it to add it in the middle of the view.

import { useState } from "react";
import { DRAG_MIME, LIBRARY, type LibraryItem, itemIcon } from "@/lib/library";

function Glyph({ item }: { item: LibraryItem }) {
  const icon = itemIcon(item);
  if (icon) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt="" width={32} height={32} draggable={false} />;
  }
  if (item.kind === "zone") return <span className={`ss-lib-zone zone-${item.zone}`} />;
  return <span className="ss-lib-note">Aa</span>;
}

export function ShapeLibrary({ onAdd }: { onAdd: (item: LibraryItem) => void }) {
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const q = query.trim().toLowerCase();
  const groups = LIBRARY.map((g) => ({ ...g, items: q ? g.items.filter((i) => i.keywords.includes(q)) : g.items })).filter((g) => g.items.length > 0);

  return (
    <aside className="ss-library" aria-label="Shapes">
      <div className="ss-library-search">
        <input
          className="input small"
          placeholder="Search shapes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label="Search shapes"
        />
      </div>
      <div className="ss-library-groups">
        {groups.map((g) => {
          const open = q !== "" || !closed.has(g.title);
          return (
            <section key={g.title}>
              <button
                type="button"
                className="ss-library-title"
                aria-expanded={open}
                onClick={() =>
                  setClosed((s) => {
                    const next = new Set(s);
                    if (next.has(g.title)) next.delete(g.title);
                    else next.add(g.title);
                    return next;
                  })
                }
              >
                <span className={`ss-caret${open ? " open" : ""}`}>▸</span> {g.title}
              </button>
              {open && (
                <div className="ss-library-grid">
                  {g.items.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className="ss-library-item"
                      draggable
                      title={`${item.label}: drag onto the canvas, or click to add`}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_MIME, item.key);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => onAdd(item)}
                    >
                      <Glyph item={item} />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        {groups.length === 0 && <p className="ss-library-empty">No shapes match “{query}”.</p>}
      </div>
    </aside>
  );
}
