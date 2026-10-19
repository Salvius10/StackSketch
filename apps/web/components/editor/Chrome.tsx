"use client";

// draw.io-style chrome: a menu bar (File, Edit, View, Arrange, AI, Help) and a
// toolbar of the commands used most. Both run the same commands as the keyboard.

import type { ConnectorStyle, EdgeKind, LineStyle } from "@stacksketch/graph";
import { type ReactNode, useEffect, useRef, useState } from "react";

// --- icons ----------------------------------------------------------------------------

const PATHS: Record<string, ReactNode> = {
  library: <path d="M3 3h5v14H3zM10 3h7v6h-7zM10 11h7v6h-7z" />,
  panel: <path d="M3 3h14v14H3zM12 3v14" />,
  undo: <path d="M7 5 3 9l4 4M3 9h9a4 4 0 0 1 0 8h-2" />,
  redo: <path d="m13 5 4 4-4 4M17 9H8a4 4 0 0 0 0 8h2" />,
  zoomIn: <path d="M9 4a5 5 0 1 0 0 10A5 5 0 0 0 9 4zM13 13l4 4M9 7v4M7 9h4" />,
  zoomOut: <path d="M9 4a5 5 0 1 0 0 10A5 5 0 0 0 9 4zM13 13l4 4M7 9h4" />,
  fit: <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" />,
  trash: <path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11" />,
  duplicate: <path d="M7 7h10v10H7zM3 13V3h10" />,
  layout: <path d="M3 4h4v4H3zM13 4h4v4h-4zM8 13h4v4H8zM7 6h6M10 8v5" />,
  zone: <path d="M3 3h14v14H3z" strokeDasharray="3 2" />,
  grid: <path d="M3 3h14v14H3zM3 8h14M3 13h14M8 3v14M13 3v14" />,
  sync: <path d="M2 10h14M13 7l3 3-3 3" />,
  async: <path d="M2 10h3M7 10h3M12 10h4M13 7l3 3-3 3" />,
  stream: <path d="M2 10h1M5 10h1M8 10h1M11 10h1M14 10h2M13 7l3 3-3 3" />,
  orthogonal: <path d="M3 16h7V4h7M14 1l3 3-3 3" />,
  straight: <path d="M3 17 17 3M11 3h6v6" />,
  curved: <path d="M3 17C11 17 9 4 17 4M14 1l3 3-3 3" />,
  templates: <path d="M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z" />,
};

export function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg className="ss-icon-svg" viewBox="0 0 20 20" width="18" height="18" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}

// --- menu bar ---------------------------------------------------------------------------

export type MenuItem =
  | { label: string; shortcut?: string; disabled?: boolean; checked?: boolean; run: () => void }
  | "-";

export function MenuBar({ menus }: { menus: { title: string; items: MenuItem[] }[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <nav className="ss-menubar" ref={bar}>
      {menus.map((m) => (
        <div key={m.title} className="ss-menu-wrap">
          <button
            type="button"
            className={`ss-menu-title${open === m.title ? " on" : ""}`}
            onClick={() => setOpen(open === m.title ? null : m.title)}
            onPointerEnter={() => open && setOpen(m.title)}
          >
            {m.title}
          </button>
          {open === m.title && (
            <div className="ss-menu" role="menu">
              {m.items.map((item, i) =>
                item === "-" ? (
                  <div key={`sep-${i}`} className="ss-menu-sep" />
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    className="ss-menu-item"
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(null);
                      item.run();
                    }}
                  >
                    <span className="ss-menu-check">{item.checked ? "✓" : ""}</span>
                    <span className="ss-menu-label">{item.label}</span>
                    {item.shortcut && <span className="ss-menu-shortcut">{item.shortcut}</span>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

// --- toolbar ----------------------------------------------------------------------------

export interface ToolbarProps {
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  connector: ConnectorStyle;
  grid: boolean;
  libraryOpen: boolean;
  panelOpen: boolean;
  onLibrary(): void;
  onPanel(): void;
  onUndo(): void;
  onRedo(): void;
  onZoomIn(): void;
  onZoomOut(): void;
  onZoomReset(): void;
  onFit(): void;
  onDelete(): void;
  onDuplicate(): void;
  onKind(kind: EdgeKind): void;
  onLine(line: LineStyle): void;
  onTemplates(): void;
  onLayout(): void;
  onZone(): void;
  onGrid(): void;
}

function Tool({ icon, title, onClick, disabled, on }: { icon: keyof typeof PATHS; title: string; onClick: () => void; disabled?: boolean; on?: boolean }) {
  return (
    <button type="button" className={`ss-tool${on ? " on" : ""}`} title={title} aria-label={title} onClick={onClick} disabled={disabled}>
      <Icon name={icon} />
    </button>
  );
}

export function Toolbar(p: ToolbarProps) {
  return (
    <div className="ss-toolbar" role="toolbar">
      <Tool icon="library" title="Shape library" on={p.libraryOpen} onClick={p.onLibrary} />
      <Tool icon="templates" title="Templates" onClick={p.onTemplates} />
      <span className="ss-tool-sep" />
      <Tool icon="undo" title="Undo (Ctrl+Z)" onClick={p.onUndo} disabled={!p.canUndo} />
      <Tool icon="redo" title="Redo (Ctrl+Y)" onClick={p.onRedo} disabled={!p.canRedo} />
      <span className="ss-tool-sep" />
      <Tool icon="zoomOut" title="Zoom out (Ctrl+-)" onClick={p.onZoomOut} />
      <button type="button" className="ss-zoom" title="Actual size (Ctrl+0)" onClick={p.onZoomReset}>
        {Math.round(p.zoom * 100)}%
      </button>
      <Tool icon="zoomIn" title="Zoom in (Ctrl+=)" onClick={p.onZoomIn} />
      <Tool icon="fit" title="Fit the diagram (Ctrl+Shift+H)" onClick={p.onFit} />
      <span className="ss-tool-sep" />
      <Tool icon="trash" title="Delete (Del)" onClick={p.onDelete} disabled={!p.hasSelection} />
      <Tool icon="duplicate" title="Duplicate (Ctrl+D)" onClick={p.onDuplicate} disabled={!p.hasSelection} />
      <span className="ss-tool-sep" />
      <span className="ss-tool-label">Connector</span>
      {(["sync", "async", "stream"] as const).map((k) => (
        <button
          key={k}
          type="button"
          className={`ss-kind${(p.connector.kind ?? "sync") === k ? " on" : ""}`}
          title={k === "sync" ? "Sync: the caller waits for the reply" : k === "async" ? "Async: fire and forget" : "Stream: continuous data"}
          onClick={() => p.onKind(k)}
        >
          <Icon name={k} /> {k}
        </button>
      ))}
      {(["orthogonal", "straight", "curved"] as const).map((l) => (
        <Tool
          key={l}
          icon={l}
          title={l === "orthogonal" ? "Right-angled connectors" : l === "straight" ? "Straight connectors" : "Curved connectors"}
          on={(p.connector.line ?? "orthogonal") === l}
          onClick={() => p.onLine(l)}
        />
      ))}
      <span className="ss-tool-sep" />
      <Tool icon="layout" title="Auto layout (Ctrl+Shift+L)" onClick={p.onLayout} />
      <Tool icon="zone" title="Put the selection in a zone (Ctrl+G)" onClick={p.onZone} disabled={!p.hasSelection} />
      <Tool icon="grid" title="Grid" on={p.grid} onClick={p.onGrid} />
      <span className="ss-spacer" />
      <Tool icon="panel" title="Format panel" on={p.panelOpen} onClick={p.onPanel} />
    </div>
  );
}
