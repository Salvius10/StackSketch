// Excalidraw <-> Yjs. Each element is one entry in a Y.Map keyed by id; the
// element with the higher version wins, and Excalidraw's own reconcile keeps
// an element the local user is still editing from being overwritten.

import { CaptureUpdateAction, reconcileElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { RemoteExcalidrawElement } from "@excalidraw/excalidraw/data/reconcile";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import * as Y from "yjs";

export const LOCAL_ORIGIN = { source: "excalidraw-local" };

// Excalidraw mutates element objects in place while you drag, so nothing is
// shared by reference between the scene and the Yjs map.
const clone = <T,>(el: T): T => JSON.parse(JSON.stringify(el)) as T;

export class ExcalidrawBinding {
  /** version + nonce last exchanged with the map, per element id. */
  private synced = new Map<string, string>();
  private disposed = false;

  constructor(
    private api: ExcalidrawImperativeAPI,
    private map: Y.Map<ExcalidrawElement>,
    /** Called with the elements this client changed, after they are shared. */
    private onLocalEdit?: (changed: ExcalidrawElement[]) => void,
  ) {
    map.observe(this.onRemote);
    this.applyRemote(Array.from(map.keys()));
  }

  destroy(): void {
    this.disposed = true;
    this.map.unobserve(this.onRemote);
  }

  /** Call from Excalidraw's onChange: pushes elements whose version moved. */
  onLocalChange(elements: readonly ExcalidrawElement[]): void {
    if (this.disposed) return;
    const changed: ExcalidrawElement[] = [];
    for (const el of elements) {
      const stamp = `${el.version}:${el.versionNonce}`;
      if (this.synced.get(el.id) === stamp) continue;
      const remote = this.map.get(el.id);
      if (remote && (remote.version > el.version || (remote.version === el.version && remote.versionNonce === el.versionNonce))) {
        this.synced.set(el.id, stamp);
        continue;
      }
      this.synced.set(el.id, stamp);
      changed.push(el);
    }
    if (changed.length === 0) return;
    const doc = this.map.doc;
    const write = () => {
      for (const el of changed) this.map.set(el.id, clone(el));
    };
    if (doc) doc.transact(write, LOCAL_ORIGIN);
    else write();
    this.onLocalEdit?.(changed);
  }

  private onRemote = (event: Y.YMapEvent<ExcalidrawElement>, tr: Y.Transaction) => {
    if (tr.origin === LOCAL_ORIGIN || this.disposed) return;
    this.applyRemote(Array.from(event.keysChanged));
  };

  private applyRemote(keys: string[]): void {
    if (keys.length === 0) return;
    const remote: RemoteExcalidrawElement[] = [];
    for (const key of keys) {
      const el = this.map.get(key);
      if (!el) continue;
      remote.push(clone(el) as unknown as RemoteExcalidrawElement);
      this.synced.set(key, `${el.version}:${el.versionNonce}`);
    }
    if (remote.length === 0) return;
    const local = this.api.getSceneElementsIncludingDeleted() as readonly OrderedExcalidrawElement[];
    const elements = reconcileElements(local, remote, this.api.getAppState());
    this.api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
  }
}
