import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { MSG, type ProgressMessage } from "../../shared/messages";
import type {
  ExecutionStage,
  ExecutionTone,
  PromptExecution,
  RunPromptRequest
} from "../../shared/types";
import { useToast } from "./ToastProvider";

type ExecutionContextValue = {
  entries: Record<string, PromptExecution>;
  workingCount: number;
  queuedCount: number;
  runPrompt: (request: RunPromptRequest) => boolean;
  cancelPrompt: (promptId: string) => void;
  cancelCanvas: (canvasId: string) => void;
  dismissPrompt: (promptId: string) => void;
};

const ExecutionContext = createContext<ExecutionContextValue | null>(null);

function toneForStage(stage: ExecutionStage): ExecutionTone {
  if (stage === "captured") return "done";
  if (stage === "failed") return "error";
  if (stage === "cancelled") return "cancelled";
  return "working";
}

export function ExecutionProvider({
  children,
  embedded
}: {
  children: ReactNode;
  embedded: boolean;
}) {
  const { pushToast } = useToast();
  const [entries, setEntries] = useState<Record<string, PromptExecution>>({});
  const entriesRef = useRef<Record<string, PromptExecution>>({});
  const activeRef = useRef<RunPromptRequest | null>(null);
  const queueRef = useRef<RunPromptRequest[]>([]);
  const lastProgressAtRef = useRef(0);
  const removeTimers = useRef(new Map<string, number>());
  const cancelTimerRef = useRef<number | null>(null);

  const updateEntries = useCallback(
    (updater: (current: Record<string, PromptExecution>) => Record<string, PromptExecution>) => {
      const next = updater(entriesRef.current);
      entriesRef.current = next;
      setEntries(next);
    },
    []
  );

  const clearRemoveTimer = useCallback((promptId: string) => {
    const timer = removeTimers.current.get(promptId);
    if (timer) window.clearTimeout(timer);
    removeTimers.current.delete(promptId);
  }, []);

  const scheduleRemove = useCallback(
    (promptId: string, delay: number) => {
      clearRemoveTimer(promptId);
      removeTimers.current.set(
        promptId,
        window.setTimeout(() => {
          removeTimers.current.delete(promptId);
          updateEntries((current) => {
            const next = { ...current };
            delete next[promptId];
            return next;
          });
        }, delay)
      );
    },
    [clearRemoveTimer, updateEntries]
  );

  const setEntry = useCallback(
    (entry: PromptExecution) => {
      updateEntries((current) => ({ ...current, [entry.promptId]: entry }));
    },
    [updateEntries]
  );

  const startNext = useCallback(() => {
    if (activeRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    activeRef.current = next;
    lastProgressAtRef.current = Date.now();
    setEntry({
      requestId: next.requestId,
      canvasId: next.canvasId,
      promptId: next.promptId,
      stage: "sending",
      tone: "working",
      message: "正在准备生成",
      title: next.title,
      startedAt: entriesRef.current[next.promptId]?.startedAt ?? Date.now(),
      updatedAt: Date.now()
    });
    window.parent.postMessage({ type: MSG.runPrompt, ...next }, "*");
  }, [setEntry]);

  const runPrompt = useCallback(
    (request: RunPromptRequest): boolean => {
      if (!embedded) return false;
      const current = entriesRef.current[request.promptId];
      const duplicate =
        activeRef.current?.promptId === request.promptId ||
        queueRef.current.some((task) => task.promptId === request.promptId) ||
        current?.tone === "working" ||
        current?.tone === "queued";
      if (duplicate) {
        pushToast("这个节点已有生成任务", { tone: "info" });
        return false;
      }
      clearRemoveTimer(request.promptId);
      const now = Date.now();
      if (!activeRef.current) {
        activeRef.current = request;
        lastProgressAtRef.current = now;
        setEntry({
          requestId: request.requestId,
          canvasId: request.canvasId,
          promptId: request.promptId,
          stage: "sending",
          tone: "working",
          message: "正在准备生成",
          title: request.title,
          startedAt: now,
          updatedAt: now
        });
        window.parent.postMessage({ type: MSG.runPrompt, ...request }, "*");
        return true;
      }
      queueRef.current.push(request);
      setEntry({
        requestId: request.requestId,
        canvasId: request.canvasId,
        promptId: request.promptId,
        stage: "sending",
        tone: "queued",
        message: "排队中，等待前一个节点完成",
        title: request.title,
        startedAt: now,
        updatedAt: now
      });
      return true;
    },
    [clearRemoveTimer, embedded, pushToast, setEntry]
  );

  const cancelPrompt = useCallback(
    (promptId: string) => {
      const entry = entriesRef.current[promptId];
      const active = activeRef.current;
      if (active?.promptId === promptId) {
        window.parent.postMessage(
          { type: MSG.cancelRun, requestIds: [active.requestId] },
          "*"
        );
        updateEntries((current) => ({
          ...current,
          [promptId]: {
            ...(current[promptId] ?? {
              requestId: active.requestId,
              canvasId: active.canvasId,
              promptId,
              stage: "sending" as ExecutionStage,
              tone: "working" as ExecutionTone,
              startedAt: Date.now(),
              updatedAt: Date.now(),
              message: ""
            }),
            message: "正在取消",
            updatedAt: Date.now()
          }
        }));
        if (cancelTimerRef.current) window.clearTimeout(cancelTimerRef.current);
        cancelTimerRef.current = window.setTimeout(() => {
          if (activeRef.current?.promptId !== promptId) return;
          activeRef.current = null;
          updateEntries((current) => {
            if (!current[promptId]) return current;
            return {
              ...current,
              [promptId]: {
                ...current[promptId],
                tone: "cancelled",
                message: "已取消",
                updatedAt: Date.now()
              }
            };
          });
          scheduleRemove(promptId, 1800);
          startNext();
        }, 4200);
        return;
      }

      const queuedIndex = queueRef.current.findIndex((task) => task.promptId === promptId);
      if (queuedIndex >= 0) {
        queueRef.current.splice(queuedIndex, 1);
        updateEntries((current) => {
          if (!current[promptId]) return current;
          return {
            ...current,
            [promptId]: {
              ...current[promptId],
              tone: "cancelled",
              message: "已取消",
              updatedAt: Date.now()
            }
          };
        });
        scheduleRemove(promptId, 1800);
        return;
      }

      if (entry?.tone === "working") {
        window.parent.postMessage(
          { type: MSG.cancelRun, requestIds: [entry.requestId] },
          "*"
        );
        updateEntries((current) => ({
          ...current,
          [promptId]: { ...entry, message: "正在取消", updatedAt: Date.now() }
        }));
      }
    },
    [scheduleRemove, startNext, updateEntries]
  );

  const cancelCanvas = useCallback(
    (canvasId: string) => {
      const promptIds = Object.values(entriesRef.current)
        .filter(
          (entry) =>
            entry.canvasId === canvasId &&
            (entry.tone === "working" || entry.tone === "queued")
        )
        .map((entry) => entry.promptId);
      for (const promptId of promptIds) cancelPrompt(promptId);
    },
    [cancelPrompt]
  );

  const dismissPrompt = useCallback(
    (promptId: string) => {
      clearRemoveTimer(promptId);
      if (activeRef.current?.promptId === promptId) {
        cancelPrompt(promptId);
        return;
      }
      queueRef.current = queueRef.current.filter((task) => task.promptId !== promptId);
      updateEntries((current) => {
        const next = { ...current };
        delete next[promptId];
        return next;
      });
    },
    [cancelPrompt, clearRemoveTimer, updateEntries]
  );

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const data = event.data as ProgressMessage | undefined;
      if (!data || data.type !== MSG.progress) return;
      const promptId = String(data.promptId || "");
      const requestId = String(data.requestId || "");
      if (!promptId || !requestId) return;
      const active = activeRef.current;
      const isActive = active?.requestId === requestId;
      if (isActive) lastProgressAtRef.current = Date.now();

      const stage = String(data.stage || "waiting") as ExecutionStage;
      const tone = toneForStage(stage);
      const known = entriesRef.current[promptId];
      const now = Date.now();
      const entry: PromptExecution = {
        requestId,
        canvasId: String(data.canvasId || "") || active?.canvasId || known?.canvasId || "",
        promptId,
        stage,
        tone,
        message: String(data.message || ""),
        title: known?.title,
        startedAt: known?.startedAt ?? now,
        updatedAt: now
      };
      updateEntries((current) => ({ ...current, [promptId]: entry }));

      if (isActive && (tone === "done" || tone === "error" || tone === "cancelled")) {
        activeRef.current = null;
        if (cancelTimerRef.current) {
          window.clearTimeout(cancelTimerRef.current);
          cancelTimerRef.current = null;
        }
        window.setTimeout(() => startNext(), 60);
      }
      if (tone === "error") {
        pushToast(entry.message || "生成失败", { tone: "error" });
      } else if (tone === "done") {
        scheduleRemove(promptId, 8000);
      } else if (tone === "cancelled") {
        scheduleRemove(promptId, 2200);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [pushToast, scheduleRemove, startNext, updateEntries]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const active = activeRef.current;
      if (!active) return;
      if (Date.now() - lastProgressAtRef.current < 105_000) return;
      window.parent.postMessage(
        { type: MSG.cancelRun, requestIds: [active.requestId] },
        "*"
      );
      updateEntries((current) => {
        if (!current[active.promptId]) return current;
        return {
          ...current,
          [active.promptId]: {
            ...current[active.promptId],
            tone: "error",
            message: "与 ChatGPT 页面通信中断，请刷新页面后重试",
            updatedAt: Date.now()
          }
        };
      });
      activeRef.current = null;
      startNext();
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [startNext, updateEntries]);

  useEffect(
    () => () => {
      for (const timer of removeTimers.current.values()) window.clearTimeout(timer);
      if (cancelTimerRef.current) window.clearTimeout(cancelTimerRef.current);
    },
    []
  );

  const workingCount = Object.values(entries).filter(
    (entry) => entry.tone === "working"
  ).length;
  const queuedCount = Object.values(entries).filter(
    (entry) => entry.tone === "queued"
  ).length;

  const value = useMemo<ExecutionContextValue>(
    () => ({
      entries,
      workingCount,
      queuedCount,
      runPrompt,
      cancelPrompt,
      cancelCanvas,
      dismissPrompt
    }),
    [cancelCanvas, cancelPrompt, dismissPrompt, entries, queuedCount, runPrompt, workingCount]
  );

  return (
    <ExecutionContext.Provider value={value}>{children}</ExecutionContext.Provider>
  );
}

export function useExecution(): ExecutionContextValue {
  const context = useContext(ExecutionContext);
  if (!context) throw new Error("useExecution must be used inside ExecutionProvider");
  return context;
}

export function usePromptExecution(promptId: string): PromptExecution | null {
  return useExecution().entries[promptId] ?? null;
}
