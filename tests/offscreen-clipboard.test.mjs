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

async function runImageCopy({ clipboardError = null } = {}) {
  let listener = null;
  let clipboardApiWrites = 0;
  let fallbackImageSource = "";
  let activeElement = null;
  let selectedElement = null;

  const selection = {
    removeAllRanges() {
      selectedElement = null;
    },
    addRange(range) {
      selectedElement = range.selectedElement;
    }
  };

  const document = {
    body: {
      appendChild(element) {
        element.isConnected = true;
      }
    },
    createElement(tagName) {
      if (tagName === "canvas") {
        return {
          width: 0,
          height: 0,
          getContext() {
            return { drawImage() {} };
          },
          toBlob(callback) {
            callback(new Blob(["png"], { type: "image/png" }));
          }
        };
      }
      if (tagName === "div") {
        return {
          children: [],
          style: {},
          isConnected: false,
          setAttribute() {},
          appendChild(element) {
            this.children.push(element);
          },
          focus() {
            activeElement = this;
          },
          remove() {
            this.isConnected = false;
            if (activeElement === this) activeElement = null;
          }
        };
      }
      if (tagName === "img") {
        return { src: "", alt: "" };
      }
      throw new Error(`Unexpected element: ${tagName}`);
    },
    createRange() {
      return {
        selectedElement: null,
        selectNode(element) {
          this.selectedElement = element;
        }
      };
    },
    execCommand(command) {
      assert.equal(command, "copy");
      fallbackImageSource = selectedElement?.src ?? "";
      return Boolean(fallbackImageSource);
    }
  };

  class MockImage {
    naturalWidth = 16;
    naturalHeight = 16;

    set src(value) {
      this._src = value;
      queueMicrotask(() => this.onload?.());
    }

    get src() {
      return this._src;
    }
  }

  class MockClipboardItem {
    constructor(items) {
      this.items = items;
    }
  }

  const context = vm.createContext({
    Blob,
    ClipboardItem: MockClipboardItem,
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
    Error,
    Image: MockImage,
    navigator: {
      clipboard: {
        async write() {
          if (clipboardError) throw clipboardError;
          clipboardApiWrites += 1;
        }
      }
    },
    queueMicrotask,
    window: {
      getSelection() {
        return selection;
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
        format: "image",
        dataUrl: "data:image/png;base64,aW1hZ2U="
      },
      {},
      resolve
    );
    assert.equal(keepAlive, true);
  });

  return { response, clipboardApiWrites, fallbackImageSource };
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

test("falls back to a selected image when the image Clipboard API is blocked", async () => {
  const result = await runImageCopy({
    clipboardError: new DOMException(
      "Clipboard API blocked by permissions policy",
      "NotAllowedError"
    )
  });
  assert.equal(result.response.ok, true);
  assert.equal(result.clipboardApiWrites, 0);
  assert.equal(result.fallbackImageSource, "data:image/png;base64,aW1hZ2U=");
});
