import { blobToDataUrl, imageSizeFromBlob, sha256Hex } from "../shared/blob";
import {
  MSG,
  type CancelRunMessage,
  type ImportUrlMessage,
  type ResultNoticeMessage,
  type RunPromptMessage,
  type StoreImageMessage,
  type ThemeMessage
} from "../shared/messages";
import { listenSettings, readShellTheme } from "../shared/settings";
import type { ExecutionStage, RunPromptRequest } from "../shared/types";
import {
  cancelAutomation,
  executePrompt,
  type AutomationHooks
} from "./automation";
import { createFloatingShell } from "./shell";

(() => {
  const globalState = globalThis as Record<string, unknown>;
  if (globalState.__branchboardV2Loaded) return;
  globalState.__branchboardV2Loaded = true;

  document.getElementById("branchboard-floating-canvas-host")?.remove();
  const shell = createFloatingShell();

  async function applyStoredTheme() {
    shell.applyTheme(await readShellTheme());
  }
  void applyStoredTheme();
  listenSettings((settings) => shell.applyTheme(settings.theme));

  const hooks: AutomationHooks = {
    report(request: RunPromptRequest, stage: ExecutionStage, message: string) {
      shell.frame.contentWindow?.postMessage(
        {
          type: MSG.progress,
          requestId: request.requestId,
          canvasId: request.canvasId,
          promptId: request.promptId,
          stage,
          message
        },
        "*"
      );
    },
    onRunning() {
      shell.setActivity("running");
    },
    onFinished(outcome) {
      if (outcome === "done") shell.setActivity("done");
      else if (outcome === "error") shell.setActivity("error");
      else {
        shell.setActivity("idle");
        if (!shell.isOpen()) shell.showToast("已取消生成");
      }
    },
    onError(message) {
      if (!shell.isOpen()) shell.showToast(message, true);
    }
  };

  async function fileToDataUrl(file: Blob): Promise<string> {
    return blobToDataUrl(file);
  }

  async function importImageUrl(message: ImportUrlMessage): Promise<void> {
    const imageUrl = String(message.imageUrl || "");
    if (!imageUrl) throw new Error("拖入的内容没有图片地址");
    const response = await fetch(imageUrl, { credentials: "include" });
    if (!response.ok) throw new Error("图片读取受限，请复制图片后在画布中粘贴");
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) throw new Error("拖入的内容不是图片");
    let size = { width: 1024, height: 1024 };
    try {
      size = await imageSizeFromBlob(blob);
    } catch {
      // Dimensions are optional for placement; keep a usable fallback.
    }
    const dataUrl = await blobToDataUrl(blob);
    const hash = await sha256Hex(blob);
    const storeMessage: StoreImageMessage = {
      type: MSG.storeImage,
      dataUrl,
      name: "拖入图片",
      canvasId: String(message.canvasId || ""),
      promptId: message.promptId ? String(message.promptId) : undefined,
      requestId: `import-${crypto.randomUUID()}`,
      relation: message.promptId ? "reference" : undefined,
      position: message.position,
      width: size.width,
      height: size.height,
      hash
    };
    const stored = (await chrome.runtime.sendMessage(storeMessage)) as
      | { ok?: boolean; error?: string }
      | undefined;
    if (!stored?.ok) throw new Error(stored?.error || "图片写入画布失败");
  }

  window.addEventListener("message", (event) => {
    if (event.source !== shell.frame.contentWindow) return;
    const data = event.data as
      | RunPromptMessage
      | CancelRunMessage
      | ImportUrlMessage
      | ThemeMessage
      | ResultNoticeMessage
      | { type?: string };
    if (!data || typeof data.type !== "string") return;

    if (data.type === MSG.runPrompt) {
      const request = data as RunPromptMessage;
      void executePrompt(
        {
          requestId: request.requestId,
          canvasId: request.canvasId,
          promptId: request.promptId,
          title: request.title,
          prompt: request.prompt,
          references: Array.isArray(request.references) ? request.references : []
        },
        hooks
      );
      return;
    }
    if (data.type === MSG.cancelRun) {
      const message = data as CancelRunMessage;
      cancelAutomation(
        Array.isArray(message.requestIds) ? message.requestIds.map(String) : [],
        hooks
      );
      return;
    }
    if (data.type === MSG.importUrl) {
      void importImageUrl(data as ImportUrlMessage).catch((error) => {
        shell.showToast(
          error instanceof Error ? error.message : "图片读取失败",
          true
        );
      });
      return;
    }
    if (data.type === MSG.theme) {
      shell.applyTheme((data as ThemeMessage).theme);
      return;
    }
    if (data.type === MSG.minimize) {
      shell.setOpen(false);
      return;
    }
    if (data.type === MSG.resultNotice) {
      const message = data as ResultNoticeMessage;
      if (!shell.isOpen() && message.count > 0) {
        shell.setActivity("done");
        shell.showToast(`${message.count} 张图片已加入画布`);
      }
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === MSG.toggleCanvas) {
      shell.setOpen(!shell.isOpen());
    }
  });

  window.addEventListener(
    "paste",
    (event) => {
      if (!shell.isOpen()) return;
      const items = event.clipboardData?.items;
      if (!items) return;
      const imageItem = Array.from(items).find(
        (item) => item.kind === "file" && item.type.startsWith("image/")
      );
      if (!imageItem) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("textarea, input, [contenteditable='true'], form")) {
        return;
      }
      const file = imageItem.getAsFile();
      if (!file) return;
      event.preventDefault();
      event.stopPropagation();
      void fileToDataUrl(file)
        .then((dataUrl) => {
          shell.frame.contentWindow?.postMessage(
            {
              type: MSG.forwardPaste,
              dataUrl,
              name: file.name || "粘贴图片"
            },
            "*"
          );
        })
        .catch(() => shell.showToast("粘贴图片失败", true));
    },
    true
  );
})();
