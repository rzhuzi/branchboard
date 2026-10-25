import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE_URL = process.env.BASE_URL || "http://localhost:4173";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION_FIXTURE = path.join(ROOT, "dist", "migration-fixture.html");
const BROWSER_PATH =
  process.env.BROWSER_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ARTIFACT_DIR =
  process.env.ARTIFACT_DIR || path.join(os.tmpdir(), "branchboard-migration-e2e");
await mkdir(ARTIFACT_DIR, { recursive: true });
const userDataDir = await mkdtemp(path.join(os.tmpdir(), "branchboard-migration-"));

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

function log(message) {
  console.log(`• ${message}`);
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

try {
  log("seed a V1 IndexedDB workspace");
  await writeFile(
    MIGRATION_FIXTURE,
    "<!doctype html><html><head><meta charset='utf-8'></head><body></body></html>"
  );
  await page.goto(`${BASE_URL}/migration-fixture.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const imageData = (fill, inner) =>
      new Promise((resolve) => {
        const canvas = document.createElement("canvas");
        canvas.width = 96;
        canvas.height = 64;
        const context = canvas.getContext("2d");
        context.fillStyle = fill;
        context.fillRect(0, 0, 96, 64);
        context.fillStyle = inner;
        context.fillRect(24, 16, 48, 32);
        resolve(canvas.toDataURL("image/png"));
      });
    const firstImage = await imageData("#df7c46", "#14181b");
    const inboxImage = await imageData("#5a7d9a", "#101315");
    const createdAt = "2026-01-01T08:00:00.000Z";
    const snapshot = {
      id: "canvas:legacy-canvas",
      version: 1,
      updatedAt: createdAt,
      nodes: [
        {
          id: "legacy-prompt-1",
          type: "prompt",
          position: { x: 80, y: 120 },
          data: {
            kind: "prompt",
            title: "旧版标题",
            prompt: "旧版的猫在窗边",
            createdAt
          }
        },
        {
          id: "legacy-image-1",
          type: "image",
          position: { x: 520, y: 120 },
          data: {
            kind: "image",
            name: "旧版生成图",
            dataUrl: firstImage,
            createdAt
          }
        }
      ],
      edges: [
        {
          id: "legacy-edge-1",
          source: "legacy-prompt-1",
          target: "legacy-image-1",
          label: "生成结果"
        }
      ]
    };
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("branchboard-db", 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore("snapshots", { keyPath: "id" });
        database.createObjectStore("inbox", { keyPath: "id" });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(
          ["snapshots", "inbox"],
          "readwrite"
        );
        const snapshots = transaction.objectStore("snapshots");
        snapshots.put({
          id: "canvas-registry",
          version: 1,
          activeCanvasId: "legacy-canvas",
          canvases: [
            {
              id: "legacy-canvas",
              title: "旧画布",
              createdAt
            }
          ]
        });
        snapshots.put(snapshot);
        transaction.objectStore("inbox").put({
          id: "legacy-inbox-1",
          dataUrl: inboxImage,
          name: "旧版收件箱图片",
          createdAt,
          parentPromptId: "legacy-prompt-1",
          canvasId: "legacy-canvas"
        });
        transaction.oncomplete = () => {
          database.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
      };
    });
  });

  log("open V2 and migrate legacy canvases, assets and inbox");
  await page.goto(`${BASE_URL}/canvas.html`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".bb-app", { timeout: 15000 });
  await page.waitForFunction(
    () => document.querySelectorAll(".react-flow__node").length === 3,
    { timeout: 15000 }
  );
  await wait(900);
  assert.equal(
    await page.$eval(".bb-tab.active .bb-tab-title", (element) => element.textContent),
    "旧画布"
  );
  assert.equal(
    await page.$eval(".bb-prompt-node textarea", (element) => element.value),
    "旧版的猫在窗边"
  );
  assert.equal(await page.$$eval(".bb-image-node", (nodes) => nodes.length), 2);
  assert.equal(await page.$$eval(".react-flow__edge", (edges) => edges.length), 2);
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll(".bb-image-node img")).every(
        (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
      ),
    { timeout: 8000 }
  );
  const databaseState = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("branchboard-v2");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const documents = await new Promise((resolve, reject) => {
      const request = database.transaction("documents").objectStore("documents").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const assets = await new Promise((resolve, reject) => {
      const request = database.transaction("assets").objectStore("assets").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return {
      documentCount: documents.length,
      assetCount: assets.length,
      legacyCanvasId: documents[0]?.id
    };
  });
  assert.equal(databaseState.documentCount, 1);
  assert.equal(databaseState.legacyCanvasId, "legacy-canvas");
  assert.ok(databaseState.assetCount >= 2);
  const legacyStillExists = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("branchboard-db");
        request.onsuccess = () => {
          const database = request.result;
          resolve(
            database.objectStoreNames.contains("snapshots") &&
              database.objectStoreNames.contains("inbox")
          );
          database.close();
        };
        request.onerror = () => resolve(false);
      })
  );
  assert.equal(legacyStillExists, true);
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, "01-migrated-canvas.png")
  });

  log("reload does not duplicate migrated nodes");
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".bb-app", { timeout: 15000 });
  await page.waitForFunction(
    () => document.querySelectorAll(".react-flow__node").length === 3,
    { timeout: 10000 }
  );
  assert.equal(await page.$$eval(".bb-image-node", (nodes) => nodes.length), 2);
  assert.deepEqual(pageErrors, []);
  console.log(`\nMigration checks passed. Screenshots: ${ARTIFACT_DIR}`);
} finally {
  await browser.close();
  await unlink(MIGRATION_FIXTURE).catch(() => {});
}
