import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";

const browserPath = [
  process.env.BROWSER_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean).find((candidate) => existsSync(candidate));
if (!browserPath) throw new Error("No Chromium browser found. Set BROWSER_PATH.");

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("../../src/content/dom.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  globalName: "contentDom"
});
const { outputFiles: integrationFiles } = await build({
  stdin: {
    contents: 'export * from "./src/content/dom.ts"; export { executePrompt, hasActiveAutomation } from "./src/content/automation.ts";',
    resolveDir: fileURLToPath(new URL("../..", import.meta.url))
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  globalName: "contentIntegration"
});
let browser;
before(async () => {
  // Puppeteer creates an isolated temporary profile; the user's Chrome stays open.
  browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
});
after(async () => { await browser?.close(); });

async function fixture() {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html lang='zh-CN'><body><main></main></body></html>");
  await page.addScriptTag({ content: outputFiles[0].text });
  await page.evaluate(() => {
    window.addTurn = async ({ id, legacyNumber, turnTag, text, images = [], userImages = [], user = false }) => {
      const turn = document.createElement(turnTag ?? (legacyNumber === undefined ? "div" : "section"));
      turn.id = id;
      if (legacyNumber === undefined) turn.dataset.turnKey = id;
      else turn.dataset.testid = `conversation-turn-${legacyNumber}`;
      const content = document.createElement("div");
      if (legacyNumber === undefined) content.dataset.talvtTurnState = "complete";
      const appendImages = async (parent, entries, userReference = false) => {
        const gallery = document.createElement("div");
        if (!userReference && legacyNumber === undefined) gallery.dataset.testid = "generated-image-gallery";
        for (const [index, settings] of entries.entries()) {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 512;
          const context = canvas.getContext("2d");
          context.fillStyle = settings.color ?? (index ? "#abc" : "#def");
          context.fillRect(0, 0, 512, 512);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve));
          const image = new Image();
          image.id = settings.id;
          image.alt = settings.alt ?? (userReference ? "上传的图片" : `已生成图像 ${index + 1}`);
          image.src = URL.createObjectURL(blob);
          await image.decode();
          if (settings.pending) Object.defineProperty(image, "complete", { value: false, configurable: true });
          if (userReference || legacyNumber !== undefined) gallery.append(image);
          else {
            const preview = document.createElement("button");
            preview.dataset.testid = "generated-image-preview";
            preview.append(image);
            gallery.append(preview);
          }
        }
        if (entries.length) parent.append(gallery);
      };
      if (legacyNumber === undefined) {
        const userUnit = document.createElement("div");
        userUnit.dataset.chatgptSearchUnitKey = `${id}:0:user`;
        const bubble = document.createElement("div");
        bubble.dataset.userMessageBubble = "true";
        bubble.append(user ? (text ?? "用户消息") : "画一只猪");
        await appendImages(bubble, user ? images : userImages, true);
        userUnit.append(bubble);
        content.append(userUnit);
      }
      const assistant = document.createElement("div");
      if (!user && legacyNumber === undefined) {
        const marker = document.createElement("span");
        marker.dataset.chatgptAgentTurnStart = "";
        content.append(marker);
        assistant.dataset.chatgptSearchMessageIds = `${id}-assistant`;
      }
      if (!user && legacyNumber !== undefined) {
        const heading = document.createElement("h5");
        heading.textContent = "ChatGPT 说：";
        assistant.append(heading);
      }
      if (!user && text) {
        const paragraph = document.createElement("p");
        paragraph.textContent = text;
        assistant.append(paragraph);
      }
      if (!user) await appendImages(assistant, images);
      if (!user && legacyNumber === undefined) {
        const status = document.createElement("div");
        status.setAttribute("role", "status");
        status.textContent = "回答已完成";
        assistant.append(status);
      }
      if (!user) content.append(assistant);
      turn.append(content);
      document.querySelector("main").append(turn);
    };
    window.captureBaseline = () => {
      window.baselineTurn = contentDom.captureConversationBaseline();
      window.baselineKeys = contentDom.generatedImageKeys();
    };
    window.resultIds = () => contentDom.newGeneratedImages(baselineTurn, baselineKeys).map((image) => image.id);
  });
  return page;
}

async function secureIntegrationFixture() {
  const page = await browser.newPage();
  // Return local HTML under a secure origin for the real WebCrypto API.
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.url() === "https://chatgpt.com/") {
      void request.respond({
        status: 200,
        contentType: "text/html",
        body: '<!doctype html><html lang="zh-CN"><body><main></main><form><textarea id="prompt-textarea"></textarea><button type="button" data-testid="send-button">发送</button></form></body></html>'
      });
    } else if (/^(?:blob:|data:)/.test(request.url())) {
      void request.continue();
    } else {
      void request.abort();
    }
  });
  await page.goto("https://chatgpt.com/", { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: integrationFiles[0].text });
  return page;
}

test("detects completed images in the current ChatGPT gallery without imagegen classes", async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      captureBaseline();
      await addTurn({ id: "new-turn-uuid", images: [{ id: "pig" }] });
      return resultIds();
    });
    assert.deepEqual(result, ["pig"]);
  } finally { await page.close(); }
});

test("still detects the older section and generated-image alt structure", async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      await addTurn({ id: "old", legacyNumber: 0, text: "Earlier response" });
      captureBaseline();
      await addTurn({ id: "legacy-result", legacyNumber: 2, images: [{ id: "legacy-image", alt: "Generated image: a pig" }] });
      return resultIds();
    });
    assert.deepEqual(result, ["legacy-image"]);
  } finally { await page.close(); }
});

test("excludes old gallery images and newly uploaded user references", async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      await addTurn({ id: "old-turn-uuid", images: [{ id: "old-image" }] });
      captureBaseline();
      await addTurn({ id: "assistant-turn-uuid", userImages: [{ id: "reference", alt: "已生成图像 1" }], images: [{ id: "new-image" }] });
      return resultIds();
    });
    assert.deepEqual(result, ["new-image"]);
  } finally { await page.close(); }
});

test("recognizes a generated-image label without a colon in the legacy structure", async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      captureBaseline();
      await addTurn({ id: "no-colon", legacyNumber: 0, images: [{ id: "no-colon-image", alt: "Generated image" }] });
      return resultIds();
    });
    assert.deepEqual(result, ["no-colon-image"]);
  } finally { await page.close(); }
});

test("recognizes legacy conversation-turn attributes on article elements", async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      captureBaseline();
      await addTurn({ id: "article-turn", legacyNumber: 0, turnTag: "article", text: "Article response", images: [{ id: "article-image", alt: "Generated image: a pig" }] });
      return { images: resultIds(), turns: contentDom.newAssistantTurns(baselineTurn).length };
    });
    assert.deepEqual(result.images, ["article-image"]);
    assert.equal(result.turns, 1);
  } finally { await page.close(); }
});

test("detects a new UUID turn after an old virtualized turn has been removed", async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      await addTurn({ id: "virtualized-old-turn-uuid", images: [{ id: "old-image" }] });
      captureBaseline();
      document.getElementById("virtualized-old-turn-uuid").remove();
      await addTurn({ id: "virtualized-new-turn-uuid", images: [{ id: "fresh-image" }] });
      return { images: resultIds(), turns: contentDom.newAssistantTurns(baselineTurn).length };
    });
    assert.deepEqual(result.images, ["fresh-image"]);
    assert.equal(result.turns, 1);
  } finally { await page.close(); }
});

test("keeps a pending second gallery image out of results until it loads", async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      captureBaseline();
      await addTurn({ id: "multi-turn-uuid", images: [{ id: "first" }, { id: "second", pending: true }] });
      const before = resultIds();
      const turns = contentDom.newAssistantTurns(baselineTurn);
      const placeholder = contentDom.hasImageGenerationPlaceholder(turns);
      delete document.getElementById("second").complete;
      return { before, after: resultIds(), placeholder, turns: turns.length };
    });
    assert.deepEqual(result.before, ["first"]);
    assert.deepEqual(result.after, ["first", "second"]);
    assert.equal(result.placeholder, true);
    assert.equal(result.turns, 1);
  } finally { await page.close(); }
});

test("recognizes a new plain-text assistant response in the current turn structure", async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      await addTurn({ id: "old-text-turn-uuid", text: "Earlier response" });
      captureBaseline();
      await addTurn({ id: "user-text-turn-uuid", user: true, text: "画一只猪" });
      await addTurn({ id: "new-text-turn-uuid", text: "这次没有生成图片。" });
      const turns = contentDom.newAssistantTurns(baselineTurn);
      return { count: turns.length, text: turns.map((turn) => turn.textContent).join(" "), placeholder: contentDom.hasImageGenerationPlaceholder(turns) };
    });
    assert.equal(result.count, 1);
    assert.match(result.text, /这次没有生成图片/);
    assert.equal(result.placeholder, false);
  } finally { await page.close(); }
});

test("captures the current ChatGPT gallery through the real generation and Blob pipeline", { timeout: 15000 }, async () => {
  const page = await secureIntegrationFixture();
  try {
    const result = await page.evaluate(async () => {
      const stored = [];
      const progress = [];
      const errors = [];
      const outcomes = [];
      Object.defineProperty(window.chrome, "runtime", { configurable: true, value: {
        sendMessage: async (message) => { stored.push(message); return { ok: true }; }
      } });
      document.querySelector("[data-testid='send-button']").addEventListener("click", () => {
        document.querySelector("#prompt-textarea").value = "";
        void (async () => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1254;
          const context = canvas.getContext("2d");
          context.fillStyle = "#edb6a0";
          context.fillRect(0, 0, 1254, 1254);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
          const image = new Image();
          image.alt = "已生成图像 1";
          image.src = URL.createObjectURL(blob);
          await image.decode();
          const turn = document.createElement("div");
          turn.dataset.turnKey = "new-generated-turn-uuid";
          turn.innerHTML = '<div data-talvt-turn-state="complete"><div data-chatgpt-search-unit-key="new:0:user"><div data-user-message-bubble="true">画一只猪</div></div><span data-chatgpt-agent-turn-start></span><div data-chatgpt-search-message-ids="assistant-1"><div data-testid="generated-image-gallery"><button data-testid="generated-image-preview"></button></div><div role="status">回答已完成</div></div></div>';
          turn.querySelector("[data-testid='generated-image-preview']").append(image);
          document.querySelector("main").append(turn);
        })();
      });
      await contentIntegration.executePrompt({
        requestId: "capture-request",
        canvasId: "origin-canvas",
        promptId: "origin-prompt",
        title: "画一只猪",
        prompt: "画一只猪",
        references: []
      }, {
        report: (_request, stage, message) => progress.push({ stage, message }),
        onRunning() {},
        onFinished: (outcome) => outcomes.push(outcome),
        onError: (message) => errors.push(message)
      });
      return { stored, progress, errors, outcomes, secure: isSecureContext, blobUrl: document.querySelector("img").src };
    });
    assert.equal(result.secure, true);
    assert.match(result.blobUrl, /^blob:https:\/\/chatgpt\.com\//);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.outcomes, ["done"]);
    assert.equal(result.progress.at(-1).stage, "captured");
    assert.equal(result.stored.length, 1);
    const message = result.stored[0];
    assert.equal(message.type, "branchboard:v2:store-image");
    assert.equal(message.canvasId, "origin-canvas");
    assert.equal(message.promptId, "origin-prompt");
    assert.equal(message.requestId, "capture-request");
    assert.equal(message.relation, "generated");
    assert.equal(message.name, "画一只猪");
    assert.equal(message.width, 1254);
    assert.equal(message.height, 1254);
    assert.match(message.dataUrl, /^data:image\/png;base64,/);
    const bytes = Buffer.from(message.dataUrl.split(",")[1], "base64");
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(message.hash, createHash("sha256").update(bytes).digest("hex"));
  } finally { await page.close(); }
});

test("an unfinished current turn keeps generating when there is no stop button", async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      captureBaseline();
      await addTurn({ id: "thinking-turn", text: "先构思一下画面。" });
      document.querySelector("[data-talvt-turn-state]").dataset.talvtTurnState = "thinking";
      const turns = contentDom.newAssistantTurns(baselineTurn);
      return {
        stop: Boolean(contentDom.findStopButton()),
        generating: contentDom.isResponseGenerating(turns),
        complete: contentDom.isAssistantResponseComplete(turns)
      };
    });
    assert.deepEqual(result, { stop: false, generating: true, complete: false });
  } finally { await page.close(); }
});

test("image progress overrides a complete text turn with no image element yet", async () => {
  const page = await fixture();
  try {
    const results = await page.evaluate(async () => {
      captureBaseline();
      await addTurn({ id: "image-progress-turn", text: "我来画一只猪。" });
      const assistant = document.querySelector("[data-chatgpt-search-message-ids]");
      const samples = [];
      for (const markup of [
        '<div role="progressbar" aria-valuenow="37">37%</div>',
        '<p>正在勾勒草图</p>'
      ]) {
        const progress = document.createElement("div");
        progress.innerHTML = markup;
        assistant.append(progress);
        const turns = contentDom.newAssistantTurns(baselineTurn);
        samples.push({
          generating: contentDom.isResponseGenerating(turns),
          complete: contentDom.isAssistantResponseComplete(turns),
          placeholder: contentDom.hasImageGenerationPlaceholder(turns)
        });
        progress.remove();
      }
      return samples;
    });
    assert.deepEqual(results, [
      { generating: true, complete: false, placeholder: true },
      { generating: true, complete: false, placeholder: true }
    ]);
  } finally { await page.close(); }
});

test("completion is explicit and progress words in the user bubble do not block it", async () => {
  const page = await fixture();
  try {
    const result = await page.evaluate(async () => {
      captureBaseline();
      await addTurn({ id: "completion-turn", text: "这次无法生成图片。" });
      const turns = contentDom.newAssistantTurns(baselineTurn);
      const complete = contentDom.isAssistantResponseComplete(turns);
      const state = document.querySelector("[data-talvt-turn-state]");
      state.removeAttribute("data-talvt-turn-state");
      const unknown = contentDom.isAssistantResponseComplete(turns);
      state.dataset.talvtTurnState = "complete";
      document.querySelector("[data-user-message-bubble]").innerHTML =
        '<p>正在勾勒草图</p><div role="progressbar" aria-valuenow="37">37%</div>';
      return {
        complete, unknown,
        userProgress: contentDom.isResponseGenerating(turns),
        final: contentDom.isAssistantResponseComplete(turns),
        placeholder: contentDom.hasImageGenerationPlaceholder(turns)
      };
    });
    assert.deepEqual(result, {
      complete: true, unknown: false, userProgress: false, final: true, placeholder: false
    });
  } finally { await page.close(); }
});

test("thinking and 37-percent progress last over ten seconds before the real Blob is captured", { timeout: 25000 }, async () => {
  const page = await secureIntegrationFixture();
  try {
    const result = await page.evaluate(async () => {
      const stored = [];
      const progress = [];
      const errors = [];
      Object.defineProperty(window.chrome, "runtime", { configurable: true, value: {
        sendMessage: async (message) => { stored.push(message); return { ok: true }; }
      } });
      document.querySelector("[data-testid='send-button']").addEventListener("click", () => {
        document.querySelector("#prompt-textarea").value = "";
        const turn = document.createElement("div");
        turn.dataset.turnKey = "delayed-image-turn";
        turn.innerHTML = '<div data-talvt-turn-state="complete"><div data-user-message-bubble>画一只猪</div><span data-chatgpt-agent-turn-start></span><div data-chatgpt-search-message-ids="assistant-delayed"><p>先构思一下画面。</p><p>正在勾勒草图</p><div role="progressbar" aria-valuenow="37">37%</div></div></div>';
        document.querySelector("main").append(turn);
        setTimeout(async () => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 512;
          canvas.getContext("2d").fillRect(0, 0, 512, 512);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
          const image = new Image();
          image.alt = "已生成图像 1";
          image.src = URL.createObjectURL(blob);
          await image.decode();
          const assistant = turn.querySelector("[data-chatgpt-search-message-ids]");
          assistant.innerHTML = '<div data-testid="generated-image-gallery"><button data-testid="generated-image-preview"></button></div><div role="status">回答已完成</div>';
          assistant.querySelector("[data-testid='generated-image-preview']").append(image);
        }, 12_000);
      });
      const running = contentIntegration.executePrompt({
        requestId: "delayed-request", canvasId: "origin-canvas", promptId: "origin-prompt",
        title: "画一只猪", prompt: "画一只猪", references: []
      }, {
        report: (_request, stage, message) => progress.push({ stage, message }),
        onRunning() {}, onFinished() {}, onError: (message) => errors.push(message)
      });
      await new Promise((resolve) => setTimeout(resolve, 11_500));
      const checkpoint = {
        active: contentIntegration.hasActiveAutomation(),
        failed: progress.some((event) => event.stage === "failed"),
        stored: stored.length
      };
      await running;
      return { checkpoint, stored, progress, errors };
    });
    assert.deepEqual(result.checkpoint, { active: true, failed: false, stored: 0 });
    assert.deepEqual(result.errors, []);
    assert.equal(result.progress.at(-1).stage, "captured");
    assert.equal(result.stored.length, 1);
    assert.equal(result.stored[0].canvasId, "origin-canvas");
    assert.equal(result.stored[0].promptId, "origin-prompt");
    assert.match(result.stored[0].dataUrl, /^data:image\/png;base64,/);
  } finally { await page.close(); }
});
