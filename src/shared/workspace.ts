import {
  appendCanvasTab,
  commitDocument,
  ensureRegistry,
  getDocument,
  isQuotaError,
  loadRegistry,
  openV2Database,
  removeCanvasTab,
  renameCanvasTab,
  setActiveCanvas
} from "./db";
import type { CanvasDocument, CanvasRegistry, CanvasSnapshot, CanvasTab } from "./types";
import { mergeCanvasSnapshots } from "./merge";

const CHANNEL_NAME = "branchboard-v2-workspace";
const SESSION_ACTIVE_CANVAS_KEY = "branchboardV2ActiveCanvasId";

export type WorkspaceCommitFailureKind = "conflict" | "quota" | "unavailable";

export type WorkspaceCommitFailure = {
  ok: false;
  kind: WorkspaceCommitFailureKind;
  message: string;
};

export type WorkspaceCommitResult =
  | {
      ok: true;
      merged: boolean;
      document: CanvasDocument;
    }
  | WorkspaceCommitFailure;

export type WorkspaceChange =
  | { kind: "canvas"; canvasId: string }
  | { kind: "registry" };

export type WorkspaceView = {
  activeCanvasId: string;
  canvases: CanvasTab[];
  document: CanvasDocument;
};

type WorkspaceSessionOptions = {
  createEmptySnapshot: () => CanvasSnapshot;
};

function failureFrom(error: unknown): WorkspaceCommitFailure {
  if (isQuotaError(error)) {
    return {
      ok: false,
      kind: "quota",
      message: "本地存储空间不足，当前修改仍保留在画布中"
    };
  }
  return {
    ok: false,
    kind: "unavailable",
    message: "暂时无法写入本地存储，请稍后重试"
  };
}

export function snapshotOfDocument(document: CanvasDocument): CanvasSnapshot {
  return {
    nodes: document.nodes,
    edges: document.edges,
    viewport: document.viewport,
    updatedAt: document.updatedAt
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

function nextCanvasTitle(canvases: CanvasTab[]): string {
  let maximum = 0;
  for (const canvas of canvases) {
    const match = canvas.title.match(/^画布\s*(\d+)$/);
    if (match) maximum = Math.max(maximum, Number(match[1]));
  }
  return `画布 ${Math.max(canvases.length + 1, maximum + 1)}`;
}

export function createWorkspaceSession({ createEmptySnapshot }: WorkspaceSessionOptions) {
  const sourceId = crypto.randomUUID();
  const documents = new Map<string, CanvasDocument>();
  const channel =
    typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME);

  const publish = (change: WorkspaceChange) => {
    channel?.postMessage({ ...change, sourceId });
  };

  const saveInitialDocument = async (canvasId: string): Promise<CanvasDocument> => {
    const snapshot = createEmptySnapshot();
    const database = await openV2Database();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("documents", "readwrite");
        transaction.objectStore("documents").put({
          id: canvasId,
          schemaVersion: 2,
          revision: 0,
          ...snapshot
        } satisfies CanvasDocument);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
    const document: CanvasDocument = {
      id: canvasId,
      schemaVersion: 2,
      revision: 0,
      ...snapshot
    };
    documents.set(canvasId, document);
    return document;
  };

  const openDocument = async (canvasId: string): Promise<CanvasDocument> => {
    const stored = await getDocument(canvasId);
    const document = stored ?? (await saveInitialDocument(canvasId));
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
        const attempt = await commitDocument(canvasId, base.revision, candidate);
        if (attempt.ok) {
          documents.set(canvasId, attempt.document);
          publish({ kind: "canvas", canvasId });
          return { ok: true, merged, document: attempt.document };
        }
        candidate = mergeCanvasSnapshots(
          snapshotOfDocument(base),
          candidate,
          snapshotOfDocument(attempt.current)
        );
        base = attempt.current;
        documents.set(canvasId, attempt.current);
        merged = true;
      }
      return {
        ok: false,
        kind: "conflict",
        message: "画布在其他标签页也被修改，请重试保存"
      };
    } catch (error) {
      return failureFrom(error);
    }
  };

  const loadCanvas = async (canvasId: string): Promise<CanvasDocument> =>
    openDocument(canvasId);

  const open = async (): Promise<WorkspaceView> => {
    let registry = await loadRegistry();
    if (!registry) {
      const canvasId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const initialTab: CanvasTab = { id: canvasId, title: "画布 1", createdAt };
      registry = await ensureRegistry({
        id: "registry",
        schemaVersion: 2,
        activeCanvasId: canvasId,
        canvases: [initialTab]
      });
      await openDocument(canvasId);
    }

    const sessionCanvasId = readSessionCanvasId();
    const activeCanvasId = registry.canvases.some(
      (canvas) => canvas.id === sessionCanvasId
    )
      ? sessionCanvasId
      : registry.canvases.some((canvas) => canvas.id === registry.activeCanvasId)
        ? registry.activeCanvasId
        : registry.canvases[0].id;
    writeSessionCanvasId(activeCanvasId);
    const document = await openDocument(activeCanvasId);
    return { activeCanvasId, canvases: registry.canvases, document };
  };

  const switchCanvas = async (targetCanvasId: string): Promise<WorkspaceView | null> => {
    const registry = await loadRegistry();
    if (!registry?.canvases.some((canvas) => canvas.id === targetCanvasId)) return null;
    await setActiveCanvas(targetCanvasId);
    writeSessionCanvasId(targetCanvasId);
    const document = await openDocument(targetCanvasId);
    return {
      activeCanvasId: targetCanvasId,
      canvases: registry.canvases,
      document
    };
  };

  const createCanvas = async (): Promise<WorkspaceView> => {
    const registry = await loadRegistry();
    const canvasId = crypto.randomUUID();
    const tab: CanvasTab = {
      id: canvasId,
      title: nextCanvasTitle(registry?.canvases ?? []),
      createdAt: new Date().toISOString()
    };
    const document = await saveInitialDocument(canvasId);
    const nextRegistry = await appendCanvasTab(tab);
    writeSessionCanvasId(canvasId);
    publish({ kind: "registry" });
    publish({ kind: "canvas", canvasId });
    return {
      activeCanvasId: canvasId,
      canvases: nextRegistry.canvases,
      document
    };
  };

  const deleteCanvas = async (
    currentCanvasId: string,
    targetCanvasId: string
  ): Promise<WorkspaceView | null> => {
    const removed = await removeCanvasTab(targetCanvasId);
    if (!removed.ok) return null;
    documents.delete(targetCanvasId);
    const activeCanvasId = removed.registry.canvases.some(
      (canvas) => canvas.id === currentCanvasId
    )
      ? currentCanvasId
      : removed.registry.canvases.some(
            (canvas) => canvas.id === removed.registry.activeCanvasId
          )
        ? removed.registry.activeCanvasId
        : removed.registry.canvases[0].id;
    await setActiveCanvas(activeCanvasId);
    writeSessionCanvasId(activeCanvasId);
    const document = await openDocument(activeCanvasId);
    publish({ kind: "registry" });
    return {
      activeCanvasId,
      canvases: removed.registry.canvases,
      document
    };
  };

  const renameCanvas = async (
    canvasId: string,
    title: string
  ): Promise<CanvasRegistry | null> => {
    const registry = await renameCanvasTab(canvasId, title);
    if (!registry) return null;
    publish({ kind: "registry" });
    return registry;
  };

  const refreshDocument = async (canvasId: string): Promise<CanvasDocument | null> => {
    const document = await getDocument(canvasId);
    if (document) documents.set(canvasId, document);
    return document;
  };

  const applyToCanvas = async (
    canvasId: string,
    updater: (snapshot: CanvasSnapshot) => CanvasSnapshot
  ): Promise<WorkspaceCommitResult> => {
    try {
      let base = await getDocument(canvasId);
      if (!base) return { ok: false, kind: "unavailable", message: "目标画布不存在" };
      for (let attemptNumber = 0; attemptNumber < 3; attemptNumber += 1) {
        const candidate = updater(snapshotOfDocument(base));
        const attempt = await commitDocument(canvasId, base.revision, candidate);
        if (attempt.ok) {
          documents.set(canvasId, attempt.document);
          publish({ kind: "canvas", canvasId });
          return { ok: true, merged: attemptNumber > 0, document: attempt.document };
        }
        base = attempt.current;
        documents.set(canvasId, attempt.current);
      }
      return {
        ok: false,
        kind: "conflict",
        message: "画布在其他标签页也被修改，请重试保存"
      };
    } catch (error) {
      return failureFrom(error);
    }
  };

  const refreshRegistry = (): Promise<CanvasRegistry | null> => loadRegistry();

  const subscribe = (listener: (change: WorkspaceChange) => void): (() => void) => {
    if (!channel) return () => {};
    const handleMessage = (event: MessageEvent) => {
      const message = event.data as (WorkspaceChange & { sourceId?: string }) | undefined;
      if (!message || message.sourceId === sourceId) return;
      if (message.kind === "registry") {
        listener({ kind: "registry" });
      } else if (message.kind === "canvas" && typeof message.canvasId === "string") {
        listener({ kind: "canvas", canvasId: message.canvasId });
      }
    };
    channel.addEventListener("message", handleMessage);
    return () => channel.removeEventListener("message", handleMessage);
  };

  return {
    open,
    commit,
    loadCanvas,
    switchCanvas,
    createCanvas,
    deleteCanvas,
    renameCanvas,
    refreshDocument,
    refreshRegistry,
    applyToCanvas,
    subscribe
  };
}

export type WorkspaceSession = ReturnType<typeof createWorkspaceSession>;
