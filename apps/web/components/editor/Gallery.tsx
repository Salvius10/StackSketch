"use client";

// draw.io's two galleries: "More shapes", to switch shape libraries on and off,
// and the templates, ready-made diagrams to start from.

import { type Diagram, TEMPLATE_CATEGORIES, TEMPLATES, type Template, type TemplateCategory } from "@stacksketch/graph";
import { useEffect, useState } from "react";
import { DEFAULT_LIBRARIES, LIBRARIES, type Library } from "@/lib/library";
import { diagramToSvgDataUrl } from "@/lib/render-svg";
import { Modal } from "../Dialogs";
import { ItemTile } from "./ShapeLibrary";

const GROUPS: Library["group"][] = ["Standard", "Software", "Cloud", "Networking"];

export function MoreShapesDialog({ enabled, onApply, onClose }: { enabled: string[]; onApply: (ids: string[]) => void; onClose: () => void }) {
  const [picked, setPicked] = useState(() => new Set(enabled));
  const [shown, setShown] = useState<string>(enabled.find((id) => !DEFAULT_LIBRARIES.includes(id)) ?? "aws");
  const lib = LIBRARIES.find((l) => l.id === shown) ?? LIBRARIES[0];
  const flip = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <Modal title="Shapes" onClose={onClose} wide>
      <div className="ss-gallery">
        <div className="ss-gallery-list">
          {GROUPS.map((g) => (
            <div key={g}>
              <h3 className="section-title">{g}</h3>
              {LIBRARIES.filter((l) => l.group === g).map((l) => (
                <label key={l.id} className={`ss-gallery-lib${shown === l.id ? " on" : ""}`} onPointerEnter={() => setShown(l.id)} onFocus={() => setShown(l.id)}>
                  <input type="checkbox" checked={picked.has(l.id)} onChange={() => flip(l.id)} />
                  <span>{l.title}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="ss-gallery-preview">
          <h3 className="section-title">{lib.title}</h3>
          <p className="fine">{lib.description}</p>
          <div className="ss-library-grid preview">
            {lib.items.map((item) => (
              <span key={item.key} className="ss-library-item" title={item.name}>
                <ItemTile item={item} />
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={() => setPicked(new Set(DEFAULT_LIBRARIES))}>
          Reset
        </button>
        <span className="spacer" />
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            // Keep the libraries' own order, as draw.io does.
            onApply(LIBRARIES.map((l) => l.id).filter((id) => picked.has(id)));
            onClose();
          }}
        >
          Apply
        </button>
      </div>
    </Modal>
  );
}

// Templates are built once per visit; the graph ones go through the auto layout.
const built = new Map<string, Promise<{ diagram: Diagram; preview: string }>>();

function buildTemplate(t: Template) {
  let p = built.get(t.id);
  if (!p) {
    p = t.build().then((diagram) => ({ diagram, preview: diagramToSvgDataUrl(diagram) }));
    built.set(t.id, p);
  }
  return p;
}

export function TemplatesDialog({ onInsert, onClose }: { onInsert: (diagram: Diagram, template: Template) => void; onClose: () => void }) {
  const [category, setCategory] = useState<TemplateCategory | "All">("All");
  const [picked, setPicked] = useState<string>(TEMPLATES[0].id);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    for (const t of TEMPLATES) {
      buildTemplate(t).then(
        (b) => live && setPreviews((p) => ({ ...p, [t.id]: b.preview })),
        (err: Error) => live && setError(`${t.name}: ${err.message}`),
      );
    }
    return () => {
      live = false;
    };
  }, []);
  const shown = TEMPLATES.filter((t) => category === "All" || t.category === category);
  const insert = async (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    try {
      onInsert((await buildTemplate(t)).diagram, t);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Modal title="Templates" onClose={onClose} wide>
      <div className="ss-gallery">
        <div className="ss-gallery-list">
          {(["All", ...TEMPLATE_CATEGORIES] as const).map((c) => (
            <button key={c} type="button" className={`ss-gallery-cat${category === c ? " on" : ""}`} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="ss-template-grid">
          {shown.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`ss-template${picked === t.id ? " on" : ""}`}
              onClick={() => setPicked(t.id)}
              onDoubleClick={() => void insert(t.id)}
              title={t.description}
            >
              <span className="ss-template-preview">{previews[t.id] ? <img src={previews[t.id]} alt="" /> : <span className="fine">Drawing…</span>}</span>
              <span className="ss-template-name">{t.name}</span>
              <span className="ss-template-desc">{t.description}</span>
            </button>
          ))}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="modal-actions">
        <span className="fine">Inserted beside what’s already on the board; Ctrl+Z takes it out again.</span>
        <span className="spacer" />
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={() => void insert(picked)}>
          Insert
        </button>
      </div>
    </Modal>
  );
}
