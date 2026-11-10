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
import { listPending, deletePending } from "../../shared/db";
import { integratePendingIntoSnapshot } from "../../shared/integration";
import { MSG, type ResultNoticeMessage } from "../../shared/messages";
import { migrateLegacyWorkspaceIfNeeded } from "../../shared/migration";
import type { CanvasSnapshot, CanvasTab, PendingImage } from "../../shared/types";
import {
  createWorkspaceSession,
  type WorkspaceSession,
  type WorkspaceView
} from "../../shared/workspace";
import { EditorContextProviders } from "./EditorContext";
import { useEditor } from "./useEditor";
import { useExecution } from "./ExecutionProvider";
import { useToast } from "./ToastProvider";
import { BrandMark } from "../ui/Brand";

export type WorkspaceContextValue = {
  tabs: CanvasTab[];
  activeCanvasId: string;
  busy: boolean;
  unread: Record<string, number>;
  switchCanvas: (canvasId: string) => Promise<boolean>;
  createCanvas: () => Promise<boolean>;
  deleteCanvas: (canvasId: string) => Promise<boolean>;
  renameCanvas: (canvasId: string, title: string) => Promise<boolean>;
  focusPromptInCanvas: (canvasId: string, promptId: string) => Promise<void>;
  embedded: boolean;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function createEmptySnapshot(): CanvasSnapshot {
  return {
    nodes: [],
    edges: [],
    viewport: null,
    updatedAt: new Date().toISOString()
  };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

function LoadingScreen({ message }: { message: string }) {
  return (
    <div className="bb-app-loading">
      <span className="bb-loader-mark" aria-hidden="true">
        <BrandMark size={28} />
      </span>
      <strong>Branchboard</strong>
      <p>{message}</p>
      <span className="bb-loader-bar" aria-hidden="true" />
    </div>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="bb-app-loading error">
      <span className="bb-loader-mark" aria-hidden="true">
        !
      </span>
      <strong>无法打开本地画布</strong>
      <p>{message}</p>
      <button type="button" className="bb-button primary" onClick={onRetry}>
        重试
      </button>
    </div>
  );
}

export function WorkspaceLoader({
  embedded,
  children
}: {
  embedded: boolean;
  children: ReactNode;
}) {
  const workspace = useMemo(
    () => createWorkspaceSession({ createEmptySnapshot }),
    []
  );
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [message, setMessage] = useState("正在读取本地画布");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError("");
    setMessage("正在读取本地画布");
    void (async () => {
      try {
        await migrateLegacyWorkspaceIfNeeded((progress) => {
          if (!cancelled) setMessage(progress);
        });
        const nextView = await workspace.open();
        if (cancelled) return;
        setView(nextView);
      } catch (reason) {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : "本地存储暂时不可用");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, workspace]);

  if (error) {
    return (
      <ErrorScreen
        message={error}
        onRetry={() => {
          setError("");
          setAttempt((value) => value + 1);
        }}
      />
    );
  }
  if (!view) return <LoadingScreen message={message} />;
  return (
    <WorkspaceShell
      workspace={workspace}
      initialView={view}
      embedded={embedded}
    >
      {children}
    </WorkspaceShell>
  );
}

function WorkspaceShell({
  workspace,
  initialView,
  embedded,
  children
}: {
  workspace: WorkspaceSession;
  initialView: WorkspaceView;
  embedded: boolean;
  children: ReactNode;
}) {
  const [view, setView] = useState<WorkspaceView>(initialView);
  const [tabs, setTabs] = useState<CanvasTab[]>(initialView.canvases);
  const [busy, setBusy] = useState(false);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const viewRef = useRef(view);
  const tabsRef = useRef(tabs);
  const busyRef = useRef(false);
  const pendingBusyRef = useRef(false);
  const { pushToast } = useToast();
  const { cancelCanvas } = useExecution();
  viewRef.current = view;
  tabsRef.current = tabs;
  busyRef.current = busy;

  const editor = useEditor({
    workspace,
    canvasId: view.activeCanvasId,
    document: view.document,
    embedded
  });
  const editorActions = editor.actions;
  const editorFlush = editor.flush;

  const postResultNotice = useCallback(
    (canvasId: string, count: number) => {
      if (!embedded || count <= 0) return;
      window.parent.postMessage(
        {
          type: MSG.resultNotice,
          canvasId,
          count
        } satisfies ResultNoticeMessage,
        "*"
      );
    },
    [embedded]
  );

  const switchCanvas = useCallback(
    async (targetCanvasId: string): Promise<boolean> => {
      if (busyRef.current) return false;
      if (targetCanvasId === viewRef.current.activeCanvasId) return true;
      setBusy(true);
      busyRef.current = true;
      try {
        const saved = await editorFlush();
        if (!saved) {
          pushToast("当前画布尚未保存，暂时无法切换", { tone: "error" });
          return false;
        }
        const nextView = await workspace.switchCanvas(targetCanvasId);
        if (!nextView) {
          pushToast("目标画布不存在或已在其他页面删除", { tone: "error" });
          return false;
        }
        setTabs(nextView.canvases);
        setView(nextView);
        setUnread((current) => {
          const next = { ...current };
          delete next[targetCanvasId];
          return next;
        });
        await nextFrame();
        return true;
      } finally {
        setBusy(false);
        busyRef.current = false;
      }
    },
    [editorFlush, pushToast, workspace]
  );

  const createCanvas = useCallback(async (): Promise<boolean> => {
    if (busyRef.current) return false;
    setBusy(true);
    busyRef.current = true;
    try {
      const saved = await editorFlush();
      if (!saved) {
        pushToast("当前画布尚未保存，暂时无法新建画布", { tone: "error" });
        return false;
      }
      const nextView = await workspace.createCanvas();
      setTabs(nextView.canvases);
      setView(nextView);
      await nextFrame();
      return true;
    } catch {
      pushToast("新建画布失败，请稍后重试", { tone: "error" });
      return false;
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }, [editorFlush, pushToast, workspace]);

  const deleteCanvas = useCallback(
    async (targetCanvasId: string): Promise<boolean> => {
      if (busyRef.current) return false;
      if (tabsRef.current.length <= 1) {
        pushToast("至少需要保留一个画布", { tone: "info" });
        return false;
      }
      setBusy(true);
      busyRef.current = true;
      try {
        const saved = await editorFlush();
        if (!saved) {
          pushToast("当前画布尚未保存，暂时无法删除画布", { tone: "error" });
          return false;
        }
        const currentActiveId = viewRef.current.activeCanvasId;
        const nextView = await workspace.deleteCanvas(currentActiveId, targetCanvasId);
        if (!nextView) {
          pushToast("删除画布失败，请稍后重试", { tone: "error" });
          return false;
        }
        cancelCanvas(targetCanvasId);
        editorActions.forgetCanvas(targetCanvasId);
        setTabs(nextView.canvases);
        setView(nextView);
        setUnread((current) => {
          const next = { ...current };
          delete next[targetCanvasId];
          return next;
        });
        await nextFrame();
        return true;
      } finally {
        setBusy(false);
        busyRef.current = false;
      }
    },
    [cancelCanvas, editorActions, editorFlush, pushToast, workspace]
  );

  const renameCanvas = useCallback(
    async (canvasId: string, title: string): Promise<boolean> => {
      const trimmed = title.trim();
      if (!trimmed) return false;
      const registry = await workspace.renameCanvas(canvasId, trimmed);
      if (!registry) {
        pushToast("画布不存在或已被删除", { tone: "error" });
        return false;
      }
      setTabs(registry.canvases);
      return true;
    },
    [pushToast, workspace]
  );

  const focusPromptInCanvas = useCallback(
    async (targetCanvasId: string, promptId: string) => {
      const ok = await switchCanvas(targetCanvasId);
      if (!ok) return;
      await nextFrame();
      editorActions.locateNodes([promptId]);
    },
    [editorActions, switchCanvas]
  );

  const consumePending = useCallback(async () => {
    if (pendingBusyRef.current) return;
    pendingBusyRef.current = true;
    const activeAtStart = viewRef.current.activeCanvasId;
    let needsRetry = false;
    try {
      const pending = await listPending();
      if (!pending.length) return;
      const groups = new Map<string, PendingImage[]>();
      for (const image of pending) {
        const canvasId = String(image.canvasId || "");
        if (!canvasId) {
          await deletePending([image.id]);
          continue;
        }
        const current = groups.get(canvasId) ?? [];
        current.push(image);
        groups.set(canvasId, current);
      }

      for (const [canvasId, records] of groups) {
        if (!tabsRef.current.some((canvas) => canvas.id === canvasId)) {
          await deletePending(records.map((record) => record.id));
          continue;
        }

        if (canvasId === activeAtStart) {
          if (viewRef.current.activeCanvasId !== activeAtStart) {
            needsRetry = true;
            continue;
          }
          const addedNodeIds = await editorActions.integratePending(records);
          if (!addedNodeIds.length) {
            const saved = await editorFlush();
            if (!saved) {
              needsRetry = true;
              continue;
            }
            await deletePending(records.map((record) => record.id));
            continue;
          }
          const saved = await editorFlush();
          if (!saved) {
            needsRetry = true;
            continue;
          }
          await deletePending(records.map((record) => record.id));
          pushToast(`${addedNodeIds.length} 张图片已加入画布`, {
            tone: "success",
            duration: 6000,
            action: {
              label: "定位",
              onClick: () => editorActions.locateNodes(addedNodeIds)
            }
          });
          postResultNotice(canvasId, addedNodeIds.length);
          continue;
        }

        let addedCount = 0;
        const result = await workspace.applyToCanvas(canvasId, (snapshot) => {
          const integrated = integratePendingIntoSnapshot(snapshot, records);
          addedCount = integrated.addedNodeIds.length;
          return integrated.snapshot;
        });
        if (!result.ok) {
          needsRetry = true;
          continue;
        }
        await deletePending(records.map((record) => record.id));
        if (addedCount > 0) {
          const canvasTitle =
            tabsRef.current.find((canvas) => canvas.id === canvasId)?.title ?? "另一个画布";
          setUnread((current) => ({
            ...current,
            [canvasId]: (current[canvasId] ?? 0) + addedCount
          }));
          pushToast(`${addedCount} 张图片已加入「${canvasTitle}」`, {
            tone: "success",
            duration: 6000,
            action: {
              label: "切换",
              onClick: () => {
                void switchCanvas(canvasId).then((switched) => {
                  if (switched) {
                    window.setTimeout(
                      () => editorActions.locateNodes(addedNodeIdsFromRecords(records)),
                      120
                    );
                  }
                });
              }
            }
          });
          postResultNotice(canvasId, addedCount);
        }
      }
    } catch {
      pushToast("生成结果暂时无法写入画布", { tone: "error" });
    } finally {
      pendingBusyRef.current = false;
      if (needsRetry) {
        window.setTimeout(() => {
          void consumePending();
        }, 900);
      }
    }
  }, [editorActions, editorFlush, postResultNotice, pushToast, switchCanvas, workspace]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void consumePending();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [consumePending, view.activeCanvasId]);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;
    const listener = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        (message as { type?: string }).type === MSG.pendingUpdated
      ) {
        void consumePending();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [consumePending]);

  useEffect(() => {
    const unsubscribe = workspace.subscribe((change) => {
      if (change.kind !== "registry") return;
      void (async () => {
        const registry = await workspace.refreshRegistry();
        if (!registry) return;
        if (
          !registry.canvases.some(
            (canvas) => canvas.id === viewRef.current.activeCanvasId
          )
        ) {
          const previousActive = viewRef.current.activeCanvasId;
          cancelCanvas(previousActive);
          editorActions.forgetCanvas(previousActive);
          pushToast("当前画布已在其他标签页删除，已切换到其他画布", {
            tone: "error",
            duration: 5000
          });
          const nextView = await workspace.open();
          setTabs(nextView.canvases);
          setView(nextView);
          await nextFrame();
          return;
        }
        setTabs(registry.canvases);
      })();
    });
    return unsubscribe;
  }, [cancelCanvas, editorActions, pushToast, workspace]);

  const contextValue = useMemo<WorkspaceContextValue>(
    () => ({
      tabs,
      activeCanvasId: view.activeCanvasId,
      busy,
      unread,
      switchCanvas,
      createCanvas,
      deleteCanvas,
      renameCanvas,
      focusPromptInCanvas,
      embedded
    }),
    [
      busy,
      createCanvas,
      deleteCanvas,
      embedded,
      focusPromptInCanvas,
      renameCanvas,
      switchCanvas,
      tabs,
      unread,
      view.activeCanvasId
    ]
  );

  return (
    <WorkspaceContext.Provider value={contextValue}>
      <EditorContextProviders state={editor.state} actions={editorActions}>
        {children}
      </EditorContextProviders>
    </WorkspaceContext.Provider>
  );
}

function addedNodeIdsFromRecords(records: PendingImage[]): string[] {
  return records
    .map((record) => record.assetId)
    .filter(Boolean)
    .map((assetId) => `image-${assetId}`);
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceShell");
  return context;
}
