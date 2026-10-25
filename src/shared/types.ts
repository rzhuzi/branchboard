import type { Edge, Node, Viewport } from "@xyflow/react";

export type Theme = "dark" | "light";

export type PromptNodeData = {
  [key: string]: unknown;
  kind: "prompt";
  prompt: string;
  createdAt: string;
  updatedAt: string;
};

export type ImageNodeData = {
  [key: string]: unknown;
  kind: "image";
  assetId: string;
  name: string;
  createdAt: string;
  width: number;
  height: number;
  annotatedAt?: string;
  originalAssetId?: string;
};

export type CanvasNodeData = PromptNodeData | ImageNodeData;
export type CanvasNode = Node<CanvasNodeData>;

export type RelationKind = "generated" | "reference" | "branch";

export type RelationEdgeData = {
  [key: string]: unknown;
  relation: RelationKind;
};

export type CanvasEdge = Edge<RelationEdgeData>;

export type CanvasSnapshot = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: Viewport | null;
  updatedAt: string;
};

export type CanvasDocument = CanvasSnapshot & {
  id: string;
  schemaVersion: 2;
  revision: number;
};

export type CanvasTab = {
  id: string;
  title: string;
  createdAt: string;
};

export type CanvasRegistry = {
  id: "registry";
  schemaVersion: 2;
  activeCanvasId: string;
  canvases: CanvasTab[];
  migratedFromV1At?: string;
};

export type StoredAsset = {
  id: string;
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  createdAt: string;
  hash?: string;
  name?: string;
};

export type PendingImage = {
  id: string;
  assetId: string;
  requestId: string;
  canvasId: string;
  promptId?: string;
  name: string;
  width: number;
  height: number;
  createdAt: string;
  hash?: string;
  relation?: Exclude<RelationKind, "branch">;
  position?: { x: number; y: number };
};

export type RunReference = {
  name: string;
  dataUrl: string;
};

export type RunPromptRequest = {
  requestId: string;
  canvasId: string;
  promptId: string;
  title: string;
  prompt: string;
  references: RunReference[];
};

export type ExecutionStage =
  | "attaching"
  | "filling"
  | "sending"
  | "sent"
  | "waiting"
  | "capturing"
  | "captured"
  | "failed"
  | "cancelled";

export type ExecutionProgress = {
  requestId: string;
  canvasId: string;
  promptId: string;
  stage: ExecutionStage;
  message: string;
};

export type ExecutionTone = "queued" | "working" | "done" | "error" | "cancelled";

export type PromptExecution = {
  requestId: string;
  canvasId: string;
  promptId: string;
  stage: ExecutionStage;
  tone: ExecutionTone;
  message: string;
  title?: string;
  startedAt: number;
  updatedAt: number;
};

export type WorkspaceView = {
  activeCanvasId: string;
  canvases: CanvasTab[];
  document: CanvasDocument;
};

export type NewImageInput = {
  assetId: string;
  name: string;
  width: number;
  height: number;
  createdAt: string;
};

export type PendingIntegrationResult = {
  snapshot: CanvasSnapshot;
  addedNodeIds: string[];
  addedImageCount: number;
};
