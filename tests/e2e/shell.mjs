import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EXTENSION_DIR = path.join(ROOT, "dist");
const SHELL_FIXTURE = path.join(EXTENSION_DIR, "shell-fixture.html");
const BASE_URL = process.env.BASE_URL || "http://localhost:4173";
const browserCandidates = [
  process.env.BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
].filter(Boolean);
const BROWSER_PATH = browserCandidates.find((candidate) => existsSync(candidate));
if (!BROWSER_PATH) {
  throw new Error("No Chromium browser found. Set BROWSER_PATH.");
}
const ARTIFACT_DIR =
  process.env.ARTIFACT_DIR || path.join(os.tmpdir(), "branchboard-shell-e2e");
await mkdir(ARTIFACT_DIR, { recursive: true });
const userDataDir = await mkdtemp(path.join(os.tmpdir(), "branchboard-ext-profile-"));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: process.env.HEADLESS !== "0",
  userDataDir,
  defaultViewport: { width: 1280, height: 900 },
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--load-extension=${EXTENSION_DIR}`
  ]
});

function log(message) {
  console.log(`• ${message}`);
}

async function wait(ms) {
  await new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

try {
  log("load extension service worker");
  const worker = await browser.waitForTarget(
    (target) =>
      target.type() === "service_worker" && target.url().includes("background.js"),
    { timeout: 20000 }
  );
  const extensionId = new URL(worker.url()).host;
  assert.ok(extensionId, "extension id was not available");
  log(`extension loaded: ${extensionId}`);

  log("open the real extension canvas page");
  const extensionPage = await browser.newPage();
  const extensionErrors = [];
  extensionPage.on("pageerror", (error) => extensionErrors.push(error.message));
  await extensionPage.goto(`chrome-extension://${extensionId}/canvas.html`, {
    waitUntil: "networkidle0"
  });
  await extensionPage.waitForSelector(".bb-app", { timeout: 15000 });
  const manifestVersion = await extensionPage.evaluate(
    () => chrome.runtime.getManifest().version
  );
  assert.equal(manifestVersion, "2.0.0");
  const extensionCanvasRect = await extensionPage.$eval(".bb-canvas", (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await extensionPage.mouse.click(
    extensionCanvasRect.x + extensionCanvasRect.width / 2,
    extensionCanvasRect.y + extensionCanvasRect.height / 2,
    { count: 2 }
  );
  await extensionPage.waitForSelector(".bb-prompt-node textarea", { timeout: 5000 });
  await extensionPage.keyboard.type("扩展环境下的复制测试");
  await wait(500);
  await extensionPage.click('.bb-prompt-node [aria-label="复制提示词"]');
  await extensionPage.waitForSelector(".bb-node-feedback.copied", { timeout: 5000 });
  await extensionPage.screenshot({
    path: path.join(ARTIFACT_DIR, "01-extension-canvas.png")
  });

  log("background stores a generated image and the canvas recovers it");
  const storedResult = await extensionPage.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    context.fillStyle = "#df7c46";
    context.fillRect(0, 0, 96, 64);
    context.fillStyle = "#121619";
    context.fillRect(24, 16, 48, 32);
    const dataUrl = canvas.toDataURL("image/png");
    const canvasId =
      sessionStorage.getItem("branchboardV2ActiveCanvasId") ||
      (await new Promise((resolve, reject) => {
        const request = indexedDB.open("branchboard-v2");
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("registry", "readonly");
          const get = transaction.objectStore("registry").get("registry");
          get.onsuccess = () => {
            database.close();
            resolve(get.result?.activeCanvasId || "");
          };
          get.onerror = () => reject(get.error);
        };
        request.onerror = () => reject(request.error);
      }));
    const promptId =
      document
        .querySelector(".bb-prompt-node")
        ?.closest(".react-flow__node")
        ?.getAttribute("data-id") || "";
    const response = await chrome.runtime.sendMessage({
      type: "branchboard:v2:store-image",
      dataUrl,
      name: "后台回收测试",
      canvasId,
      promptId,
      requestId: "e2e-background-result",
      relation: "generated",
      width: 96,
      height: 64
    });
    return { response, canvasId, promptId };
  });
  assert.equal(storedResult.response.ok, true);
  await extensionPage.waitForSelector(".bb-image-node img", { timeout: 10000 });
  await extensionPage.waitForFunction(
    () => document.querySelectorAll(".react-flow__edge").length >= 1,
    { timeout: 6000 }
  );
  await wait(1200);
  const pendingAfter = await extensionPage.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("branchboard-v2");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const pending = await new Promise((resolve, reject) => {
      const transaction = database.transaction("pending", "readonly");
      const request = transaction.objectStore("pending").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return pending.length;
  });
  assert.equal(pendingAfter, 0);
  await extensionPage.screenshot({
    path: path.join(ARTIFACT_DIR, "01b-extension-generated-result.png")
  });
  assert.deepEqual(extensionErrors, []);

  log("inject shell on a blank page with a mocked runtime");
  await writeFile(
    SHELL_FIXTURE,
    "<!doctype html><html><head><meta charset='utf-8'></head><body style='margin:0'></body></html>"
  );
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.log("shell parent error", error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.log("shell console error", message.text());
  });
  await page.goto(`${BASE_URL}/shell-fixture.html`, { waitUntil: "networkidle0" });
  await page.evaluate((canvasUrl) => {
    window.__bbStorage = {};
    window.__bbMessageListeners = [];
    window.chrome = {
      runtime: {
        getURL: (resource) =>
          resource === "canvas.html" ? canvasUrl : `http://localhost:4173/${resource}`,
        onMessage: {
          addListener(listener) {
            window.__bbMessageListeners.push(listener);
          },
          removeListener(listener) {
            window.__bbMessageListeners = window.__bbMessageListeners.filter(
              (item) => item !== listener
            );
          }
        },
        sendMessage: async () => ({ ok: true })
      },
      storage: {
        local: {
          async get(keys) {
            if (typeof keys === "string") {
              return { [keys]: window.__bbStorage[keys] };
            }
            const result = {};
            for (const key of keys ?? []) result[key] = window.__bbStorage[key];
            return result;
          },
          async set(values) {
            Object.assign(window.__bbStorage, values);
          }
        },
        onChanged: {
          addListener() {},
          removeListener() {}
        }
      }
    };
  }, `${BASE_URL}/canvas.html`);
  await page.addScriptTag({ path: path.join(EXTENSION_DIR, "content.js") });
  await page.waitForFunction(
    () => Boolean(document.getElementById("branchboard-floating-canvas-host")?.shadowRoot)
  );
  const orbBox = await page.evaluate(() => {
    const host = document.getElementById("branchboard-floating-canvas-host");
    const orb = host.shadowRoot.querySelector(".orb");
    const rect = orb.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "02-orb.png") });
  await page.mouse.click(orbBox.x + orbBox.width / 2, orbBox.y + orbBox.height / 2);
  await page.waitForFunction(() => {
    const host = document.getElementById("branchboard-floating-canvas-host");
    return host.shadowRoot.querySelector(".floating").classList.contains("open");
  });
  const frame = page.frames().find((item) => item.url().includes("/canvas.html?embedded=1"));
  assert.ok(frame, "embedded canvas iframe was not created");
  await frame.waitForSelector(".bb-app", { timeout: 15000 });
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "03-floating-open.png") });

  log("canvas theme message updates the shell");
  const initialTheme = await frame.evaluate(() => document.documentElement.dataset.theme);
  await frame.evaluate(() => {
    document.querySelector('[aria-label^="切换到"]')?.click();
  });
  await page.waitForFunction((expected) => {
    const host = document.getElementById("branchboard-floating-canvas-host");
    return host.classList.contains("light") === (expected === "light");
  }, { timeout: 4000 }, initialTheme === "light" ? "dark" : "light");

  log("minimize preserves the live iframe state");
  await frame.evaluate(() => {
    document.querySelector(".bb-empty-state .bb-button")?.click();
  });
  await frame.waitForSelector(".bb-prompt-node textarea", { timeout: 5000 });
  const promptValue = "最小化后仍然存在的提示词";
  await frame.type(".bb-prompt-node textarea", promptValue);
  await wait(400);
  await page.evaluate(() => {
    const host = document.getElementById("branchboard-floating-canvas-host");
    host.shadowRoot.querySelector(".minimize").click();
  });
  await page.waitForFunction(() => {
    const host = document.getElementById("branchboard-floating-canvas-host");
    const floating = host.shadowRoot.querySelector(".floating");
    const orb = host.shadowRoot.querySelector(".orb");
    return !floating.classList.contains("open") && !orb.classList.contains("hidden");
  });
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "04-orb-after-minimize.png") });
  await page.evaluate(() => {
    const host = document.getElementById("branchboard-floating-canvas-host");
    host.shadowRoot.querySelector(".orb").click();
  });
  await page.waitForFunction(() => {
    const host = document.getElementById("branchboard-floating-canvas-host");
    return host.shadowRoot.querySelector(".floating").classList.contains("open");
  });
  assert.equal(
    await frame.$eval(".bb-prompt-node textarea", (element) => element.value),
    promptValue
  );

  log("drag, maximize, restore and resize the floating window");
  const geometryBefore = await page.evaluate(() => {
    const host = document.getElementById("branchboard-floating-canvas-host");
    const floating = host.shadowRoot.querySelector(".floating");
    const header = host.shadowRoot.querySelector(".shell-header");
    const rect = floating.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      header: {
        x: headerRect.x,
        y: headerRect.y,
        width: headerRect.width,
        height: headerRect.height
      }
    };
  });
  await page.mouse.move(
    geometryBefore.header.x + geometryBefore.header.width / 2,
    geometryBefore.header.y + geometryBefore.header.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    geometryBefore.header.x + geometryBefore.header.width / 2 - 60,
    geometryBefore.header.y + geometryBefore.header.height / 2 - 40,
    { steps: 6 }
  );
  await page.mouse.up();
  await wait(200);
  const geometryAfterDrag = await page.evaluate(() => {
    const host = document.getElementById("branchboard-floating-canvas-host");
    const rect = host.shadowRoot.querySelector(".floating").getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  });
  assert.ok(geometryAfterDrag.left < geometryBefore.left - 30);
  assert.ok(geometryAfterDrag.top < geometryBefore.top - 20);

  await page.evaluate(() => {
    const host = document.getElementById("branchboard-floating-canvas-host");
    host.shadowRoot.querySelector(".maximize").click();
  });
  await wait(200);
  const maximized = await page.evaluate(() => {
    const host = document.getElementById("branchboard-floating-canvas-host");
    return {
      rect: host.shadowRoot.querySelector(".floating").getBoundingClientRect().toJSON(),
      viewport: { width: window.innerWidth, height: window.innerHeight }
    };
  });
  assert.ok(maximized.rect.width >= maximized.viewport.width - 18);
  assert.ok(maximized.rect.height >= maximized.viewport.height - 18);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "05-maximized.png") });
  await page.evaluate(() => {
    const host = document.getElementById("branchboard-floating-canvas-host");
    host.shadowRoot.querySelector(".maximize").click();
  });
  await wait(200);
  const restored = await page.evaluate(() => {
    const host = document.getElementById("branchboard-floating-canvas-host");
    return host.shadowRoot.querySelector(".floating").getBoundingClientRect().toJSON();
  });
  assert.ok(restored.width < maximized.viewport.width - 100);

  const resizeHandle = await page.evaluate(() => {
    const host = document.getElementById("branchboard-floating-canvas-host");
    const handle = host.shadowRoot.querySelector(".resize-handle");
    const rect = handle.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  await page.mouse.move(resizeHandle.x + resizeHandle.width / 2, resizeHandle.y + resizeHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeHandle.x + resizeHandle.width / 2 + 80, resizeHandle.y + resizeHandle.height / 2 + 50, {
    steps: 6
  });
  await page.mouse.up();
  await wait(250);
  const resized = await page.evaluate(() => {
    const host = document.getElementById("branchboard-floating-canvas-host");
    return host.shadowRoot.querySelector(".floating").getBoundingClientRect().toJSON();
  });
  assert.ok(resized.width > restored.width + 40);
  assert.ok(resized.height > restored.height + 20);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "06-resized.png") });

  console.log(`\nAll extension shell checks passed. Screenshots: ${ARTIFACT_DIR}`);
} finally {
  await browser.close();
  await unlink(SHELL_FIXTURE).catch(() => {});
}
