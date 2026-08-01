import type { Edge, Node } from "@xyflow/react";

export type PromptNodeData = {
  [key: string]: unknown;
  kind: "prompt";
  title: string;
  prompt: string;
  createdAt: string;
};

export type ImageNodeData = {
  [key: string]: unknown;
  kind: "image";
  name: string;
  dataUrl: string;
  createdAt: string;
};

export type CanvasNodeData = PromptNodeData | ImageNodeData;
export type CanvasNode = Node<CanvasNodeData>;
export type CanvasEdge = Edge;

export type CanvasSnapshot = {
  version: 1;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  updatedAt: string;
};

export type InboxImage = {
  id: string;
  dataUrl: string;
  name: string;
  createdAt: string;
  parentPromptId?: string;
  canvasId?: string;
  position?: { x: number; y: number };
};

export type ActivePrompt = {
  id: string;
  title: string;
  prompt: string;
};

export type WorkspaceMode = "manual" | "auto";
export type WorkspaceTheme = "dark" | "light";

export type ExecutionSettings = {
  mode: WorkspaceMode;
  theme: WorkspaceTheme;
};
