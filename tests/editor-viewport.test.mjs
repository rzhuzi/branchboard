import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/canvas/state/useEditorViewport.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["react"],
  plugins: [{
    name: "viewport-storage-stub",
    setup(builder) {
      builder.onResolve({ filter: /shared[\\/]db$/ }, () => ({
        path: "test-viewport-db",
        external: true
      }));
    }
  }]
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function createHarness() {
  const documentViewport = { x: 20, y: 30, zoom: 0.8 };
  const reads = new Map([["canvas-a", deferred()]]);
  const readCalls = [];
  const applied = [];
  const stateUpdates = [];
  const effects = [];
  const cleanups = [];
  const frames = new Map();
  let nextFrameId = 0;
  let flowViewport = documentViewport;
  const core = {
    canvasId: "canvas-a",
    initialDocumentRef: { current: { viewport: documentViewport, nodes: [] } },
    viewportRef: { current: documentViewport },
    viewportDirtyRef: { current: false },
    viewportVersionRef: { current: 0 },
    nodesRef: { current: [] },
    edgesRef: { current: [] },
    selectedIdsRef: { current: [] },
    applyState() {},
    setSelectedCount() {},
    setViewport(viewport) { stateUpdates.push(structuredClone(viewport)); },
    markViewportDirty() {
      core.viewportDirtyRef.current = true;
      core.viewportVersionRef.current += 1;
    },
    reactFlowRef: { current: {
      setViewport(viewport) {
        flowViewport = viewport;
        applied.push(structuredClone(viewport));
        return Promise.resolve(true);
      },
      getViewport() { return flowViewport; },
      fitView() { return Promise.resolve(true); }
    } }
  };
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require(name) {
      if (name === "react") return {
        useCallback: (callback) => callback,
        useEffect: (effect) => effects.push(effect)
      };
      if (name === "test-viewport-db") return {
        getViewport(canvasId) {
          readCalls.push(canvasId);
          assert.equal(reads.has(canvasId), true);
          return reads.get(canvasId).promise;
        }
      };
      throw new Error(`Unexpected import: ${name}`);
    },
    window: {
      requestAnimationFrame(callback) {
        const id = ++nextFrameId;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame(id) { frames.delete(id); }
    }
  }, { filename: "editor-viewport.cjs" });

  function render() {
    const actions = module.exports.useEditorViewport(core);
    for (const effect of effects.splice(0)) cleanups.push(effect());
    return actions;
  }
  function runFrame() {
    const queued = [...frames.values()];
    frames.clear();
    for (const callback of queued) callback();
  }
  function cleanup() {
    for (const dispose of cleanups.splice(0)) dispose?.();
  }
  async function settle(canvasId = "canvas-a") {
    await reads.get(canvasId).promise.catch(() => {});
    await Promise.resolve();
  }

  const actions = render();
  runFrame();
  assert.deepEqual(readCalls, ["canvas-a"]);
  return {
    core, actions, documentViewport, reads, applied, stateUpdates,
    render, runFrame, cleanup, settle
  };
}

for (const action of ["applyViewport", "onMoveEnd"]) {
  test(`late stored viewport does not overwrite a user's ${action} movement`, async () => {
    const harness = createHarness();
    const latest = { x: 240, y: -160, zoom: 1.25 };
    harness.actions[action](latest);
    assert.equal(harness.core.viewportVersionRef.current, 1);
    // A completed autosave may clear dirty before the older startup read resolves.
    harness.core.viewportDirtyRef.current = false;
    harness.reads.get("canvas-a").resolve({ x: -10, y: -20, zoom: 0.4 });
    await harness.settle();
    assert.deepEqual(structuredClone(harness.core.viewportRef.current), latest);
    assert.deepEqual(harness.stateUpdates.at(-1), latest);
    harness.cleanup();
  });
}

test("restores the stored viewport when the user has not moved", async () => {
  const harness = createHarness();
  const stored = { x: 90, y: 120, zoom: 1.5 };
  harness.reads.get("canvas-a").resolve(stored);
  await harness.settle();
  assert.deepEqual(harness.applied, [stored]);
  assert.deepEqual(harness.stateUpdates, [stored]);
  assert.deepEqual(structuredClone(harness.core.viewportRef.current), stored);
  assert.equal(harness.core.viewportDirtyRef.current, false);
  harness.cleanup();
});

test("falls back to the document viewport if stored viewport loading fails", async () => {
  const harness = createHarness();
  harness.reads.get("canvas-a").reject(new Error("IndexedDB unavailable"));
  await harness.settle();
  assert.deepEqual(harness.applied, [harness.documentViewport]);
  assert.deepEqual(harness.stateUpdates, [harness.documentViewport]);
  assert.equal(harness.core.viewportVersionRef.current, 0);
  harness.cleanup();
});

test("does not apply a late viewport after unmount cleanup", async () => {
  const harness = createHarness();
  harness.cleanup();
  harness.reads.get("canvas-a").resolve({ x: 500, y: 600, zoom: 2 });
  await harness.settle();
  assert.deepEqual(harness.applied, []);
  assert.deepEqual(harness.stateUpdates, []);
  assert.deepEqual(structuredClone(harness.core.viewportRef.current), harness.documentViewport);
});

test("does not apply the previous canvas's late viewport after switching", async () => {
  const harness = createHarness();
  harness.cleanup();
  const nextViewport = { x: 300, y: 200, zoom: 1.1 };
  harness.core.canvasId = "canvas-b";
  harness.core.initialDocumentRef.current = { viewport: nextViewport, nodes: [] };
  harness.core.viewportRef.current = nextViewport;
  harness.core.viewportVersionRef.current += 1;
  harness.reads.set("canvas-b", deferred());
  harness.render();
  harness.runFrame();
  harness.reads.get("canvas-b").resolve(nextViewport);
  await harness.settle("canvas-b");
  harness.reads.get("canvas-a").resolve({ x: -500, y: -600, zoom: 0.5 });
  await harness.settle("canvas-a");
  assert.deepEqual(harness.applied, [nextViewport]);
  assert.deepEqual(harness.stateUpdates, [nextViewport]);
  assert.deepEqual(structuredClone(harness.core.viewportRef.current), nextViewport);
  harness.cleanup();
});
