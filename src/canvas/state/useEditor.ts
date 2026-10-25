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

  const addImagesFromFiles = useCallback(
    async (files: File[], position: Point, targetPromptId?: string) => {
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));
      if (!imageFiles.length) {
        pushToast("拖入的内容里没有图片", { tone: "error" });
        return;
      }
      const originCanvasId = canvasIdRef.current;
      const stored = await Promise.all(
        imageFiles.map(async (file) => {
          try {
            const asset = await storeBlob(file, { name: file.name });
            return {
              assetId: asset.id,
              name: file.name || "图片",
              width: asset.width,
              height: asset.height,
              createdAt: asset.createdAt
            };
          } catch {
            return null;
          }
        })
      );
      const images = stored.filter((image): image is NonNullable<typeof image> =>
        Boolean(image)
      );
      if (canvasIdRef.current !== originCanvasId) {
        pushToast("画布已切换，图片未加入", { tone: "info" });
        return;
      }
      if (!images.length) {
        pushToast("图片保存失败，请检查本地存储空间", { tone: "error" });
        return;
      }
      if (images.length < imageFiles.length) {
        pushToast(`${imageFiles.length - images.length} 张图片保存失败`, {
          tone: "error"
        });
      }
      insertImageAssets(images, position, targetPromptId);
    },
    [insertImageAssets, pushToast, storeBlob]
  );

  const addImagesFromDataUrls = useCallback(
    async (
      entries: { dataUrl: string; name?: string }[],
      position: Point,
      targetPromptId?: string
    ) => {
      if (!entries.length) return;
      const originCanvasId = canvasIdRef.current;
      const stored = await Promise.all(
        entries.map(async (entry) => {
          try {
            const blob = dataUrlToBlob(entry.dataUrl);
            const asset = await storeBlob(blob, { name: entry.name });
            return {
              assetId: asset.id,
              name: entry.name || "粘贴图片",
              width: asset.width,
              height: asset.height,
              createdAt: asset.createdAt
            };
          } catch {
            return null;
          }
        })
      );
      const images = stored.filter((image): image is NonNullable<typeof image> =>
        Boolean(image)
      );
      if (canvasIdRef.current !== originCanvasId) {
        pushToast("画布已切换，图片未加入", { tone: "info" });
        return;
      }
      if (!images.length) {
        pushToast("图片保存失败，请检查本地存储空间", { tone: "error" });
        return;
      }
      insertImageAssets(images, position, targetPromptId);
    },
    [insertImageAssets, pushToast, storeBlob]
  );

  const generatePrompt = useCallback(
    async (nodeId: string) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (!node || node.data.kind !== "prompt") return;
      const prompt = node.data.prompt.trim();
      if (!prompt) {
        pushToast("先写一段提示词", { tone: "info" });
        return;
      }
      if (!embedded) {
        try {
          await copyText(prompt);
          pushToast("已复制提示词，请在 ChatGPT 输入框中粘贴发送", {
            tone: "success",
            duration: 4200
          });
        } catch (error) {
          pushToast(error instanceof Error ? error.message : "复制失败", {
            tone: "error"
          });
        }
        return;
      }

      const referenceEdges = edgesRef.current.filter(
        (edge) => edge.target === nodeId && edge.data?.relation === "reference"
      );
      const referenceNodes = referenceEdges
        .map((edge) => nodesRef.current.find((item) => item.id === edge.source))
        .filter((item): item is CanvasNode => Boolean(item) && item?.data.kind === "image");
      const limited = referenceNodes.slice(-MAX_REFERENCES);
      if (referenceNodes.length > MAX_REFERENCES) {
        pushToast(`参考图最多附加 ${MAX_REFERENCES} 张，已使用最近 ${MAX_REFERENCES} 张`, {
          tone: "info"
        });
      }
      const references = await Promise.all(
        limited.map(async (reference) => {
          if (reference.data.kind !== "image") return null;
          try {
            return {
              name: reference.data.name || "参考图",
              dataUrl: await getDataUrl(reference.data.assetId)
            };
          } catch {
            return null;
          }
        })
      );
      runPrompt({
        requestId: crypto.randomUUID(),
        canvasId: canvasIdRef.current,
        promptId: node.id,
        title: firstLineTitle(prompt),
        prompt,
        references: references.filter(
          (reference): reference is { name: string; dataUrl: string } => Boolean(reference)
        )
      });
    },
    [embedded, getDataUrl, pushToast, runPrompt]
  );

  const copyPrompt = useCallback(
    async (nodeId: string): Promise<boolean> => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (!node || node.data.kind !== "prompt") return false;
      try {
        await copyText(node.data.prompt);
        return true;
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "复制失败", {
          tone: "error"
        });
        return false;
      }
    },
    [pushToast]
  );

  const copyImage = useCallback(
    async (nodeId: string): Promise<boolean> => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (!node || node.data.kind !== "image") return false;
      try {
        const asset = await getAssetEntry(node.data.assetId);
        await copyImageBlob(asset.blob);
        return true;
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "复制图片失败", {
          tone: "error"
        });
        return false;
      }
    },
    [getAssetEntry, pushToast]
  );

  const downloadImage = useCallback(
    (nodeId: string) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (!node || node.data.kind !== "image") return;
      void getAssetEntry(node.data.assetId)
        .then((asset) => {
          const link = document.createElement("a");
          link.href = asset.url;
          link.download = downloadFileName(node.data.kind === "image" ? node.data.name : "", asset.mime);
          document.body.appendChild(link);
          link.click();
          link.remove();
          pushToast("已开始下载图片", { tone: "success", duration: 1800 });
        })
        .catch(() => pushToast("图片下载失败", { tone: "error" }));
    },
    [getAssetEntry, pushToast]
  );

  const annotateImage = useCallback(
    async (nodeId: string, blob: Blob, size: { width: number; height: number }) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (!node || node.data.kind !== "image") return;
      const originCanvasId = canvasIdRef.current;
      try {
        const asset = await storeBlob(blob, {
          name: `${node.data.name || "图片"} · 标注`,
          width: size.width,
          height: size.height
        });
        if (canvasIdRef.current !== originCanvasId) return;
        const current = nodesRef.current.find((item) => item.id === nodeId);
        if (!current || current.data.kind !== "image") return;
        pushHistory();
        const nextNodes = nodesRef.current.map((item) =>
          item.id === nodeId && item.data.kind === "image"
            ? {
                ...item,
                data: {
                  ...item.data,
                  assetId: asset.id,
                  originalAssetId: item.data.originalAssetId ?? item.data.assetId,
                  annotatedAt: nowIso()
                }
              }
            : item
        );
        applyState(nextNodes, edgesRef.current);
        markDirty();
        pushToast("标注已保存，可从菜单恢复原图", { tone: "success", duration: 3000 });
      } catch {
        pushToast("标注保存失败，请检查本地存储空间", { tone: "error" });
      }
    },
    [applyState, markDirty, pushHistory, pushToast, storeBlob]
  );

  const restoreOriginal = useCallback(
    (nodeId: string) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (!node || node.data.kind !== "image" || !node.data.originalAssetId) {
        pushToast("这张图片没有可恢复的原图", { tone: "info" });
        return;
      }
      pushHistory();
      const restoreAssetId = node.data.originalAssetId;
      const nextNodes = nodesRef.current.map((item) => {
        if (item.id !== nodeId || item.data.kind !== "image") return item;
        const { originalAssetId, annotatedAt, ...rest } = item.data;
        return {
          ...item,
          data: {
            ...rest,
            assetId: restoreAssetId
          }
        };
      });
      applyState(nextNodes, edgesRef.current);
      markDirty();
      pushToast("已恢复原图", { tone: "success", duration: 2200 });
    },
    [applyState, markDirty, pushHistory, pushToast]
  );

  const integratePending = useCallback(
    async (pending: PendingImage[]): Promise<string[]> => {
      if (!pending.length) return [];
      const result = integratePendingIntoSnapshot(
        {
          nodes: nodesRef.current,
          edges: edgesRef.current,
          viewport: viewportRef.current,
          updatedAt: nowIso()
        },
        pending
      );
      if (!result.addedNodeIds.length) return [];
      pushHistory();
      applyState(result.snapshot.nodes, result.snapshot.edges);
      markDirty();
      return result.addedNodeIds;
    },
    [applyState, markDirty, pushHistory]
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
