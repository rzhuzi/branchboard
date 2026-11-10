import assert from "node:assert/strict";
import test from "node:test";
import {
  findFreePosition,
  placeChild,
  placeIncoming
} from "../src/shared/placement.ts";

function prompt(id, x, y, promptText = "") {
  return {
    id,
    type: "prompt",
    position: { x, y },
    data: {
      kind: "prompt",
      prompt: promptText,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  };
}

function image(id, x, y, width = 1024, height = 1024) {
  return {
    id,
    type: "image",
    position: { x, y },
    data: {
      kind: "image",
      assetId: `asset-${id}`,
      name: id,
      createdAt: "2026-01-01T00:00:00.000Z",
      width,
      height
    }
  };
}

test("places a child to the right of its parent and below existing children", () => {
  const parent = { ...prompt("p1", 0, 0), measured: { width: 380, height: 260 } };
  const child = { ...image("i1", 452, 0), measured: { width: 320, height: 410 } };
  const childSize = { width: 320, height: 240 };
  const position = placeChild(
    [parent, child],
    [
      {
        id: "e1",
        source: "p1",
        target: "i1",
        data: { relation: "generated" }
      }
    ],
    "p1",
    childSize
  );

  assert.equal(position.x, child.position.x, "siblings should share the same column");
  assert.ok(position.x > parent.position.x + parent.measured.width);
  assert.ok(position.y > child.position.y + child.measured.height);
});

test("cascades a new node away from an occupied position", () => {
  const existing = { ...prompt("p1", 0, 0), measured: { width: 380, height: 270 } };
  const size = { width: 320, height: 200 };
  const position = findFreePosition([existing], size, {
    x: 0,
    y: 0
  });

  assert.ok(
    position.x >= existing.position.x + existing.measured.width ||
      position.x + size.width <= existing.position.x ||
      position.y >= existing.position.y + existing.measured.height ||
      position.y + size.height <= existing.position.y,
    "the returned rectangle must not overlap the measured existing node"
  );
});

test("places a reference image to the left of a prompt without overlapping it", () => {
  const target = { ...prompt("p1", 500, 300), measured: { width: 300, height: 240 } };
  const size = { width: 320, height: 200 };
  const position = placeIncoming([target], [], "p1", size);

  assert.ok(position.x + size.width < target.position.x);
  assert.equal(
    position.y + size.height / 2,
    target.position.y + target.measured.height / 2,
    "the first reference should align with the prompt's measured vertical center"
  );
});

test("stacks incoming reference images above existing references", () => {
  const target = { ...prompt("p1", 500, 300), measured: { width: 300, height: 240 } };
  const first = { ...image("i1", 116, 300), measured: { width: 320, height: 390 } };
  const size = { width: 320, height: 220 };
  const position = placeIncoming(
    [target, first],
    [
      {
        id: "e1",
        source: "i1",
        target: "p1",
        data: { relation: "reference" }
      }
    ],
    "p1",
    size
  );

  assert.equal(position.x, first.position.x);
  assert.ok(position.y + size.height < first.position.y);
});
