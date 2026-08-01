const DB_NAME = "branchboard-db";
const DB_VERSION = 1;
const INBOX_STORE = "inbox";
const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
let creatingOffscreenDocument = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("snapshots")) {
        database.createObjectStore("snapshots", { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(INBOX_STORE)) {
        database.createObjectStore(INBOX_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeInboxImage(
  dataUrl,
  name,
  parentPromptId,
  canvasId,
  position
) {
  if (!dataUrl.startsWith("data:image/")) {
    throw new Error("只支持图片文件");
  }
  if (dataUrl.length > 28_000_000) {
    throw new Error("图片太大，请使用小于 20MB 的图片");
  }

  const { activePrompt } = await chrome.storage.local.get("activePrompt");
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(INBOX_STORE, "readwrite");
      transaction.objectStore(INBOX_STORE).put({
        id: crypto.randomUUID(),
        dataUrl,
        name: name || "ChatGPT 生成结果",
        createdAt: new Date().toISOString(),
        parentPromptId: parentPromptId || activePrompt?.id,
        canvasId: canvasId || undefined,
        position:
          Number.isFinite(position?.x) && Number.isFinite(position?.y)
            ? { x: position.x, y: position.y }
            : undefined
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }

  try {
    await chrome.runtime.sendMessage({ type: "branchboard:inbox-updated" });
  } catch {
    // The full canvas may be closed. It consumes the inbox on next launch.
  }
}

async function hasOffscreenDocument() {
  if (typeof chrome.offscreen?.hasDocument === "function") {
    return chrome.offscreen.hasDocument();
  }
  if (typeof chrome.runtime.getContexts === "function") {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
    });
    return contexts.length > 0;
  }
  const matchedClients = await clients.matchAll();
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  return matchedClients.some((client) => client.url === offscreenUrl);
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ["CLIPBOARD"],
      justification: "Copy Branchboard prompt text and images to the clipboard."
    });
  }
  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = null;
  }
}

async function writeClipboard(message) {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    type: "branchboard:offscreen-clipboard-write",
    target: "offscreen",
    format: message.format,
    text: message.text,
    dataUrl: message.dataUrl
  });
  if (!response?.ok) {
    throw new Error(response?.error || "写入剪贴板失败");
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "branchboard:store-image") {
    void storeInboxImage(
      String(message.dataUrl || ""),
      String(message.name || ""),
      String(message.parentPromptId || ""),
      String(message.canvasId || ""),
      message.position
    )
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
    );
    return true;
  }
  if (message?.type === "branchboard:clipboard-write") {
    void writeClipboard(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    return true;
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "branchboard:toggle-floating-canvas"
    });
  } catch {
    // The action only works on supported ChatGPT pages.
  }
});
