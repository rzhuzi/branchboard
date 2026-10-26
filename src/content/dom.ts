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

export function isResponseGenerating(turns: Element[] = []): boolean {
  return Boolean(findStopButton()) || turns.some((turn) => {
    const state = responseStateElement(turn)?.getAttribute("data-talvt-turn-state");
    return (state !== undefined && state !== null && state !== "complete") ||
      hasImageGenerationProgress(turn);
  });
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

const LEGACY_TURN_SELECTOR = "[data-testid^='conversation-turn-']";
const CURRENT_TURN_SELECTOR = "[data-turn-key]";
const GENERATED_IMAGE_CONTAINER =
  "[data-testid='generated-image-preview'], [data-testid='generated-image-gallery'], [class*='imagegen']";
const GENERATED_IMAGE_ALT = /^(?:已生成(?:图片|图像)|generated image)(?=$|[\s:：])/i;
const USER_MESSAGE_SELECTOR =
  "[data-message-author-role='user'], [data-user-message-bubble], [data-chatgpt-search-unit-key$=':user']";
const IMAGE_PROGRESS_LABEL = /^(?:正在(?:勾勒草图|生成(?:图片|图像)|绘制(?:图片|图像)|添加细节)|(?:creating|generating|drawing) (?:an? )?image)[.。…\s]*$/i;

function responseStateElement(turn: Element): Element | null {
  return turn.matches("[data-talvt-turn-state]")
    ? turn
    : turn.querySelector("[data-talvt-turn-state]");
}

function hasImageGenerationProgress(turn: Element): boolean {
  const indicators = turn.querySelectorAll("[role='progressbar'], [aria-busy='true'], span, p, div");
  return Array.from(indicators).some((element) => {
    if (element.closest(USER_MESSAGE_SELECTOR) || element.closest("[aria-hidden='true']") || !visible(element)) return false;
    return element.matches("[role='progressbar'], [aria-busy='true']") ||
      (!element.childElementCount && IMAGE_PROGRESS_LABEL.test(element.textContent?.trim() || ""));
  });
}

export function isAssistantResponseComplete(turns: Element[]): boolean {
  if (!turns.length || isResponseGenerating(turns)) return false;
  return turns.every((turn) => {
    const state = responseStateElement(turn);
    if (state) return state.getAttribute("data-talvt-turn-state") === "complete";
    // Older pages expose final-answer actions instead of an explicit turn state.
    return Array.from(turn.querySelectorAll(
      "[data-testid='copy-turn-action-button'], [data-testid='good-response-turn-action-button'], [data-testid='bad-response-turn-action-button']"
    )).some(visible);
  });
}

export type ConversationBaseline = {
  latestTurn: number;
  turnKeys: Set<string>;
};

function conversationTurnNumber(element: Element): number {
  const turn = element.closest(LEGACY_TURN_SELECTOR);
  const match = turn?.getAttribute("data-testid")?.match(/conversation-turn-(\d+)/);
  return match ? Number(match[1]) : -1;
}

export function captureConversationBaseline(): ConversationBaseline {
  return {
    latestTurn: Math.max(
      -1,
      ...Array.from(document.querySelectorAll(LEGACY_TURN_SELECTOR)).map(conversationTurnNumber)
    ),
    turnKeys: new Set(
      Array.from(document.querySelectorAll(CURRENT_TURN_SELECTOR)).map(
        (turn) => turn.getAttribute("data-turn-key")!
      )
    )
  };
}

function isNewConversationTurn(element: Element, baseline: ConversationBaseline): boolean {
  const key = element.closest(CURRENT_TURN_SELECTOR)?.getAttribute("data-turn-key");
  if (key && baseline.turnKeys.has(key)) return false;
  const turn = conversationTurnNumber(element);
  return turn < 0 || turn > baseline.latestTurn;
}

export function isGeneratedImage(image: HTMLImageElement): boolean {
  if (image.closest(USER_MESSAGE_SELECTOR)) return false;
  const alt = image.getAttribute("alt") || "";
  return (
    GENERATED_IMAGE_ALT.test(alt) ||
    Boolean(image.closest(GENERATED_IMAGE_CONTAINER))
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
  baselineTurn: ConversationBaseline,
  baselineKeys: Set<string>
): HTMLImageElement[] {
  const candidates = Array.from(document.querySelectorAll("img")).filter(
    (image): image is HTMLImageElement => {
      if (!(image instanceof HTMLImageElement)) return false;
      if (!isGeneratedImage(image)) return false;
      const key = generatedImageKey(image);
      if (!key || baselineKeys.has(key)) return false;
      if (!isNewConversationTurn(image, baselineTurn)) return false;
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
    /^(?:已生成(?:图片|图像)|generated image)(?:\s*[:：]\s*|\s+\d+\s*$|\s*$)/i,
    ""
  );
  return alt || fallbackTitle || "ChatGPT 生成结果";
}

export function newAssistantTurns(baselineTurn: ConversationBaseline): Element[] {
  return Array.from(
    document.querySelectorAll(`${LEGACY_TURN_SELECTOR}, ${CURRENT_TURN_SELECTOR}`)
  ).filter((element) => {
    if (!isNewConversationTurn(element, baselineTurn)) return false;
    if (element.matches(CURRENT_TURN_SELECTOR)) {
      // A current turn contains both the user bubble and the assistant response.
      if (element.querySelector(LEGACY_TURN_SELECTOR)) return false;
      return Boolean(element.querySelector("[data-chatgpt-agent-turn-start]"));
    }
    const role = element.getAttribute("data-message-author-role") ??
      element.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role");
    if (role) return role === "assistant";
    const turn = conversationTurnNumber(element);
    if (turn >= baselineTurn.latestTurn + 2) return true;
    const heading = Array.from(element.querySelectorAll("h4, h5, h6"))
      .map((element) => element.textContent || "")
      .join(" ");
    return /ChatGPT|assistant|助手/i.test(heading);
  });
}

export function hasImageGenerationPlaceholder(turns: Element[]): boolean {
  return turns.some(
    (turn) =>
      hasImageGenerationProgress(turn) ||
      Boolean(turn.querySelector(GENERATED_IMAGE_CONTAINER)) ||
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
