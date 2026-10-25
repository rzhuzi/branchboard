import assert from "node:assert/strict";
import test from "node:test";
import { integratePendingIntoSnapshot } from "../src/shared/integration.ts";

function prompt(id, x = 0, y = 0) {
  return {
    id,
    type: "prompt",
    position: { x, y },
    data: {
      kind: "prompt",
      prompt: "a cat",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  };
}

function snapshot(nodes = []) {
  return {
    nodes,
    edges: [],
    viewport: null,
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function record(overrides = {}) {
  return {
    id: "pending-1",
    assetId: "asset-1",
    requestId: "request-1",
    canvasId: "canvas-1",
    promptId: "p1",
    name: "generated",
    width: 1024,
    height: 1024,
    createdAt: "2026-01-01T00:01:00.000Z",
    relation: "generated",
    ...overrides
  };
}

test("attaches generated results to the initiating prompt", () => {
  const result = integratePendingIntoSnapshot(snapshot([prompt("p1")]), [
    record()
  ]);

  assert.equal(result.addedNodeIds.length, 1);
  assert.equal(result.snapshot.nodes[1].id, "image-asset-1");
  assert.equal(result.snapshot.nodes[1].data.kind, "image");
  assert.equal(result.snapshot.edges.length, 1);
  assert.equal(result.snapshot.edges[0].source, "p1");
  assert.equal(result.snapshot.edges[0].target, "image-asset-1");
  assert.equal(result.snapshot.edges[0].data.relation, "generated");
});

test("does not connect an imported image without an explicit prompt", () => {
  const result = integratePendingIntoSnapshot(snapshot([prompt("p1")]), [
    record({ promptId: undefined, relation: undefined, position: { x: 900, y: 900 } })
  ]);

  assert.equal(result.snapshot.nodes.length, 2);
  assert.equal(result.snapshot.edges.length, 0);
  assert.deepEqual(result.snapshot.nodes[1].position, { x: 900, y: 900 });
});

test("creates an image-to-prompt reference relationship", () => {
  const result = integratePendingIntoSnapshot(snapshot([prompt("p1")]), [
    record({ relation: "reference" })
  ]);

  assert.equal(result.snapshot.edges.length, 1);
  assert.equal(result.snapshot.edges[0].source, "image-asset-1");
  assert.equal(result.snapshot.edges[0].target, "p1");
  assert.equal(result.snapshot.edges[0].data.relation, "reference");
});

test("skips a result whose asset is already present", () => {
  const first = integratePendingIntoSnapshot(snapshot([prompt("p1")]), [record()]);
  const second = integratePendingIntoSnapshot(first.snapshot, [record()]);

  assert.equal(second.addedNodeIds.length, 0);
  assert.equal(second.snapshot.nodes.length, 2);
  assert.equal(second.snapshot.edges.length, 1);
});

test("falls back to a standalone image when the prompt was deleted", () => {
  const result = integratePendingIntoSnapshot(snapshot([]), [record()]);

  assert.equal(result.snapshot.nodes.length, 1);
  assert.equal(result.snapshot.edges.length, 0);
});
