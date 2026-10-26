import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const bundle = await build({
  stdin: {
    contents: `
      export { useEditorImages } from "./src/canvas/state/useEditorImages.ts";
      export { useEditorNodes } from "./src/canvas/state/useEditorNodes.ts";
      export { useEditorHistory } from "./src/canvas/state/useEditorHistory.ts";
    `,
    resolveDir: fileURLToPath(new URL("..", import.meta.url))
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["react", "@xyflow/react"]
});
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, {
  module,
  exports: module.exports,
  crypto: globalThis.crypto,
  require: (name) => name === "react"
    ? { useCallback: (callback) => callback }
    : require(name)
}, { filename: "editor-commands.cjs" });
const { useEditorImages, useEditorNodes, useEditorHistory } = module.exports;

function promptNode(id = "prompt-1", text = "a cat") {
  return {
    id,
    type: "prompt",
    position: { x: 0, y: 0 },
    data: {
      kind: "prompt",
      prompt: text,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  };
}

function imageNode(id = "image-1") {
  return {
    id,
    type: "image",
    position: { x: 400, y: 0 },
    data: {
      kind: "image",
      assetId: `asset-${id}`,
      name: "reference.png",
      width: 1024,
      height: 1024,
      createdAt: "2026-01-01T00:00:00.000Z"
    }
  };
}

function createCore(nodes = [promptNode()], edges = []) {
  const core = {
    nodesRef: { current: nodes },
    edgesRef: { current: edges },
    viewportRef: { current: { x: 0, y: 0, zoom: 1 } },
    canvasIdRef: { current: "canvas-a" },
    historiesRef: { current: new Map() },
    selectedIdsRef: { current: [] },
    dragStartRef: { current: null },
    undoRef: { current: () => {} },
    dirtyCount: 0,
    historyVersion: 0,
    markDirty() { core.dirtyCount += 1; },
    setHistoryVersion(update) {
      core.historyVersion = update(core.historyVersion);
    },
    setSelectedCount() {},
    applyState(nextNodes, nextEdges) {
      core.nodesRef.current = nextNodes;
      core.edgesRef.current = nextEdges;
    }
  };
  return core;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function generationHarness(getDataUrl) {
  const core = createCore([promptNode(), imageNode()], [{
    id: "reference-1",
    source: "image-1",
    target: "prompt-1",
    data: { relation: "reference" }
  }]);
  const requests = [];
  const toasts = [];
  const actions = useEditorImages(core, {}, {
    embedded: true,
    getDataUrl,
    runPrompt(request) { requests.push(request); return true; },
    pushToast(message, options) { toasts.push({ message, ...options }); }
  });
  return { core, actions, requests, toasts };
}

test("does not send a prepared generation after switching canvases", async () => {
  const loading = deferred();
  const { core, actions, requests } = generationHarness(() => loading.promise);
  const generating = actions.generatePrompt("prompt-1");
  core.canvasIdRef.current = "canvas-b";
  core.nodesRef.current = [promptNode("prompt-2")];
  loading.resolve("data:image/png;base64,aW1hZ2U=");
  await generating;
  assert.equal(requests.length, 0);
});

test("does not send a prepared generation after its prompt was deleted", async () => {
  const loading = deferred();
  const { core, actions, requests } = generationHarness(() => loading.promise);
  const generating = actions.generatePrompt("prompt-1");
  core.nodesRef.current = core.nodesRef.current.filter((node) => node.id !== "prompt-1");
  loading.resolve("data:image/png;base64,aW1hZ2U=");
  await generating;
  assert.equal(requests.length, 0);
});

test("does not send a generation with a missing reference image", async () => {
  const { actions, requests, toasts } = generationHarness(async () => {
    throw new Error("图片资源不存在或已被删除");
  });
  await actions.generatePrompt("prompt-1");
  assert.equal(requests.length, 0);
  assert.equal(toasts.some((toast) => toast.tone === "error" && toast.message.includes("参考图")), true);
});

test("sends a valid generation with its original canvas and reference", async () => {
  const dataUrl = "data:image/png;base64,aW1hZ2U=";
  const { actions, requests } = generationHarness(async () => dataUrl);
  await actions.generatePrompt("prompt-1");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].canvasId, "canvas-a");
  assert.equal(requests[0].promptId, "prompt-1");
  assert.equal(requests[0].prompt, "a cat");
  assert.equal(requests[0].references.length, 1);
  assert.equal(requests[0].references[0].dataUrl, dataUrl);
});

function historyHarness() {
  const original = promptNode();
  const core = createCore([original, promptNode("branch-1")]);
  const history = { past: [{ nodes: [original], edges: [] }], future: [] };
  core.historiesRef.current.set("canvas-a", history);
  const historyActions = useEditorHistory(core, { cancelPrompt() {} });
  const nodeActions = useEditorNodes(core, {}, { cancelPrompt() {}, pushToast() {} });
  historyActions.undo();
  assert.equal(history.future.length, 1);
  return { core, history, historyActions, nodeActions };
}

test("editing a prompt after undo prevents redo from replacing the new text", () => {
  const { core, history, historyActions, nodeActions } = historyHarness();
  nodeActions.updatePrompt("prompt-1", "a dog");
  historyActions.redo();
  assert.equal(core.nodesRef.current[0].data.prompt, "a dog");
  assert.equal(core.nodesRef.current.length, 1);
  assert.equal(history.future.length, 0);
});

test("unchanged or missing prompts preserve redo and other canvases keep their history", () => {
  const { core, history, nodeActions } = historyHarness();
  const otherHistory = { past: [], future: [{ nodes: [promptNode("other")], edges: [] }] };
  core.historiesRef.current.set("canvas-b", otherHistory);
  const dirtyBefore = core.dirtyCount;
  nodeActions.updatePrompt("prompt-1", "a cat");
  nodeActions.updatePrompt("missing", "a dog");
  assert.equal(history.future.length, 1);
  assert.equal(core.dirtyCount, dirtyBefore);
  nodeActions.updatePrompt("prompt-1", "a dog");
  assert.equal(otherHistory.future.length, 1);
});
