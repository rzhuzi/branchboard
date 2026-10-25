import { blobToDataUrl, sha256Hex } from "../shared/blob";
import { MSG, type StoreImageMessage } from "../shared/messages";
import type {
  ExecutionStage,
  RunPromptRequest
} from "../shared/types";
import {
  attachReferenceImages,
  composerText,
  fillComposer,
  findComposer,
  findSendButton,
  findStopButton,
  generatedImageKeys,
  generatedImageName,
  hasImageGenerationPlaceholder,
  isResponseGenerating,
  latestConversationTurn,
  newAssistantTurns,
  newGeneratedImages,
  wait
} from "./dom";

const TEXT_RESPONSE_GRACE_MS = 10_000;
const GENERATION_TIMEOUT_MS = 360_000;
const HEARTBEAT_MS = 15_000;

type ActiveExecution = {
  request: RunPromptRequest;
  cancelled: boolean;
  controller: AbortController;
};

export type AutomationHooks = {
  report: (request: RunPromptRequest, stage: ExecutionStage, message: string) => void;
  onRunning: () => void;
  onFinished: (outcome: "done" | "error" | "cancelled") => void;
  onError: (message: string) => void;
};

let active: ActiveExecution | null = null;

function assertActive(execution: ActiveExecution): void {
  if (execution.cancelled || execution.controller.signal.aborted) {
    throw new DOMException("运行已取消", "AbortError");
  }
}

async function waitForComposer(
  execution: ActiveExecution,
  timeout = 10_000
): Promise<ReturnType<typeof findComposer>> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    assertActive(execution);
    const composer = findComposer();
    if (composer) return composer;
    await wait(180);
  }
  throw new Error("没有找到 ChatGPT 输入框，请刷新页面后重试");
}

async function waitForSendButton(
  execution: ActiveExecution,
  timeout = 10_000
): Promise<HTMLButtonElement> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    assertActive(execution);
    const button = findSendButton();
    if (button) return button;
    await wait(160);
  }
  throw new Error("提示词已填入，但发送按钮暂时不可用");
}

async function waitForSendStarted(
  execution: ActiveExecution,
  timeout = 10_000
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    assertActive(execution);
    if (findStopButton()) return;
    const composer = findComposer();
    if (composer && !composerText(composer)) return;
    await wait(150);
  }
  throw new Error("发送没有开始，请检查 ChatGPT 输入框");
}

async function storeGeneratedImage(
  request: RunPromptRequest,
  image: HTMLImageElement,
  signal: AbortSignal,
  capturedFingerprints: Set<string>
): Promise<boolean> {
  const imageUrl = image.currentSrc || image.src;
  if (!imageUrl) throw new Error("生成图片没有可读取的地址");
  const response = await fetch(imageUrl, { credentials: "include", signal });
  if (!response.ok) throw new Error(`读取生成图片失败 (${response.status})`);
  const blob = await response.blob();
  const hash = await sha256Hex(blob);
  if (capturedFingerprints.has(hash)) return false;
  capturedFingerprints.add(hash);
  const dataUrl = await blobToDataUrl(blob);
  const message: StoreImageMessage = {
    type: MSG.storeImage,
    dataUrl,
    name: generatedImageName(image, request.title),
    canvasId: request.canvasId,
    promptId: request.promptId,
    requestId: request.requestId,
    relation: "generated",
    width: image.naturalWidth,
    height: image.naturalHeight,
    hash
  };
  const stored = (await chrome.runtime.sendMessage(message)) as
    | { ok?: boolean; error?: string }
    | undefined;
  if (!stored?.ok) {
    throw new Error(stored?.error || "生成结果写入本地画布失败");
  }
  return true;
}

async function waitForGeneratedResults(
  request: RunPromptRequest,
  execution: ActiveExecution,
  hooks: AutomationHooks,
  baselineTurn: number,
  baselineKeys: Set<string>
): Promise<void> {
  const startedAt = Date.now();
  let firstReadyAt = 0;
  let textResponseReadyAt = 0;
  let lastHeartbeatAt = Date.now();
  hooks.report(request, "waiting", "ChatGPT 正在生成图片");

  while (Date.now() - startedAt < GENERATION_TIMEOUT_MS) {
    assertActive(execution);
    if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) {
      lastHeartbeatAt = Date.now();
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      hooks.report(request, "waiting", `正在等待 ChatGPT 生成 · 已等待 ${elapsed} 秒`);
    }

    const candidates = newGeneratedImages(baselineTurn, baselineKeys);
    if (!candidates.length) {
      firstReadyAt = 0;
      const assistantTurns = newAssistantTurns(baselineTurn);
      const stillRunning = isResponseGenerating();
      const imagePlaceholder = hasImageGenerationPlaceholder(assistantTurns);
      if (assistantTurns.length && !stillRunning && !imagePlaceholder) {
        if (!textResponseReadyAt) textResponseReadyAt = Date.now();
        if (Date.now() - textResponseReadyAt >= TEXT_RESPONSE_GRACE_MS) {
          throw new Error("ChatGPT 返回了文字，没有生成图片");
        }
      } else {
        textResponseReadyAt = 0;
      }
      await wait(900);
      continue;
    }

    textResponseReadyAt = 0;
    if (!firstReadyAt) firstReadyAt = Date.now();
    if (Date.now() - firstReadyAt < 1600) {
      await wait(400);
      continue;
    }

    hooks.report(request, "capturing", `正在读取 ${candidates.length} 张图片`);
    const capturedFingerprints = new Set<string>();
    let capturedCount = 0;
    for (const image of candidates) {
      assertActive(execution);
      if (
        await storeGeneratedImage(
          request,
          image,
          execution.controller.signal,
          capturedFingerprints
        )
      ) {
        capturedCount += 1;
      }
    }
    hooks.report(
      request,
      "captured",
      capturedCount > 0
        ? `${capturedCount} 张图片已加入画布`
        : "生成图片与已有结果相同，未重复加入"
    );
    return;
  }

  throw new Error("等待生成图片超时，请检查 ChatGPT 是否生成成功");
}

export function hasActiveAutomation(): boolean {
  return Boolean(active);
}

export function cancelAutomation(
  requestIds: string[],
  hooks: AutomationHooks
): void {
  if (!active || !requestIds.includes(active.request.requestId)) return;
  active.cancelled = true;
  active.controller.abort();
  findStopButton()?.click();
  hooks.report(active.request, "cancelled", "已取消生成");
}

export async function executePrompt(
  request: RunPromptRequest,
  hooks: AutomationHooks
): Promise<void> {
  if (active) {
    hooks.report(request, "failed", "另一个节点正在执行，请稍后重试");
    hooks.onError("另一个节点正在执行，请稍后重试");
    return;
  }
  const execution: ActiveExecution = {
    request,
    cancelled: false,
    controller: new AbortController()
  };
  active = execution;
  hooks.onRunning();
  let outcome: "done" | "error" | "cancelled" = "error";
  try {
    const prompt = String(request.prompt || "").trim();
    if (!prompt) throw new Error("提示词是空的");

    const composer = await waitForComposer(execution);
    if (!composer) throw new Error("没有找到 ChatGPT 输入框，请刷新页面后重试");
    if (composerText(composer)) {
      throw new Error("ChatGPT 输入框里已有内容，请先清空或发送后再试");
    }

    if (request.references?.length) {
      hooks.report(request, "attaching", `正在附加 ${request.references.length} 张参考图`);
      assertActive(execution);
      await attachReferenceImages(request.references, execution.controller.signal);
      assertActive(execution);
    }

    hooks.report(request, "filling", "正在填入提示词");
    fillComposer(composer, prompt);
    await wait(200);
    assertActive(execution);
    if (!composerText(findComposer() ?? composer)) {
      throw new Error("未能写入 ChatGPT 输入框，请刷新页面后重试");
    }

    hooks.report(request, "sending", "正在发送");
    const sendButton = await waitForSendButton(execution);
    const baselineTurn = latestConversationTurn();
    const baselineKeys = generatedImageKeys();
    assertActive(execution);
    sendButton.click();
    await waitForSendStarted(execution);
    hooks.report(request, "sent", "已发送，等待生成图片");
    await waitForGeneratedResults(
      request,
      execution,
      hooks,
      baselineTurn,
      baselineKeys
    );
    outcome = "done";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      outcome = "cancelled";
    } else {
      const message = error instanceof Error ? error.message : String(error);
      outcome = "error";
      hooks.report(request, "failed", message);
      hooks.onError(message);
    }
  } finally {
    if (active === execution) active = null;
    hooks.onFinished(outcome);
  }
}
