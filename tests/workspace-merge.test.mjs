import assert from "node:assert/strict";
import test from "node:test";
import { mergeCanvasSnapshots } from "../src/shared/workspaceMerge.ts";

function promptNode(overrides = {}) {
  return {
    id: "prompt-1",
    type: "prompt",
    position: { x: 40, y: 60 },
    data: {
      kind: "prompt",
      title: "原始标题",
      prompt: "原始提示词",
      createdAt: "2026-01-01T00:00:00.000Z"
    },
    ...overrides
  };
}

function snapshot(nodes, edges = []) {
  return {
    version: 1,
    nodes,
    edges,
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

test("preserves independent edits made in two ChatGPT tabs", () => {
  const baseNode = promptNode();
  const localNode = {
    ...baseNode,
    data: { ...baseNode.data, title: "标签页 A 修改标题" }
  };
  const remoteNode = {
    ...baseNode,
    data: { ...baseNode.data, prompt: "标签页 B 修改提示词" }
  };

  const merged = mergeCanvasSnapshots(
    snapshot([baseNode]),
    snapshot([localNode]),
    snapshot([remoteNode])
  );

  assert.equal(merged.nodes[0].data.title, "标签页 A 修改标题");
  assert.equal(merged.nodes[0].data.prompt, "标签页 B 修改提示词");
});

test("keeps a remote generated image while preserving a local node move", () => {
  const baseNode = promptNode();
  const movedNode = { ...baseNode, position: { x: 260, y: 180 } };
  const imageNode = {
    id: "image-result-1",
    type: "image",
    position: { x: 500, y: 180 },
    data: {
      kind: "image",
      name: "生成结果",
      dataUrl: "data:image/png;base64,AA==",
      createdAt: "2026-01-01T00:01:00.000Z"
    }
  };

  const merged = mergeCanvasSnapshots(
    snapshot([baseNode]),
    snapshot([movedNode]),
    snapshot([baseNode, imageNode])
  );

  assert.deepEqual(merged.nodes[0].position, { x: 260, y: 180 });
  assert.equal(merged.nodes[1].id, "image-result-1");
});

test("accepts an unchanged remote deletion but retains a locally edited entity", () => {
  const baseNode = promptNode();
  const unchangedDeletion = mergeCanvasSnapshots(
    snapshot([baseNode]),
    snapshot([baseNode]),
    snapshot([])
  );
  assert.equal(unchangedDeletion.nodes.length, 0);

  const editedNode = {
    ...baseNode,
    data: { ...baseNode.data, title: "删除前仍有本地修改" }
  };
  const editedDeletion = mergeCanvasSnapshots(
    snapshot([baseNode]),
    snapshot([editedNode]),
    snapshot([])
  );
  assert.equal(editedDeletion.nodes[0].data.title, "删除前仍有本地修改");
});

