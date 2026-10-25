import assert from "node:assert/strict";
import test from "node:test";
import { legacyRelationFor } from "../src/shared/legacy.ts";

test("maps legacy prompt and image relationships to V2 relations", () => {
  assert.equal(legacyRelationFor("prompt", "image"), "generated");
  assert.equal(legacyRelationFor("image", "prompt"), "reference");
  assert.equal(legacyRelationFor("prompt", "prompt"), "branch");
});

test("drops relationships that V2 cannot represent", () => {
  assert.equal(legacyRelationFor("image", "image"), null);
  assert.equal(legacyRelationFor(undefined, "prompt"), null);
});
