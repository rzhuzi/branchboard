import { useCallback } from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange
} from "@xyflow/react";
import {
  estimateNodeSize,
  findFreePosition,
  placeChild,
  placeIncoming,
  type Point
} from "../../shared/placement";
import type {
  CanvasEdge,
  CanvasNode,
  PromptNodeData,
  RelationKind
} from "../../shared/types";
import type { ToastOptions } from "./ToastProvider";
import {
  nowIso,
  relationForConnection,
  savedEdgeId
} from "./editorPure";
import type { EditorCore } from "./editorCore";
import type { ViewportApi } from "./useEditorViewport";

export function useEditorNodes(
  core: EditorCore,
  viewport: Pick<ViewportApi, "focusPrompt" | "clampToVisible" | "canvasCenterFlow">,
  externals: {
    cancelPrompt: (promptId: string) => void;
    pushToast: (message: string, options?: ToastOptions) => void;
  }
) {
  const {
    applyState,
    dragStartRef,
    edgesRef,
    markDirty,
    nodesRef,
    pushHistory,
    selectedIdsRef,
    setEdges,
    setNodes,
    setSelectedCount,
    undoRef
  } = core;
  const { focusPrompt, clampToVisible, canvasCenterFlow } = viewport;
  const { cancelPrompt, pushToast } = externals;

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

  return {
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
  };
}

export type NodesApi = ReturnType<typeof useEditorNodes>;
