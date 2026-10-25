import { blobToDataUrl } from "./blob";
import { MSG } from "./messages";

type ClipboardResponse = { ok?: boolean; error?: string } | undefined;

function hasChromeRuntime(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.sendMessage);
}

async function sendClipboardMessage(payload: {
  format: "text" | "image";
  text?: string;
  dataUrl?: string;
}): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: MSG.clipboardWrite,
    ...payload
  })) as ClipboardResponse;
  if (!response?.ok) {
    throw new Error(response?.error || "写入剪贴板失败");
  }
}

export async function copyText(text: string): Promise<void> {
  if (!text.trim()) throw new Error("没有可复制的内容");
  if (hasChromeRuntime()) {
    await sendClipboardMessage({ format: "text", text });
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    copyTextWithSelection(text);
  }
}

function copyTextWithSelection(text: string): void {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  try {
    if (!document.execCommand("copy")) {
      throw new Error("复制提示词失败");
    }
  } finally {
    textarea.remove();
  }
}

export async function copyImageBlob(blob: Blob): Promise<void> {
  if (hasChromeRuntime()) {
    const dataUrl = await blobToDataUrl(blob);
    await sendClipboardMessage({ format: "image", dataUrl });
    return;
  }
  const png = blob.type === "image/png" ? blob : await convertToPng(blob);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

async function convertToPng(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建图片剪贴板");
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("图片转换失败"))),
        "image/png"
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
