import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../public/runtime-utils.js", import.meta.url),
  "utf8"
);
const context = vm.createContext({});
vm.runInContext(source, context, { filename: "public/runtime-utils.js" });
const { normalizeFloatingGeometry } =
  context.__branchboardRuntimeUtils;

test("clamps a saved large-screen window into a smaller viewport", () => {
  const geometry = normalizeFloatingGeometry(
    {
      left: "1420px",
      top: "700px",
      width: "860px",
      height: "690px"
    },
    { width: 800, height: 600 },
    { minWidth: 520, minHeight: 420, margin: 8 }
  );

  assert.deepEqual(
    { ...geometry },
    { left: 8, top: 8, width: 784, height: 584 }
  );
});

test("allows the floating canvas to fit viewports below its preferred minimum", () => {
  const geometry = normalizeFloatingGeometry(
    null,
    { width: 520, height: 372 },
    {
      minWidth: 520,
      minHeight: 420,
      defaultWidth: 860,
      defaultHeight: 690,
      margin: 8
    }
  );

  assert.equal(geometry.width, 504);
  assert.equal(geometry.height, 356);
  assert.equal(geometry.left, 8);
  assert.equal(geometry.top, 8);
});

test("converts legacy right and bottom offsets into canonical coordinates", () => {
  const geometry = normalizeFloatingGeometry(
    {
      right: "18px",
      bottom: "24px",
      width: "600px",
      height: "450px"
    },
    { width: 1200, height: 800 },
    { margin: 8 }
  );

  assert.equal(geometry.left, 582);
  assert.equal(geometry.top, 326);
  assert.equal(geometry.width, 600);
  assert.equal(geometry.height, 450);
});
