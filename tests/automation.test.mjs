import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { transformSync } from "esbuild";

const source = transformSync(
  await readFile(new URL("../src/content/automation.ts", import.meta.url), "utf8"),
  { loader: "ts", format: "cjs", target: "es2022" }
).code;

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createHarness({
  pauseAt = "waiting", secondImageAt = 0, generatingUntil = 0,
  pendingUntil = 0, loadedThumbnail = false, imageAt = 0,
  assistantText = false, textOnly = false, responseCompleteAt = 0,
  imagePlaceholder = true
} = {}) {
  const paused = deferred();
  const resume = deferred();
  const events = [];
  const stored = [];
  const composer = {};
  const image = { currentSrc: "https://chatgpt.com/image/result", complete: true, naturalWidth: 1024, naturalHeight: 1024 };
  const secondImage = { ...image, currentSrc: "https://chatgpt.com/image/second" };
  let clock = 1;
  let text = "";
  let runCount = 0;
  let didPause = false;
  const dom = {
    findComposer: () => composer,
    composerText: () => text,
    fillComposer(_composer, prompt) {
      runCount += 1;
      text = prompt;
    },
    findSendButton: () => ({ click() { text = ""; } }),
    findStopButton: () => ({ click() {} }),
    captureConversationBaseline: () => ({ latestTurn: 0, turnKeys: new Set() }),
    generatedImageKeys: () => new Set(),
    newGeneratedImages: () => textOnly || clock < imageAt || (pauseAt === "waiting" && runCount === 1) ? [] : secondImageAt && clock >= secondImageAt ? [image, secondImage] : [image],
    newAssistantTurns: () => assistantText || pendingUntil || loadedThumbnail ? [{
      querySelectorAll: () => textOnly || clock < imageAt ? [] : [
        image,
        ...(pendingUntil ? [{ ...secondImage, complete: clock >= pendingUntil }] : []),
        ...(loadedThumbnail ? [{ ...image, naturalWidth: 64, naturalHeight: 64 }] : [])
      ]
    }] : [],
    isResponseGenerating: () => clock < generatingUntil,
    isAssistantResponseComplete: () => clock >= responseCompleteAt,
    hasImageGenerationPlaceholder: () => imagePlaceholder,
    isGeneratedImage: () => true,
    generatedImageName: (image) => image.currentSrc,
    async wait(milliseconds) {
      if (pauseAt === "waiting" && milliseconds === 900 && !didPause) {
        didPause = true;
        paused.resolve();
        await resume.promise;
      }
      clock += milliseconds;
    }
  };
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require(name) {
      if (name === "./dom") return dom;
      if (name === "../shared/messages") return { MSG: { storeImage: "store-image" } };
      if (name === "../shared/blob") {
        return {
          blobToDataUrl: async () => "data:image/png;base64,aW1hZ2U=",
          sha256Hex: async (blob) => blob.url
        };
      }
      throw new Error(`Unexpected import: ${name}`);
    },
    DOMException,
    AbortController,
    Date: { now: () => clock },
    fetch: async (url) => ({ ok: true, blob: async () => ({ url }) }),
    chrome: {
      runtime: {
        async sendMessage(message) {
          if (pauseAt === "storage" && !didPause) {
            didPause = true;
            paused.resolve();
            await resume.promise;
          }
          stored.push({ name: message.name, at: clock });
          return { ok: true };
        }
      }
    }
  });
  vm.runInContext(source, context, { filename: "src/content/automation.ts" });
  const api = module.exports;
  const hooks = {
    report(request, stage, message) {
      events.push({ requestId: request.requestId, stage, message, active: api.hasActiveAutomation(), at: clock });
    },
    onRunning() {},
    onFinished() {},
    onError() {}
  };
  return { api, hooks, events, stored, paused: paused.promise, resume: resume.resolve };
}

function request(id) {
  return { requestId: id, canvasId: "canvas", promptId: id, title: id, prompt: "a cat", references: [] };
}

test("acknowledges cancellation once after releasing the active execution", async () => {
  const harness = createHarness();
  const first = harness.api.executePrompt(request("first"), harness.hooks);
  await harness.paused;
  try {
    harness.api.cancelAutomation(["first"], harness.hooks);
    harness.api.cancelAutomation(["first"], harness.hooks);
    assert.equal(harness.api.hasActiveAutomation(), true);
    assert.equal(harness.events.filter((event) => event.stage === "cancelled").length, 0);
  } finally {
    harness.resume();
    await first;
  }
  const cancelled = harness.events.filter((event) => event.stage === "cancelled");
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].active, false);
});

test("a queued prompt can start as soon as cancellation is acknowledged", async () => {
  const harness = createHarness();
  let next;
  const hooks = {
    ...harness.hooks,
    report(request, stage, message) {
      harness.hooks.report(request, stage, message);
      if (request.requestId === "first" && stage === "cancelled") {
        next = harness.api.executePrompt(requestNext, harness.hooks);
      }
    }
  };
  const requestNext = request("next");
  const first = harness.api.executePrompt(request("first"), hooks);
  await harness.paused;
  harness.api.cancelAutomation(["first"], hooks);
  harness.resume();
  await first;
  await next;
  assert.equal(harness.events.some((event) => event.requestId === "next" && event.stage === "failed"), false);
  assert.equal(harness.events.some((event) => event.requestId === "next" && event.stage === "captured"), true);
});

test("cancellation during the final image write cannot later report success", async () => {
  const harness = createHarness({ pauseAt: "storage" });
  const running = harness.api.executePrompt(request("first"), harness.hooks);
  await harness.paused;
  harness.api.cancelAutomation(["first"], harness.hooks);
  harness.resume();
  await running;
  const terminal = harness.events.filter((event) => ["cancelled", "failed", "captured"].includes(event.stage));
  assert.deepEqual(terminal.map((event) => event.stage), ["cancelled"]);
  assert.equal(terminal[0].active, false);
});

test("waits for generation to finish and captures a later second image", async () => {
  const harness = createHarness({ pauseAt: null, secondImageAt: 5000, generatingUntil: 6000 });
  await harness.api.executePrompt(request("first"), harness.hooks);
  assert.equal(harness.stored.length, 2);
  assert.ok(harness.stored.every((image) => image.at >= 6000));
  assert.equal(harness.events.find((event) => event.stage === "captured")?.active, false);
});

test("waits for an unfinished generated image after streaming has stopped", async () => {
  const harness = createHarness({ pauseAt: null, secondImageAt: 5000, pendingUntil: 5000 });
  await harness.api.executePrompt(request("first"), harness.hooks);
  assert.equal(harness.stored.length, 2);
  assert.ok(harness.stored.every((image) => image.at >= 5000));
});

test("restarts the stability interval when another image becomes ready", async () => {
  const harness = createHarness({ pauseAt: null, secondImageAt: 1200 });
  await harness.api.executePrompt(request("first"), harness.hooks);
  assert.equal(harness.stored.length, 2);
  assert.ok(harness.stored.every((image) => image.at >= 2800));
});

test("a response that never finishes still reaches the generation timeout", async () => {
  const harness = createHarness({ pauseAt: null, generatingUntil: 1_000_000 });
  await harness.api.executePrompt(request("first"), harness.hooks);
  assert.equal(harness.stored.length, 0);
  const failed = harness.events.find((event) => event.stage === "failed");
  assert.match(failed?.message ?? "", /超时/);
  assert.equal(failed?.active, false);
});

test("a loaded small thumbnail does not block a full-size generated image", async () => {
  const harness = createHarness({ pauseAt: null, loadedThumbnail: true });
  await harness.api.executePrompt(request("first"), harness.hooks);
  assert.equal(harness.stored.length, 1);
  assert.equal(harness.events.some((event) => event.stage === "captured"), true);
  assert.equal(harness.events.some((event) => event.stage === "failed"), false);
});

test("thinking text without a stop button does not finish a generation before its image arrives", async () => {
  const harness = createHarness({
    pauseAt: null, assistantText: true, imagePlaceholder: false,
    imageAt: 25_000, responseCompleteAt: 26_000
  });
  await harness.api.executePrompt(request("first"), harness.hooks);
  assert.equal(harness.events.some((event) => event.stage === "failed"), false);
  assert.equal(harness.stored.length, 1);
  assert.ok(harness.stored[0].at >= 26_000);
  assert.equal(harness.events.at(-1).stage, "captured");
});

test("a text-only response starts its grace period after explicit completion", async () => {
  const harness = createHarness({
    pauseAt: null, assistantText: true, textOnly: true,
    imagePlaceholder: false, responseCompleteAt: 20_000
  });
  await harness.api.executePrompt(request("first"), harness.hooks);
  const failed = harness.events.find((event) => event.stage === "failed");
  assert.match(failed?.message ?? "", /返回了文字，没有生成图片/);
  assert.ok(failed.at >= 30_000, `text response finished prematurely at ${failed.at}ms`);
  assert.equal(harness.stored.length, 0);
});

test("an unknown response completion state times out instead of treating thinking as a text result", async () => {
  const harness = createHarness({
    pauseAt: null, assistantText: true, textOnly: true,
    imagePlaceholder: false, responseCompleteAt: Infinity
  });
  await harness.api.executePrompt(request("first"), harness.hooks);
  const failed = harness.events.find((event) => event.stage === "failed");
  assert.match(failed?.message ?? "", /超时/);
  assert.ok(failed.at >= 360_000);
  assert.equal(harness.stored.length, 0);
});
