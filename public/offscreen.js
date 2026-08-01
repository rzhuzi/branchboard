function imageToPngBlob(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("无法创建图片剪贴板"));
        return;
      }
      context.drawImage(image, 0, 0);
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("图片转换为 PNG 失败")),
        "image/png"
      );
    };
    image.onerror = () => reject(new Error("无法读取画布图片"));
    image.src = dataUrl;
  });
}

async function copyImageWithSelection(dataUrl) {
  const container = document.createElement("div");
  const image = document.createElement("img");
  container.setAttribute("contenteditable", "true");
  container.setAttribute("aria-hidden", "true");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.width = "1px";
  container.style.height = "1px";
  container.style.overflow = "hidden";
  image.src = dataUrl;
  image.alt = "";
  container.appendChild(image);
  document.body.appendChild(container);

  try {
    if (typeof image.decode === "function") {
      await image.decode();
    }
    const selection = window.getSelection();
    if (!selection) {
      throw new Error("无法创建图片选择区域");
    }
    const range = document.createRange();
    range.selectNode(image);
    selection.removeAllRanges();
    selection.addRange(range);
    container.focus();
    if (!document.execCommand("copy")) {
      throw new Error("兼容复制通道没有写入图片");
    }
    selection.removeAllRanges();
  } finally {
    window.getSelection()?.removeAllRanges();
    container.remove();
  }
}

async function writeClipboard(message) {
  if (message.format === "text") {
    const text = String(message.text || "");
    try {
      await navigator.clipboard.writeText(text);
    } catch (clipboardError) {
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
          throw new Error("兼容复制通道没有写入剪贴板");
        }
      } catch (fallbackError) {
        const primaryMessage =
          clipboardError instanceof Error
            ? clipboardError.message
            : String(clipboardError);
        const fallbackMessage =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        throw new Error(
          `剪贴板 API 失败：${primaryMessage}；兼容复制失败：${fallbackMessage}`
        );
      } finally {
        textarea.remove();
      }
    }
    return;
  }
  if (message.format === "image") {
    const dataUrl = String(message.dataUrl || "");
    if (!dataUrl.startsWith("data:image/")) {
      throw new Error("只支持复制图片");
    }
    const blob = await imageToPngBlob(dataUrl);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": blob
        })
      ]);
    } catch (clipboardError) {
      try {
        await copyImageWithSelection(dataUrl);
      } catch (fallbackError) {
        const primaryMessage =
          clipboardError instanceof Error
            ? clipboardError.message
            : String(clipboardError);
        const fallbackMessage =
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError);
        throw new Error(
          `图片剪贴板 API 失败：${primaryMessage}；兼容复制失败：${fallbackMessage}`
        );
      }
    }
    return;
  }
  throw new Error("未知的剪贴板格式");
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    message?.target !== "offscreen" ||
    message?.type !== "branchboard:offscreen-clipboard-write"
  ) {
    return;
  }
  void writeClipboard(message)
    .then(() => sendResponse({ ok: true }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    );
  return true;
});

