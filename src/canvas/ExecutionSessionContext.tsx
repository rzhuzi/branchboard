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

export type ExecutionTone = "working" | "done" | "error";

export type PromptExecution = {
  requestId: string;
  canvasId: string;
  promptId: string;
  tone: ExecutionTone;
  message: string;
  updatedAt: string;
};

type BeginExecutionInput = {
  requestId: string;
  promptId: string;
  message: string;
};

type ExecutionSessionValue = {
  executions: Record<string, PromptExecution>;
  isBusy: boolean;
  currentCanvasId: string;
  setCurrentCanvasId: (canvasId: string) => void;
  beginExecution: (input: BeginExecutionInput) => boolean;
  cancelPrompts: (promptIds: string[]) => void;
};

const ExecutionSessionContext =
  createContext<ExecutionSessionValue | null>(null);

function now(): string {
  return new Date().toISOString();
}

export function ExecutionSessionProvider({
  children
}: {
  children: ReactNode;
}) {
  const [executions, setExecutions] = useState<
    Record<string, PromptExecution>
  >({});
  const [currentCanvasId, setCurrentCanvasIdState] = useState("");
  const currentCanvasIdRef = useRef("");
  const executionsRef = useRef(executions);

  useEffect(() => {
    executionsRef.current = executions;
  }, [executions]);

  const setCurrentCanvasId = useCallback((canvasId: string) => {
    currentCanvasIdRef.current = canvasId;
    setCurrentCanvasIdState(canvasId);
  }, []);

  const beginExecution = useCallback(
    ({ requestId, promptId, message }: BeginExecutionInput): boolean => {
      const busy = Object.values(executionsRef.current).some(
        (execution) => execution.tone === "working"
      );
      if (busy) return false;
      const execution: PromptExecution = {
        requestId,
        canvasId: currentCanvasIdRef.current,
        promptId,
        tone: "working",
        message,
        updatedAt: now()
      };
      executionsRef.current = {
        ...executionsRef.current,
        [promptId]: execution
      };
      setExecutions(executionsRef.current);
      return true;
    },
    []
  );

  const cancelPrompts = useCallback((promptIds: string[]) => {
    if (!promptIds.length) return;
    setExecutions((current) => {
      const next = { ...current };
      for (const promptId of promptIds) delete next[promptId];
      executionsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    const handleProgress = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (event.data?.type !== "branchboard:execution-progress") return;

      const requestId = String(event.data.requestId || "");
      const explicitPromptId = String(event.data.promptId || "");
      const existing = explicitPromptId
        ? executionsRef.current[explicitPromptId]
        : Object.values(executionsRef.current).find(
            (execution) => execution.requestId === requestId
          );
      const promptId = explicitPromptId || existing?.promptId || "";
      if (!promptId) return;
      if (existing && existing.requestId !== requestId) return;

      const stage = String(event.data.stage || "");
      if (stage === "cancelled") {
        cancelPrompts([promptId]);
        return;
      }
      const tone: ExecutionTone =
        stage === "failed"
          ? "error"
          : stage === "captured"
            ? "done"
            : "working";
      const next: PromptExecution = {
        requestId,
        canvasId:
          String(event.data.canvasId || "") ||
          existing?.canvasId ||
          currentCanvasIdRef.current,
        promptId,
        tone,
        message: String(
          event.data.message ||
            (tone === "error"
              ? "执行失败"
              : tone === "done"
                ? "生成图片已自动回传"
                : "正在执行")
        ),
        updatedAt: now()
      };
      executionsRef.current = {
        ...executionsRef.current,
        [promptId]: next
      };
      setExecutions(executionsRef.current);
    };

    window.addEventListener("message", handleProgress);
    return () => window.removeEventListener("message", handleProgress);
  }, [cancelPrompts]);

  const isBusy = Object.values(executions).some(
    (execution) => execution.tone === "working"
  );
  const value = useMemo<ExecutionSessionValue>(
    () => ({
      executions,
      isBusy,
      currentCanvasId,
      setCurrentCanvasId,
      beginExecution,
      cancelPrompts
    }),
    [
      beginExecution,
      cancelPrompts,
      currentCanvasId,
      executions,
      isBusy,
      setCurrentCanvasId
    ]
  );

  return (
    <ExecutionSessionContext.Provider value={value}>
      {children}
    </ExecutionSessionContext.Provider>
  );
}

export function useExecutionSession(): ExecutionSessionValue {
  const context = useContext(ExecutionSessionContext);
  if (!context) {
    throw new Error(
      "useExecutionSession must be used inside ExecutionSessionProvider"
    );
  }
  return context;
}

