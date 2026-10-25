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
  process.env.ARTIFACT_DIR || path.join(os.tmpdir(), "branchboard-e2e");
await mkdir(ARTIFACT_DIR, { recursive: true });
const userDataDir = await mkdtemp(path.join(os.tmpdir(), "branchboard-profile-"));

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: true,
  userDataDir,
  defaultViewport: { width: 1280, height: 900 },
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"]
});
const pageErrors = [];
const page = await browser.newPage();
await page.bringToFront();
page.on("pageerror", (error) => pageErrors.push(error.message));

function log(message) {
  console.log(`• ${message}`);
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function screenshot(name) {
  await page.screenshot({ path: path.join(ARTIFACT_DIR, `${name}.png`) });
}

async function nodeCount() {
  return page.$$eval(".react-flow__node", (nodes) => nodes.length);
}

async function edgeCount() {
  return page.$$eval(".react-flow__edge", (edges) => edges.length);
}

async function waitForNodes(count, timeout = 8000) {
  await page.waitForFunction(
    (expected) => document.querySelectorAll(".react-flow__node").length === expected,
    { timeout },
    count
  );
}

async function waitForSaved(timeout = 6000) {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll(".bb-save-indicator span")).some(
        (element) => element.textContent === "已保存"
      ),
    { timeout }
  );
}

async function canvasRect() {
  return page.$eval(".bb-canvas", (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
}

async function clickBlank() {
  const rect = await canvasRect();
  await page.mouse.click(rect.x + 36, rect.y + 56);
  await wait(120);
}

async function viewportState() {
  return page.$eval(".react-flow__viewport", (element) => {
    const style = getComputedStyle(element).transform;
    const matrix = new DOMMatrixReadOnly(style);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  });
}

async function promptCount() {
  return page.$$eval(".bb-prompt-node", (nodes) => nodes.length);
}

async function clickMenuItem(label) {
  const clicked = await page.evaluate((text) => {
    const item = Array.from(document.querySelectorAll(".bb-menu-item")).find(
      (element) => element.textContent?.trim().startsWith(text)
    );
    if (item instanceof HTMLElement) {
      item.click();
      return true;
    }
    return false;
  }, label);
  assert.equal(clicked, true, `menu item not found: ${label}`);
  await wait(180);
}

async function activeTextarea() {
  return page.evaluate(() => {
    const element = document.activeElement;
    return element instanceof HTMLTextAreaElement
      ? { value: element.value, label: element.getAttribute("aria-label") }
      : null;
  });
}

try {
  await browser.defaultBrowserContext().overridePermissions(BASE_URL, [
    "clipboard-read",
    "clipboard-write"
  ]);
  log("open canvas");
  await page.goto(`${BASE_URL}/canvas.html`, { waitUntil: "networkidle0" });
  await page.waitForSelector(".bb-app", { timeout: 15000 });
  await page.waitForSelector(".bb-empty-state", { timeout: 8000 });
  await screenshot("01-empty");

  log("double-click creates an auto-focused prompt");
  let rect = await canvasRect();
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2, {
    count: 2
  });
  await page.waitForSelector(".bb-prompt-node textarea", { timeout: 5000 });
  await page.waitForFunction(
    () => document.activeElement?.tagName === "TEXTAREA",
    { timeout: 3000 }
  );
  assert.equal(await promptCount(), 1);

  const basePrompt = "一只在雨夜屋顶看着霓虹灯的猫";
  await page.keyboard.type(basePrompt);
  await wait(700);
  await waitForSaved();
  assert.equal((await activeTextarea()).value, basePrompt);
  await screenshot("02-first-prompt");

  log("branch copies prompt and focuses the new node");
  await page.click('.bb-prompt-node [aria-label="创建分支"]');
  await waitForNodes(2);
  await page.waitForFunction(
    (expected) =>
      document.activeElement instanceof HTMLTextAreaElement &&
      document.activeElement.value === expected,
    { timeout: 3000 },
    basePrompt
  );
  await page.keyboard.type("，赛博朋克风格，电影感构图");
  await wait(400);
  assert.equal(await edgeCount(), 1);
  const promptOverflow = await page.$$eval(".bb-prompt-input", (elements) =>
    elements.map((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight
    }))
  );
  assert.ok(
    promptOverflow.every((item) => item.scrollHeight <= item.clientHeight + 2),
    `prompt text is clipped: ${JSON.stringify(promptOverflow)}`
  );
  await screenshot("03-branch");

  log("copy prompt feedback");
  await page.click('.bb-prompt-node [aria-label="复制提示词"]');
  await page.waitForSelector(".bb-node-feedback.copied", { timeout: 3000 });

  log("undo and redo branch creation");
  await clickBlank();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyZ");
  await page.keyboard.up("Control");
  await waitForNodes(1);
  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await page.keyboard.press("KeyZ");
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  await waitForNodes(2);

  log("N shortcut creates another prompt");
  await clickBlank();
  await page.keyboard.press("KeyN");
  await waitForNodes(3);
  await page.waitForFunction(
    () => document.activeElement?.tagName === "TEXTAREA",
    { timeout: 3000 }
  );
  await page.keyboard.type("第三个提示词");
  await wait(600);

  log("rename active canvas");
  const tab = await page.$(".bb-tab.active");
  const tabRect = await tab.boundingBox();
  await page.mouse.click(tabRect.x + tabRect.width / 2, tabRect.y + tabRect.height / 2, {
    count: 2
  });
  await page.waitForSelector(".bb-tab.editing input", { timeout: 3000 });
  await page.keyboard.type("角色设定");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll(".bb-tab-title")).some(
        (element) => element.textContent === "角色设定"
      ),
    { timeout: 3000 }
  );

  log("create and switch canvases");
  await page.click('[aria-label="新建画布"]');
  await page.waitForSelector(".bb-empty-state", { timeout: 5000 });
  assert.equal(await nodeCount(), 0);
  assert.equal((await page.$$(".bb-tab")).length, 2);
  await screenshot("04-new-canvas");
  await page.click(".bb-tab");
  await waitForNodes(3);
  assert.equal(await page.$eval(".bb-empty-state", () => true).catch(() => false), false);

  log("light theme");
  await page.click('[aria-label="切换到浅色主题"]');
  await wait(250);
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "light"
  );
  await screenshot("05-light-theme");

  log("cursor-anchored zoom and wheel panning");
  const client = await page.createCDPSession();
  rect = await canvasRect();
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const zoomBefore = await page.$eval(".bb-zoom-value", (element) => element.textContent);
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: centerX,
    y: centerY,
    deltaX: 0,
    deltaY: -120,
    modifiers: 2
  });
  await wait(350);
  const zoomAfter = await page.$eval(".bb-zoom-value", (element) => element.textContent);
  assert.notEqual(zoomAfter, zoomBefore);
  const beforePan = await viewportState();
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: centerX,
    y: centerY,
    deltaX: 0,
    deltaY: 120
  });
  await wait(350);
  const afterPan = await viewportState();
  assert.notEqual(Math.round(afterPan.y), Math.round(beforePan.y));
  assert.equal(Math.round(afterPan.zoom * 100), Math.round(beforePan.zoom * 100));

  log("paste an image without auto-connecting it");
  await clickBlank();
  const edgesBeforePaste = await edgeCount();
  const viewportBeforePaste = await viewportState();
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    context.fillStyle = "#df7c46";
    context.fillRect(0, 0, 96, 64);
    context.fillStyle = "#101315";
    context.fillRect(24, 16, 48, 32);
    const blob = await new Promise((resolve) =>
      canvas.toBlob((result) => resolve(result), "image/png")
    );
    const file = new File([blob], "e2e-image.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    let event;
    try {
      event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer
      });
    } catch {
      event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: transfer });
    }
    document.body.dispatchEvent(event);
  });
  await page.waitForSelector(".bb-image-node img", { timeout: 6000 });
  await page.waitForFunction(
    () => {
      const image = document.querySelector(".bb-image-node img");
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
    },
    { timeout: 6000 }
  );
  assert.equal(await edgeCount(), edgesBeforePaste);
  const viewportAfterPaste = await viewportState();
  assert.equal(Math.round(viewportAfterPaste.x), Math.round(viewportBeforePaste.x));
  assert.equal(Math.round(viewportAfterPaste.y), Math.round(viewportBeforePaste.y));
  const canvasBounds = await canvasRect();
  const pastedBounds = await page.$eval(".bb-image-node", (element) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  });
  assert.ok(pastedBounds.x >= canvasBounds.x + 8, "pasted image is off the left edge");
  assert.ok(pastedBounds.y >= canvasBounds.y + 8, "pasted image is off the top edge");
  assert.ok(
    pastedBounds.x + pastedBounds.width <= canvasBounds.x + canvasBounds.width - 8,
    "pasted image is off the right edge"
  );
  await screenshot("06-image-pasted");

  log("double-click image preview");
  const imageRect = await page.$eval(".bb-image-node img", (element) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  });
  await page.mouse.click(imageRect.x + imageRect.width / 2, imageRect.y + imageRect.height / 2, {
    count: 2
  });
  await page.waitForSelector(".bb-image-preview-overlay", { timeout: 4000 });
  const previewActions = await page.$eval(".bb-preview-actions", (element) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  });
  assert.ok(previewActions.y + previewActions.height <= 900, "preview actions are not visible");
  await screenshot("07-image-preview");
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector(".bb-image-preview-overlay"),
    { timeout: 3000 }
  );

  log("continue from image creates a prompt with a reference edge");
  const promptsBeforeContinue = await promptCount();
  await page.click(".bb-image-menu-button");
  await page.waitForSelector(".bb-menu", { timeout: 3000 });
  await clickMenuItem("继续修改");
  await waitForNodes(promptsBeforeContinue + 2);
  await page.waitForFunction(
    () => document.activeElement?.tagName === "TEXTAREA",
    { timeout: 3000 }
  );
  const referenceChip = await page.$$eval(".bb-node-count", (elements) =>
    elements.map((element) => element.textContent?.trim())
  );
  assert.ok(referenceChip.includes("1 参考"));
  await page.keyboard.type("继续优化光线，保持同一角色");
  await wait(500);

  log("standalone generate copies prompt and keeps canvas state");
  await page.click(".bb-prompt-node .bb-generate-button");
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll(".bb-toast-message")).some((element) =>
        element.textContent?.includes("已复制提示词")
      ),
    { timeout: 5000 }
  );

  log("annotate image and restore the original");
  const originalImageSrc = await page.$eval(".bb-image-node img", (element) => element.src);
  await page.mouse.move(imageRect.x + imageRect.width / 2, imageRect.y + imageRect.height / 2);
  await wait(200);
  await page.click(".bb-image-menu-button");
  await page.waitForSelector(".bb-menu", { timeout: 3000 });
  await clickMenuItem("标注图片");
  await page.waitForSelector(".bb-annotation-overlay", { timeout: 4000 });
  await screenshot("08-annotation");
  const annotationCanvas = await page.$eval(".bb-annotation-space canvas", (element) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  });
  await page.mouse.move(
    annotationCanvas.x + annotationCanvas.width * 0.3,
    annotationCanvas.y + annotationCanvas.height * 0.4
  );
  await page.mouse.down();
  await page.mouse.move(
    annotationCanvas.x + annotationCanvas.width * 0.7,
    annotationCanvas.y + annotationCanvas.height * 0.6,
    { steps: 8 }
  );
  await page.mouse.up();
  await page.click(".bb-annotation-footer .bb-button.primary");
  await page.waitForFunction(
    () => !document.querySelector(".bb-annotation-overlay"),
    { timeout: 5000 }
  );
  await page.waitForSelector(".bb-image-badge", { timeout: 5000 });
  const annotatedImageSrc = await page.$eval(".bb-image-node img", (element) => element.src);
  assert.notEqual(annotatedImageSrc, originalImageSrc);
  await page.click(".bb-image-menu-button");
  await page.waitForSelector(".bb-menu", { timeout: 3000 });
  await clickMenuItem("恢复原图");
  await page.waitForFunction(
    () => !document.querySelector(".bb-image-badge"),
    { timeout: 4000 }
  );
  const restoredImageSrc = await page.$eval(".bb-image-node img", (element) => element.src);
  assert.equal(restoredImageSrc, originalImageSrc);

  log("delete a prompt and undo from the toast");
  const promptsBeforeDelete = await promptCount();
  await page.click(".bb-prompt-node .bb-prompt-head");
  await page.keyboard.press("Delete");
  await page.waitForFunction(
    (expected) => document.querySelectorAll(".bb-prompt-node").length === expected,
    { timeout: 4000 },
    promptsBeforeDelete - 1
  );
  await page.waitForSelector(".bb-toast-action", { timeout: 3000 });
  await page.click(".bb-toast-action");
  await waitForNodes(promptsBeforeDelete + 1);
  await page.waitForFunction(() => !document.querySelector(".bb-toast-action"), {
    timeout: 3000
  });

  log("drag image, then undo the move");
  const imageNodeSelector = ".bb-image-node";
  const transformBeforeDrag = await page.$eval(imageNodeSelector, (element) => {
    const wrapper = element.closest(".react-flow__node");
    return wrapper ? wrapper.style.transform : "";
  });
  const dragRect = await page.$eval(imageNodeSelector, (element) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  });
  await page.mouse.move(dragRect.x + dragRect.width / 2, dragRect.y + 30);
  await page.mouse.down();
  await page.mouse.move(dragRect.x + dragRect.width / 2 + 90, dragRect.y + 90, {
    steps: 10
  });
  await page.mouse.up();
  await wait(300);
  const transformAfterDrag = await page.$eval(imageNodeSelector, (element) => {
    const wrapper = element.closest(".react-flow__node");
    return wrapper ? wrapper.style.transform : "";
  });
  assert.notEqual(transformAfterDrag, transformBeforeDrag);
  await clickBlank();
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyZ");
  await page.keyboard.up("Control");
  await wait(400);
  const transformAfterUndo = await page.$eval(imageNodeSelector, (element) => {
    const wrapper = element.closest(".react-flow__node");
    return wrapper ? wrapper.style.transform : "";
  });
  assert.equal(transformAfterUndo, transformBeforeDrag);

  log("multi-select with Control and Shift marquee");
  const promptHeads = await page.$$(".bb-prompt-head");
  await promptHeads[0].click();
  await page.keyboard.down("Control");
  if (promptHeads[1]) await promptHeads[1].click();
  await page.keyboard.up("Control");
  await wait(200);
  const controlSelection = await page.$$eval(".bb-selection-pill", (elements) =>
    elements.map((element) => element.textContent?.trim())
  );
  assert.ok(
    controlSelection.some((text) => text?.includes("2 个已选")),
    `Control selection failed: ${JSON.stringify(controlSelection)}`
  );
  await clickBlank();
  const promptRects = await page.$$eval(".bb-prompt-node", (nodes) =>
    nodes.map((node) => {
      const bounds = node.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    })
  );
  const minX = Math.min(...promptRects.map((item) => item.x));
  const minY = Math.min(...promptRects.map((item) => item.y));
  const maxX = Math.max(...promptRects.map((item) => item.x + item.width));
  const maxY = Math.max(...promptRects.map((item) => item.y + item.height));
  await page.keyboard.down("Shift");
  await page.mouse.move(minX - 24, minY - 24);
  await page.mouse.down();
  await page.mouse.move(maxX + 24, maxY + 24, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await wait(250);
  const marqueeSelection = await page.$$eval(".bb-selection-pill", (elements) =>
    elements.map((element) => element.textContent?.trim())
  );
  assert.ok(
    marqueeSelection.some((text) => /[2-9] 个已选/.test(text ?? "")),
    `Shift marquee selection failed: ${JSON.stringify(marqueeSelection)}`
  );
  await wait(400);
  assert.equal(
    await page.$eval(".react-flow__selection", () => true).catch(() => false),
    false,
    "selection rectangle did not disappear after mouse release"
  );
  await screenshot("09-multi-select");

  log("delete a selected relationship and undo");
  const edgesBeforeDelete = await edgeCount();
  assert.ok(edgesBeforeDelete >= 1);
  await page.keyboard.press("Delete");
  await page.waitForFunction(
    (expected) => document.querySelectorAll(".react-flow__edge").length === expected,
    { timeout: 4000 },
    0
  );
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyZ");
  await page.keyboard.up("Control");
  await page.waitForFunction(
    (expected) => document.querySelectorAll(".react-flow__edge").length === expected,
    { timeout: 4000 },
    edgesBeforeDelete
  );

  log("switch canvases and restore the previous viewport");
  await clickBlank();
  await wait(900);
  const viewportA = await viewportState();
  const tabs = await page.$$(".bb-tab");
  await tabs[1].click();
  await page.waitForSelector(".bb-empty-state", { timeout: 5000 });
  await tabs[0].click();
  await waitForNodes(promptsBeforeDelete + 1);
  await wait(500);
  const viewportAAfter = await viewportState();
  assert.ok(Math.abs(viewportAAfter.x - viewportA.x) <= 2, "viewport x was reset");
  assert.ok(Math.abs(viewportAAfter.y - viewportA.y) <= 2, "viewport y was reset");
  assert.ok(Math.abs(viewportAAfter.zoom - viewportA.zoom) <= 0.02, "zoom was reset");

  log("reload restores canvas, theme, and viewport");
  await clickBlank();
  await wait(1000);
  await waitForSaved();
  const nodesBeforeReload = await nodeCount();
  const activeTitleBeforeReload = await page.$eval(".bb-tab.active .bb-tab-title", (element) => element.textContent);
  const viewportBeforeReload = await viewportState();
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(".bb-app", { timeout: 15000 });
  await waitForNodes(nodesBeforeReload);
  await wait(700);
  assert.equal(
    await page.$eval(".bb-tab.active .bb-tab-title", (element) => element.textContent),
    activeTitleBeforeReload
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "light"
  );
  const viewportAfterReload = await viewportState();
  assert.ok(
    Math.abs(viewportAfterReload.x - viewportBeforeReload.x) <= 3,
    `viewport x not restored: ${JSON.stringify({ viewportBeforeReload, viewportAfterReload })}`
  );
  assert.ok(
    Math.abs(viewportAfterReload.y - viewportBeforeReload.y) <= 3,
    `viewport y not restored: ${JSON.stringify({ viewportBeforeReload, viewportAfterReload })}`
  );
  assert.ok(
    Math.abs(viewportAfterReload.zoom - viewportBeforeReload.zoom) <= 0.02,
    "zoom not restored"
  );
  await screenshot("10-reloaded");

  log("second tab receives canvas changes");
  const page2 = await browser.newPage();
  await page2.bringToFront();
  await page2.goto(`${BASE_URL}/canvas.html`, { waitUntil: "networkidle0" });
  await page2.waitForSelector(".bb-app", { timeout: 15000 });
  await waitForNodes(nodesBeforeReload);
  const promptNodes = await page.$$eval(".react-flow__node", (nodes) =>
    nodes
      .map((node) => {
        const textarea = node.querySelector(".bb-prompt-node textarea");
        return textarea
          ? { id: node.getAttribute("data-id"), value: textarea.value }
          : null;
      })
      .filter(Boolean)
  );
  const syncTarget = promptNodes.find((node) => node.value.includes("雨夜屋顶"));
  assert.ok(syncTarget, "sync target prompt was not found");
  await page.bringToFront();
  await page.click(`.react-flow__node[data-id="${syncTarget.id}"] textarea`);
  await page.keyboard.press("End");
  await page.keyboard.type(" · 双标签同步");
  await wait(900);
  await waitForSaved();
  await page2.bringToFront();
  await page2.waitForFunction(
    (nodeId) => {
      const node = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
      const textarea = node?.querySelector("textarea");
      return textarea?.value.includes("双标签同步") ?? false;
    },
    { timeout: 6000 },
    syncTarget.id
  );
  await page2.close();
  await screenshot("11-tab-sync");

  assert.deepEqual(pageErrors, []);
  console.log(`\nAll UI checks passed. Screenshots: ${ARTIFACT_DIR}`);
} finally {
  await browser.close();
}
