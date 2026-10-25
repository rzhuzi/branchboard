import { useMemo } from "react";
import type { EditorActions, EditorStateValue } from "./EditorContext";
import type { EditorCore } from "./editorCore";
import type { HistoryApi } from "./useEditorHistory";
import type { ViewportApi } from "./useEditorViewport";
import type { NodesApi } from "./useEditorNodes";
import type { ImagesApi } from "./useEditorImages";
import type { SaveApi } from "./useEditorSave";

export function useEditorBindings(
  core: EditorCore,
  historyApi: HistoryApi,
  viewport: ViewportApi,
  nodesApi: NodesApi,
  images: ImagesApi,
  save: SaveApi
) {
  const {
    nodes,
    edges,
    viewport: viewportState,
    saveState,
    saveError,
    selectedCount,
    historiesRef,
    getSnapshot
  } = core;
  const { undo, redo, forgetCanvas, onNodeDragStart, onNodeDragStop } = historyApi;
  const {
    onSelectionChange,
    onMoveEnd,
    applyViewport,
    locateNodes,
    fitAll,
    zoomBy,
    zoomTo,
    focusPrompt,
    selectAll,
    clearSelection
  } = viewport;
  const {
    addPromptAt,
    addPromptAtCenter,
    addPromptFromText,
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
  } = nodesApi;
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
  } = images;
  const { retrySave, flush, isDirty } = save;

  const history = historiesRef.current.get(core.canvasId);
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
      viewport: viewportState,
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
      viewportState
    ]
  );

  return { actions, state };
}
