import type { ActivePrompt, ExecutionSettings } from "./types";

const ACTIVE_PROMPT_KEY = "activePrompt";
const EXECUTION_SETTINGS_KEY = "branchboardExecutionSettings";
const DEFAULT_EXECUTION_SETTINGS: ExecutionSettings = {
  mode: "manual",
  theme: "dark"
};

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

export async function setActivePrompt(
  activePrompt: ActivePrompt | null
): Promise<void> {
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [ACTIVE_PROMPT_KEY]: activePrompt });
    return;
  }
  if (activePrompt) {
    localStorage.setItem(ACTIVE_PROMPT_KEY, JSON.stringify(activePrompt));
  } else {
    localStorage.removeItem(ACTIVE_PROMPT_KEY);
  }
}

export async function getActivePrompt(): Promise<ActivePrompt | null> {
  if (hasChromeStorage()) {
    const result = await chrome.storage.local.get(ACTIVE_PROMPT_KEY);
    return (result[ACTIVE_PROMPT_KEY] as ActivePrompt | undefined) ?? null;
  }
  const stored = localStorage.getItem(ACTIVE_PROMPT_KEY);
  return stored ? (JSON.parse(stored) as ActivePrompt) : null;
}

export async function getExecutionSettings(): Promise<ExecutionSettings> {
  if (hasChromeStorage()) {
    const result = await chrome.storage.local.get(EXECUTION_SETTINGS_KEY);
    const stored = result[EXECUTION_SETTINGS_KEY] as
      | { mode?: string; theme?: string }
      | undefined;
    return {
      mode:
        stored?.mode === "auto" || stored?.mode === "script"
          ? "auto"
          : "manual",
      theme: stored?.theme === "light" ? "light" : "dark"
    };
  }
  const stored = localStorage.getItem(EXECUTION_SETTINGS_KEY);
  if (!stored) return DEFAULT_EXECUTION_SETTINGS;
  const parsed = JSON.parse(stored) as { mode?: string; theme?: string };
  return {
    mode:
      parsed.mode === "auto" || parsed.mode === "script" ? "auto" : "manual",
    theme: parsed.theme === "light" ? "light" : "dark"
  };
}

export async function setExecutionSettings(
  settings: ExecutionSettings
): Promise<void> {
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [EXECUTION_SETTINGS_KEY]: settings });
    return;
  }
  localStorage.setItem(EXECUTION_SETTINGS_KEY, JSON.stringify(settings));
}

export function listenForActivePrompt(
  callback: (activePrompt: ActivePrompt | null) => void
): () => void {
  if (!hasChromeStorage()) {
    const listener = (event: StorageEvent) => {
      if (event.key !== ACTIVE_PROMPT_KEY) return;
      callback(event.newValue ? (JSON.parse(event.newValue) as ActivePrompt) : null);
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }

  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ) => {
    if (areaName !== "local" || !changes[ACTIVE_PROMPT_KEY]) return;
    callback(
      (changes[ACTIVE_PROMPT_KEY].newValue as ActivePrompt | undefined) ?? null
    );
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function copyText(text: string): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    const response = await chrome.runtime.sendMessage({
      type: "branchboard:clipboard-write",
      format: "text",
      text
    });
    if (!response?.ok) {
      throw new Error(response?.error || "复制提示词失败");
    }
    return;
  }
  await navigator.clipboard.writeText(text);
}

export async function copyImage(dataUrl: string): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    const response = await chrome.runtime.sendMessage({
      type: "branchboard:clipboard-write",
      format: "image",
      dataUrl
    });
    if (!response?.ok) {
      throw new Error(response?.error || "复制图片失败");
    }
    return;
  }

  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas context unavailable");
  context.drawImage(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) =>
        result ? resolve(result) : reject(new Error("PNG conversion failed")),
      "image/png"
    );
  });
  await navigator.clipboard.write([
    new ClipboardItem({
      "image/png": blob
    })
  ]);
}

export async function openChatGpt(): Promise<void> {
  const url = "https://chatgpt.com/";
  if (typeof chrome !== "undefined" && chrome.tabs?.create) {
    await chrome.tabs.create({ url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function openCanvas(): Promise<void> {
  if (typeof chrome !== "undefined" && chrome.tabs?.create && chrome.runtime?.getURL) {
    await chrome.tabs.create({ url: chrome.runtime.getURL("canvas.html") });
    return;
  }
  window.open("/canvas.html", "_blank", "noopener,noreferrer");
}

export async function notifyCanvasInbox(): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
  try {
    await chrome.runtime.sendMessage({ type: "branchboard:inbox-updated" });
  } catch {
    // The canvas may not be open yet. It consumes the inbox on next launch.
  }
}

