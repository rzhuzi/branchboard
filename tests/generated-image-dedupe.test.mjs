import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../public/runtime-utils.js", import.meta.url),
  "utf8"
);
const context = vm.createContext({});
vm.runInContext(source, context, { filename: "public/runtime-utils.js" });
const { uniqueByKey, bytesToHex, sha256Hex } =
  context.__branchboardRuntimeUtils;

test("keeps only one generated image for repeated DOM copies of the same URL", () => {
  const first = { src: "https://chatgpt.com/image/one" };
  const result = uniqueByKey(
    [first, { src: first.src }, { src: first.src }],
    (image) => image.src
  );
  assert.equal(result.length, 1);
  assert.equal(result[0], first);
});

test("keeps genuinely different generated image URLs", () => {
  const images = [
    { src: "https://chatgpt.com/image/one" },
    { src: "https://chatgpt.com/image/two" },
    { src: "https://chatgpt.com/image/three" }
  ];
  const result = uniqueByKey(images, (image) => image.src);
  assert.equal(result.length, 3);
  assert.equal(result[0], images[0]);
  assert.equal(result[1], images[1]);
  assert.equal(result[2], images[2]);
});

test("formats content digests as stable hexadecimal keys", () => {
  assert.equal(
    bytesToHex(new Uint8Array([0, 15, 16, 127, 255])),
    "000f107fff"
  );
});

test("uses image bytes rather than URLs for the final duplicate key", async () => {
  const first = new TextEncoder().encode("same generated image");
  const duplicate = new TextEncoder().encode("same generated image");
  const different = new TextEncoder().encode("different generated image");
  const firstHash = await sha256Hex(first, webcrypto.subtle);
  const duplicateHash = await sha256Hex(duplicate, webcrypto.subtle);
  const differentHash = await sha256Hex(different, webcrypto.subtle);
  assert.equal(firstHash, duplicateHash);
  assert.notEqual(firstHash, differentHash);
});
