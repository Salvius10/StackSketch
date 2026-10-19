// The shape catalog: every outline the editor draws, as SVG on a w×h box, with
// the draw.io style that draws the same shape, so an export opens in draw.io as
// real, editable shapes. An outline takes its fill and line colour from the group
// it is drawn in; `currentColor` is the line colour, for solid parts such as a
// UML start state.

import { INK } from "./icons";

export interface NodeStyle {
  /** A colour, or "none". */
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dashed?: boolean;
  fontColor?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  opacity?: number;
}

export type Look = Required<NodeStyle>;

export const SHAPE_DEFAULTS: Look = {
  fill: "#FFFFFF",
  stroke: INK,
  strokeWidth: 1.5,
  dashed: false,
  fontColor: INK,
  fontSize: 13,
  bold: false,
  italic: false,
  underline: false,
  align: "center",
  valign: "middle",
  opacity: 1,
};

export interface TextBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Text in rows with lines between: UML classes, entity tables, lists and tables. */
export type RowsKind = "class" | "entity" | "list" | "table";

export interface ShapeDef {
  /** Stable key stored on diagram nodes. */
  key: string;
  name: string;
  /** Default size. */
  w: number;
  h: number;
  /** The outline at w×h. Shapes with rows get their label, to draw the lines between rows. */
  draw(w: number, h: number, label: string): string;
  /** Where the label goes: wrapped inside the shape, under it, or nowhere. */
  label: "inside" | "below" | "none";
  /** The area an inside label wraps in. */
  text(w: number, h: number): TextBox;
  rows?: RowsKind;
  /** draw.io style for the same shape, without colours. Without one, the export embeds the outline as a picture. */
  drawio?: string;
  /** What a new shape starts with, e.g. no outline for text. */
  style?: NodeStyle;
  /** Filled in the line colour (UML start and end states, fork bars). */
  solid?: boolean;
}

// --- geometry helpers ----------------------------------------------------------------------

const r1 = (v: number) => Math.round(v * 10) / 10;
const pt = (x: number, y: number) => `${r1(x)} ${r1(y)}`;
type P = [number, number];
const poly = (pts: P[]) => `<path d="M${pts.map(([x, y]) => pt(x, y)).join("L")}Z"/>`;
const path = (d: string, extra = "") => `<path d="${d}"${extra}/>`;
/** Lines inside a shape: never filled. */
const lines = (d: string, extra = "") => `<path d="${d}" fill="none"${extra}/>`;
const box = (x: number, y: number, w: number, h: number, r = 0, extra = "") =>
  `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(Math.max(w, 0))}" height="${r1(Math.max(h, 0))}"${r ? ` rx="${r1(r)}"` : ""}${extra}/>`;
const oval = (cx: number, cy: number, rx: number, ry: number, extra = "") =>
  `<ellipse cx="${r1(cx)}" cy="${r1(cy)}" rx="${r1(Math.max(rx, 0))}" ry="${r1(Math.max(ry, 0))}"${extra}/>`;
const inset = (w: number, h: number, dx: number, dy: number): TextBox => ({ x: dx, y: dy, w: Math.max(w - 2 * dx, 4), h: Math.max(h - 2 * dy, 4) });
const pad = (w: number, h: number) => inset(w, h, 4, 4);

/** Points on a unit square, stretched to w×h. */
const unit = (pts: P[], w: number, h: number): P[] => pts.map(([x, y]) => [x * w, y * h]);

/** Points fitted to fill w×h exactly, whatever their own extent. */
function fit(pts: P[], w: number, h: number): P[] {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return pts.map(([x, y]) => [((x - x0) / (x1 - x0 || 1)) * w, ((y - y0) / (y1 - y0 || 1)) * h]);
}

function star(points: number, inner: number): P[] {
  return Array.from({ length: points * 2 }, (_, i) => {
    const a = (i * Math.PI) / points - Math.PI / 2;
    const r = i % 2 ? inner : 1;
    return [r * Math.cos(a), r * Math.sin(a)] as P;
  });
}

const PLUS: P[] = [
  [0.35, 0], [0.65, 0], [0.65, 0.35], [1, 0.35], [1, 0.65], [0.65, 0.65],
  [0.65, 1], [0.35, 1], [0.35, 0.65], [0, 0.65], [0, 0.35], [0.35, 0.35],
];
const rotate45 = (pts: P[]): P[] => pts.map(([x, y]) => [0.5 + (x - 0.5 - (y - 0.5)) * Math.SQRT1_2, 0.5 + (x - 0.5 + (y - 0.5)) * Math.SQRT1_2]);

/** A right-pointing block arrow along `len`, `across` thick. */
function arrowPoints(len: number, across: number): P[] {
  const hd = Math.min(len * 0.4, across);
  return [[0, across * 0.3], [len - hd, across * 0.3], [len - hd, 0], [len, across / 2], [len - hd, across], [len - hd, across * 0.7], [0, across * 0.7]];
}

function doubleArrowPoints(len: number, across: number): P[] {
  const hd = Math.min(len * 0.3, across);
  return [[0, across / 2], [hd, 0], [hd, across * 0.3], [len - hd, across * 0.3], [len - hd, 0], [len, across / 2], [len - hd, across], [len - hd, across * 0.7], [hd, across * 0.7], [hd, across]];
}

const QUAD: P[] = (() => {
  const [s, hw, hl] = [0.1, 0.22, 0.22];
  return [
    [0.5, 0], [0.5 + hw, hl], [0.5 + s, hl], [0.5 + s, 0.5 - s], [1 - hl, 0.5 - s], [1 - hl, 0.5 - hw],
    [1, 0.5], [1 - hl, 0.5 + hw], [1 - hl, 0.5 + s], [0.5 + s, 0.5 + s], [0.5 + s, 1 - hl], [0.5 + hw, 1 - hl],
    [0.5, 1], [0.5 - hw, 1 - hl], [0.5 - s, 1 - hl], [0.5 - s, 0.5 + s], [hl, 0.5 + s], [hl, 0.5 + hw],
    [0, 0.5], [hl, 0.5 - hw], [hl, 0.5 - s], [0.5 - s, 0.5 - s], [0.5 - s, hl], [0.5 - hw, hl],
  ];
})();

function documentPath(x: number, y: number, w: number, h: number): string {
  const b = y + h * 0.85;
  return `M${pt(x, y)}H${r1(x + w)}V${r1(b)}C${pt(x + w * 0.8, y + h * 0.7)} ${pt(x + w * 0.65, y + h * 0.75)} ${pt(x + w * 0.5, b)}S${pt(x + w * 0.2, y + h)} ${pt(x, b)}Z`;
}

function cylinderPath(w: number, h: number, ry: number): string {
  return `M0 ${r1(ry)}A${r1(w / 2)} ${r1(ry)} 0 0 1 ${r1(w)} ${r1(ry)}V${r1(h - ry)}A${r1(w / 2)} ${r1(ry)} 0 0 1 0 ${r1(h - ry)}Z`;
}

const diamondPts = (w: number, h: number, d = 0): P[] => [[w / 2, d], [w - d, h / 2], [w / 2, h - d], [d, h / 2]];

// --- rows: classes, entity tables, lists, tables ---------------------------------------------

export const HEAD_H = 26;
export const ROW_H = 20;

export interface RowsLayout {
  /** Title lines, centred in the header. */
  head: string[];
  headH: number;
  /** Each row's text and the top of its line box; entity rows may carry a key ("PK", "FK"). */
  rows: { text: string; key?: string; y: number }[];
  /** Where a line runs across the shape. */
  lines: number[];
  /** The key column's right edge, when an entity table has keys. */
  keyCol?: number;
  /** Height the text needs. */
  height: number;
}

const SEPARATOR = /^\s*-{2,}\s*$/;
const KEY = /^(PK\s*,\s*FK|PK|FK|UK)\s+(.+)$/i;

/** Rows for a class, entity or list: first line(s) the title, the rest one per row. */
export function rowsLayout(kind: RowsKind, label: string): RowsLayout {
  const all = label.split("\n");
  const stereotype = kind === "class" && all.length > 1 && /^\s*(«|<<)/.test(all[0]);
  const head = all.slice(0, stereotype ? 2 : 1);
  const headH = HEAD_H + (head.length - 1) * 15;
  const rows: RowsLayout["rows"] = [];
  const lines = [headH];
  let y = headH + 3;
  for (const raw of all.slice(head.length)) {
    if (kind === "class" && SEPARATOR.test(raw)) {
      lines.push(y + 3);
      y += 6;
      continue;
    }
    const m = kind === "entity" ? KEY.exec(raw.trim()) : null;
    rows.push(m ? { text: m[2], key: m[1].toUpperCase().replace(/\s/g, ""), y } : { text: raw, y });
    y += ROW_H;
  }
  const keyCol = kind === "entity" && rows.some((r) => r.key) ? 44 : undefined;
  return { head, headH, rows, lines, keyCol, height: Math.max(y + 5, headH + 12) };
}

/** A table: one row per line, cells split on "|". */
export function tableLayout(label: string, w: number, h: number): { cells: string[][]; cols: number; rowH: number; colW: number } {
  const cells = label.split("\n").map((l) => l.split("|").map((c) => c.trim()));
  const cols = Math.max(1, ...cells.map((r) => r.length));
  return { cells, cols, rowH: h / Math.max(cells.length, 1), colW: w / cols };
}

function drawRows(kind: RowsKind, w: number, h: number, label: string): string {
  if (kind === "table") {
    const t = tableLayout(label, w, h);
    let d = "";
    for (let i = 1; i < t.cells.length; i++) d += `M0 ${r1(i * t.rowH)}H${r1(w)}`;
    for (let i = 1; i < t.cols; i++) d += `M${r1(i * t.colW)} 0V${r1(h)}`;
    return box(0, 0, w, h) + (d ? lines(d) : "");
  }
  const layout = rowsLayout(kind, label);
  let d = layout.lines.filter((y) => y < h).map((y) => `M0 ${r1(y)}H${r1(w)}`).join("");
  if (layout.keyCol) d += `M${layout.keyCol} ${layout.headH}V${r1(h)}`;
  return box(0, 0, w, h, kind === "entity" ? 3 : 0) + (d ? lines(d) : "");
}

// --- the catalog ---------------------------------------------------------------------------------

type Opts = Partial<Omit<ShapeDef, "key" | "name" | "w" | "h" | "draw">>;

function shape(key: string, name: string, w: number, h: number, draw: ShapeDef["draw"], opts: Opts = {}): ShapeDef {
  return { key, name, w, h, draw, label: "inside", text: pad, ...opts };
}

const fc = (name: string) => `shape=mxgraph.flowchart.${name};whiteSpace=wrap;html=1;`;

export const SHAPES: ShapeDef[] = [
  // General
  shape("rect", "Rectangle", 120, 60, (w, h) => box(0, 0, w, h), { drawio: "rounded=0;whiteSpace=wrap;html=1;" }),
  shape("rounded", "Rounded rectangle", 120, 60, (w, h) => box(0, 0, w, h, Math.min(w, h) * 0.15), { drawio: "rounded=1;whiteSpace=wrap;html=1;" }),
  shape("ellipse", "Ellipse", 120, 80, (w, h) => oval(w / 2, h / 2, w / 2, h / 2), { drawio: "ellipse;whiteSpace=wrap;html=1;", text: (w, h) => inset(w, h, w * 0.15, h * 0.15) }),
  shape("text", "Text", 60, 30, () => "", { drawio: "text;html=1;whiteSpace=wrap;", style: { fill: "none", stroke: "none" }, text: (w, h) => inset(w, h, 2, 2) }),
  shape("process", "Process", 120, 60, (w, h) => box(0, 0, w, h) + lines(`M${r1(w * 0.1)} 0V${r1(h)}M${r1(w * 0.9)} 0V${r1(h)}`), {
    drawio: "shape=process;whiteSpace=wrap;html=1;backgroundOutline=1;",
    text: (w, h) => inset(w, h, w * 0.1 + 2, 4),
  }),
  shape("diamond", "Diamond", 80, 80, (w, h) => poly(diamondPts(w, h)), { drawio: "rhombus;whiteSpace=wrap;html=1;", text: (w, h) => inset(w, h, w / 4, h / 4) }),
  shape("parallelogram", "Parallelogram", 120, 60, (w, h) => {
    const d = Math.min(w * 0.2, 20);
    return poly([[d, 0], [w, 0], [w - d, h], [0, h]]);
  }, { drawio: "shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fixedSize=1;", text: (w, h) => inset(w, h, Math.min(w * 0.2, 20), 4) }),
  shape("hexagon", "Hexagon", 120, 80, (w, h) => {
    const d = Math.min(w * 0.25, 24);
    return poly([[d, 0], [w - d, 0], [w, h / 2], [w - d, h], [d, h], [0, h / 2]]);
  }, { drawio: "shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;", text: (w, h) => inset(w, h, Math.min(w * 0.25, 24), 4) }),
  shape("triangle", "Triangle", 60, 80, (w, h) => poly([[0, 0], [w, h / 2], [0, h]]), { drawio: "triangle;whiteSpace=wrap;html=1;", text: (w, h) => ({ x: 4, y: h / 4, w: w * 0.55, h: h / 2 }) }),
  shape("cylinder", "Cylinder", 60, 80, (w, h) => {
    const ry = Math.min(12, h * 0.15);
    return path(cylinderPath(w, h, ry)) + lines(`M0 ${r1(ry)}A${r1(w / 2)} ${r1(ry)} 0 0 0 ${r1(w)} ${r1(ry)}`);
  }, {
    drawio: "shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=12;",
    text: (w, h) => {
      const ry = Math.min(12, h * 0.15);
      return { x: 4, y: ry * 2 + 2, w: w - 8, h: Math.max(h - ry * 3 - 4, 4) };
    },
  }),
  shape("cloud", "Cloud", 120, 80, (w, h) => {
    const p = (x: number, y: number) => pt(x * w, y * h);
    return path(
      `M${p(0.25, 0.25)}C${p(0.05, 0.25)} ${p(0, 0.5)} ${p(0.16, 0.55)}C${p(0, 0.66)} ${p(0.18, 0.9)} ${p(0.31, 0.8)}` +
        `C${p(0.4, 1)} ${p(0.7, 1)} ${p(0.8, 0.8)}C${p(1, 0.8)} ${p(1, 0.6)} ${p(0.875, 0.5)}` +
        `C${p(1, 0.3)} ${p(0.8, 0.1)} ${p(0.625, 0.2)}C${p(0.5, 0.05)} ${p(0.3, 0.05)} ${p(0.25, 0.25)}Z`,
    );
  }, { drawio: "ellipse;shape=cloud;whiteSpace=wrap;html=1;", text: (w, h) => inset(w, h, w * 0.15, h * 0.22) }),
  shape("document", "Document", 120, 80, (w, h) => path(documentPath(0, 0, w, h)), {
    drawio: "shape=document;whiteSpace=wrap;html=1;boundedLbl=1;",
    text: (w, h) => ({ x: 4, y: 4, w: w - 8, h: h * 0.78 - 4 }),
  }),
  shape("internal-storage", "Internal storage", 80, 80, (w, h) => {
    const d = Math.min(12, w * 0.15, h * 0.15);
    return box(0, 0, w, h) + lines(`M${r1(d)} 0V${r1(h)}M0 ${r1(d)}H${r1(w)}`);
  }, { drawio: "shape=internalStorage;whiteSpace=wrap;html=1;backgroundOutline=1;", text: (w, h) => ({ x: 16, y: 16, w: w - 20, h: h - 20 }) }),
  shape("cube", "Cube", 120, 80, (w, h) => {
    const d = Math.min(20, w * 0.25, h * 0.25);
    return poly([[0, d], [d, 0], [w, 0], [w, h - d], [w - d, h], [0, h]]) + lines(`M0 ${r1(d)}H${r1(w - d)}V${r1(h)}M${r1(w - d)} ${r1(d)}L${r1(w)} 0`);
  }, {
    drawio: "shape=cube;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;darkOpacity=0.05;darkOpacity2=0.1;flipH=1;",
    text: (w, h) => {
      const d = Math.min(20, w * 0.25, h * 0.25);
      return { x: 4, y: d + 4, w: w - d - 8, h: h - d - 8 };
    },
  }),
  shape("step", "Step", 120, 80, (w, h) => {
    const d = Math.min(w * 0.2, 20);
    return poly([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h], [d, h / 2]]);
  }, { drawio: "shape=step;perimeter=stepPerimeter;whiteSpace=wrap;html=1;fixedSize=1;", text: (w, h) => inset(w, h, Math.min(w * 0.2, 20) + 2, 4) }),
  shape("trapezoid", "Trapezoid", 120, 60, (w, h) => {
    const d = Math.min(w * 0.2, 20);
    return poly([[d, 0], [w - d, 0], [w, h], [0, h]]);
  }, { drawio: "shape=trapezoid;perimeter=trapezoidPerimeter;whiteSpace=wrap;html=1;fixedSize=1;flipV=1;", text: (w, h) => inset(w, h, Math.min(w * 0.2, 20), 4) }),
  shape("tape", "Tape", 120, 100, (w, h) => {
    const dy = h * 0.1;
    return path(
      `M0 ${r1(dy)}Q${pt(w * 0.25, -dy)} ${pt(w * 0.5, dy)}T${pt(w, dy)}V${r1(h - dy)}Q${pt(w * 0.75, h + dy)} ${pt(w * 0.5, h - dy)}T${pt(0, h - dy)}Z`,
    );
  }, { drawio: "shape=tape;whiteSpace=wrap;html=1;", text: (w, h) => ({ x: 4, y: h * 0.2, w: w - 8, h: h * 0.6 }) }),
  shape("note", "Note", 80, 100, (w, h) => {
    const f = Math.min(16, w * 0.3, h * 0.3);
    return poly([[0, 0], [w - f, 0], [w, f], [w, h], [0, h]]) + lines(`M${r1(w - f)} 0V${r1(f)}H${r1(w)}`);
  }, { drawio: "shape=note;whiteSpace=wrap;html=1;backgroundOutline=1;darkOpacity=0.05;size=16;" }),
  shape("card", "Card", 80, 100, (w, h) => {
    const c = Math.min(16, w * 0.3, h * 0.3);
    return poly([[c, 0], [w, 0], [w, h], [0, h], [0, c]]);
  }, { drawio: "shape=card;whiteSpace=wrap;html=1;size=16;" }),
  shape("callout", "Callout", 120, 80, (w, h) => {
    const b = h - Math.min(20, h * 0.3);
    return poly([[0, 0], [w, 0], [w, b], [w * 0.45, b], [w * 0.3, h], [w * 0.3, b], [0, b]]);
  }, { drawio: "shape=callout;whiteSpace=wrap;html=1;perimeter=calloutPerimeter;size=20;position=0.3;position2=0.3;base=20;", text: (w, h) => ({ x: 4, y: 4, w: w - 8, h: h - Math.min(20, h * 0.3) - 8 }) }),
  shape("actor", "Actor", 30, 60, (w, h) =>
    oval(w / 2, h / 8, w / 4, h / 8) + lines(`M${pt(w / 2, h / 4)}V${r1((h * 2) / 3)}M0 ${r1(h / 3)}H${r1(w)}M${pt(w / 2, (h * 2) / 3)}L0 ${r1(h)}M${pt(w / 2, (h * 2) / 3)}L${pt(w, h)}`), {
    drawio: "shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;outlineConnect=0;",
    label: "below",
  }),
  shape("data-storage", "Data storage", 100, 80, (w, h) => {
    const d = w * 0.1;
    return path(`M${r1(d)} 0H${r1(w)}Q${pt(w - d * 2, h / 2)} ${pt(w, h)}H${r1(d)}Q${pt(-d, h / 2)} ${pt(d, 0)}Z`);
  }, { drawio: "shape=dataStorage;whiteSpace=wrap;html=1;fixedSize=1;", text: (w, h) => ({ x: w * 0.1 + 2, y: 4, w: w * 0.7, h: h - 8 }) }),
  shape("hline", "Horizontal line", 160, 10, (w, h) => lines(`M0 ${r1(h / 2)}H${r1(w)}`), { drawio: "line;strokeWidth=2;html=1;", label: "none", style: { fill: "none" } }),
  shape("vline", "Vertical line", 10, 160, (w, h) => lines(`M${r1(w / 2)} 0V${r1(h)}`), { drawio: "line;strokeWidth=2;direction=south;html=1;", label: "none", style: { fill: "none" } }),

  // Misc and Advanced
  shape("folder", "Folder", 120, 80, (w, h) => {
    const tw = Math.min(50, w * 0.4);
    const t = Math.min(14, h * 0.25);
    return poly([[0, 0], [tw, 0], [tw + t * 0.6, t], [w, t], [w, h], [0, h]]) + lines(`M0 ${r1(t)}H${r1(tw + t * 0.6)}`);
  }, { drawio: "shape=folder;whiteSpace=wrap;html=1;tabWidth=50;tabHeight=14;tabPosition=left;", text: (w, h) => ({ x: 4, y: Math.min(14, h * 0.25) + 4, w: w - 8, h: h - Math.min(14, h * 0.25) - 8 }) }),
  shape("corner", "Corner", 80, 80, (w, h) => {
    const t = Math.min(w, h) * 0.3;
    return poly([[0, 0], [t, 0], [t, h - t], [w, h - t], [w, h], [0, h]]);
  }, { drawio: "shape=corner;whiteSpace=wrap;html=1;dx=24;dy=24;", label: "none" }),
  shape("tee", "Tee", 100, 100, (w, h) => {
    const t = Math.min(w, h) * 0.3;
    return poly([[0, 0], [w, 0], [w, t], [(w + t) / 2, t], [(w + t) / 2, h], [(w - t) / 2, h], [(w - t) / 2, t], [0, t]]);
  }, { drawio: "shape=tee;whiteSpace=wrap;html=1;dx=30;dy=30;", label: "none" }),
  shape("datastore", "Data store", 60, 60, (w, h) => {
    const ry = Math.min(9, h * 0.12);
    const arc = (y: number) => `M0 ${r1(y)}A${r1(w / 2)} ${r1(ry)} 0 0 0 ${r1(w)} ${r1(y)}`;
    return path(cylinderPath(w, h, ry)) + lines(arc(ry) + arc(ry * 2) + arc(ry * 3));
  }, { drawio: "shape=datastore;whiteSpace=wrap;html=1;", text: (w, h) => ({ x: 4, y: Math.min(9, h * 0.12) * 4 + 2, w: w - 8, h: Math.max(h - Math.min(9, h * 0.12) * 5 - 4, 4) }) }),
  shape("or", "Or", 70, 70, (w, h) => oval(w / 2, h / 2, w / 2, h / 2) + lines(`M${r1(w / 2)} 0V${r1(h)}M0 ${r1(h / 2)}H${r1(w)}`), { drawio: fc("or"), label: "none" }),
  shape("summing", "Summing junction", 70, 70, (w, h) =>
    oval(w / 2, h / 2, w / 2, h / 2) + lines(`M${pt(w * 0.146, h * 0.146)}L${pt(w * 0.854, h * 0.854)}M${pt(w * 0.854, h * 0.146)}L${pt(w * 0.146, h * 0.854)}`), {
    drawio: fc("summing_function"),
    label: "none",
  }),
  shape("sort", "Sort", 70, 80, (w, h) => poly(diamondPts(w, h)) + lines(`M0 ${r1(h / 2)}H${r1(w)}`), { drawio: fc("sort"), label: "none" }),
  shape("collate", "Collate", 60, 80, (w, h) => path(`M0 0H${r1(w)}L0 ${r1(h)}H${r1(w)}Z`), { drawio: fc("collate"), label: "none" }),
  shape("delay", "Delay", 90, 60, (w, h) => path(`M0 0H${r1(w / 2)}A${r1(w / 2)} ${r1(h / 2)} 0 0 1 ${r1(w / 2)} ${r1(h)}H0Z`), { drawio: fc("delay"), text: (w, h) => ({ x: 4, y: 4, w: w * 0.8, h: h - 8 }) }),
  shape("display", "Display", 120, 60, (w, h) =>
    path(`M0 ${r1(h / 2)}L${r1(w * 0.15)} 0H${r1(w * 0.85)}A${r1(w * 0.15)} ${r1(h / 2)} 0 0 1 ${r1(w * 0.85)} ${r1(h)}H${r1(w * 0.15)}Z`), {
    drawio: fc("display"),
    text: (w, h) => inset(w, h, w * 0.15, 4),
  }),
  shape("manual-input", "Manual input", 120, 60, (w, h) => poly([[0, h * 0.3], [w, 0], [w, h], [0, h]]), { drawio: fc("manual_input"), text: (w, h) => ({ x: 4, y: h * 0.3, w: w - 8, h: h * 0.7 - 4 }) }),
  shape("manual-operation", "Manual operation", 120, 60, (w, h) => {
    const d = Math.min(w * 0.15, 20);
    return poly([[0, 0], [w, 0], [w - d, h], [d, h]]);
  }, { drawio: fc("manual_operation"), text: (w, h) => inset(w, h, Math.min(w * 0.15, 20), 4) }),
  shape("terminator", "Terminator", 120, 50, (w, h) => box(0, 0, w, h, h / 2), { drawio: fc("terminator"), text: (w, h) => inset(w, h, h / 4 + 2, 4) }),
  shape("stored-data", "Stored data", 100, 60, (w, h) => {
    const d = Math.min(w * 0.15, 16);
    return path(`M${r1(d)} 0H${r1(w)}A${r1(d)} ${r1(h / 2)} 0 0 0 ${r1(w)} ${r1(h)}H${r1(d)}A${r1(d)} ${r1(h / 2)} 0 0 1 ${r1(d)} 0Z`);
  }, { drawio: fc("stored_data"), text: (w, h) => ({ x: Math.min(w * 0.15, 16), y: 4, w: w - 2 * Math.min(w * 0.15, 16) - 2, h: h - 8 }) }),
  shape("direct-data", "Direct data", 120, 60, (w, h) => {
    const rx = Math.min(w * 0.15, 15);
    return (
      path(`M${r1(rx)} 0H${r1(w - rx)}A${r1(rx)} ${r1(h / 2)} 0 0 1 ${r1(w - rx)} ${r1(h)}H${r1(rx)}A${r1(rx)} ${r1(h / 2)} 0 0 1 ${r1(rx)} 0Z`) +
      lines(`M${r1(w - rx)} 0A${r1(rx)} ${r1(h / 2)} 0 0 0 ${r1(w - rx)} ${r1(h)}`)
    );
  }, { drawio: fc("direct_data"), text: (w, h) => ({ x: Math.min(w * 0.15, 15), y: 4, w: w - 3 * Math.min(w * 0.15, 15), h: h - 8 }) }),
  shape("sequential-data", "Sequential data", 70, 70, (w, h) => oval(w / 2, h / 2, w / 2, h / 2) + lines(`M${r1(w / 2)} ${r1(h)}H${r1(w)}`), {
    drawio: fc("sequential_data"),
    text: (w, h) => inset(w, h, w * 0.15, h * 0.15),
  }),
  shape("multi-document", "Multi-document", 120, 80, (w, h) => {
    const o = Math.min(8, w * 0.06, h * 0.08);
    return path(documentPath(o * 2, 0, w - o * 2, h - o * 2)) + path(documentPath(o, o, w - o * 2, h - o * 2)) + path(documentPath(0, o * 2, w - o * 2, h - o * 2));
  }, { drawio: fc("multi-document"), text: (w, h) => ({ x: 4, y: Math.min(8, w * 0.06, h * 0.08) * 2 + 4, w: w * 0.85, h: h * 0.6 }) }),
  shape("off-page", "Off-page reference", 60, 60, (w, h) => poly([[0, 0], [w, 0], [w, h * 0.6], [w / 2, h], [0, h * 0.6]]), { drawio: "shape=offPageConnector;whiteSpace=wrap;html=1;", text: (w, h) => ({ x: 4, y: 4, w: w - 8, h: h * 0.6 - 4 }) }),
  shape("loop-limit", "Loop limit", 120, 60, (w, h) => {
    const d = Math.min(w, h) * 0.2;
    return poly([[d, 0], [w - d, 0], [w, d], [w, h], [0, h], [0, d]]);
  }, { drawio: fc("loop_limit") }),
  shape("extract", "Extract", 70, 70, (w, h) => poly([[w / 2, 0], [w, h], [0, h]]), { drawio: fc("extract_or_measurement"), text: (w, h) => ({ x: w / 4, y: h / 2, w: w / 2, h: h / 2 - 4 }) }),
  shape("merge", "Merge", 70, 70, (w, h) => poly([[0, 0], [w, 0], [w / 2, h]]), { drawio: fc("merge_or_storage"), text: (w, h) => ({ x: w / 4, y: 4, w: w / 2, h: h / 2 - 4 }) }),
  shape("annotation", "Annotation", 60, 100, (w, h) => lines(`M${r1(Math.min(w * 0.3, 12))} 0H0V${r1(h)}H${r1(Math.min(w * 0.3, 12))}`), {
    drawio: "shape=partialRectangle;right=0;html=1;whiteSpace=wrap;align=left;spacingLeft=14;",
    style: { fill: "none", align: "left" },
    text: (w, h) => ({ x: 14, y: 4, w: w - 18, h: h - 8 }),
  }),
  shape("curly-left", "Left brace", 20, 120, (w, h) =>
    lines(`M${r1(w)} 0Q${pt(w / 2, 0)} ${pt(w / 2, h * 0.1)}V${r1(h * 0.4)}Q${pt(w / 2, h / 2)} ${pt(0, h / 2)}Q${pt(w / 2, h / 2)} ${pt(w / 2, h * 0.6)}V${r1(h * 0.9)}Q${pt(w / 2, h)} ${pt(w, h)}`), {
    drawio: "shape=curlyBracket;whiteSpace=wrap;html=1;rounded=1;",
    label: "none",
    style: { fill: "none" },
  }),
  shape("curly-right", "Right brace", 20, 120, (w, h) =>
    lines(`M0 0Q${pt(w / 2, 0)} ${pt(w / 2, h * 0.1)}V${r1(h * 0.4)}Q${pt(w / 2, h / 2)} ${pt(w, h / 2)}Q${pt(w / 2, h / 2)} ${pt(w / 2, h * 0.6)}V${r1(h * 0.9)}Q${pt(w / 2, h)} ${pt(0, h)}`), {
    drawio: "shape=curlyBracket;whiteSpace=wrap;html=1;rounded=1;flipH=1;",
    label: "none",
    style: { fill: "none" },
  }),
  shape("list", "List", 160, 110, (w, h, label) => drawRows("list", w, h, label), { rows: "list", style: { align: "left" } }),
  shape("table", "Table", 240, 90, (w, h, label) => drawRows("table", w, h, label), { rows: "table" }),

  // Basic
  shape("octagon", "Octagon", 80, 80, (w, h) => {
    const c = Math.min(w, h) * 0.29;
    return poly([[c, 0], [w - c, 0], [w, c], [w, h - c], [w - c, h], [c, h], [0, h - c], [0, c]]);
  }, { text: (w, h) => inset(w, h, Math.min(w, h) * 0.15, 4) }),
  shape("pentagon", "Pentagon", 80, 80, (w, h) => poly(unit([[0.5, 0], [1, 0.38], [0.81, 1], [0.19, 1], [0, 0.38]], w, h)), { text: (w, h) => ({ x: w * 0.2, y: h * 0.3, w: w * 0.6, h: h * 0.6 }) }),
  shape("star", "Star", 80, 80, (w, h) => poly(fit(star(5, 0.4), w, h)), { label: "below" }),
  shape("cross", "Cross", 80, 80, (w, h) => poly(unit(PLUS, w, h)), { drawio: "shape=cross;whiteSpace=wrap;html=1;size=0.3;", label: "below" }),
  shape("x", "X", 80, 80, (w, h) => poly(fit(rotate45(PLUS), w, h)), { label: "below" }),
  shape("heart", "Heart", 80, 80, (w, h) => {
    const p = (x: number, y: number) => pt(x * w, y * h);
    return path(`M${p(0.5, 0.3)}C${p(0.5, 0.1)} ${p(0.2, 0)} ${p(0.05, 0.2)}C${p(-0.05, 0.38)} ${p(0.05, 0.6)} ${p(0.5, 1)}C${p(0.95, 0.6)} ${p(1.05, 0.38)} ${p(0.95, 0.2)}C${p(0.8, 0)} ${p(0.5, 0.1)} ${p(0.5, 0.3)}Z`);
  }, { label: "below" }),
  shape("moon", "Moon", 60, 80, (w, h) =>
    path(`M${pt(w * 0.75, h * 0.08)}A${pt(w * 0.5, h * 0.5)} 0 1 0 ${pt(w * 0.75, h * 0.92)}A${pt(w * 0.3, h * 0.42)} 0 0 1 ${pt(w * 0.75, h * 0.08)}Z`), {
    label: "below",
  }),
  shape("smiley", "Smiley", 80, 80, (w, h) =>
    oval(w / 2, h / 2, w / 2, h / 2) +
    oval(w * 0.35, h * 0.38, w * 0.05, h * 0.06, ` fill="currentColor" stroke="none"`) +
    oval(w * 0.65, h * 0.38, w * 0.05, h * 0.06, ` fill="currentColor" stroke="none"`) +
    lines(`M${pt(w * 0.28, h * 0.6)}Q${pt(w * 0.5, h * 0.82)} ${pt(w * 0.72, h * 0.6)}`), {
    label: "below",
  }),
  shape("no", "No symbol", 80, 80, (w, h) => {
    const t = Math.min(w, h) * 0.12;
    const [cx, cy, rx, ry] = [w / 2, h / 2, w / 2 - t, h / 2 - t];
    const k = Math.SQRT1_2;
    const [ax, ay, bx, by] = [cx - rx * k, cy - ry * k, cx + rx * k, cy + ry * k];
    const [nx, ny] = [(t / 2) * k, (-t / 2) * k];
    return (
      path(`M0 ${r1(cy)}A${pt(w / 2, h / 2)} 0 1 0 ${pt(w, cy)}A${pt(w / 2, h / 2)} 0 1 0 0 ${r1(cy)}ZM${pt(t, cy)}A${pt(rx, ry)} 0 1 1 ${pt(w - t, cy)}A${pt(rx, ry)} 0 1 1 ${pt(t, cy)}Z`, ` fill-rule="evenodd"`) +
      poly([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]])
    );
  }, { label: "below" }),
  shape("pie", "Pie", 80, 80, (w, h) => path(`M${pt(w / 2, h / 2)}L${pt(w / 2, 0)}A${pt(w / 2, h / 2)} 0 1 1 0 ${r1(h / 2)}Z`), { label: "below" }),
  shape("donut", "Donut", 80, 80, (w, h) => {
    const t = Math.min(w, h) * 0.25;
    const [cy, rx, ry] = [h / 2, w / 2 - t, h / 2 - t];
    return path(`M0 ${r1(cy)}A${pt(w / 2, h / 2)} 0 1 0 ${pt(w, cy)}A${pt(w / 2, h / 2)} 0 1 0 0 ${r1(cy)}ZM${pt(t, cy)}A${pt(rx, ry)} 0 1 1 ${pt(w - t, cy)}A${pt(rx, ry)} 0 1 1 ${pt(t, cy)}Z`, ` fill-rule="evenodd"`);
  }, { label: "below" }),
  shape("frame", "Frame", 100, 80, (w, h) => {
    const t = Math.min(w, h) * 0.12;
    return path(`M0 0H${r1(w)}V${r1(h)}H0ZM${pt(t, t)}V${r1(h - t)}H${r1(w - t)}V${r1(t)}Z`, ` fill-rule="evenodd"`);
  }, { text: (w, h) => inset(w, h, Math.min(w, h) * 0.12 + 4, Math.min(w, h) * 0.12 + 4) }),
  shape("lightning", "Lightning", 60, 80, (w, h) => poly(unit([[0.55, 0], [0.1, 0.58], [0.45, 0.58], [0.3, 1], [0.9, 0.38], [0.55, 0.38], [0.75, 0]], w, h)), { label: "below" }),
  shape("cone", "Cone", 70, 80, (w, h) => {
    const ry = Math.min(h * 0.12, 12);
    return path(`M${pt(w / 2, 0)}L${pt(w, h - ry)}A${pt(w / 2, ry)} 0 0 1 0 ${r1(h - ry)}Z`);
  }, { label: "below" }),
  shape("pyramid", "Pyramid", 80, 80, (w, h) => poly([[w / 2, 0], [w, h * 0.8], [w * 0.55, h], [0, h * 0.85]]) + lines(`M${pt(w / 2, 0)}L${pt(w * 0.55, h)}`), { label: "below" }),

  // Arrows
  shape("arrow-right", "Arrow right", 100, 60, (w, h) => poly(arrowPoints(w, h)), {
    drawio: "shape=singleArrow;whiteSpace=wrap;html=1;arrowWidth=0.4;arrowSize=0.4;",
    text: (w, h) => ({ x: 4, y: h * 0.3, w: w - Math.min(w * 0.4, h) - 4, h: h * 0.4 }),
  }),
  shape("arrow-left", "Arrow left", 100, 60, (w, h) => poly(arrowPoints(w, h).map(([x, y]) => [w - x, y])), {
    drawio: "shape=singleArrow;whiteSpace=wrap;html=1;arrowWidth=0.4;arrowSize=0.4;direction=west;",
    text: (w, h) => ({ x: Math.min(w * 0.4, h), y: h * 0.3, w: w - Math.min(w * 0.4, h) - 4, h: h * 0.4 }),
  }),
  shape("arrow-up", "Arrow up", 60, 100, (w, h) => poly(arrowPoints(h, w).map(([a, b]) => [b, h - a])), {
    drawio: "shape=singleArrow;whiteSpace=wrap;html=1;arrowWidth=0.4;arrowSize=0.4;direction=north;",
    label: "none",
  }),
  shape("arrow-down", "Arrow down", 60, 100, (w, h) => poly(arrowPoints(h, w).map(([a, b]) => [b, a])), {
    drawio: "shape=singleArrow;whiteSpace=wrap;html=1;arrowWidth=0.4;arrowSize=0.4;direction=south;",
    label: "none",
  }),
  shape("arrow-double", "Double arrow", 120, 60, (w, h) => poly(doubleArrowPoints(w, h)), {
    drawio: "shape=doubleArrow;whiteSpace=wrap;html=1;arrowWidth=0.4;arrowSize=0.3;",
    text: (w, h) => ({ x: Math.min(w * 0.3, h), y: h * 0.3, w: w - 2 * Math.min(w * 0.3, h), h: h * 0.4 }),
  }),
  shape("arrow-double-v", "Double arrow vertical", 60, 120, (w, h) => poly(doubleArrowPoints(h, w).map(([a, b]) => [b, a])), {
    drawio: "shape=doubleArrow;whiteSpace=wrap;html=1;arrowWidth=0.4;arrowSize=0.3;direction=south;",
    label: "none",
  }),
  shape("arrow-quad", "Quad arrow", 100, 100, (w, h) => poly(unit(QUAD, w, h)), { label: "none" }),
  shape("chevron", "Chevron", 100, 60, (w, h) => {
    const d = Math.min(w * 0.3, h * 0.5);
    return poly([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h], [d, h / 2]]);
  }, { drawio: "shape=step;perimeter=stepPerimeter;whiteSpace=wrap;html=1;fixedSize=1;size=30;", text: (w, h) => inset(w, h, Math.min(w * 0.3, h * 0.5), 4) }),
  shape("arrow-notched", "Notched arrow", 100, 60, (w, h) => poly([...arrowPoints(w, h), [Math.min(h * 0.3, w * 0.15), h / 2]]), { label: "none" }),
  shape("arrow-callout", "Callout arrow", 120, 60, (w, h) => {
    const [bw, hd] = [w * 0.55, Math.min(w * 0.2, h * 0.5)];
    return poly([[0, 0], [bw, 0], [bw, h * 0.35], [w - hd, h * 0.35], [w - hd, h * 0.15], [w, h / 2], [w - hd, h * 0.85], [w - hd, h * 0.65], [bw, h * 0.65], [bw, h], [0, h]]);
  }, { text: (w, h) => ({ x: 4, y: 4, w: w * 0.55 - 8, h: h - 8 }) }),

  // Entity relation
  shape("double-rect", "Double rectangle", 120, 60, (w, h) => box(0, 0, w, h) + box(4, 4, w - 8, h - 8, 0, ` fill="none"`), { drawio: "shape=ext;margin=3;double=1;whiteSpace=wrap;html=1;" }),
  shape("double-ellipse", "Double ellipse", 120, 80, (w, h) => oval(w / 2, h / 2, w / 2, h / 2) + oval(w / 2, h / 2, w / 2 - 4, h / 2 - 4, ` fill="none"`), {
    drawio: "ellipse;shape=doubleEllipse;margin=3;whiteSpace=wrap;html=1;",
    text: (w, h) => inset(w, h, w * 0.15, h * 0.15),
  }),
  shape("double-diamond", "Double diamond", 100, 80, (w, h) => poly(diamondPts(w, h)) + poly(diamondPts(w, h, 7)).replace("/>", ` fill="none"/>`), {
    drawio: "shape=rhombus;double=1;perimeter=rhombusPerimeter;whiteSpace=wrap;html=1;",
    text: (w, h) => inset(w, h, w / 4, h / 4),
  }),
  shape("entity-table", "Table", 180, 110, (w, h, label) => drawRows("entity", w, h, label), { rows: "entity", style: { align: "left" } }),

  // UML
  shape("uml-class", "Class", 160, 110, (w, h, label) => drawRows("class", w, h, label), { rows: "class", style: { align: "left" } }),
  shape("uml-component", "Component", 140, 70, (w, h) => box(10, 0, w - 10, h) + box(0, h * 0.25, 20, 10) + box(0, h * 0.55, 20, 10), {
    drawio: "shape=module;jettyWidth=20;jettyHeight=10;whiteSpace=wrap;html=1;",
    text: (w, h) => ({ x: 26, y: 4, w: w - 30, h: h - 8 }),
  }),
  shape("uml-lifeline", "Lifeline", 100, 260, (w, h) => {
    const hh = Math.min(40, h * 0.3);
    return box(0, 0, w, hh) + lines(`M${r1(w / 2)} ${r1(hh)}V${r1(h)}`, ` stroke-dasharray="6 4"`);
  }, { drawio: "shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=0;size=40;", text: (w, h) => ({ x: 4, y: 4, w: w - 8, h: Math.min(40, h * 0.3) - 8 }) }),
  shape("uml-frame", "Frame", 300, 200, (w, h) => {
    const tw = Math.min(70, w * 0.4);
    return box(0, 0, w, h) + path(`M0 0H${r1(tw)}V15L${r1(tw - 7)} 22H0Z`, ` fill="none"`);
  }, {
    drawio: "shape=umlFrame;whiteSpace=wrap;html=1;pointerEvents=0;width=70;height=22;",
    style: { fill: "none", align: "left", valign: "top", fontSize: 12 },
    text: (w) => ({ x: 4, y: 3, w: Math.min(70, w * 0.4) - 12, h: 18 }),
  }),
  shape("uml-initial", "Initial state", 30, 30, (w, h) => oval(w / 2, h / 2, w / 2, h / 2, ` fill="currentColor"`), { drawio: "ellipse;html=1;shape=startState;", label: "none", solid: true }),
  shape("uml-final", "Final state", 30, 30, (w, h) => oval(w / 2, h / 2, w / 2, h / 2) + oval(w / 2, h / 2, w * 0.3, h * 0.3, ` fill="currentColor" stroke="none"`), {
    drawio: "ellipse;html=1;shape=endState;",
    label: "none",
    solid: true,
  }),
  shape("uml-fork", "Fork / join", 120, 10, (w, h) => box(0, 0, w, h, 0, ` fill="currentColor"`), { drawio: "html=1;points=[];perimeter=orthogonalPerimeter;", label: "none", solid: true }),

  // C4
  shape("c4-person", "Person", 160, 170, (w, h) => {
    const r = Math.min(w, h) * 0.2;
    return box(0, r * 1.6, w, h - r * 1.6, Math.min(24, w * 0.2)) + oval(w / 2, r, r, r);
  }, {
    drawio: "shape=mxgraph.c4.person2;whiteSpace=wrap;html=1;",
    text: (w, h) => {
      const r = Math.min(w, h) * 0.2;
      return { x: 8, y: r * 2.1, w: w - 16, h: h - r * 2.1 - 6 };
    },
  }),
];

const BY_KEY = new Map(SHAPES.map((s) => [s.key, s]));

export function isShapeKey(key: unknown): key is string {
  return typeof key === "string" && BY_KEY.has(key);
}

/** A shape's definition; unknown keys draw as rectangles. */
export function shapeDef(key: string | undefined): ShapeDef {
  return (key && BY_KEY.get(key)) || BY_KEY.get("rect")!;
}

// --- colours and the outline as SVG ----------------------------------------------------------------

const COLOUR = /^(#[0-9a-f]{3,8}|none|transparent|currentColor|var\(--[a-z0-9-]+\)|rgba?\([\d\s.,%]+\))$/i;

/** A colour that is safe to put in markup, or the fallback. */
export function safeColour(c: unknown, fallback: string): string {
  return typeof c === "string" && COLOUR.test(c.trim()) ? c.trim() : fallback;
}

const num = (v: unknown, fallback: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : fallback);

/** A shape's effective style: its own, over its kind's, over `base`. Values are checked, so they're safe in markup. */
export function lookOf(style: NodeStyle | undefined, def: ShapeDef | null, base: Look = SHAPE_DEFAULTS): Look {
  const s = { ...def?.style, ...style };
  return {
    fill: safeColour(s.fill, base.fill),
    stroke: safeColour(s.stroke, base.stroke),
    strokeWidth: num(s.strokeWidth, base.strokeWidth, 0, 12),
    dashed: typeof s.dashed === "boolean" ? s.dashed : base.dashed,
    fontColor: safeColour(s.fontColor, base.fontColor),
    fontSize: num(s.fontSize, base.fontSize, 6, 72),
    bold: typeof s.bold === "boolean" ? s.bold : base.bold,
    italic: typeof s.italic === "boolean" ? s.italic : base.italic,
    underline: typeof s.underline === "boolean" ? s.underline : base.underline,
    align: s.align === "left" || s.align === "right" || s.align === "center" ? s.align : base.align,
    valign: s.valign === "top" || s.valign === "bottom" || s.valign === "middle" ? s.valign : base.valign,
    opacity: num(s.opacity, base.opacity, 0.05, 1),
  };
}

/** The outline in a group carrying its colours. */
export function shapeSvg(def: ShapeDef, w: number, h: number, look: Look, label = ""): string {
  const style =
    `fill:${look.fill};stroke:${look.stroke};stroke-width:${look.strokeWidth};color:${look.stroke === "none" ? look.fontColor : look.stroke};` +
    (look.dashed ? "stroke-dasharray:6 4;" : "") +
    (look.opacity < 1 ? `opacity:${look.opacity};` : "");
  return `<g style="${style}" stroke-linejoin="round" stroke-linecap="round">${def.draw(Math.max(w, 2), Math.max(h, 2), label)}</g>`;
}
