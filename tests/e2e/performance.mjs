import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE_URL = process.env.BASE_URL || "http://localhost:4173";
const BROWSER_PATH =
  process.env.BROWSER_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ARTIFACT_DIR =
  process.env.ARTIFACT_DIR || path.join(os.tmpdir(), "branchboard-performance");
await mkdir(ARTIFACT_DIR, { recursive: true });
const userDataDir = await mkdtemp(path.join(os.tmpdir(), "branchboard-perf-"));
const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  userDataDir,
  defaultViewport: { width: 1280, height: 900 },
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

try {
  console.log("• open an empty canvas");
  await page.goto(`${BASE_URL}/canvas.html`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".bb-app", { timeout: 15000 });
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll(".bb-save-indicator span")).some(
        (element) => element.textContent === "已保存"
      ),
    { timeout: 6000 }
  );

  console.log("• seed 48 prompts, 16 images and 16 generated edges");
  await page.evaluate(async () => {
    const activeCanvasId = sessionStorage.getItem("branchboardV2ActiveCanvasId");
    if (!activeCanvasId) throw new Error("active canvas missing");
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("branchboard-v2");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const documentRecord = await new Promise((resolve, reject) => {
      const request = database
        .transaction("documents")
        .objectStore("documents")
        .get(activeCanvasId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const createdAt = new Date().toISOString();
    const imageAssets = [];
    for (let index = 0; index < 16; index += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const context = canvas.getContext("2d");
      context.fillStyle = index % 2 ? "#4e6c83" : "#c87545";
      context.fillRect(0, 0, 512, 512);
      context.fillStyle = "#151a1e";
      context.fillRect(96, 96, 320, 320);
      const blob = await new Promise((resolve) =>
        canvas.toBlob((result) => resolve(result), "image/png")
      );
      imageAssets.push({
        id: `perf-asset-${index}`,
        blob,
        mime: "image/png",
        width: 512,
        height: 512,
        createdAt
      });
    }
    const nodes = [];
    const edges = [];
    const promptIdsByRow = new Map();
    for (let index = 0; index < 64; index += 1) {
      const column = index % 8;
      const row = Math.floor(index / 8);
      const id = `perf-node-${index}`;
      const position = { x: column * 400, y: row * 460 };
      if (index % 4 === 0) {
        nodes.push({
          id,
          type: "image",
          position,
          data: {
            kind: "image",
            assetId: `perf-asset-${Math.floor(index / 4)}`,
            name: `压力测试图片 ${index}`,
            createdAt,
            width: 512,
            height: 512
          }
        });
      } else {
        nodes.push({
          id,
          type: "prompt",
          position,
          data: {
            kind: "prompt",
            prompt: `压力测试提示词 ${index}：雨夜城市中的角色与光线`,
            createdAt,
            updatedAt: createdAt
          }
        });
        const rowPrompts = promptIdsByRow.get(row) ?? [];
        rowPrompts.push(id);
        promptIdsByRow.set(row, rowPrompts);
      }
    }
    for (let index = 0; index < 16; index += 1) {
      const column = (index * 4) % 8;
      const row = Math.floor((index * 4) / 8);
      const prompts = promptIdsByRow.get(row) ?? [];
      const source = prompts.find((_, promptIndex) => promptIndex === Math.min(column, prompts.length - 1));
      if (!source) continue;
      edges.push({
        id: `perf-edge-${index}`,
        source,
        target: `perf-node-${index * 4}`,
        type: "relation",
        data: { relation: "generated" }
      });
    }
    const transaction = database.transaction(
      ["assets", "documents"],
      "readwrite"
    );
    for (const asset of imageAssets) {
      transaction.objectStore("assets").put(asset);
    }
    transaction.objectStore("documents").put({
      ...documentRecord,
      revision: documentRecord.revision + 1,
      nodes,
      edges,
      viewport: { x: 20, y: 20, zoom: 0.2 },
      updatedAt: createdAt
    });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  console.log("• reload and render the large canvas");
  const loadStartedAt = Date.now();
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".bb-app", { timeout: 15000 });
  await page.waitForFunction(
    () => document.querySelectorAll(".react-flow__node").length === 64,
    { timeout: 15000 }
  );
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll(".bb-image-node img")).every(
        (image) => image instanceof HTMLImageElement && image.naturalWidth > 0
      ),
    { timeout: 15000 }
  );
  const loadMilliseconds = Date.now() - loadStartedAt;
  await wait(600);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "01-dense-canvas.png") });
  assert.equal(await page.$$eval(".bb-prompt-node", (nodes) => nodes.length), 48);
  assert.equal(await page.$$eval(".bb-image-node", (nodes) => nodes.length), 16);

  console.log("• pan and zoom with the long-task observer active");
  await page.evaluate(() => {
    window.__perfLongTasks = [];
    if (typeof PerformanceObserver === "function") {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__perfLongTasks.push(entry.duration);
        }
      });
      try {
        observer.observe({ entryTypes: ["longtask"] });
      } catch {
        // Long task timing is not available in every headless build.
      }
    }
  });
  const client = await page.createCDPSession();
  const rect = await page.$eval(".bb-canvas", (element) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  });
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const interactionStartedAt = Date.now();
  for (let index = 0; index < 30; index += 1) {
    const zoom = index % 3 === 0;
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: centerX,
      y: centerY,
      deltaX: 0,
      deltaY: zoom ? (index % 2 === 0 ? -100 : 100) : index % 2 === 0 ? 40 : -40,
      modifiers: zoom ? 2 : 0
    });
    await wait(24);
  }
  await wait(250);
  const interactionMilliseconds = Date.now() - interactionStartedAt;
  const longTasks = await page.evaluate(() => window.__perfLongTasks);
  const maxLongTask = longTasks.length ? Math.max(...longTasks) : 0;
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "02-after-pan-zoom.png") });
  assert.equal(pageErrors.length, 0, `page errors: ${JSON.stringify(pageErrors)}`);
  assert.ok(maxLongTask < 500, `long task too long: ${maxLongTask}ms`);
  console.log(
    `  load ${loadMilliseconds}ms · 30 wheel events ${interactionMilliseconds}ms · long tasks ${
      longTasks.length
    } (max ${Math.round(maxLongTask)}ms)`
  );
  console.log(`\nPerformance smoke passed. Screenshots: ${ARTIFACT_DIR}`);
} finally {
  await browser.close();
}
