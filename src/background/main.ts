import { dataUrlToBlob, sha256Hex } from "../shared/blob";
import { addPending, listPending, putAsset } from "../shared/db";
import {
  MSG,
  type ClipboardWriteMessage,
  type StoreImageMessage
} from "../shared/messages";

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
let creatingOffscreenDocument: Promise<void> | null = null;

async function notifyPendingUpdated(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: MSG.pendingUpdated });
  } catch {
    // The canvas may not be open. Pending results are consumed on next launch.
  }
}

function finiteDimension(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 1024;
}

async function storeImage(message: StoreImageMessage): Promise<{ ok: true }> {
  const dataUrl = String(message.dataUrl || "");
  if (!dataUrl.startsWith("data:image/")) throw new Error("只支持图片数据");
  if (dataUrl.length > 40_000_000) throw new Error("图片太大，无法保存");
  const canvasId = String(message.canvasId || "");
  const requestId = String(message.requestId || "");
  if (!canvasId || !requestId) throw new Error("缺少画布或任务标识");

  const blob = dataUrlToBlob(dataUrl);
  const hash = /^[a-f0-9]{64}$/i.test(String(message.hash || ""))
    ? String(message.hash).toLowerCase()
    : await sha256Hex(blob);

  const existing = await listPending();
  if (
    existing.some(
      (image) => image.requestId === requestId && image.hash === hash
    )
  ) {
    return { ok: true };
  }

  const width = finiteDimension(message.width);
  const height = finiteDimension(message.height);
  const createdAt = new Date().toISOString();
  const name = String(message.name || "生成图片");
  const assetId = crypto.randomUUID();
  await putAsset({
    id: assetId,
    blob,
    mime: blob.type || "image/png",
    width,
    height,
    createdAt,
    hash,
    name
  });
  await addPending({
    id: crypto.randomUUID(),
    assetId,
    requestId,
    canvasId,
    promptId: message.promptId ? String(message.promptId) : undefined,
    name,
    width,
    height,
    createdAt,
    hash,
    relation: message.relation,
    position:
      Number.isFinite(message.position?.x) && Number.isFinite(message.position?.y)
        ? { x: Number(message.position?.x), y: Number(message.position?.y) }
        : undefined
  });
  void notifyPendingUpdated();
  return { ok: true };
}

async function hasOffscreenDocument(): Promise<boolean> {
  const offscreen = chrome.offscreen as typeof chrome.offscreen & {
    hasDocument?: () => Promise<boolean>;
  };
  if (typeof offscreen?.hasDocument === "function") {
    return offscreen.hasDocument();
  }
  if (typeof chrome.runtime.getContexts === "function") {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
    });
    return contexts.length > 0;
  }
  const clientsApi = (
    self as unknown as {
      clients?: { matchAll(): Promise<Array<{ url: string }>> };
    }
  ).clients;
  if (!clientsApi) return false;
  const matchedClients = await clientsApi.matchAll();
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  return matchedClients.some((client) => client.url === offscreenUrl);
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["CLIPBOARD"],
      justification: "Copy Branchboard prompt text or image to the clipboard."
    });
  }
  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = null;
  }
}

async function writeClipboard(message: ClipboardWriteMessage): Promise<void> {
  await ensureOffscreenDocument();
  const response = (await chrome.runtime.sendMessage({
    target: "offscreen",
    type: MSG.offscreenWrite,
    format: message.format,
    text: message.text,
    dataUrl: message.dataUrl
  })) as { ok?: boolean; error?: string } | undefined;
  if (!response?.ok) {
    throw new Error(response?.error || "写入剪贴板失败");
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === MSG.storeImage) {
    void storeImage(message as StoreImageMessage)
      .then((result) => sendResponse(result))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }
  if (message?.type === MSG.clipboardWrite) {
    void writeClipboard(message as ClipboardWriteMessage)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }
  return false;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: MSG.toggleCanvas });
  } catch {
    // The action only works on supported ChatGPT pages.
  }
});
