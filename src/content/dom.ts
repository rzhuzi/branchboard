import { uniqueByKey } from "../shared/blob";

export type Composer = HTMLTextAreaElement | HTMLElement;

export function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function visible(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLElement && element.hidden) return false;
  return element.getClientRects().length > 0;
}

export function findComposer(): Composer | null {
  const selectors = [
    "#prompt-textarea",
    "textarea[data-testid='prompt-textarea']",
    "form textarea",
    "[contenteditable='true'][data-testid='prompt-textarea']",
    "main form [contenteditable='true']",
    "main [contenteditable='true'][data-virtualkeyboard='true']"
  ];
  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll(selector));
    for (const element of candidates) {
      if (
        element instanceof HTMLTextAreaElement ||
        (element instanceof HTMLElement && element.isContentEditable)
      ) {
        if (visible(element)) return element;
      }
    }
  }
  return null;
}

export function composerText(composer: Composer): string {
  if (composer instanceof HTMLTextAreaElement) return composer.value;
  return (composer.innerText || composer.textContent || "").trim();
}

export function fillComposer(composer: Composer, text: string): void {
  composer.focus();
  if (composer instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )?.set;
    if (setter) setter.call(composer, text);
    else composer.value = text;
    composer.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text
      })
    );
    composer.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(composer);
  selection?.removeAllRanges();
  selection?.addRange(range);
  const inserted = document.execCommand("insertText", false, text);
  if (!inserted) {
    composer.textContent = text;
    composer.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text
      })
    );
  }
}

export function findSendButton(): HTMLButtonElement | null {
  const scope = findComposer()?.closest("form") || document;
  const selectors = [
    "button[data-testid='send-button']",
    "button[aria-label*='Send' i]",
    "button[aria-label*='发送']"
  ];
  for (const selector of selectors) {
    const buttons = Array.from(scope.querySelectorAll(selector));
    for (const button of buttons) {
      if (
        button instanceof HTMLButtonElement &&
        !button.disabled &&
        !button.hidden &&
        visible(button)
      ) {
        return button;
      }
    }
  }
  return null;
}

export function findStopButton(): HTMLButtonElement | null {
  const selectors = [
    "button[data-testid='stop-button']",
    "button[aria-label*='Stop generating' i]",
    "button[aria-label*='Stop streaming' i]",
    "button[aria-label*='停止生成']",
    "button[aria-label*='停止回复']"
  ];
  for (const selector of selectors) {
    const buttons = Array.from(document.querySelectorAll(selector));
    for (const button of buttons) {
      if (button instanceof HTMLButtonElement && visible(button)) return button;
    }
  }
  return null;
}

export function isResponseGenerating(): boolean {
  return Boolean(findStopButton());
}

export function findFileInput(): HTMLInputElement | null {
  const composerRoot = findComposer()?.closest("form");
  const inputs = Array.from(
    (composerRoot || document).querySelectorAll("input[type='file']")
  );
  for (const input of inputs) {
    if (!(input instanceof HTMLInputElement)) continue;
    const accept = input.accept.toLowerCase();
    if (
      !accept ||
      accept.includes("image") ||
      /\.(?:png|jpe?g|webp|gif|avif)/.test(accept)
    ) {
      return input;
    }
  }
  return null;
}

export function findAttachButton(): HTMLButtonElement | null {
  const selectors = [
    "button[data-testid='composer-plus-btn']",
    "button[aria-label*='Attach' i]",
    "button[aria-label*='Upload' i]",
    "button[aria-label*='添加']",
    "button[aria-label*='上传']"
  ];
  for (const selector of selectors) {
    const buttons = Array.from(document.querySelectorAll(selector));
    for (const button of buttons) {
      if (button instanceof HTMLButtonElement && visible(button)) return button;
    }
  }
  return null;
}

function conversationTurnNumber(element: Element): number {
  const section = element.closest("section[data-testid^='conversation-turn-']");
  const match = section?.getAttribute("data-testid")?.match(/conversation-turn-(\d+)/);
  return match ? Number(match[1]) : -1;
}

export function latestConversationTurn(): number {
  return Math.max(
    -1,
    ...Array.from(
      document.querySelectorAll("section[data-testid^='conversation-turn-']")
    ).map((section) => {
      const match = section
        .getAttribute("data-testid")
        ?.match(/conversation-turn-(\d+)/);
      return match ? Number(match[1]) : -1;
    })
  );
}

export function isGeneratedImage(image: HTMLImageElement): boolean {
  const alt = image.getAttribute("alt") || "";
  return (
    /^(?:已生成图片|generated image)\s*[:：]/i.test(alt) ||
    Boolean(image.closest('[class*="imagegen-image"], [class*="imagegen"]'))
  );
}

export function generatedImageKey(image: HTMLImageElement): string {
  return image.currentSrc || image.src || "";
}

export function generatedImageKeys(): Set<string> {
  return new Set(
    Array.from(document.querySelectorAll("img"))
      .filter(
        (image): image is HTMLImageElement =>
          image instanceof HTMLImageElement && isGeneratedImage(image)
      )
      .map(generatedImageKey)
      .filter(Boolean)
  );
}

export function newGeneratedImages(
  baselineTurn: number,
  baselineKeys: Set<string>
): HTMLImageElement[] {
  const candidates = Array.from(document.querySelectorAll("img")).filter(
    (image): image is HTMLImageElement => {
      if (!(image instanceof HTMLImageElement)) return false;
      if (!isGeneratedImage(image)) return false;
      const key = generatedImageKey(image);
      if (!key || baselineKeys.has(key)) return false;
      const turn = conversationTurnNumber(image);
      if (baselineTurn >= 0 && turn >= 0 && turn <= baselineTurn) return false;
      return (
        image.complete &&
        image.naturalWidth >= 256 &&
        image.naturalHeight >= 256
      );
    }
  );
  return uniqueByKey(candidates, generatedImageKey);
}

export function generatedImageName(
  image: HTMLImageElement,
  fallbackTitle: string
): string {
  const alt = (image.getAttribute("alt") || "").replace(
    /^(?:已生成图片|generated image)\s*[:：]\s*/i,
    ""
  );
  return alt || fallbackTitle || "ChatGPT 生成结果";
}

export function newAssistantTurns(baselineTurn: number): Element[] {
  return Array.from(
    document.querySelectorAll("section[data-testid^='conversation-turn-']")
  ).filter((section) => {
    const match = section
      .getAttribute("data-testid")
      ?.match(/conversation-turn-(\d+)/);
    const turn = match ? Number(match[1]) : -1;
    if (turn >= baselineTurn + 2) return true;
    const heading = Array.from(section.querySelectorAll("h4, h5, h6"))
      .map((element) => element.textContent || "")
      .join(" ");
    return turn > baselineTurn && /ChatGPT|assistant|助手/i.test(heading);
  });
}

export function hasImageGenerationPlaceholder(turns: Element[]): boolean {
  return turns.some(
    (turn) =>
      Boolean(turn.querySelector('[class*="imagegen"]')) ||
      Array.from(turn.querySelectorAll("img")).some(
        (image) =>
          image instanceof HTMLImageElement && isGeneratedImage(image)
      )
  );
}

export async function attachReferenceImages(
  images: { name: string; dataUrl: string }[],
  signal: AbortSignal
): Promise<void> {
  if (!images.length) return;
  let input = findFileInput();
  if (!input) {
    findAttachButton()?.click();
    const startedAt = Date.now();
    while (!input && Date.now() - startedAt < 2400) {
      await wait(120);
      input = findFileInput();
    }
  }
  if (!input) {
    throw new Error("找不到参考图上传入口，请把图片直接粘贴到 ChatGPT 输入框");
  }

  const transfer = new DataTransfer();
  for (const image of images) {
    const response = await fetch(image.dataUrl, { signal });
    const blob = await response.blob();
    const extension = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    transfer.items.add(
      new File([blob], image.name || `branchboard-reference.${extension}`, {
        type: blob.type || "image/png"
      })
    );
  }
  const filesSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "files"
  )?.set;
  if (filesSetter) filesSetter.call(input, transfer.files);
  else input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await wait(1100);
}
