import type {
  ExecutionProgress,
  PendingImage,
  RelationKind,
  RunPromptRequest,
  Theme
} from "./types";

export const MSG = {
  runPrompt: "branchboard:v2:run-prompt",
  cancelRun: "branchboard:v2:cancel-run",
  importUrl: "branchboard:v2:import-url",
  resultNotice: "branchboard:v2:result-notice",
  theme: "branchboard:v2:theme",
  minimize: "branchboard:v2:minimize",
  progress: "branchboard:v2:progress",
  forwardPaste: "branchboard:v2:forward-paste",
  storeImage: "branchboard:v2:store-image",
  clipboardWrite: "branchboard:v2:clipboard-write",
  offscreenWrite: "branchboard:v2:offscreen-write",
  pendingUpdated: "branchboard:v2:pending-updated",
  toggleCanvas: "branchboard:v2:toggle-canvas"
} as const;

export type RunPromptMessage = RunPromptRequest & { type: typeof MSG.runPrompt };

export type CancelRunMessage = {
  type: typeof MSG.cancelRun;
  requestIds: string[];
};

export type ImportUrlMessage = {
  type: typeof MSG.importUrl;
  imageUrl: string;
  canvasId: string;
  promptId?: string;
  position?: { x: number; y: number };
};

export type ResultNoticeMessage = {
  type: typeof MSG.resultNotice;
  canvasId: string;
  count: number;
};

export type ThemeMessage = {
  type: typeof MSG.theme;
  theme: Theme;
};

export type ProgressMessage = ExecutionProgress & {
  type: typeof MSG.progress;
};

export type ForwardPasteMessage = {
  type: typeof MSG.forwardPaste;
  dataUrl: string;
  name: string;
};

export type StoreImageMessage = {
  type: typeof MSG.storeImage;
  dataUrl: string;
  name: string;
  canvasId: string;
  promptId?: string;
  requestId: string;
  relation?: Exclude<RelationKind, "branch">;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  hash?: string;
};

export type ClipboardWriteMessage = {
  type: typeof MSG.clipboardWrite;
  format: "text" | "image";
  text?: string;
  dataUrl?: string;
};

export type PendingUpdatedMessage = {
  type: typeof MSG.pendingUpdated;
  images?: PendingImage[];
};

export type ToggleCanvasMessage = {
  type: typeof MSG.toggleCanvas;
};
