// Excalidraw subsets fonts in a web worker when it exports an SVG. It locates the
// worker script through import.meta.url, which Turbopack rewrites to a file:// path,
// so the worker can never start in this app. Excalidraw then subsets on the main
// thread, as designed, but reports the fallback with console.error, which Next.js
// shows as an error. Log that one message at debug level instead.

const FALLBACK_MESSAGE = "Failed to use workers for subsetting";
const INSTALLED = Symbol.for("stacksketch.font-worker-filter");

export function quietFontWorkerFallback(): void {
  const scope = globalThis as typeof globalThis & { [INSTALLED]?: boolean };
  if (scope[INSTALLED]) return;
  scope[INSTALLED] = true;
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith(FALLBACK_MESSAGE)) {
      console.debug("Excalidraw is subsetting export fonts on the main thread:", args[1]);
      return;
    }
    original.apply(console, args);
  };
}
