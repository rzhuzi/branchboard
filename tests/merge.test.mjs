import assert from "node:assert/strict";
import test from "node:test";
import { mergeCanvasSnapshots } from "../src/shared/merge.ts";

function promptNode(overrides = {}) {
  return {
    id: "prompt-1",
    type: "prompt",
    position: { x: 40, y: 60 },
    data: {
      kind: "prompt",
      prompt: "原始提示词",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    ...overrides
  };
}

function snapshot(nodes, edges = [], viewport = null) {
  return {
    nodes,
    edges,
    viewport,
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

test("preserves independent edits made in two ChatGPT tabs", () => {
  const base = promptNode();
  const local = {
    ...base,
    data: { ...base.data, prompt: "标签页 A 修改提示词" }
  };
  const remote = {
    ...base,
    position: { x: 300, y: 120 }
  };

  const merged = mergeCanvasSnapshots(
    snapshot([base]),
    snapshot([local]),
    snapshot([remote])
  );

  assert.equal(merged.nodes[0].data.prompt, "标签页 A 修改提示词");
  assert.deepEqual(merged.nodes[0].position, { x: 300, y: 120 });
});

test("keeps a remote generated image while preserving a local node move", () => {
  const base = promptNode();
  const moved = { ...base, position: { x: 260, y: 180 } };
  const imageNode = {
    id: "image-result-1",
    type: "image",
    position: { x: 500, y: 180 },
    data: {
      kind: "image",
      assetId: "asset-1",
      name: "生成结果",
      createdAt: "2026-01-01T00:01:00.000Z",
      width: 1024,
      height: 1024
    }
  };

  const merged = mergeCanvasSnapshots(
    snapshot([base]),
    snapshot([moved]),
    snapshot([base, imageNode])
  );

  assert.deepEqual(merged.nodes[0].position, { x: 260, y: 180 });
  assert.equal(merged.nodes[1].id, "image-result-1");
});

test("accepts an unchanged remote deletion but retains a locally edited entity", () => {
  const base = promptNode();
  const unchangedDeletion = mergeCanvasSnapshots(
    snapshot([base]),
    snapshot([base]),
    snapshot([])
  );
  assert.equal(unchangedDeletion.nodes.length, 0);

  const edited = {
    ...base,
    data: { ...base.data, prompt: "删除前仍有本地修改" }
  };
  const editedDeletion = mergeCanvasSnapshots(
    snapshot([base]),
    snapshot([edited]),
    snapshot([])
  );
  assert.equal(editedDeletion.nodes[0].data.prompt, "删除前仍有本地修改");
});

test("keeps the viewport of the tab that saves", () => {
  const localViewport = { x: 100, y: 200, zoom: 1.4 };
  const remoteViewport = { x: -400, y: 90, zoom: 0.7 };
  const merged = mergeCanvasSnapshots(
    snapshot([], [], { x: 0, y: 0, zoom: 1 }),
    snapshot([], [], localViewport),
    snapshot([], [], remoteViewport)
  );
  assert.deepEqual(merged.viewport, localViewport);
});

test("keeps a remote result without a dangling edge when its prompt was deleted locally", () => {
  const prompt = promptNode();
  const image = {
    id: "image-result-1",
    type: "image",
    position: { x: 500, y: 180 },
    data: { kind: "image", assetId: "asset-1" }
  };
  const generated = {
    id: "generated-1",
    source: prompt.id,
    target: image.id,
    data: { relation: "generated" }
  };

  const merged = mergeCanvasSnapshots(
    snapshot([prompt]),
    snapshot([]),
    snapshot([prompt, image], [generated])
  );

  assert.deepEqual(merged.nodes.map((node) => node.id), [image.id]);
  assert.deepEqual(merged.edges, []);
});
