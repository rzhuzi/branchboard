import type { CanvasSnapshot, InboxImage } from "./types";

const DB_NAME = "branchboard-db";
const DB_VERSION = 1;
const SNAPSHOT_STORE = "snapshots";
const INBOX_STORE = "inbox";
const MAIN_SNAPSHOT_ID = "main";
const CANVAS_REGISTRY_ID = "canvas-registry";
const CANVAS_SNAPSHOT_PREFIX = "canvas:";

type StoredSnapshot = CanvasSnapshot & { id: string };
type StoredCanvasDocument = StoredSnapshot & { revision?: number };

export type CanvasTab = {
  id: string;
  title: string;
  createdAt: string;
};

export type CanvasRegistry = {
  version: 1;
  activeCanvasId: string;
  canvases: CanvasTab[];
};

export type CanvasDocument = {
  revision: number;
  snapshot: CanvasSnapshot;
};

export type CanvasCommitAttempt =
  | { ok: true; document: CanvasDocument }
  | { ok: false; kind: "conflict"; current: CanvasDocument };

type StoredCanvasRegistry = CanvasRegistry & {
  id: typeof CANVAS_REGISTRY_ID;
  kind: "canvas-registry";
};

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

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SNAPSHOT_STORE)) {
        database.createObjectStore(SNAPSHOT_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(INBOX_STORE)) {
        database.createObjectStore(INBOX_STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadSnapshotById(id: string): Promise<CanvasSnapshot | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SNAPSHOT_STORE, "readonly");
    const stored = await requestToPromise(
      transaction.objectStore(SNAPSHOT_STORE).get(id) as IDBRequest<
        StoredSnapshot | undefined
      >
    );
    if (!stored) return null;
    const { id: _id, ...snapshot } = stored;
    return snapshot;
  } finally {
    database.close();
  }
}

async function saveSnapshotById(
  id: string,
  snapshot: CanvasSnapshot
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
    transaction.objectStore(SNAPSHOT_STORE).put({
      ...snapshot,
      id
    } satisfies StoredSnapshot);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export function loadSnapshot(): Promise<CanvasSnapshot | null> {
  return loadSnapshotById(MAIN_SNAPSHOT_ID);
}

export function saveCanvasSnapshot(
  canvasId: string,
  snapshot: CanvasSnapshot
): Promise<void> {
  return saveSnapshotById(`${CANVAS_SNAPSHOT_PREFIX}${canvasId}`, snapshot);
}

function storedToCanvasDocument(
  stored: StoredCanvasDocument | undefined
): CanvasDocument | null {
  if (!stored) return null;
  const { id: _id, revision = 0, ...snapshot } = stored;
  return {
    revision,
    snapshot
  };
}

export async function loadCanvasDocument(
  canvasId: string
): Promise<CanvasDocument | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SNAPSHOT_STORE, "readonly");
    const stored = await requestToPromise(
      transaction
        .objectStore(SNAPSHOT_STORE)
        .get(`${CANVAS_SNAPSHOT_PREFIX}${canvasId}`) as IDBRequest<
        StoredCanvasDocument | undefined
      >
    );
    return storedToCanvasDocument(stored);
  } finally {
    database.close();
  }
}

export async function commitCanvasDocument(
  canvasId: string,
  baseRevision: number,
  snapshot: CanvasSnapshot
): Promise<CanvasCommitAttempt> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
    const store = transaction.objectStore(SNAPSHOT_STORE);
    const id = `${CANVAS_SNAPSHOT_PREFIX}${canvasId}`;
    const stored = await requestToPromise(
      store.get(id) as IDBRequest<StoredCanvasDocument | undefined>
    );
    const current = storedToCanvasDocument(stored) ?? {
      revision: 0,
      snapshot: {
        version: 1,
        nodes: [],
        edges: [],
        updatedAt: new Date(0).toISOString()
      }
    };

    if (current.revision !== baseRevision) {
      await transactionDone(transaction);
      return { ok: false, kind: "conflict", current };
    }

    const document: CanvasDocument = {
      revision: current.revision + 1,
      snapshot
    };
    store.put({
      ...snapshot,
      id,
      revision: document.revision
    } satisfies StoredCanvasDocument);
    await transactionDone(transaction);
    return { ok: true, document };
  } finally {
    database.close();
  }
}

export async function ensureCanvasRegistry(
  initial: CanvasRegistry
): Promise<CanvasRegistry> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
    const store = transaction.objectStore(SNAPSHOT_STORE);
    const stored = await requestToPromise(
      store.get(CANVAS_REGISTRY_ID) as IDBRequest<
        StoredCanvasRegistry | undefined
      >
    );
    if (stored?.canvases.length) {
      await transactionDone(transaction);
      return {
        version: 1,
        activeCanvasId: stored.activeCanvasId,
        canvases: stored.canvases
      };
    }
    store.put({
      ...initial,
      id: CANVAS_REGISTRY_ID,
      kind: "canvas-registry"
    } satisfies StoredCanvasRegistry);
    await transactionDone(transaction);
    return initial;
  } finally {
    database.close();
  }
}

export async function appendCanvasTab(
  tab: CanvasTab
): Promise<CanvasRegistry> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SNAPSHOT_STORE, "readwrite");
    const store = transaction.objectStore(SNAPSHOT_STORE);
    const stored = await requestToPromise(
      store.get(CANVAS_REGISTRY_ID) as IDBRequest<
        StoredCanvasRegistry | undefined
      >
    );
    const canvases = stored?.canvases ?? [];
    const next: CanvasRegistry = {
      version: 1,
      activeCanvasId: tab.id,
      canvases: canvases.some((canvas) => canvas.id === tab.id)
        ? canvases
        : [...canvases, tab]
    };
    store.put({
      ...next,
      id: CANVAS_REGISTRY_ID,
      kind: "canvas-registry"
    } satisfies StoredCanvasRegistry);
    await transactionDone(transaction);
    return next;
  } finally {
    database.close();
  }
}

export async function loadCanvasRegistry(): Promise<CanvasRegistry | null> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SNAPSHOT_STORE, "readonly");
    const stored = await requestToPromise(
      transaction.objectStore(SNAPSHOT_STORE).get(CANVAS_REGISTRY_ID) as IDBRequest<
        StoredCanvasRegistry | undefined
      >
    );
    if (!stored?.canvases.length) return null;
    return {
      version: 1,
      activeCanvasId: stored.activeCanvasId,
      canvases: stored.canvases
    };
  } finally {
    database.close();
  }
}

export async function addInboxImage(image: InboxImage): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(INBOX_STORE, "readwrite");
    transaction.objectStore(INBOX_STORE).put(image);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function listInboxImages(): Promise<InboxImage[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(INBOX_STORE, "readonly");
    const store = transaction.objectStore(INBOX_STORE);
    const images = await requestToPromise(
      store.getAll() as IDBRequest<InboxImage[]>
    );
    return images.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } finally {
    database.close();
  }
}

export async function removeInboxImages(imageIds: string[]): Promise<void> {
  if (!imageIds.length) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(INBOX_STORE, "readwrite");
    const store = transaction.objectStore(INBOX_STORE);
    for (const imageId of imageIds) store.delete(imageId);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

