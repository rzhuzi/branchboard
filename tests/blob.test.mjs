import assert from "node:assert/strict";
import test from "node:test";
import {
  bytesToHex,
  dataUrlToBlob,
  sha256Hex,
  uniqueByKey
} from "../src/shared/blob.ts";

test("keeps only one generated image for repeated DOM copies of the same URL", () => {
  const first = { src: "https://chatgpt.com/image/one" };
  const result = uniqueByKey(
    [first, { src: first.src }, { src: first.src }],
    (image) => image.src
  );
  assert.equal(result.length, 1);
  assert.equal(result[0], first);
});

test("formats content digests as stable hexadecimal keys", async () => {
  assert.equal(bytesToHex(new Uint8Array([0, 15, 16, 127, 255])), "000f107fff");
  const first = new TextEncoder().encode("same generated image");
  const duplicate = new TextEncoder().encode("same generated image");
  const different = new TextEncoder().encode("different generated image");
  assert.equal(await sha256Hex(first), await sha256Hex(duplicate));
  assert.notEqual(await sha256Hex(first), await sha256Hex(different));
});

test("decodes base64 image data URLs into blobs", async () => {
  const blob = dataUrlToBlob("data:image/png;base64,aGVsbG8=");
  assert.equal(blob.type, "image/png");
  assert.equal(await blob.text(), "hello");
});
