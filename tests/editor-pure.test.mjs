import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_HISTORY,
  MAX_REFERENCES,
  downloadFileName,
  firstLineTitle,
  positionsChanged,
  prepareEdges,
  prepareNodes,
  relationForConnection,
  sanitizeEdge,
  sanitizeNode,
  savedEdgeId,
  snapshotFromDocument
} from "../src/canvas/state/editorPure.ts";

function promptNode(id, overrides = {}) {
  return {
    id,
    type: "prompt",
    position: { x: 0, y: 0 },
    data: {
      kind: "prompt",
      prompt: "提示词",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    ...overrides
  };
}

function imageNode(id, overrides = {}) {
  return {
    id,
    type: "image",
    position: { x: 100, y: 0 },
    data: {
      kind: "image",
      assetId: `asset-${id}`,
      name: "图片",
      createdAt: "2026-01-01T00:00:00.000Z",
      width: 1024,
      height: 1024
    },
    ...overrides
  };
}

function edge(source, target, data) {
  return {
    id: `edge-${source}-${target}`,
    source,
    target,
    type: "relation",
    ...(data ? { data } : {})
  };
}

test("editor constants stay fixed", () => {
  assert.equal(MAX_HISTORY, 60);
  assert.equal(MAX_REFERENCES, 4);
});

test("firstLineTitle takes the first line and truncates to 48 chars", () => {
  assert.equal(firstLineTitle("第一行\n第二行"), "第一行");
  assert.equal(firstLineTitle("x".repeat(60)).length, 48);
  assert.equal(firstLineTitle("   \n  "), "生成图片");
});

test("sanitizeNode keeps only id/type/position/data", () => {
  const node = promptNode("p1", { selected: true, dragging: true, measured: { width: 10 } });
  const sanitized = sanitizeNode(node);
  assert.deepEqual(Object.keys(sanitized).sort(), ["data", "id", "position", "type"]);
  assert.equal(sanitized.data.kind, "prompt");
});

test("sanitizeEdge defaults relation to generated", () => {
  const withoutRelation = sanitizeEdge(edge("a", "b"));
  assert.equal(withoutRelation.data.relation, "generated");
  assert.equal(withoutRelation.type, "relation");
  const withRelation = sanitizeEdge(edge("a", "b", { relation: "branch" }));
  assert.equal(withRelation.data.relation, "branch");
});

test("prepareNodes clears selection and dragging flags", () => {
  const prepared = prepareNodes([
    promptNode("p1", { selected: true }),
    imageNode("i1", { dragging: true })
  ]);
  assert.equal(prepared.every((node) => !node.selected && !node.dragging), true);
});

test("prepareEdges infers relations from node kinds", () => {
  const nodes = [promptNode("p1"), promptNode("p2"), imageNode("i1")];
  const prepared = prepareEdges(
    [
      edge("p1", "i1"),
      edge("i1", "p1"),
      edge("p1", "p2"),
      edge("i1", "i1"),
      edge("p1", "ghost")
    ],
    nodes
  );
  assert.deepEqual(
    prepared.map((item) => item.data.relation),
    ["generated", "reference", "branch"]
  );
});

test("prepareEdges keeps an explicit relation", () => {
  const nodes = [promptNode("p1"), imageNode("i1")];
  const prepared = prepareEdges([edge("p1", "i1", { relation: "reference" })], nodes);
  assert.deepEqual(prepared.map((item) => item.data.relation), ["reference"]);
});

test("positionsChanged detects real movement only", () => {
  const before = { nodes: [promptNode("p1")], edges: [] };
  const same = { nodes: [promptNode("p1")], edges: [] };
  const drifted = { nodes: [promptNode("p1", { position: { x: 0.3, y: 0.4 } })], edges: [] };
  const moved = { nodes: [promptNode("p1", { position: { x: 30, y: 0 } })], edges: [] };
  const resized = { nodes: [promptNode("p1"), promptNode("p2")], edges: [] };
  assert.equal(positionsChanged(before, same), false);
  assert.equal(positionsChanged(before, drifted), false);
  assert.equal(positionsChanged(before, moved), true);
  assert.equal(positionsChanged(before, resized), true);
});

test("relationForConnection only allows image→prompt and prompt→prompt", () => {
  assert.equal(relationForConnection(imageNode("i1"), promptNode("p1")), "reference");
  assert.equal(relationForConnection(promptNode("p1"), promptNode("p2")), "branch");
  assert.equal(relationForConnection(promptNode("p1"), imageNode("i1")), null);
  assert.equal(relationForConnection(promptNode("p1"), promptNode("p1")), null);
  assert.equal(relationForConnection(undefined, promptNode("p1")), null);
});

test("savedEdgeId embeds the relation suffix", () => {
  const id = savedEdgeId("generated");
  assert.match(id, /^edge-[0-9a-f-]{36}-generated$/);
});

test("downloadFileName sanitizes illegal characters and falls back", () => {
  assert.equal(downloadFileName('a<b>/c:d*e?f"g|h', "image/png"), "a_b__c_d_e_f_g_h.png");
  assert.equal(downloadFileName("   ", "image/jpeg"), "branchboard-image.jpg");
  assert.equal(downloadFileName("photo", "image/svg+xml"), "photo.svg");
});

test("snapshotFromDocument maps the persistence fields", () => {
  const document = {
    id: "canvas-1",
    schemaVersion: 2,
    revision: 7,
    nodes: [promptNode("p1")],
    edges: [],
    viewport: { x: 1, y: 2, zoom: 0.5 },
    updatedAt: "2026-02-02T00:00:00.000Z"
  };
  const snapshot = snapshotFromDocument(document);
  assert.deepEqual(snapshot, {
    nodes: document.nodes,
    edges: [],
    viewport: document.viewport,
    updatedAt: document.updatedAt
  });
});
