import {
  appendCanvasTab,
  commitCanvasDocument,
  ensureCanvasRegistry,
  loadCanvasDocument,
  loadCanvasRegistry,
  loadSnapshot,
  removeCanvasTab,
  renameCanvasTab,
  saveCanvasSnapshot,
  type CanvasDocument,
  type CanvasRegistry,
  type CanvasTab
} from "./storage";
import type { CanvasSnapshot } from "./types";
import { mergeCanvasSnapshots } from "./workspaceMerge";

const CHANNEL_NAME = "branchboard-workspace-v1";
const SESSION_ACTIVE_CANVAS_KEY = "branchboardActiveCanvasId";

export type WorkspaceView = {
  activeCanvasId: string;
  canvases: CanvasTab[];
  snapshot: CanvasSnapshot;
};

export type WorkspaceCommitFailureKind =
  | "conflict"
  | "quota"
  | "unavailable";

export type WorkspaceCommitFailure = {
  ok: false;
  kind: WorkspaceCommitFailureKind;
  message: string;
  recoverable: true;
};

export type WorkspaceCommitResult =
  | {
      ok: true;
      merged: boolean;
      snapshot: CanvasSnapshot;
      revision: number;
    }
  | WorkspaceCommitFailure;

export type WorkspaceChange =
  | { kind: "canvas"; canvasId: string }
  | { kind: "registry" };

type WorkspaceSessionOptions = {
  createEmptySnapshot: () => CanvasSnapshot;
};

function failureFrom(error: unknown): WorkspaceCommitFailure {
  const name =
    typeof error === "object" && error && "name" in error
      ? String(error.name)
      : "";
  if (name === "QuotaExceededError") {
    return {
      ok: false,
      kind: "quota",
      message: "本地存储空间不足，当前修改仍保留在画布中",
      recoverable: true
    };
  }
  return {
    ok: false,
    kind: "unavailable",
    message: "暂时无法写入本地存储，请稍后重试",
    recoverable: true
  };
}

function readSessionCanvasId(): string {
  try {
    return sessionStorage.getItem(SESSION_ACTIVE_CANVAS_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeSessionCanvasId(canvasId: string): void {
  try {
    sessionStorage.setItem(SESSION_ACTIVE_CANVAS_KEY, canvasId);
  } catch {
    // Session restoration is helpful but not required for persistence safety.
  }
}

export function createWorkspaceSession({
  createEmptySnapshot
}: WorkspaceSessionOptions) {
  const sourceId = crypto.randomUUID();
  const documents = new Map<string, CanvasDocument>();
  const channel =
    typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(CHANNEL_NAME);

  const publish = (change: WorkspaceChange) => {
    channel?.postMessage({ ...change, sourceId });
  };

  const openDocument = async (canvasId: string): Promise<CanvasDocument> => {
    let document = await loadCanvasDocument(canvasId);
    if (!document) {
      const snapshot = createEmptySnapshot();
      await saveCanvasSnapshot(canvasId, snapshot);
      document = { revision: 0, snapshot };
    }
    documents.set(canvasId, document);
    return document;
  };

  const commit = async (
    canvasId: string,
    snapshot: CanvasSnapshot
  ): Promise<WorkspaceCommitResult> => {
    try {
      let base = documents.get(canvasId) ?? (await openDocument(canvasId));
      let candidate = snapshot;
      let merged = false;

      for (let attemptNumber = 0; attemptNumber < 3; attemptNumber += 1) {
        const attempt = await commitCanvasDocument(
          canvasId,
          base.revision,
          candidate
        );
        if (attempt.ok) {
          documents.set(canvasId, attempt.document);
          publish({ kind: "canvas", canvasId });
          return {
            ok: true,
            merged,
            snapshot: attempt.document.snapshot,
            revision: attempt.document.revision
          };
        }

        candidate = mergeCanvasSnapshots(
          base.snapshot,
          candidate,
          attempt.current.snapshot
        );
        base = attempt.current;
        merged = true;
      }

      return {
        ok: false,
        kind: "conflict",
        message: "画布在其他标签页也被修改，请重试保存",
        recoverable: true
      };
    } catch (error) {
      return failureFrom(error);
    }
  };

  const open = async (): Promise<WorkspaceView> => {
    let registry = await loadCanvasRegistry();
    if (!registry) {
      const canvasId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const initialTab: CanvasTab = {
        id: canvasId,
        title: "画布 1",
        createdAt
      };
      const legacy = await loadSnapshot();
      const initialSnapshot =
        legacy?.nodes.length ? legacy : createEmptySnapshot();
      registry = await ensureCanvasRegistry({
        version: 1,
        activeCanvasId: canvasId,
        canvases: [initialTab]
      });
      if (registry.activeCanvasId === canvasId) {
        await saveCanvasSnapshot(canvasId, initialSnapshot);
      }
    }

    const sessionCanvasId = readSessionCanvasId();
    const activeCanvasId = registry.canvases.some(
      (canvas) => canvas.id === sessionCanvasId
    )
      ? sessionCanvasId
      : registry.canvases.some(
            (canvas) => canvas.id === registry.activeCanvasId
          )
        ? registry.activeCanvasId
        : registry.canvases[0].id;
    writeSessionCanvasId(activeCanvasId);
    const document = await openDocument(activeCanvasId);
    return {
      activeCanvasId,
      canvases: registry.canvases,
      snapshot: document.snapshot
    };
  };

  const selectCanvas = async (
    currentCanvasId: string,
    currentSnapshot: CanvasSnapshot,
    targetCanvasId: string
  ): Promise<
    | { ok: true; view: WorkspaceView }
    | { ok: false; failure: WorkspaceCommitFailure }
  > => {
    const saved = await commit(currentCanvasId, currentSnapshot);
    if (!saved.ok) return { ok: false, failure: saved };
    const registry = await loadCanvasRegistry();
    if (!registry?.canvases.some((canvas) => canvas.id === targetCanvasId)) {
      return {
        ok: false,
        failure: {
          ok: false,
          kind: "unavailable",
          message: "目标画布不存在或已在其他页面移除",
          recoverable: true
        }
      };
    }
    writeSessionCanvasId(targetCanvasId);
    const document = await openDocument(targetCanvasId);
    return {
      ok: true,
      view: {
        activeCanvasId: targetCanvasId,
        canvases: registry.canvases,
        snapshot: document.snapshot
      }
    };
  };

  const createCanvas = async (
    currentCanvasId: string,
    currentSnapshot: CanvasSnapshot
  ): Promise<
    | { ok: true; view: WorkspaceView }
    | { ok: false; failure: WorkspaceCommitFailure }
  > => {
    if (currentCanvasId) {
      const saved = await commit(currentCanvasId, currentSnapshot);
      if (!saved.ok) return { ok: false, failure: saved };
    }

    try {
      const existing = await loadCanvasRegistry();
      const canvasId = crypto.randomUUID();
      const nextTab: CanvasTab = {
        id: canvasId,
        title: `画布 ${(existing?.canvases.length ?? 0) + 1}`,
        createdAt: new Date().toISOString()
      };
      const snapshot = createEmptySnapshot();
      await saveCanvasSnapshot(canvasId, snapshot);
      documents.set(canvasId, { revision: 0, snapshot });
      const registry = await appendCanvasTab(nextTab);
      writeSessionCanvasId(canvasId);
      publish({ kind: "registry" });
      publish({ kind: "canvas", canvasId });
      return {
        ok: true,
        view: {
          activeCanvasId: canvasId,
          canvases: registry.canvases,
          snapshot
        }
      };
    } catch (error) {
      return { ok: false, failure: failureFrom(error) };
    }
  };

  const deleteCanvas = async (
    currentCanvasId: string,
    currentSnapshot: CanvasSnapshot,
    targetCanvasId: string
  ): Promise<
    | { ok: true; view: WorkspaceView }
    | { ok: false; failure: WorkspaceCommitFailure }
  > => {
    if (currentCanvasId && currentCanvasId !== targetCanvasId) {
      const saved = await commit(currentCanvasId, currentSnapshot);
      if (!saved.ok) return { ok: false, failure: saved };
    }

    try {
      const before = await loadCanvasRegistry();
      const targetIndex =
        before?.canvases.findIndex((canvas) => canvas.id === targetCanvasId) ??
        -1;
      const removed = await removeCanvasTab(targetCanvasId);
      if (!removed.ok) {
        return {
          ok: false,
          failure: {
            ok: false,
            kind: "unavailable",
            message:
              removed.reason === "last-canvas"
                ? "至少需要保留一个画布"
                : "这个画布已经被移除",
            recoverable: true
          }
        };
      }

      documents.delete(targetCanvasId);
      const remaining = removed.registry.canvases;
      const activeCanvasId = remaining.some(
        (canvas) => canvas.id === currentCanvasId
      )
        ? currentCanvasId
        : remaining[
            Math.min(Math.max(targetIndex, 0), remaining.length - 1)
          ].id;
      writeSessionCanvasId(activeCanvasId);
      const document = await openDocument(activeCanvasId);
      publish({ kind: "registry" });
      return {
        ok: true,
        view: {
          activeCanvasId,
          canvases: remaining,
          snapshot: document.snapshot
        }
      };
    } catch (error) {
      return { ok: false, failure: failureFrom(error) };
    }
  };

  const renameCanvas = async (
    canvasId: string,
    title: string
  ): Promise<
    | { ok: true; canvases: CanvasTab[] }
    | { ok: false; failure: WorkspaceCommitFailure }
  > => {
    try {
      const registry = await renameCanvasTab(canvasId, title);
      if (!registry) {
        return {
          ok: false,
          failure: {
            ok: false,
            kind: "unavailable",
            message: "这个画布已经被移除",
            recoverable: true
          }
        };
      }
      publish({ kind: "registry" });
      return { ok: true, canvases: registry.canvases };
    } catch (error) {
      return { ok: false, failure: failureFrom(error) };
    }
  };

  const refreshCanvas = async (
    canvasId: string
  ): Promise<CanvasSnapshot | null> => {
    const document = await loadCanvasDocument(canvasId);
    if (!document) return null;
    documents.set(canvasId, document);
    return document.snapshot;
  };

  const refreshRegistry = (): Promise<CanvasRegistry | null> =>
    loadCanvasRegistry();

  const subscribe = (
    listener: (change: WorkspaceChange) => void
  ): (() => void) => {
    if (!channel) return () => {};
    const handleMessage = (event: MessageEvent) => {
      const message = event.data as
        | (WorkspaceChange & { sourceId?: string })
        | undefined;
      if (!message || message.sourceId === sourceId) return;
      if (message.kind === "registry") {
        listener({ kind: "registry" });
      } else if (
        message.kind === "canvas" &&
        typeof message.canvasId === "string"
      ) {
        listener({ kind: "canvas", canvasId: message.canvasId });
      }
    };
    channel.addEventListener("message", handleMessage);
    return () => channel.removeEventListener("message", handleMessage);
  };

  return {
    open,
    commit,
    selectCanvas,
    createCanvas,
    deleteCanvas,
    renameCanvas,
    refreshCanvas,
    refreshRegistry,
    subscribe
  };
}

export type WorkspaceSession = ReturnType<typeof createWorkspaceSession>;
