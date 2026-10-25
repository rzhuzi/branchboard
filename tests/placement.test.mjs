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
  const parent = prompt("p1", 0, 0);
  const child = image("i1", 392, 0);
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
    { width: 320, height: 240 }
  );

  assert.equal(position.x, 392);
  assert.equal(position.y, 360);
});

test("cascades a new node away from an occupied position", () => {
  const existing = prompt("p1", 0, 0);
  const position = findFreePosition([existing], { width: 320, height: 200 }, {
    x: 0,
    y: 0
  });

  const overlaps =
    position.x < 320 + 36 &&
    position.x + 320 + 36 > 0 &&
    position.y < 196 + 36 &&
    position.y + 200 + 36 > 0;
  assert.equal(overlaps, false);
});

test("places a reference image to the left of a prompt without overlapping it", () => {
  const target = prompt("p1", 500, 300);
  const position = placeIncoming([target], [], "p1", { width: 320, height: 200 });

  assert.equal(position.x, 116);
  assert.equal(position.y, 300);
});

test("stacks incoming reference images above existing references", () => {
  const target = prompt("p1", 500, 300);
  const first = image("i1", 116, 300);
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
    { width: 320, height: 220 }
  );

  assert.equal(position.x, 116);
  assert.ok(position.y < 300);
});
