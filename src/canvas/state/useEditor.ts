import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
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
  CanvasSnapshot,
  PendingImage,
  PromptNodeData,
  RelationKind
} from "../../shared/types";
import type { WorkspaceSession } from "../../shared/workspace";
import { useAssets } from "./AssetProvider";
import { useExecution } from "./ExecutionProvider";
import { useToast } from "./ToastProvider";
import type { EditorActions, EditorStateValue, SaveState } from "./EditorContext";
import {
  downloadFileName,
  firstLineTitle,
  MAX_HISTORY,
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
  type HistoryEntry,
  type HistoryStacks
} from "./editorPure";

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
  const reactFlow = useReactFlow<CanvasNode, CanvasEdge>();
  const reactFlowRef = useRef(reactFlow);
  reactFlowRef.current = reactFlow;
  const { getAssetEntry, getDataUrl, storeBlob } = useAssets();
  const { cancelPrompt, runPrompt } = useExecution();
  const { pushToast } = useToast();

  const initialNodesRef = useRef<CanvasNode[] | null>(null);
  const initialEdgesRef = useRef<CanvasEdge[] | null>(null);
  if (!initialNodesRef.current || !initialEdgesRef.current) {
    const nodes = prepareNodes(initialDocument.nodes);
    initialNodesRef.current = nodes;
    initialEdgesRef.current = prepareEdges(initialDocument.edges, nodes);
  }

  const [nodes, setNodes] = useState<CanvasNode[]>(initialNodesRef.current);
  const [edges, setEdges] = useState<CanvasEdge[]>(initialEdgesRef.current);
  const [viewport, setViewport] = useState<Viewport>(
    initialDocument.viewport ?? { x: 0, y: 0, zoom: 1 }
  );
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [selectedCount, setSelectedCount] = useState(0);
  const [, setHistoryVersion] = useState(0);

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const viewportRef = useRef(viewport);
  const selectedIdsRef = useRef<string[]>([]);
  const canvasIdRef = useRef(canvasId);
  const loadedCanvasRef = useRef("");
  const revisionRef = useRef(initialDocument.revision);
  const historiesRef = useRef(new Map<string, HistoryStacks>());
  const dirtyRef = useRef(false);
  const changeVersionRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const saveLoopRef = useRef<Promise<boolean> | null>(null);
  const saveStateRef = useRef<SaveState>("saved");
  const dragStartRef = useRef<HistoryEntry | null>(null);
  const initialDocumentRef = useRef(initialDocument);
  const saveNowRef = useRef<(() => Promise<boolean>) | null>(null);
  const undoRef = useRef<() => void>(() => {});
  initialDocumentRef.current = initialDocument;
  canvasIdRef.current = canvasId;

  const setSaveStatus = useCallback((next: SaveState, message = "") => {
    saveStateRef.current = next;
    setSaveState(next);
    setSaveError(message);
  }, []);

  const applyState = useCallback((nextNodes: CanvasNode[], nextEdges: CanvasEdge[]) => {
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
  }, []);

  const snapshotNow = useCallback(
    (): CanvasSnapshot => ({
      nodes: nodesRef.current.map(sanitizeNode),
      edges: edgesRef.current.map(sanitizeEdge),
      viewport: { ...viewportRef.current },
      updatedAt: nowIso()
    }),
    []
  );

  const saveNow = useCallback(async (): Promise<boolean> => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (saveLoopRef.current) {
      await saveLoopRef.current;
      if (!dirtyRef.current) return saveStateRef.current !== "error";
    }

    const run = async (): Promise<boolean> => {
      let loops = 0;
      while (dirtyRef.current && loops < 4) {
        loops += 1;
        const targetCanvasId = canvasIdRef.current;
        const versionAtStart = changeVersionRef.current;
        const candidate = snapshotNow();
        const result = await workspace.commit(targetCanvasId, candidate);
        if (canvasIdRef.current !== targetCanvasId) return true;
        if (!result.ok) {
          setSaveStatus("error", result.message);
          return false;
        }
        revisionRef.current = result.document.revision;
        if (result.merged) {
          const merged =
            changeVersionRef.current === versionAtStart
              ? snapshotFromDocument(result.document)
              : mergeCanvasSnapshots(
                  candidate,
                  snapshotNow(),
                  snapshotFromDocument(result.document)
                );
          applyState(prepareNodes(merged.nodes), merged.edges);
        }
        if (changeVersionRef.current === versionAtStart) {
          dirtyRef.current = false;
          setSaveStatus("saved");
          return true;
        }
      }
      if (dirtyRef.current) {
        saveStateRef.current = "saving";
        setSaveState("saving");
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = null;
          if (dirtyRef.current) void saveNowRef.current?.();
        }, 480);
      }
      return !dirtyRef.current && saveStateRef.current !== "error";
    };

    const promise = run();
    saveLoopRef.current = promise;
    try {
      return await promise;
    } finally {
      if (saveLoopRef.current === promise) saveLoopRef.current = null;
    }
  }, [applyState, setSaveStatus, snapshotNow, workspace]);

  saveNowRef.current = saveNow;

  const scheduleSave = useCallback(
    (delay = 520) => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        if (dirtyRef.current) void saveNowRef.current?.();
      }, delay);
    },
    []
  );

  const markDirty = useCallback(
    (silent = false) => {
      changeVersionRef.current += 1;
      dirtyRef.current = true;
      if (!silent || saveStateRef.current === "error") {
        setSaveStatus("saving");
      }
      scheduleSave();
    },
    [scheduleSave, setSaveStatus]
  );

  const pushHistoryEntry = useCallback((entry: HistoryEntry) => {
    const history = historiesRef.current.get(canvasIdRef.current) ?? {
      past: [],
      future: []
    };
    history.past.push(entry);
    if (history.past.length > MAX_HISTORY) history.past.shift();
    history.future = [];
    historiesRef.current.set(canvasIdRef.current, history);
    setHistoryVersion((value) => value + 1);
  }, []);

  const pushHistory = useCallback(() => {
    pushHistoryEntry({
      nodes: nodesRef.current.map(sanitizeNode),
      edges: edgesRef.current.map(sanitizeEdge)
    });
  }, [pushHistoryEntry]);

  const getSnapshot = useCallback((): CanvasSnapshot => snapshotNow(), [snapshotNow]);

  const reconcileRemovedPrompts = useCallback(
    (before: CanvasNode[], after: CanvasNode[]) => {
      const afterIds = new Set(
        after.filter((node) => node.data.kind === "prompt").map((node) => node.id)
      );
      for (const node of before) {
        if (node.data.kind === "prompt" && !afterIds.has(node.id)) {
          cancelPrompt(node.id);
        }
      }
    },
    [cancelPrompt]
  );

  const undo = useCallback(() => {
    const history = historiesRef.current.get(canvasIdRef.current);
    const previous = history?.past.pop();
    if (!history || !previous) return;
    history.future.push({
      nodes: nodesRef.current.map(sanitizeNode),
      edges: edgesRef.current.map(sanitizeEdge)
    });
    const before = nodesRef.current;
    const restoredNodes = prepareNodes(previous.nodes);
    const restoredEdges = previous.edges.map((edge) => ({ ...edge, selected: false }));
    applyState(restoredNodes, restoredEdges);
    selectedIdsRef.current = [];
    setSelectedCount(0);
    reconcileRemovedPrompts(before, restoredNodes);
    setHistoryVersion((value) => value + 1);
    markDirty();
  }, [applyState, markDirty, reconcileRemovedPrompts]);
  undoRef.current = undo;

  const redo = useCallback(() => {
    const history = historiesRef.current.get(canvasIdRef.current);
    const next = history?.future.pop();
    if (!history || !next) return;
    history.past.push({
      nodes: nodesRef.current.map(sanitizeNode),
      edges: edgesRef.current.map(sanitizeEdge)
    });
    const before = nodesRef.current;
    const restoredNodes = prepareNodes(next.nodes);
    const restoredEdges = next.edges.map((edge) => ({ ...edge, selected: false }));
    applyState(restoredNodes, restoredEdges);
    selectedIdsRef.current = [];
    setSelectedCount(0);
    reconcileRemovedPrompts(before, restoredNodes);
    setHistoryVersion((value) => value + 1);
    markDirty();
  }, [applyState, markDirty, reconcileRemovedPrompts]);

  const recordViewport = useCallback(
    (nextViewport: Viewport, silent = true) => {
      const rounded: Viewport = {
        x: Math.round(nextViewport.x),
        y: Math.round(nextViewport.y),
        zoom: Math.round(nextViewport.zoom * 1000) / 1000
      };
      viewportRef.current = rounded;
      setViewport(rounded);
      markDirty(silent);
    },
    [markDirty]
  );

  const canvasRect = useCallback((): DOMRect | null => {
    const element = document.querySelector(".bb-canvas");
    return element ? element.getBoundingClientRect() : null;
  }, []);

  const canvasCenterFlow = useCallback((): Point => {
    const rect = canvasRect();
    if (!rect) return { x: 0, y: 0 };
    return reactFlowRef.current.screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    });
  }, [canvasRect]);

  const clampToVisible = useCallback(
    (position: Point, size: { width: number; height: number }): Point => {
      const rect = canvasRect();
      if (!rect) return position;
      const viewport = reactFlowRef.current.getViewport();
      const left = -viewport.x / viewport.zoom;
      const top = -viewport.y / viewport.zoom;
      const right = (rect.width - viewport.x) / viewport.zoom;
      const bottom = (rect.height - viewport.y) / viewport.zoom;
      const margin = 16;
      const minX = left + margin;
      const maxX = right - size.width - margin;
      const minY = top + margin;
      const maxY = bottom - size.height - margin;
      return {
        x:
          maxX < minX
            ? left + (right - left - size.width) / 2
            : clamp(position.x, minX, maxX),
        y:
          maxY < minY
            ? top + (bottom - top - size.height) / 2
            : clamp(position.y, minY, maxY)
      };
    },
    [canvasRect]
  );

  const ensureNodeVisible = useCallback(
    (nodeId: string) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      const rect = canvasRect();
      if (!node || !rect) return;
      const rf = reactFlowRef.current;
      const internal = rf.getNode(nodeId);
      const size = measuredNodeSize(node);
      const topLeft = rf.flowToScreenPosition(node.position);
      const padding = 28;
      let dx = 0;
      let dy = 0;
      if (topLeft.x < rect.left + padding) dx = rect.left + padding - topLeft.x;
      else if (topLeft.x + size.width > rect.right - padding) {
        dx = rect.right - padding - (topLeft.x + size.width);
      }
      if (topLeft.y < rect.top + padding) dy = rect.top + padding - topLeft.y;
      else if (topLeft.y + size.height > rect.bottom - padding) {
        dy = rect.bottom - padding - (topLeft.y + size.height);
      }
      if (!dx && !dy) return;
      const current = rf.getViewport();
      void rf.setViewport(
        { x: current.x + dx, y: current.y + dy, zoom: current.zoom },
        { duration: 180 }
      );
      if (internal) {
        viewportRef.current = {
          x: Math.round(current.x + dx),
          y: Math.round(current.y + dy),
          zoom: Math.round(current.zoom * 1000) / 1000
        };
        setViewport(viewportRef.current);
        markDirty(true);
      }
    },
    [canvasRect, markDirty]
  );

  const focusPrompt = useCallback(
    (nodeId: string, caret: "start" | "end" = "end") => {
      ensureNodeVisible(nodeId);
      const selector = `.react-flow__node[data-id="${CSS.escape(nodeId)}"] textarea`;
      let attempts = 0;
      const tryFocus = () => {
        const element = document.querySelector<HTMLTextAreaElement>(selector);
        if (element) {
          element.focus({ preventScroll: true });
          const position = caret === "end" ? element.value.length : 0;
          element.setSelectionRange(position, position);
          return;
        }
        attempts += 1;
        if (attempts < 10) window.setTimeout(tryFocus, 50);
      };
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(tryFocus);
      });
    },
    [ensureNodeVisible]
  );

  const locateNodes = useCallback(
    (nodeIds: string[]) => {
      const ids = nodeIds.filter((id) => nodesRef.current.some((node) => node.id === id));
      if (!ids.length) return;
      const idSet = new Set(ids);
      const nextNodes = nodesRef.current.map((node) => ({
        ...node,
        selected: idSet.has(node.id)
      }));
      applyState(nextNodes, edgesRef.current);
      selectedIdsRef.current = [...ids];
      setSelectedCount(ids.length);
      const rf = reactFlowRef.current;
      void rf
        .fitView({
          nodes: ids.map((id) => ({ id })),
          padding: 0.32,
          duration: 360,
          maxZoom: 1
        })
        .then(() => recordViewport(rf.getViewport(), true));
    },
    [applyState, recordViewport]
  );

  const fitAll = useCallback(() => {
    const rf = reactFlowRef.current;
    void rf
      .fitView({ padding: 0.24, duration: 300, maxZoom: 1 })
      .then(() => recordViewport(rf.getViewport(), true));
  }, [recordViewport]);

  const zoomBy = useCallback(
    (factor: number) => {
      const rf = reactFlowRef.current;
      const rect = canvasRect();
      if (!rect) return;
      const current = rf.getViewport();
      const nextZoom = clamp(current.zoom * factor, 0.1, 2.5);
      const next = zoomAtPoint(
        current,
        { x: rect.width / 2, y: rect.height / 2 },
        nextZoom
      );
      void rf.setViewport(next, { duration: 120 });
      viewportRef.current = next;
      setViewport(next);
      markDirty(true);
    },
    [canvasRect, markDirty]
  );

  const zoomTo = useCallback(
    (zoom: number) => {
      const rf = reactFlowRef.current;
      const rect = canvasRect();
      if (!rect) return;
      const current = rf.getViewport();
      const next = zoomAtPoint(
        current,
        { x: rect.width / 2, y: rect.height / 2 },
        clamp(zoom, 0.1, 2.5)
      );
      void rf.setViewport(next, { duration: 140 });
      viewportRef.current = next;
      setViewport(next);
      markDirty(true);
    },
    [canvasRect, markDirty]
  );

  const applyViewport = useCallback(
    (next: Viewport) => {
      void reactFlowRef.current.setViewport(next);
      viewportRef.current = next;
      setViewport(next);
      markDirty(true);
    },
    [markDirty]
  );

  const updateSelection = useCallback((nextNodes: CanvasNode[], nextEdges = edgesRef.current) => {
    applyState(nextNodes, nextEdges);
    selectedIdsRef.current = nextNodes.filter((node) => node.selected).map((node) => node.id);
    setSelectedCount(selectedIdsRef.current.length);
  }, [applyState]);

  const onSelectionChange = useCallback((selectedNodes: CanvasNode[]) => {
    const ids = selectedNodes.map((node) => node.id);
    selectedIdsRef.current = ids;
    setSelectedCount(ids.length);
  }, []);

  const selectAll = useCallback(() => {
    updateSelection(nodesRef.current.map((node) => ({ ...node, selected: true })));
  }, [updateSelection]);

  const clearSelection = useCallback(() => {
    updateSelection(
      nodesRef.current.map((node) => ({ ...node, selected: false })),
      edgesRef.current.map((edge) => ({ ...edge, selected: false }))
    );
  }, [updateSelection]);

  const createPromptAt = useCallback(
    (position: Point, prompt = "", focus = true) => {
      const node: CanvasNode = {
        id: crypto.randomUUID(),
        type: "prompt",
        position: { x: 0, y: 0 },
        selected: true,
        data: {
          kind: "prompt",
          prompt,
          createdAt: nowIso(),
          updatedAt: nowIso()
        } satisfies PromptNodeData
      };
      const size = estimateNodeSize(node);
      node.position = findFreePosition(
        nodesRef.current,
        size,
        clampToVisible(position, size)
      );
      pushHistory();
      const nextNodes = [
        ...nodesRef.current.map((item) => ({ ...item, selected: false })),
        node
      ];
      applyState(nextNodes, edgesRef.current);
      selectedIdsRef.current = [node.id];
      setSelectedCount(1);
      markDirty();
      if (focus) focusPrompt(node.id, prompt ? "end" : "start");
      return node.id;
    },
    [applyState, clampToVisible, focusPrompt, markDirty, pushHistory]
  );

  const addPromptAt = useCallback(
    (position: Point) => {
      createPromptAt(position, "");
    },
    [createPromptAt]
  );

  const addPromptAtCenter = useCallback(() => {
    createPromptAt(canvasCenterFlow(), "");
  }, [canvasCenterFlow, createPromptAt]);

  const addPromptFromText = useCallback(
    (text: string, position?: Point) => {
      const content = text.trim();
      if (!content) return;
      createPromptAt(position ?? canvasCenterFlow(), content, true);
    },
    [canvasCenterFlow, createPromptAt]
  );

  const insertImageAssets = useCallback(
    (
      images: { assetId: string; name: string; width: number; height: number; createdAt: string }[],
      anchor: Point,
      targetPromptId?: string
    ) => {
      if (!images.length) return;
      const parent = targetPromptId
        ? nodesRef.current.find(
            (node) => node.id === targetPromptId && node.data.kind === "prompt"
          )
        : undefined;
      let workingNodes: CanvasNode[] = nodesRef.current.map((node) => ({
        ...node,
        selected: false
      }));
      let workingEdges = [...edgesRef.current];
      const created: CanvasNode[] = [];
      const createdEdges: CanvasEdge[] = [];
      images.forEach((image, index) => {
        const size = {
          width: 320,
          height: Math.min(
            440,
            Math.max(100, Math.round((320 * (image.height || 1024)) / Math.max(1, image.width || 1024)))
          )
        };
        const relation: RelationKind | null = parent ? "reference" : null;
        const position =
          parent && relation
            ? placeIncoming(workingNodes, workingEdges, parent.id, size)
            : findFreePosition(
                workingNodes,
                size,
                clampToVisible(
                  {
                    x: anchor.x - size.width / 2 + index * 34,
                    y: anchor.y - 60 + index * 34
                  },
                  size
                )
              );
        const nodeId = crypto.randomUUID();
        const imageNode: CanvasNode = {
          id: nodeId,
          type: "image",
          position,
          selected: true,
          data: {
            kind: "image",
            assetId: image.assetId,
            name: image.name,
            createdAt: image.createdAt,
            width: image.width,
            height: image.height
          }
        };
        created.push(imageNode);
        workingNodes = [...workingNodes, imageNode];
        if (parent && relation) {
          const edge: CanvasEdge = {
            id: savedEdgeId(relation),
            source: nodeId,
            target: parent.id,
            type: "relation",
            data: { relation }
          };
          createdEdges.push(edge);
          workingEdges = [...workingEdges, edge];
        }
      });
      pushHistory();
      applyState(workingNodes, workingEdges);
      selectedIdsRef.current = created.map((node) => node.id);
      setSelectedCount(created.length);
      markDirty();
      pushToast(
        parent
          ? `已加入 ${created.length} 张参考图`
          : `已加入 ${created.length} 张图片`,
        { tone: "success", duration: 2400 }
      );
    },
    [applyState, clampToVisible, markDirty, pushHistory, pushToast]
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

  const updatePrompt = useCallback(
    (nodeId: string, prompt: string) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (!node || node.data.kind !== "prompt" || node.data.prompt === prompt) return;
      const nextNodes = nodesRef.current.map((item) =>
        item.id === nodeId && item.data.kind === "prompt"
          ? {
              ...item,
              data: { ...item.data, prompt, updatedAt: nowIso() } satisfies PromptNodeData
            }
          : item
      );
      applyState(nextNodes, edgesRef.current);
      markDirty();
    },
    [applyState, markDirty]
  );

  const branchPrompt = useCallback(
    (nodeId: string) => {
      const parent = nodesRef.current.find((node) => node.id === nodeId);
      if (!parent || parent.data.kind !== "prompt") return;
      const node: CanvasNode = {
        id: crypto.randomUUID(),
        type: "prompt",
        position: { x: 0, y: 0 },
        selected: true,
        data: {
          kind: "prompt",
          prompt: parent.data.prompt,
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      };
      node.position = placeChild(nodesRef.current, edgesRef.current, parent.id, estimateNodeSize(node));
      const edge: CanvasEdge = {
        id: savedEdgeId("branch"),
        source: parent.id,
        target: node.id,
        type: "relation",
        data: { relation: "branch" }
      };
      pushHistory();
      applyState(
        [...nodesRef.current.map((item) => ({ ...item, selected: false })), node],
        [...edgesRef.current.map((item) => ({ ...item, selected: false })), edge]
      );
      selectedIdsRef.current = [node.id];
      setSelectedCount(1);
      markDirty();
      focusPrompt(node.id, "end");
    },
    [applyState, focusPrompt, markDirty, pushHistory]
  );

  const continueFromImage = useCallback(
    (nodeId: string) => {
      const parent = nodesRef.current.find((node) => node.id === nodeId);
      if (!parent || parent.data.kind !== "image") return;
      const node: CanvasNode = {
        id: crypto.randomUUID(),
        type: "prompt",
        position: { x: 0, y: 0 },
        selected: true,
        data: {
          kind: "prompt",
          prompt: "",
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      };
      node.position = placeChild(nodesRef.current, edgesRef.current, parent.id, estimateNodeSize(node));
      const edge: CanvasEdge = {
        id: savedEdgeId("reference"),
        source: parent.id,
        target: node.id,
        type: "relation",
        data: { relation: "reference" }
      };
      pushHistory();
      applyState(
        [...nodesRef.current.map((item) => ({ ...item, selected: false })), node],
        [...edgesRef.current.map((item) => ({ ...item, selected: false })), edge]
      );
      selectedIdsRef.current = [node.id];
      setSelectedCount(1);
      markDirty();
      focusPrompt(node.id, "start");
    },
    [applyState, focusPrompt, markDirty, pushHistory]
  );

  const duplicateSelected = useCallback(() => {
    const ids = new Set(selectedIdsRef.current);
    const sources = nodesRef.current.filter((node) => ids.has(node.id));
    if (!sources.length) return;
    const clones: CanvasNode[] = [];
    let workingNodes: CanvasNode[] = nodesRef.current.map((node) => ({
      ...node,
      selected: false
    }));
    sources.forEach((source, index) => {
      const size = estimateNodeSize(source);
      const clone: CanvasNode = {
        ...source,
        id: crypto.randomUUID(),
        selected: true,
        position: findFreePosition(workingNodes, size, {
          x: source.position.x + 40 + index * 26,
          y: source.position.y + 40 + index * 26
        }),
        data: { ...source.data }
      };
      clones.push(clone);
      workingNodes = [...workingNodes, clone];
    });
    pushHistory();
    applyState(workingNodes, edgesRef.current);
    selectedIdsRef.current = clones.map((node) => node.id);
    setSelectedCount(clones.length);
    markDirty();
    pushToast(`已复制 ${clones.length} 个节点`, { tone: "success", duration: 2200 });
  }, [applyState, markDirty, pushHistory, pushToast]);

  const deleteNodesByIds = useCallback(
    (nodeIds: string[]) => {
      if (!nodeIds.length) return;
      const ids = new Set(nodeIds);
      const targets = nodesRef.current.filter((node) => ids.has(node.id));
      if (!targets.length) return;
      pushHistory();
      const nextNodes = nodesRef.current.filter((node) => !ids.has(node.id));
      const nextEdges = edgesRef.current.filter(
        (edge) => !ids.has(edge.source) && !ids.has(edge.target)
      );
      applyState(nextNodes, nextEdges);
      selectedIdsRef.current = [];
      setSelectedCount(0);
      markDirty();
      const promptIds = targets
        .filter((node) => node.data.kind === "prompt")
        .map((node) => node.id);
      for (const promptId of promptIds) cancelPrompt(promptId);
      pushToast(
        promptIds.length ? "已删除节点并取消相关生成" : "已删除节点",
        {
          tone: "info",
          action: { label: "撤销", onClick: () => undoRef.current() },
          duration: 6500
        }
      );
    },
    [applyState, cancelPrompt, markDirty, pushHistory, pushToast]
  );

  const deleteSelected = useCallback(() => {
    deleteNodesByIds([...selectedIdsRef.current]);
  }, [deleteNodesByIds]);

  const deleteNode = useCallback(
    (nodeId: string) => {
      deleteNodesByIds([nodeId]);
    },
    [deleteNodesByIds]
  );

  const deleteEdges = useCallback(
    (edgeIds: string[]) => {
      if (!edgeIds.length) return;
      const ids = new Set(edgeIds);
      if (!edgesRef.current.some((edge) => ids.has(edge.id))) return;
      pushHistory();
      applyState(nodesRef.current, edgesRef.current.filter((edge) => !ids.has(edge.id)));
      markDirty();
      pushToast("已删除关系", {
        tone: "info",
        action: { label: "撤销", onClick: () => undoRef.current() },
        duration: 5000
      });
    },
    [applyState, markDirty, pushHistory, pushToast]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const source = nodesRef.current.find((node) => node.id === connection.source);
      const target = nodesRef.current.find((node) => node.id === connection.target);
      const relation = relationForConnection(source, target);
      if (!source || !target || !relation) {
        pushToast("只能把图片连到提示词，或把提示词连到另一个提示词", {
          tone: "error"
        });
        return;
      }
      const duplicate = edgesRef.current.some(
        (edge) =>
          edge.source === source.id &&
          edge.target === target.id &&
          edge.data?.relation === relation
      );
      if (duplicate) {
        pushToast("这条关系已经存在", { tone: "info" });
        return;
      }
      const edge: CanvasEdge = {
        id: savedEdgeId(relation),
        source: source.id,
        target: target.id,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        type: "relation",
        data: { relation }
      };
      pushHistory();
      applyState(nodesRef.current, [...edgesRef.current, edge]);
      markDirty();
      pushToast(relation === "reference" ? "已建立参考关系" : "已建立分支关系", {
        tone: "success",
        duration: 2000
      });
    },
    [applyState, markDirty, pushHistory, pushToast]
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

  const forgetCanvas = useCallback((targetCanvasId: string) => {
    historiesRef.current.delete(targetCanvasId);
    setHistoryVersion((value) => value + 1);
  }, []);

  const retrySave = useCallback(() => {
    if (!dirtyRef.current) {
      setSaveStatus("saved");
      return;
    }
    setSaveStatus("saving");
    void saveNow();
  }, [saveNow, setSaveStatus]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    for (let attempt = 0; attempt < 3 && dirtyRef.current; attempt += 1) {
      await saveNow();
    }
    if (saveLoopRef.current) await saveLoopRef.current;
    return !dirtyRef.current && saveStateRef.current !== "error";
  }, [saveNow]);

  const isDirty = useCallback(() => dirtyRef.current, []);

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const next = applyNodeChanges(changes, nodesRef.current);
      nodesRef.current = next;
      setNodes(next);
      const structureChanged = changes.some(
        (change) => change.type === "remove" || change.type === "add" || change.type === "replace"
      );
      const positionChanged = changes.some((change) => change.type === "position");
      if (structureChanged || (positionChanged && !dragStartRef.current)) {
        markDirty();
      }
    },
    [markDirty]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      const next = applyEdgeChanges(changes, edgesRef.current);
      edgesRef.current = next;
      setEdges(next);
      if (
        changes.some(
          (change) =>
            change.type === "remove" || change.type === "add" || change.type === "replace"
        )
      ) {
        markDirty();
      }
    },
    [markDirty]
  );

  const onNodeDragStart = useCallback(() => {
    dragStartRef.current = {
      nodes: nodesRef.current.map(sanitizeNode),
      edges: edgesRef.current.map(sanitizeEdge)
    };
  }, []);

  const onNodeDragStop = useCallback(() => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start) return;
    const current: HistoryEntry = {
      nodes: nodesRef.current.map(sanitizeNode),
      edges: edgesRef.current.map(sanitizeEdge)
    };
    if (!positionsChanged(start, current)) return;
    pushHistoryEntry(start);
    markDirty();
  }, [markDirty, pushHistoryEntry]);

  const onMoveEnd = useCallback(
    (nextViewport: Viewport) => {
      recordViewport(nextViewport, true);
    },
    [recordViewport]
  );

  useLayoutEffect(() => {
    if (loadedCanvasRef.current === canvasId) return;
    loadedCanvasRef.current = canvasId;
    canvasIdRef.current = canvasId;
    const nextNodes = prepareNodes(initialDocumentRef.current.nodes);
    const nextEdges = prepareEdges(initialDocumentRef.current.edges, nextNodes);
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
    const nextViewport =
      initialDocumentRef.current.viewport ?? { x: 0, y: 0, zoom: 1 };
    viewportRef.current = nextViewport;
    setViewport(nextViewport);
    revisionRef.current = initialDocumentRef.current.revision;
    selectedIdsRef.current = [];
    setSelectedCount(0);
    dragStartRef.current = null;
    dirtyRef.current = false;
    changeVersionRef.current += 1;
    setSaveStatus("saved");
    setHistoryVersion((value) => value + 1);
  }, [canvasId, setSaveStatus]);

  useEffect(() => {
    const documentData = initialDocumentRef.current;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const rf = reactFlowRef.current;
      if (documentData.viewport) {
        void rf.setViewport(documentData.viewport);
        viewportRef.current = documentData.viewport;
        setViewport(documentData.viewport);
        return;
      }
      if (!documentData.nodes.length) {
        const emptyViewport = { x: 0, y: 0, zoom: 1 };
        void rf.setViewport(emptyViewport);
        viewportRef.current = emptyViewport;
        setViewport(emptyViewport);
        return;
      }
      void rf
        .fitView({ padding: 0.26, duration: 0, maxZoom: 1 })
        .then(() => {
          if (cancelled) return;
          recordViewport(rf.getViewport(), true);
        });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [canvasId, recordViewport]);

  useEffect(() => {
    const unsubscribe = workspace.subscribe((change) => {
      if (change.kind !== "canvas" || change.canvasId !== canvasIdRef.current) return;
      if (dirtyRef.current) return;
      void workspace.refreshDocument(change.canvasId).then((documentData) => {
        if (
          !documentData ||
          dirtyRef.current ||
          canvasIdRef.current !== change.canvasId ||
          documentData.revision <= revisionRef.current
        ) {
          return;
        }
        revisionRef.current = documentData.revision;
        const nextNodes = prepareNodes(documentData.nodes);
        const nextEdges = prepareEdges(documentData.edges, nextNodes);
        applyState(nextNodes, nextEdges);
        historiesRef.current.set(change.canvasId, { past: [], future: [] });
        setHistoryVersion((value) => value + 1);
        setSaveStatus("saved");
      });
    });
    return unsubscribe;
  }, [applyState, setSaveStatus, workspace]);

  useEffect(() => {
    const flushOnHide = () => {
      if (document.visibilityState === "hidden" && dirtyRef.current) {
        void saveNowRef.current?.();
      }
    };
    const flushOnPageHide = () => {
      if (dirtyRef.current) void saveNowRef.current?.();
    };
    document.addEventListener("visibilitychange", flushOnHide);
    window.addEventListener("pagehide", flushOnPageHide);
    return () => {
      document.removeEventListener("visibilitychange", flushOnHide);
      window.removeEventListener("pagehide", flushOnPageHide);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

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
