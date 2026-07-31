import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../public/offscreen.js", import.meta.url),
  "utf8"
);

async function runTextCopy({ clipboardError = null } = {}) {
  let listener = null;
  let clipboardApiText = "";
  let fallbackText = "";

  const document = {
    activeElement: null,
    body: {
      appendChild() {}
    },
    createElement(tagName) {
      assert.equal(tagName, "textarea");
      return {
        value: "",
        style: {},
        setAttribute() {},
        focus() {
          document.activeElement = this;
        },
        select() {},
        setSelectionRange() {},
        remove() {
          if (document.activeElement === this) {
            document.activeElement = null;
          }
        }
      };
    },
    execCommand(command) {
      assert.equal(command, "copy");
      fallbackText = document.activeElement?.value ?? "";
      return true;
    }
  };

  const context = vm.createContext({
    chrome: {
      runtime: {
        onMessage: {
          addListener(nextListener) {
            listener = nextListener;
          }
        }
      }
    },
    console,
    document,
    DOMException,
    Error,
    HTMLTextAreaElement: Object,
    Image: class {},
    navigator: {
      clipboard: {
        async writeText(text) {
          if (clipboardError) throw clipboardError;
          clipboardApiText = text;
        }
      }
    }
  });
  vm.runInContext(source, context, { filename: "public/offscreen.js" });
  assert.equal(typeof listener, "function");

  const response = await new Promise((resolve) => {
    const keepAlive = listener(
      {
        target: "offscreen",
        type: "branchboard:offscreen-clipboard-write",
        format: "text",
        text: "manual-copy-test"
      },
      {},
      resolve
    );
    assert.equal(keepAlive, true);
  });

  return { response, clipboardApiText, fallbackText };
}

test("uses Clipboard API when it is available", async () => {
  const result = await runTextCopy();
  assert.equal(result.response.ok, true);
  assert.equal(result.clipboardApiText, "manual-copy-test");
  assert.equal(result.fallbackText, "");
});

test("falls back when Clipboard API is blocked by permissions policy", async () => {
  const result = await runTextCopy({
    clipboardError: new DOMException(
      "Clipboard API blocked by permissions policy",
      "NotAllowedError"
    )
  });
  assert.equal(result.response.ok, true);
  assert.equal(result.clipboardApiText, "");
  assert.equal(result.fallbackText, "manual-copy-test");
});

