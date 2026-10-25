import { useCallback } from "react";
import type { CanvasNode } from "../../shared/types";
import {
  positionsChanged,
  prepareNodes,
  sanitizeEdge,
  sanitizeNode,
  type HistoryEntry
} from "./editorPure";
import type { EditorCore } from "./editorCore";

export function useEditorHistory(
  core: EditorCore,
  externals: { cancelPrompt: (promptId: string) => void }
) {
  const {
    applyState,
    canvasIdRef,
    dragStartRef,
    edgesRef,
    historiesRef,
    markDirty,
    nodesRef,
    pushHistoryEntry,
    selectedIdsRef,
    setHistoryVersion,
    setSelectedCount,
    undoRef
  } = core;
  const { cancelPrompt } = externals;

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

  const forgetCanvas = useCallback((targetCanvasId: string) => {
    historiesRef.current.delete(targetCanvasId);
    setHistoryVersion((value) => value + 1);
  }, []);

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

  return { undo, redo, forgetCanvas, onNodeDragStart, onNodeDragStop };
}
