import { createContext, useContext, type ReactNode } from "react";
import type { Connection, EdgeChange, NodeChange, Viewport } from "@xyflow/react";
import type { CanvasEdge, CanvasNode, CanvasSnapshot, PendingImage } from "../../shared/types";
import type { Point } from "../../shared/placement";

export type SaveState = "saved" | "saving" | "error";

export type EditorStateValue = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: Viewport;
  saveState: SaveState;
  saveError: string;
  canUndo: boolean;
  canRedo: boolean;
  selectedCount: number;
};

export type EditorActions = {
  onNodesChange: (changes: NodeChange<CanvasNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<CanvasEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  onSelectionChange: (nodes: CanvasNode[]) => void;
  onNodeDragStart: () => void;
  onNodeDragStop: () => void;
  onMoveEnd: (viewport: Viewport) => void;
  applyViewport: (viewport: Viewport) => void;
  addPromptAt: (position: Point) => void;
  addPromptAtCenter: () => void;
  addPromptFromText: (text: string, position?: Point) => void;
  addImagesFromFiles: (
    files: File[],
    position: Point,
    targetPromptId?: string
  ) => Promise<void>;
  addImagesFromDataUrls: (
    entries: { dataUrl: string; name?: string }[],
    position: Point,
    targetPromptId?: string
  ) => Promise<void>;
  updatePrompt: (nodeId: string, prompt: string) => void;
  generatePrompt: (nodeId: string) => Promise<void>;
  copyPrompt: (nodeId: string) => Promise<boolean>;
  copyImage: (nodeId: string) => Promise<boolean>;
  downloadImage: (nodeId: string) => void;
  branchPrompt: (nodeId: string) => void;
  continueFromImage: (nodeId: string) => void;
  duplicateSelected: () => void;
  deleteSelected: () => void;
  deleteNode: (nodeId: string) => void;
  deleteEdges: (edgeIds: string[]) => void;
  annotateImage: (
    nodeId: string,
    blob: Blob,
    size: { width: number; height: number }
  ) => Promise<void>;
  restoreOriginal: (nodeId: string) => void;
  undo: () => void;
  redo: () => void;
  selectAll: () => void;
  clearSelection: () => void;
  locateNodes: (nodeIds: string[]) => void;
  fitAll: () => void;
  zoomBy: (factor: number) => void;
  zoomTo: (zoom: number) => void;
  focusPrompt: (nodeId: string, caret?: "start" | "end") => void;
  integratePending: (pending: PendingImage[]) => Promise<string[]>;
  forgetCanvas: (canvasId: string) => void;
  retrySave: () => void;
  flush: () => Promise<boolean>;
  isDirty: () => boolean;
  getSnapshot: () => CanvasSnapshot;
};

const EditorStateContext = createContext<EditorStateValue | null>(null);
const EditorActionsContext = createContext<EditorActions | null>(null);

export function EditorContextProviders({
  state,
  actions,
  children
}: {
  state: EditorStateValue;
  actions: EditorActions;
  children: ReactNode;
}) {
  return (
    <EditorStateContext.Provider value={state}>
      <EditorActionsContext.Provider value={actions}>
        {children}
      </EditorActionsContext.Provider>
    </EditorStateContext.Provider>
  );
}

export function useEditorState(): EditorStateValue {
  const context = useContext(EditorStateContext);
  if (!context) throw new Error("useEditorState must be used inside EditorContextProviders");
  return context;
}

export function useEditorActions(): EditorActions {
  const context = useContext(EditorActionsContext);
  if (!context) throw new Error("useEditorActions must be used inside EditorContextProviders");
  return context;
}
