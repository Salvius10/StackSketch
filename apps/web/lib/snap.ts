// Snap-to-shape: a closed freehand stroke becomes a component (a box suggests a
// service, a circle a database, a diamond a gateway; renaming it refines the
// type), and an open stroke drawn from one component to another becomes an
// orthogonal arrow bound to both. Sketching stays fast and the drawing stays clean.

import { newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawFreeDrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { ICON_SIZE, type NodeType, classifyStroke } from "@stacksketch/graph";
import { NODE_LABEL, appendElements, componentElements, connectorElements, isComponent, orthogonalRoute } from "./canvas";

const HINT: Record<"rectangle" | "ellipse" | "diamond", NodeType> = {
  rectangle: "service",
  ellipse: "database",
  diamond: "gateway",
};

/** Hit area of a component, including the name under an icon. */
const inside = (el: ExcalidrawElement, x: number, y: number, pad = 14) => {
  const below = el.type === "image" ? 40 : 0;
  return x >= el.x - pad && x <= el.x + el.width + pad && y >= el.y - pad && y <= el.y + el.height + below + pad;
};

/** Returns true if the stroke was replaced. */
export function snapStroke(api: ExcalidrawImperativeAPI, stroke: ExcalidrawFreeDrawElement): boolean {
  const all = api.getSceneElementsIncludingDeleted();
  const erase = newElementWith(stroke, { isDeleted: true });
  const shape = classifyStroke(stroke.points);

  if (shape) {
    const xs = stroke.points.map((p) => p[0]);
    const ys = stroke.points.map((p) => p[1]);
    const cx = stroke.x + (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = stroke.y + (Math.min(...ys) + Math.max(...ys)) / 2;
    // No explicit type: the name decides, so renaming "Service" to "Orders DB" makes it a database.
    const [icon, label] = componentElements(
      { meta: { role: "node" }, text: NODE_LABEL[HINT[shape]] },
      { x: cx - ICON_SIZE / 2, y: cy - ICON_SIZE / 2 },
    );
    appendElements(api, [icon, label], [erase]);
    api.updateScene({
      appState: { selectedElementIds: { [icon.id]: true, [label.id]: true }, selectedGroupIds: { [icon.groupIds[0]]: true } },
    });
    return true;
  }

  // An open stroke from one component to another becomes an arrow bound to both.
  const [sx, sy] = stroke.points[0];
  const [ex, ey] = stroke.points[stroke.points.length - 1];
  const components = all.filter((e) => !e.isDeleted && isComponent(e)).reverse();
  const from = components.find((e) => inside(e, stroke.x + sx, stroke.y + sy));
  const to = components.find((e) => inside(e, stroke.x + ex, stroke.y + ey));
  if (!from || !to || from.id === to.id) return false;

  const style = api.getAppState().currentItemStrokeStyle;
  const kind = style === "dashed" ? "async" : style === "dotted" ? "stream" : "sync";
  const created = connectorElements({ meta: { role: "edge" }, text: "", kind, hot: false }, orthogonalRoute(from, to), from, to);
  const ref = { id: created[0].id, type: "arrow" as const };
  const attach = (e: ExcalidrawElement) => newElementWith(e, { boundElements: [...(e.boundElements ?? []), ref] });
  appendElements(api, created, [erase, attach(from), attach(to)]);
  return true;
}
