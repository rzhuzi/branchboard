import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeFloatingGeometry,
  wheelPanDelta,
  zoomAtPoint
} from "../src/shared/geometry.ts";

test("clamps a saved large-screen floating window into a smaller viewport", () => {
  const geometry = normalizeFloatingGeometry(
    {
      left: "1420px",
      top: "700px",
      width: "900px",
      height: "700px"
    },
    { width: 800, height: 600 },
    { minWidth: 520, minHeight: 420, margin: 8 }
  );

  assert.deepEqual(geometry, { left: 8, top: 8, width: 784, height: 584 });
});

test("allows the floating canvas to fit viewports below its preferred minimum", () => {
  const geometry = normalizeFloatingGeometry(null, { width: 520, height: 372 }, {
    minWidth: 520,
    minHeight: 420,
    defaultWidth: 900,
    defaultHeight: 700,
    margin: 8
  });

  assert.equal(geometry.width, 504);
  assert.equal(geometry.height, 356);
  assert.equal(geometry.left, 8);
  assert.equal(geometry.top, 8);
});

test("converts legacy right and bottom offsets into canonical coordinates", () => {
  const geometry = normalizeFloatingGeometry(
    { right: "18px", bottom: "24px", width: "600px", height: "450px" },
    { width: 1200, height: 800 },
    { margin: 8 }
  );

  assert.equal(geometry.left, 582);
  assert.equal(geometry.top, 326);
  assert.equal(geometry.width, 600);
  assert.equal(geometry.height, 450);
});

test("keeps the flow point under the cursor when zooming", () => {
  const viewport = { x: 100, y: 50, zoom: 1 };
  const point = { x: 200, y: 100 };
  const next = zoomAtPoint(viewport, point, 2);

  assert.deepEqual(next, { x: 0, y: 0, zoom: 2 });
  const flowPoint = {
    x: (point.x - viewport.x) / viewport.zoom,
    y: (point.y - viewport.y) / viewport.zoom
  };
  assert.equal(flowPoint.x * next.zoom + next.x, point.x);
  assert.equal(flowPoint.y * next.zoom + next.y, point.y);
});

test("pans with wheel deltas and supports shift-wheel horizontal panning", () => {
  assert.deepEqual(wheelPanDelta({ deltaX: 5, deltaY: 10, deltaMode: 0 }, 800), {
    x: -5,
    y: -10
  });
  assert.deepEqual(wheelPanDelta({ deltaX: 0, deltaY: 10, deltaMode: 0 }, 800, true), {
    x: -10,
    y: 0
  });
  assert.deepEqual(wheelPanDelta({ deltaX: 0, deltaY: 2, deltaMode: 1 }, 800), {
    x: 0,
    y: -32
  });
});
