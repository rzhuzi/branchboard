import { useCallback, useEffect } from "react";
import type { Viewport } from "@xyflow/react";
import { getViewport } from "../../shared/db";
import { clamp, zoomAtPoint } from "../../shared/geometry";
import { measuredNodeSize, type Point } from "../../shared/placement";
import type { CanvasNode } from "../../shared/types";
import type { EditorCore } from "./editorCore";

export function useEditorViewport(core: EditorCore) {
  const {
    applyState,
    canvasId,
    edgesRef,
    initialDocumentRef,
    markViewportDirty,
    nodesRef,
    reactFlowRef,
    selectedIdsRef,
    setSelectedCount,
    setViewport,
    viewportRef,
    viewportVersionRef
  } = core;

  const recordViewport = useCallback(
    (nextViewport: Viewport) => {
      const rounded: Viewport = {
        x: Math.round(nextViewport.x),
        y: Math.round(nextViewport.y),
        zoom: Math.round(nextViewport.zoom * 1000) / 1000
      };
      viewportRef.current = rounded;
      setViewport(rounded);
      markViewportDirty();
    },
    [markViewportDirty]
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
        markViewportDirty();
      }
    },
    [canvasRect, markViewportDirty]
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
        .then(() => recordViewport(rf.getViewport()));
    },
    [applyState, recordViewport]
  );

  const fitAll = useCallback(() => {
    const rf = reactFlowRef.current;
    void rf
      .fitView({ padding: 0.24, duration: 300, maxZoom: 1 })
      .then(() => recordViewport(rf.getViewport()));
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
      markViewportDirty();
    },
    [canvasRect, markViewportDirty]
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
      markViewportDirty();
    },
    [canvasRect, markViewportDirty]
  );

  const applyViewport = useCallback(
    (next: Viewport) => {
      void reactFlowRef.current.setViewport(next);
      viewportRef.current = next;
      setViewport(next);
      markViewportDirty();
    },
    [markViewportDirty]
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
    updateSelection(
      nodesRef.current.map((node) => ({ ...node, selected: true })),
      edgesRef.current.map((edge) => ({ ...edge, selected: true }))
    );
  }, [updateSelection]);

  const clearSelection = useCallback(() => {
    updateSelection(
      nodesRef.current.map((node) => ({ ...node, selected: false })),
      edgesRef.current.map((edge) => ({ ...edge, selected: false }))
    );
  }, [updateSelection]);

  const onMoveEnd = useCallback(
    (nextViewport: Viewport) => {
      recordViewport(nextViewport);
    },
    [recordViewport]
  );

  useEffect(() => {
    const documentData = initialDocumentRef.current;
    const versionAtStart = viewportVersionRef.current;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      void (async () => {
        const rf = reactFlowRef.current;
        let stored: Viewport | null = documentData.viewport;
        try {
          const record = await getViewport(canvasId);
          if (record) stored = record;
        } catch {
          // Fall back to the viewport embedded in the document snapshot.
        }
        if (cancelled || viewportVersionRef.current !== versionAtStart) return;
        if (stored) {
          void rf.setViewport(stored);
          viewportRef.current = stored;
          setViewport(stored);
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
            recordViewport(rf.getViewport());
          });
      })();
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [canvasId, recordViewport]);

  return {
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
  };
}

export type ViewportApi = ReturnType<typeof useEditorViewport>;
