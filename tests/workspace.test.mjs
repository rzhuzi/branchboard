import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

// Exercise the real workspace commit/merge flow with deterministic revisioned storage.
const databaseSource = `
  const documents = new Map();
  export const fixture = {
    seed(document) { documents.set(document.id, structuredClone(document)); },
    read(id) { return structuredClone(documents.get(id)); }
  };
  export async function getDocument(id) {
    return structuredClone(documents.get(id) ?? null);
  }
  export async function commitDocument(id, baseRevision, snapshot) {
    const current = documents.get(id);
    if (current.revision !== baseRevision) {
      return { ok: false, kind: "conflict", current: structuredClone(current) };
    }
    const document = { ...snapshot, id, schemaVersion: 2, revision: current.revision + 1 };
    fixture.seed(document);
    return { ok: true, document: structuredClone(document) };
  }
  export function isQuotaError() { return false; }
  export const appendCanvasTab = undefined, ensureRegistry = undefined,
    loadRegistry = undefined, openV2Database = undefined, removeCanvasTab = undefined,
    renameCanvasTab = undefined, setActiveCanvas = undefined;
`;

const { outputFiles } = await build({
  stdin: {
    contents: 'export { createWorkspaceSession } from "./src/shared/workspace.ts"; export { fixture } from "workspace-test-db";',
    resolveDir: fileURLToPath(new URL("..", import.meta.url))
  },
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  plugins: [{
    name: "workspace-storage-fixture",
    setup(plugin) {
      plugin.onResolve({ filter: /^(\.\/db|workspace-test-db)$/ }, () => ({
        path: "database", namespace: "workspace-fixture"
      }));
      plugin.onLoad({ filter: /.*/, namespace: "workspace-fixture" }, () => ({
        contents: databaseSource
      }));
    }
  }]
});

function setup() {
  const module = { exports: {} };
  vm.runInNewContext(outputFiles[0].text, {
    module, exports: module.exports, crypto, structuredClone, BroadcastChannel: undefined
  });
  const { createWorkspaceSession, fixture } = module.exports;
  const session = createWorkspaceSession({ createEmptySnapshot: () => snapshot([]) });
  return { fixture, session };
}

function snapshot(nodes) {
  return { nodes, edges: [], viewport: null, updatedAt: "2026-01-01T00:00:00.000Z" };
}

function document(nodes, revision) {
  return { ...snapshot(nodes), id: "canvas-1", schemaVersion: 2, revision };
}

const prompt = { id: "prompt-1", data: { kind: "prompt", prompt: "original" } };
const image = { id: "image-1", data: { kind: "image", assetId: "asset-1" } };

test("a remote read rejected after local editing preserves both edits on commit", async () => {
  const { fixture, session } = setup();
  fixture.seed(document([prompt], 1));
  await session.loadCanvas("canvas-1");
  fixture.seed(document([prompt, image], 2));

  const remoteRead = session.refreshDocument("canvas-1");
  const local = snapshot([{ ...prompt, data: { ...prompt.data, prompt: "local edit" } }]);
  await remoteRead; // The editor became dirty while reading, so it does not adopt this document.
  const result = await session.commit("canvas-1", local);

  assert.equal(result.ok, true);
  const stored = fixture.read("canvas-1");
  assert.equal(stored.nodes.find((node) => node.id === image.id)?.data.assetId, "asset-1");
  assert.equal(stored.nodes.find((node) => node.id === prompt.id)?.data.prompt, "local edit");
  assert.equal(result.merged, true);
});

test("adopting a remote document advances the base for intentional subsequent deletions", async () => {
  const { fixture, session } = setup();
  fixture.seed(document([prompt], 1));
  await session.loadCanvas("canvas-1");
  fixture.seed(document([prompt, image], 2));

  const remote = await session.refreshDocument("canvas-1");
  session.acceptDocument(remote);
  const result = await session.commit("canvas-1", snapshot([prompt]));

  assert.equal(result.ok, true);
  assert.equal(result.merged, false);
  assert.deepEqual(fixture.read("canvas-1").nodes.map((node) => node.id), [prompt.id]);
});
