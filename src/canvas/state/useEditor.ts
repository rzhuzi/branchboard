import { useCallback, useEffect, useMemo } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type Viewport
} from "@xyflow/react";
import { copyImageBlob, copyText } from "../../shared/clipboard";
import { dataUrlToBlob } from "../../shared/blob";
import { clamp, zoomAtPoint } from "../../shared/geometry";
import { integratePendingIntoSnapshot } from "../../shared/integration";
import { mergeCanvasSnapshots } from "../../shared/merge";
import {
  estimateNodeSize,
  findFreePosition,
  measuredNodeSize,
  placeChild,
  placeIncoming,
  type Point
} from "../../shared/placement";
import type {
  CanvasDocument,
  CanvasEdge,
  CanvasNode,
  PendingImage,
  PromptNodeData,
  RelationKind
} from "../../shared/types";
import type { WorkspaceSession } from "../../shared/workspace";
import { useAssets } from "./AssetProvider";
import { useExecution } from "./ExecutionProvider";
import { useToast } from "./ToastProvider";
import type { EditorActions, EditorStateValue } from "./EditorContext";
import {
  downloadFileName,
  firstLineTitle,
  MAX_REFERENCES,
  nowIso,
  positionsChanged,
  prepareEdges,
  prepareNodes,
  relationForConnection,
  sanitizeEdge,
  sanitizeNode,
  savedEdgeId,
  snapshotFromDocument,
  type HistoryEntry
} from "./editorPure";
import { useEditorCore } from "./editorCore";
import { useEditorSave } from "./useEditorSave";
import { useEditorHistory } from "./useEditorHistory";
import { useEditorViewport } from "./useEditorViewport";
import { useEditorNodes } from "./useEditorNodes";
import { useEditorImages } from "./useEditorImages";

export function useEditor({
  workspace,
  canvasId,
  document: initialDocument,
  embedded
}: {
  workspace: WorkspaceSession;
  canvasId: string;
  document: CanvasDocument;
  embedded: boolean;
}): {
  state: EditorStateValue;
  actions: EditorActions;
  flush: () => Promise<boolean>;
  isDirty: () => boolean;
} {
  const { getAssetEntry, getDataUrl, storeBlob } = useAssets();
  const { cancelPrompt, runPrompt } = useExecution();
  const { pushToast } = useToast();

  const core = useEditorCore({ canvasId, document: initialDocument });
  const {
    nodes,
    edges,
    viewport,
    saveState,
    saveError,
    selectedCount,
    setNodes,
    setEdges,
    setViewport,
    setSaveState,
    setSelectedCount,
    setSaveStatus,
    setHistoryVersion,
    nodesRef,
    edgesRef,
    viewportRef,
    selectedIdsRef,
    canvasIdRef,
    revisionRef,
    historiesRef,
    dirtyRef,
    changeVersionRef,
    saveTimerRef,
    saveLoopRef,
    saveStateRef,
    dragStartRef,
    initialDocumentRef,
    saveNowRef,
    undoRef,
    reactFlowRef,
    applyState,
    snapshotNow,
    getSnapshot,
    markDirty,
    pushHistoryEntry,
    pushHistory
  } = core;

  const { undo, redo, forgetCanvas, onNodeDragStart, onNodeDragStop } =
    useEditorHistory(core, { cancelPrompt });

  const {
    focusPrompt,
    clampToVisible,
    canvasCenterFlow,
    locateNodes,
    fitAll,
    zoomBy,
    zoomTo,
    applyViewport,
    onSelectionChange,
    selectAll,
    clearSelection,
    onMoveEnd
  } = useEditorViewport(core);

  const {
    addPromptAt,
    addPromptAtCenter,
    addPromptFromText,
    insertImageAssets,
    updatePrompt,
    branchPrompt,
    continueFromImage,
    duplicateSelected,
    deleteSelected,
    deleteNode,
    deleteEdges,
    onConnect,
    onNodesChange,
    onEdgesChange
  } = useEditorNodes(
    core,
    { focusPrompt, clampToVisible, canvasCenterFlow },
    { cancelPrompt, pushToast }
  );

  const {
    addImagesFromFiles,
    addImagesFromDataUrls,
    generatePrompt,
    copyPrompt,
    copyImage,
    downloadImage,
    annotateImage,
    restoreOriginal,
    integratePending
  } = useEditorImages(
    core,
    { insertImageAssets },
    { embedded, getDataUrl, getAssetEntry, storeBlob, runPrompt, pushToast }
  );

  const { retrySave, flush, isDirty } = useEditorSave(core, workspace);

  const history = historiesRef.current.get(canvasId);
  const canUndo = Boolean(history?.past.length);
  const canRedo = Boolean(history?.future.length);

  const actions = useMemo<EditorActions>(
    () => ({
      onNodesChange,
      onEdgesChange,
      onConnect,
      onSelectionChange,
      onNodeDragStart,
      onNodeDragStop,
      onMoveEnd,
      applyViewport,
      addPromptAt,
      addPromptAtCenter,
      addPromptFromText,
      addImagesFromFiles,
      addImagesFromDataUrls,
      updatePrompt,
      generatePrompt,
      copyPrompt,
      copyImage,
      downloadImage,
      branchPrompt,
      continueFromImage,
      duplicateSelected,
      deleteSelected,
      deleteNode,
      deleteEdges,
      annotateImage,
      restoreOriginal,
      undo,
      redo,
      selectAll,
      clearSelection,
      locateNodes,
      fitAll,
      zoomBy,
      zoomTo,
      focusPrompt,
      integratePending,
      forgetCanvas,
      retrySave,
      flush,
      isDirty,
      getSnapshot
    }),
    [
      addImagesFromDataUrls,
      addImagesFromFiles,
      addPromptAt,
      addPromptAtCenter,
      addPromptFromText,
      annotateImage,
      applyViewport,
      branchPrompt,
      clearSelection,
      continueFromImage,
      copyImage,
      copyPrompt,
      deleteNode,
      deleteEdges,
      deleteSelected,
      downloadImage,
      duplicateSelected,
      fitAll,
      flush,
      focusPrompt,
      forgetCanvas,
      generatePrompt,
      getSnapshot,
      integratePending,
      isDirty,
      locateNodes,
      onConnect,
      onEdgesChange,
      onMoveEnd,
      onNodeDragStart,
      onNodeDragStop,
      onNodesChange,
      onSelectionChange,
      redo,
      restoreOriginal,
      retrySave,
      selectAll,
      undo,
      updatePrompt,
      zoomBy,
      zoomTo
    ]
  );

  const state = useMemo<EditorStateValue>(
    () => ({
      nodes,
      edges,
      viewport,
      saveState,
      saveError,
      canUndo,
      canRedo,
      selectedCount
    }),
    [
      canRedo,
      canUndo,
      edges,
      nodes,
      saveError,
      saveState,
      selectedCount,
      viewport
    ]
  );

  return { state, actions, flush, isDirty };
}
