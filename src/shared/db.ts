import type { Viewport } from "@xyflow/react";
import type {
  CanvasDocument,
  CanvasRegistry,
  CanvasSnapshot,
  CanvasTab,
  PendingImage,
  StoredAsset
} from "./types";

export const V2_DB_NAME = "branchboard-v2";
const DB_VERSION = 2;
const DOCUMENTS_STORE = "documents";
const ASSETS_STORE = "assets";
const PENDING_STORE = "pending";
const REGISTRY_STORE = "registry";
const VIEWPORTS_STORE = "viewports";

export type StoredViewport = {
  canvasId: string;
  viewport: Viewport;
  updatedAt: string;
};

export type CanvasCommitAttempt =
  | { ok: true; document: CanvasDocument }
  | { ok: false; kind: "conflict"; current: CanvasDocument };

export type CanvasRemovalResult =
  | { ok: true; registry: CanvasRegistry }
  | { ok: false; reason: "missing" | "last-canvas" };

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function databaseExists(name: string): Promise<boolean> {
  const factory = indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string }>>;
  };
  if (typeof factory.databases !== "function") return true;
  try {
    const databases = await factory.databases();
    return databases.some((database) => database.name === name);
  } catch {
    return true;
  }
}

export function openV2Database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(V2_DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
        database.createObjectStore(DOCUMENTS_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(ASSETS_STORE)) {
        database.createObjectStore(ASSETS_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(PENDING_STORE)) {
        database.createObjectStore(PENDING_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(REGISTRY_STORE)) {
        database.createObjectStore(REGISTRY_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(VIEWPORTS_STORE)) {
        database.createObjectStore(VIEWPORTS_STORE, { keyPath: "canvasId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getDocument(canvasId: string): Promise<CanvasDocument | null> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(DOCUMENTS_STORE, "readonly");
    const document = await requestToPromise(
      transaction.objectStore(DOCUMENTS_STORE).get(canvasId) as IDBRequest<
        CanvasDocument | undefined
      >
    );
    return document ?? null;
  } finally {
    database.close();
  }
}

export async function listDocuments(): Promise<CanvasDocument[]> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(DOCUMENTS_STORE, "readonly");
    return await requestToPromise(
      transaction.objectStore(DOCUMENTS_STORE).getAll() as IDBRequest<CanvasDocument[]>
    );
  } finally {
    database.close();
  }
}

export async function putDocument(document: CanvasDocument): Promise<void> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(DOCUMENTS_STORE, "readwrite");
    transaction.objectStore(DOCUMENTS_STORE).put(document);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function deleteDocument(canvasId: string): Promise<void> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(DOCUMENTS_STORE, "readwrite");
    transaction.objectStore(DOCUMENTS_STORE).delete(canvasId);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function commitDocument(
  canvasId: string,
  baseRevision: number,
  snapshot: CanvasSnapshot
): Promise<CanvasCommitAttempt> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(DOCUMENTS_STORE, "readwrite");
    const store = transaction.objectStore(DOCUMENTS_STORE);
    const stored = await requestToPromise(
      store.get(canvasId) as IDBRequest<CanvasDocument | undefined>
    );
    const current: CanvasDocument = stored ?? {
      id: canvasId,
      schemaVersion: 2,
      revision: 0,
      nodes: [],
      edges: [],
      viewport: null,
      updatedAt: new Date(0).toISOString()
    };
    if (current.revision !== baseRevision) {
      await transactionDone(transaction);
      return { ok: false, kind: "conflict", current };
    }
    const document: CanvasDocument = {
      id: canvasId,
      schemaVersion: 2,
      revision: current.revision + 1,
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      viewport: snapshot.viewport,
      updatedAt: snapshot.updatedAt
    };
    store.put(document);
    await transactionDone(transaction);
    return { ok: true, document };
  } finally {
    database.close();
  }
}

export async function loadRegistry(): Promise<CanvasRegistry | null> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(REGISTRY_STORE, "readonly");
    const registry = await requestToPromise(
      transaction.objectStore(REGISTRY_STORE).get("registry") as IDBRequest<
        CanvasRegistry | undefined
      >
    );
    return registry?.canvases.length ? registry : null;
  } finally {
    database.close();
  }
}

export async function saveRegistry(registry: CanvasRegistry): Promise<void> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(REGISTRY_STORE, "readwrite");
    transaction.objectStore(REGISTRY_STORE).put(registry);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function ensureRegistry(initial: CanvasRegistry): Promise<CanvasRegistry> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(REGISTRY_STORE, "readwrite");
    const store = transaction.objectStore(REGISTRY_STORE);
    const stored = await requestToPromise(
      store.get("registry") as IDBRequest<CanvasRegistry | undefined>
    );
    if (stored?.canvases.length) {
      await transactionDone(transaction);
      return stored;
    }
    store.put(initial);
    await transactionDone(transaction);
    return initial;
  } finally {
    database.close();
  }
}

export async function appendCanvasTab(tab: CanvasTab): Promise<CanvasRegistry> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(REGISTRY_STORE, "readwrite");
    const store = transaction.objectStore(REGISTRY_STORE);
    const stored = await requestToPromise(
      store.get("registry") as IDBRequest<CanvasRegistry | undefined>
    );
    const canvases = stored?.canvases ?? [];
    const registry: CanvasRegistry = {
      id: "registry",
      schemaVersion: 2,
      activeCanvasId: tab.id,
      canvases: canvases.some((canvas) => canvas.id === tab.id)
        ? canvases
        : [...canvases, tab],
      migratedFromV1At: stored?.migratedFromV1At
    };
    store.put(registry);
    await transactionDone(transaction);
    return registry;
  } finally {
    database.close();
  }
}

export async function setActiveCanvas(canvasId: string): Promise<CanvasRegistry | null> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(REGISTRY_STORE, "readwrite");
    const store = transaction.objectStore(REGISTRY_STORE);
    const stored = await requestToPromise(
      store.get("registry") as IDBRequest<CanvasRegistry | undefined>
    );
    if (!stored || !stored.canvases.some((canvas) => canvas.id === canvasId)) {
      await transactionDone(transaction);
      return null;
    }
    const registry: CanvasRegistry = { ...stored, activeCanvasId: canvasId };
    store.put(registry);
    await transactionDone(transaction);
    return registry;
  } finally {
    database.close();
  }
}

export async function renameCanvasTab(
  canvasId: string,
  title: string
): Promise<CanvasRegistry | null> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(REGISTRY_STORE, "readwrite");
    const store = transaction.objectStore(REGISTRY_STORE);
    const stored = await requestToPromise(
      store.get("registry") as IDBRequest<CanvasRegistry | undefined>
    );
    if (!stored?.canvases.some((canvas) => canvas.id === canvasId)) {
      await transactionDone(transaction);
      return null;
    }
    const registry: CanvasRegistry = {
      ...stored,
      canvases: stored.canvases.map((canvas) =>
        canvas.id === canvasId ? { ...canvas, title } : canvas
      )
    };
    store.put(registry);
    await transactionDone(transaction);
    return registry;
  } finally {
    database.close();
  }
}

export async function removeCanvasTab(canvasId: string): Promise<CanvasRemovalResult> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(
      [REGISTRY_STORE, DOCUMENTS_STORE, PENDING_STORE, VIEWPORTS_STORE],
      "readwrite"
    );
    const registryStore = transaction.objectStore(REGISTRY_STORE);
    const stored = await requestToPromise(
      registryStore.get("registry") as IDBRequest<CanvasRegistry | undefined>
    );
    const canvases = stored?.canvases ?? [];
    const removedIndex = canvases.findIndex((canvas) => canvas.id === canvasId);
    if (removedIndex < 0) {
      await transactionDone(transaction);
      return { ok: false, reason: "missing" };
    }
    if (canvases.length === 1) {
      await transactionDone(transaction);
      return { ok: false, reason: "last-canvas" };
    }
    const remaining = canvases.filter((canvas) => canvas.id !== canvasId);
    const storedActive = stored?.activeCanvasId ?? "";
    const activeCanvasId =
      storedActive === canvasId || !remaining.some((canvas) => canvas.id === storedActive)
        ? remaining[Math.min(removedIndex, remaining.length - 1)].id
        : storedActive;
    const registry: CanvasRegistry = {
      ...(stored ?? { id: "registry" as const, schemaVersion: 2 as const }),
      activeCanvasId,
      canvases: remaining
    };
    registryStore.put(registry);
    transaction.objectStore(DOCUMENTS_STORE).delete(canvasId);
    transaction.objectStore(VIEWPORTS_STORE).delete(canvasId);
    const pendingStore = transaction.objectStore(PENDING_STORE);
    const pendingImages = await requestToPromise(
      pendingStore.getAll() as IDBRequest<PendingImage[]>
    );
    for (const image of pendingImages) {
      if (image.canvasId === canvasId) pendingStore.delete(image.id);
    }
    await transactionDone(transaction);
    return { ok: true, registry };
  } finally {
    database.close();
  }
}

export async function putViewport(record: StoredViewport): Promise<void> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(VIEWPORTS_STORE, "readwrite");
    transaction.objectStore(VIEWPORTS_STORE).put(record);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function getViewport(canvasId: string): Promise<Viewport | null> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(VIEWPORTS_STORE, "readonly");
    const record = await requestToPromise(
      transaction.objectStore(VIEWPORTS_STORE).get(canvasId) as IDBRequest<
        StoredViewport | undefined
      >
    );
    return record?.viewport ?? null;
  } finally {
    database.close();
  }
}

export async function putAsset(asset: StoredAsset): Promise<void> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(ASSETS_STORE, "readwrite");
    transaction.objectStore(ASSETS_STORE).put(asset);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function getAsset(assetId: string): Promise<StoredAsset | null> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(ASSETS_STORE, "readonly");
    const asset = await requestToPromise(
      transaction.objectStore(ASSETS_STORE).get(assetId) as IDBRequest<
        StoredAsset | undefined
      >
    );
    return asset ?? null;
  } finally {
    database.close();
  }
}

export async function listAssetIds(): Promise<string[]> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(ASSETS_STORE, "readonly");
    const keys = await requestToPromise(
      transaction.objectStore(ASSETS_STORE).getAllKeys() as IDBRequest<IDBValidKey[]>
    );
    return keys.map(String);
  } finally {
    database.close();
  }
}

export async function deleteAssets(assetIds: string[]): Promise<void> {
  if (!assetIds.length) return;
  const database = await openV2Database();
  try {
    const transaction = database.transaction(ASSETS_STORE, "readwrite");
    const store = transaction.objectStore(ASSETS_STORE);
    for (const assetId of assetIds) store.delete(assetId);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function addPending(image: PendingImage): Promise<void> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(PENDING_STORE, "readwrite");
    transaction.objectStore(PENDING_STORE).put(image);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function listPending(): Promise<PendingImage[]> {
  const database = await openV2Database();
  try {
    const transaction = database.transaction(PENDING_STORE, "readonly");
    const images = await requestToPromise(
      transaction.objectStore(PENDING_STORE).getAll() as IDBRequest<PendingImage[]>
    );
    return images.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } finally {
    database.close();
  }
}

export async function deletePending(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const database = await openV2Database();
  try {
    const transaction = database.transaction(PENDING_STORE, "readwrite");
    const store = transaction.objectStore(PENDING_STORE);
    for (const id of ids) store.delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function deletePendingForCanvas(canvasId: string): Promise<void> {
  const pending = await listPending();
  await deletePending(
    pending.filter((image) => image.canvasId === canvasId).map((image) => image.id)
  );
}

export function isQuotaError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    String((error as { name?: unknown }).name) === "QuotaExceededError"
  );
}
