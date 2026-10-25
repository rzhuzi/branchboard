import {
  databaseExists,
  ensureRegistry,
  getAsset,
  getDocument,
  addPending,
  loadRegistry,
  putAsset,
  putDocument
} from "./db";
import { dataUrlToBlob, imageSizeFromBlob, sha256Hex } from "./blob";
import { legacyRelationFor } from "./legacy";
import type {
  CanvasDocument,
  CanvasEdge,
  CanvasNode,
  CanvasRegistry,
  CanvasTab,
  PendingImage
} from "./types";

const LEGACY_DB_NAME = "branchboard-db";
const LEGACY_REGISTRY_ID = "canvas-registry";
const LEGACY_CANVAS_PREFIX = "canvas:";

type LegacyNode = {
  id?: string;
  type?: string;
  position?: { x?: number; y?: number };
  data?: Record<string, unknown>;
};

type LegacyEdge = {
  id?: string;
  source?: string;
  target?: string;
  label?: string;
  data?: Record<string, unknown>;
};

type LegacySnapshot = {
  id?: string;
  version?: number;
  nodes?: LegacyNode[];
  edges?: LegacyEdge[];
  updatedAt?: string;
};

type LegacyRegistry = {
  id?: string;
  version?: number;
  activeCanvasId?: string;
  canvases?: CanvasTab[];
};

type LegacyInboxImage = {
  id?: string;
  dataUrl?: string;
  name?: string;
  createdAt?: string;
  parentPromptId?: string;
  canvasId?: string;
  position?: { x?: number; y?: number };
};

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function openLegacyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readStore<T>(database: IDBDatabase, storeName: string): Promise<T[]> {
  if (!database.objectStoreNames.contains(storeName)) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

function readStoreRecord<T>(
  database: IDBDatabase,
  storeName: string,
  key: string
): Promise<T | null> {
  if (!database.objectStoreNames.contains(storeName)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

function legacyCanvasId(snapshotId: string): string {
  if (snapshotId === "main") return "legacy-main";
  if (snapshotId.startsWith(LEGACY_CANVAS_PREFIX)) {
    return snapshotId.slice(LEGACY_CANVAS_PREFIX.length);
  }
  return `legacy-${snapshotId}`;
}

async function convertLegacyAsset(
  dataUrl: string,
  name: string,
  createdAt: string,
  onAsset: () => void
): Promise<{ assetId: string; width: number; height: number } | null> {
  if (!dataUrl.startsWith("data:image/")) return null;
  const hash = await sha256Hex(new TextEncoder().encode(dataUrl));
  const assetId = `legacy-asset-${hash.slice(0, 40)}`;
  const existing = await getAsset(assetId);
  if (existing) {
    onAsset();
    return { assetId, width: existing.width, height: existing.height };
  }
  try {
    const blob = dataUrlToBlob(dataUrl);
    let size = { width: 1024, height: 1024 };
    try {
      size = await imageSizeFromBlob(blob);
    } catch {
      // Keep a usable fallback when the legacy payload is partially broken.
    }
    await putAsset({
      id: assetId,
      blob,
      mime: blob.type || "image/png",
      width: size.width,
      height: size.height,
      createdAt,
      hash,
      name
    });
    onAsset();
    return { assetId, width: size.width, height: size.height };
  } catch {
    return null;
  }
}

async function convertLegacyCanvas(
  canvas: CanvasTab,
  snapshot: LegacySnapshot | null,
  onAsset: () => void
): Promise<CanvasDocument | null> {
  if (!snapshot?.nodes?.length) {
    return {
      id: canvas.id,
      schemaVersion: 2,
      revision: 0,
      nodes: [],
      edges: [],
      viewport: null,
      updatedAt: new Date().toISOString()
    };
  }

  const nodes: CanvasNode[] = [];
  const kindById = new Map<string, "prompt" | "image">();

  for (const legacyNode of snapshot.nodes) {
    const data = legacyNode.data ?? {};
    const kind = data.kind === "image" ? "image" : data.kind === "prompt" ? "prompt" : null;
    if (!kind) continue;
    const id = String(legacyNode.id ?? crypto.randomUUID());
    const createdAt = String(data.createdAt ?? snapshot.updatedAt ?? new Date().toISOString());
    const position = {
      x: finiteNumber(legacyNode.position?.x, 0),
      y: finiteNumber(legacyNode.position?.y, 0)
    };

    if (kind === "prompt") {
      nodes.push({
        id,
        type: "prompt",
        position,
        data: {
          kind: "prompt",
          prompt: String(data.prompt ?? ""),
          createdAt,
          updatedAt: createdAt
        }
      });
      kindById.set(id, "prompt");
      continue;
    }

    const dataUrl = String(data.dataUrl ?? "");
    const asset = await convertLegacyAsset(
      dataUrl,
      String(data.name ?? "旧版图片"),
      createdAt,
      onAsset
    );
    if (!asset) continue;
    nodes.push({
      id,
      type: "image",
      position,
      data: {
        kind: "image",
        assetId: asset.assetId,
        name: String(data.name ?? "旧版图片"),
        createdAt,
        width: asset.width,
        height: asset.height
      }
    });
    kindById.set(id, "image");
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: CanvasEdge[] = [];
  for (const legacyEdge of snapshot.edges ?? []) {
    const source = String(legacyEdge.source ?? "");
    const target = String(legacyEdge.target ?? "");
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue;
    const relation = legacyRelationFor(kindById.get(source), kindById.get(target));
    if (!relation) continue;
    edges.push({
      id: String(legacyEdge.id ?? `edge-${source}-${target}-${relation}`),
      source,
      target,
      type: "relation",
      data: { relation }
    });
  }

  return {
    id: canvas.id,
    schemaVersion: 2,
    revision: 0,
    nodes,
    edges,
    viewport: null,
    updatedAt: snapshot.updatedAt ?? new Date().toISOString()
  };
}

export type MigrationResult = {
  migrated: boolean;
  canvases: number;
  images: number;
};

export async function migrateLegacyWorkspaceIfNeeded(
  onProgress?: (message: string) => void
): Promise<MigrationResult> {
  const existingRegistry = await loadRegistry();
  if (existingRegistry) {
    return { migrated: false, canvases: existingRegistry.canvases.length, images: 0 };
  }
  if (!(await databaseExists(LEGACY_DB_NAME))) {
    return { migrated: false, canvases: 0, images: 0 };
  }

  onProgress?.("正在迁移旧版画布");
  const database = await openLegacyDatabase();
  try {
    const legacyRegistry = await readStoreRecord<LegacyRegistry>(
      database,
      "snapshots",
      LEGACY_REGISTRY_ID
    );
    const snapshots = await readStore<LegacySnapshot>(database, "snapshots");
    const legacyInbox = await readStore<LegacyInboxImage>(database, "inbox");
    let assetCount = 0;

    const snapshotByCanvas = new Map<string, LegacySnapshot>();
    for (const snapshot of snapshots) {
      if (!snapshot.id) continue;
      snapshotByCanvas.set(legacyCanvasId(snapshot.id), {
        ...snapshot,
        id: legacyCanvasId(snapshot.id)
      });
    }

    let canvases: CanvasTab[] = [];
    if (legacyRegistry?.canvases?.length) {
      canvases = legacyRegistry.canvases
        .filter((canvas) => canvas.title !== undefined)
        .map((canvas) => ({
          id: String(canvas.id),
          title: String(canvas.title || "画布"),
          createdAt: String(canvas.createdAt || new Date().toISOString())
        }));
    } else {
      const main = snapshotByCanvas.get("legacy-main") ?? snapshots.find((item) => item.id === "main");
      if (main) {
        canvases = [
          {
            id: "legacy-main",
            title: "旧版画布",
            createdAt: main.updatedAt ?? new Date().toISOString()
          }
        ];
      }
    }
    if (!canvases.length) {
      return { migrated: false, canvases: 0, images: 0 };
    }

    for (const canvas of canvases) {
      const existing = await getDocument(canvas.id);
      if (existing) continue;
      const snapshot = snapshotByCanvas.get(canvas.id) ?? null;
      const document = await convertLegacyCanvas(canvas, snapshot, () => {
        assetCount += 1;
      });
      if (document) await putDocument(document);
    }

    const activeCanvasId = canvases.some(
      (canvas) => canvas.id === legacyRegistry?.activeCanvasId
    )
      ? String(legacyRegistry?.activeCanvasId)
      : canvases[0].id;

    for (const image of legacyInbox) {
      if (!image.dataUrl?.startsWith("data:image/")) continue;
      const createdAt = String(image.createdAt ?? new Date().toISOString());
      const targetCanvasId = canvases.some((canvas) => canvas.id === image.canvasId)
        ? String(image.canvasId)
        : activeCanvasId;
      const asset = await convertLegacyAsset(
        image.dataUrl,
        String(image.name ?? "旧版收件箱图片"),
        createdAt,
        () => {
          assetCount += 1;
        }
      );
      if (!asset) continue;
      const pending: PendingImage = {
        id: `legacy-inbox-${asset.assetId}`,
        assetId: asset.assetId,
        requestId: "legacy-inbox",
        canvasId: targetCanvasId,
        promptId: image.parentPromptId ? String(image.parentPromptId) : undefined,
        name: String(image.name ?? "旧版收件箱图片"),
        width: asset.width,
        height: asset.height,
        createdAt,
        relation: image.parentPromptId ? "generated" : undefined,
        position:
          Number.isFinite(image.position?.x) && Number.isFinite(image.position?.y)
            ? { x: Number(image.position?.x), y: Number(image.position?.y) }
            : undefined
      };
      await addPending(pending);
    }

    const registry: CanvasRegistry = {
      id: "registry",
      schemaVersion: 2,
      activeCanvasId,
      canvases,
      migratedFromV1At: new Date().toISOString()
    };
    await ensureRegistry(registry);
    onProgress?.(`已迁移 ${canvases.length} 个旧版画布`);
    return { migrated: true, canvases: canvases.length, images: assetCount };
  } finally {
    database.close();
  }
}
