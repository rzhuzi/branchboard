import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/canvas/state/editorCore.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["react", "@xyflow/react"],
  plugins: [{
    name: "viewport-write-stub",
    setup(builder) {
      builder.onResolve({ filter: /shared[\\/]db$/ }, () => ({
        path: "test-viewport-db", external: true
      }));
    }
  }]
});

function createHarness(putViewport = async () => {}) {
  const timers = new Map();
  const layouts = [];
  const effects = [];
  const cleanups = [];
  let nextTimer = 0;
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require(name) {
      if (name === "react") return {
        useCallback: (callback) => callback,
        useRef: (value) => ({ current: value }),
        useState: (value) => [value, () => {}],
        useLayoutEffect: (effect) => layouts.push(effect),
        useEffect: (effect) => effects.push(effect)
      };
      if (name === "@xyflow/react") return { useReactFlow: () => ({}) };
      if (name === "test-viewport-db") return { putViewport };
      throw new Error(`Unexpected import: ${name}`);
    },
    window: {
      setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
      clearTimeout(id) { timers.delete(id); }
    }
  }, { filename: "editor-core.cjs" });
  const core = module.exports.useEditorCore({
    canvasId: "canvas-1",
    document: {
      id: "canvas-1", schemaVersion: 2, revision: 1,
      nodes: [], edges: [], viewport: null, updatedAt: "2026-01-01T00:00:00.000Z"
    }
  });
  for (const effect of [...layouts, ...effects]) cleanups.push(effect());
  return {
    core, timers,
    cleanup() { for (const dispose of cleanups) dispose?.(); }
  };
}

test("unmount clears a scheduled viewport save", () => {
  const harness = createHarness();
  harness.core.markViewportDirty();
  assert.equal(harness.timers.size, 1);
  harness.cleanup();
  assert.equal(harness.timers.size, 0);
});

test("a viewport write failing after unmount does not schedule another timer", async () => {
  let rejectWrite;
  const writing = new Promise((resolve, reject) => { rejectWrite = reject; });
  const harness = createHarness(() => writing);
  harness.core.markViewportDirty();
  const saving = harness.core.flushViewport();
  assert.equal(harness.timers.size, 0);
  harness.cleanup();
  rejectWrite(new Error("IndexedDB unavailable"));
  assert.equal(await saving, false);
  assert.equal(harness.timers.size, 0);
});
