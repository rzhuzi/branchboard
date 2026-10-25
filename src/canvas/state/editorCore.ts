import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useReactFlow, type Viewport } from "@xyflow/react";
import type {
  CanvasDocument,
  CanvasEdge,
  CanvasNode,
  CanvasSnapshot
} from "../../shared/types";
import type { SaveState } from "./EditorContext";
import {
  MAX_HISTORY,
  nowIso,
  prepareEdges,
  prepareNodes,
  sanitizeEdge,
  sanitizeNode,
  type HistoryEntry,
  type HistoryStacks
} from "./editorPure";

export function useEditorCore({
  canvasId,
  document: initialDocument
}: {
  canvasId: string;
  document: CanvasDocument;
}) {
  const reactFlow = useReactFlow<CanvasNode, CanvasEdge>();
  const reactFlowRef = useRef(reactFlow);
  reactFlowRef.current = reactFlow;

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

  return {
    canvasId,
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
    loadedCanvasRef,
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
    scheduleSave,
    markDirty,
    pushHistoryEntry,
    pushHistory
  };
}

export type EditorCore = ReturnType<typeof useEditorCore>;
