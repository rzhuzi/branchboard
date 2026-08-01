import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type NodeTypes,
  type OnSelectionChangeParams
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { setActivePrompt } from "../shared/browser";
import {
  fileToDataUrl,
  listInboxImages,
  removeInboxImages
} from "../shared/storage";
import type { CanvasTab } from "../shared/storage";
import {
  createWorkspaceSession,
  type WorkspaceSession,
  type WorkspaceView
} from "../shared/WorkspaceSession";
import { mergeCanvasSnapshots } from "../shared/workspaceMerge";
import type {
  CanvasEdge,
  CanvasNode,
  CanvasSnapshot,
  InboxImage,
  PromptNodeData
} from "../shared/types";
import {
  ExecutionSettingsProvider,
  useExecutionSettings
} from "./ExecutionSettingsContext";
import {
  ExecutionSessionProvider,
  useExecutionSession
} from "./ExecutionSessionContext";
import { ImageNode } from "./nodes/ImageNode";
import { PromptNode } from "./nodes/PromptNode";
import "./styles.css";

const nodeTypes: NodeTypes = {
  prompt: PromptNode,
  image: ImageNode
};

function newPromptNode(position = { x: 120, y: 140 }): CanvasNode {
  return {
    id: crypto.randomUUID(),
    type: "prompt",
    position,
    data: {
      kind: "prompt",
      title: "第一张图",
      prompt: "",
      createdAt: new Date().toISOString()
    } satisfies PromptNodeData
  };
}

function newCanvasSnapshot(): CanvasSnapshot {
  return {
    version: 1,
    nodes: [newPromptNode()],
    edges: [],
    updatedAt: new Date().toISOString()
  };
}

function relationshipLabel(
  nodes: CanvasNode[],
  edge: CanvasEdge
): string | undefined {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  if (source?.data.kind === "prompt" && target?.data.kind === "image") {
    return "生成结果";
  }
  if (source?.data.kind === "image" && target?.data.kind === "prompt") {
    return "参考图";
  }
  if (source?.data.kind === "prompt" && target?.data.kind === "prompt") {
    return "提示词分支";
  }
  return undefined;
}

function decorateEdges(
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): CanvasEdge[] {
  return edges.map((edge) => ({
    ...edge,
    label: edge.label || relationshipLabel(nodes, edge)
  }));
}

function integrateInbox(
  baseNodes: CanvasNode[],
  baseEdges: CanvasEdge[],
  inbox: InboxImage[]
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodes = [...baseNodes];
  const edges = [...baseEdges];

  for (const [index, image] of inbox.entries()) {
    const parent =
      nodes.find(
        (node) =>
          node.id === image.parentPromptId && node.data.kind === "prompt"
      ) ?? [...nodes].reverse().find((node) => node.data.kind === "prompt");
    const outgoingCount = parent
      ? edges.filter((edge) => edge.source === parent.id).length
      : 0;
    const imageId = `image-${image.id}`;
    if (nodes.some((node) => node.id === imageId)) continue;

    nodes.push({
      id: imageId,
      type: "image",
      position: image.position
        ? {
            x: image.position.x + index * 28,
            y: image.position.y + index * 28
          }
        : parent
          ? {
              x: parent.position.x + 430,
              y: parent.position.y + outgoingCount * 360
            }
          : { x: 560 + index * 40, y: 160 + index * 40 },
      data: {
        kind: "image",
        name: image.name,
        dataUrl: image.dataUrl,
        createdAt: image.createdAt
      }
    });

    if (parent) {
      edges.push({
        id: `edge-${parent.id}-${imageId}`,
        source: parent.id,
        target: imageId,
        type: "smoothstep",
        label: "生成结果"
      });
    }
  }

  return { nodes, edges };
}

async function distributeInbox(
  workspace: WorkspaceSession,
  canvases: CanvasTab[],
  activeCanvasId: string,
  activeSnapshot: CanvasSnapshot,
  inbox: InboxImage[]
): Promise<{
  activeSnapshot: CanvasSnapshot;
  inactiveResultCounts: Record<string, number>;
}> {
  if (!inbox.length) {
    return { activeSnapshot, inactiveResultCounts: {} };
  }

  const snapshots = new Map<string, CanvasSnapshot>([
    [activeCanvasId, activeSnapshot]
  ]);
  const grouped = new Map<string, InboxImage[]>();

  for (const image of inbox) {
    let targetCanvasId = canvases.some(
      (canvas) => canvas.id === image.canvasId
    )
      ? String(image.canvasId)
      : activeCanvasId;
    const parentPromptId = image.parentPromptId;

    if (
      parentPromptId &&
      !image.canvasId &&
      !activeSnapshot.nodes.some((node) => node.id === parentPromptId)
    ) {
      for (const canvas of canvases) {
        if (canvas.id === activeCanvasId) continue;
        let snapshot = snapshots.get(canvas.id);
        if (!snapshot) {
          snapshot =
            (await workspace.refreshCanvas(canvas.id)) ?? newCanvasSnapshot();
          snapshots.set(canvas.id, snapshot);
        }
        if (snapshot.nodes.some((node) => node.id === parentPromptId)) {
          targetCanvasId = canvas.id;
          break;
        }
      }
    }

    const current = grouped.get(targetCanvasId) ?? [];
    current.push(image);
    grouped.set(targetCanvasId, current);
  }

  const inactiveResultCounts: Record<string, number> = {};
  let nextActiveSnapshot = activeSnapshot;
  for (const [canvasId, images] of grouped) {
    const snapshot = snapshots.get(canvasId) ?? newCanvasSnapshot();
    const integrated = integrateInbox(snapshot.nodes, snapshot.edges, images);
    const nextSnapshot: CanvasSnapshot = {
      version: 1,
      nodes: integrated.nodes,
      edges: integrated.edges,
      updatedAt: new Date().toISOString()
    };
    const saved = await workspace.commit(canvasId, nextSnapshot);
    if (!saved.ok) throw new Error(saved.message);
    if (canvasId === activeCanvasId) {
      nextActiveSnapshot = saved.snapshot;
    } else {
      inactiveResultCounts[canvasId] = images.length;
    }
  }
  return { activeSnapshot: nextActiveSnapshot, inactiveResultCounts };
}

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "TEXTAREA" ||
    target.tagName === "INPUT" ||
    target.isContentEditable
  );
}

function imageUrlFromDataTransfer(transfer: DataTransfer): string {
  const html = transfer.getData("text/html");
  if (html) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const source = parsed.querySelector("img")?.getAttribute("src");
    if (source) return source;
  }

  const uri = transfer
    .getData("text/uri-list")
    .split(/\r?\n/)
    .find((line) => line && !line.startsWith("#"));
  if (uri) return uri;

  const text = transfer.getData("text/plain").trim();
  return /^(?:https?:|blob:|data:image\/)/i.test(text) ? text : "";
}

function CanvasWorkspace() {
  const workspace = useMemo(
    () =>
      createWorkspaceSession({
        createEmptySnapshot: newCanvasSnapshot
      }),
    []
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>([]);
  const [hydrated, setHydrated] = useState(false);
  const [saveState, setSaveState] = useState<
    "saved" | "saving" | "error"
  >("saved");
  const [saveError, setSaveError] = useState("");
  const [canvasTabs, setCanvasTabs] = useState<CanvasTab[]>([]);
  const [activeCanvasId, setActiveCanvasId] = useState("");
  const [canvasActionPending, setCanvasActionPending] = useState(false);
  const [editingCanvasId, setEditingCanvasId] = useState("");
  const [canvasTitleDraft, setCanvasTitleDraft] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [unreadResults, setUnreadResults] = useState<Record<string, number>>({});
  const selectedPromptId = useRef<string | null>(null);
  const nodesRef = useRef<CanvasNode[]>([]);
  const edgesRef = useRef<CanvasEdge[]>([]);
  const canvasTabsRef = useRef<CanvasTab[]>([]);
  const activeCanvasIdRef = useRef("");
  const remoteApplyingRef = useRef(false);
  const localDirtyRef = useRef(false);
  const editVersionRef = useRef(0);
  const saveLoopRef = useRef<Promise<void> | null>(null);
  const editingCanvasIdRef = useRef("");
  const dragDepthRef = useRef(0);
  const {
    screenToFlowPosition,
    fitView,
    getViewport,
    setViewport
  } = useReactFlow<CanvasNode, CanvasEdge>();
  const { mode, setMode, theme, setTheme } = useExecutionSettings();
  const {
    executions,
    setCurrentCanvasId,
    cancelPrompts
  } = useExecutionSession();

  const fitViewCrisp = useCallback(
    async (options: {
      padding: number;
      duration: number;
      maxZoom: number;
    }) => {
      await fitView(options);
      const viewport = getViewport();
      const zoom =
        Math.abs(viewport.zoom - 1) < 0.015
          ? 1
          : Math.round(viewport.zoom * 100) / 100;
      await setViewport(
        {
          x: Math.round(viewport.x),
          y: Math.round(viewport.y),
          zoom
        },
        { duration: 0 }
      );
    },
    [fitView, getViewport, setViewport]
  );

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    if (activeCanvasId) setCurrentCanvasId(activeCanvasId);
  }, [activeCanvasId, setCurrentCanvasId]);

  const applyInbox = useCallback(
    async (inbox: InboxImage[]) => {
      if (!inbox.length) return;
      const canvasId = activeCanvasIdRef.current;
      if (!canvasId) return;
      const routed = await distributeInbox(
        workspace,
        canvasTabsRef.current,
        canvasId,
        {
          version: 1,
          nodes: nodesRef.current,
          edges: edgesRef.current,
          updatedAt: new Date().toISOString()
        },
        inbox
      );
      setUnreadResults((current) => {
        const next = { ...current };
        for (const [targetId, count] of Object.entries(
          routed.inactiveResultCounts
        )) {
          next[targetId] = (next[targetId] ?? 0) + count;
        }
        return next;
      });
      if (activeCanvasIdRef.current === canvasId) {
        nodesRef.current = routed.activeSnapshot.nodes;
        edgesRef.current = routed.activeSnapshot.edges;
        setNodes(routed.activeSnapshot.nodes);
        setEdges(routed.activeSnapshot.edges);
        window.setTimeout(
          () =>
            void fitViewCrisp({ padding: 0.18, duration: 500, maxZoom: 1 }),
          40
        );
      }
    },
    [fitViewCrisp, setEdges, setNodes, workspace]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const view = await workspace.open();
        const baseNodes = view.snapshot.nodes.length
          ? view.snapshot.nodes
          : [newPromptNode()];
        const baseEdges = decorateEdges(baseNodes, view.snapshot.edges);
        const inbox = await listInboxImages();
        const routed = await distributeInbox(
          workspace,
          view.canvases,
          view.activeCanvasId,
          {
            version: 1,
            nodes: baseNodes,
            edges: baseEdges,
            updatedAt: view.snapshot.updatedAt
          },
          inbox
        );
        await removeInboxImages(inbox.map((image) => image.id));
        if (cancelled) return;
        canvasTabsRef.current = view.canvases;
        activeCanvasIdRef.current = view.activeCanvasId;
        nodesRef.current = routed.activeSnapshot.nodes;
        edgesRef.current = routed.activeSnapshot.edges;
        setCanvasTabs(view.canvases);
        setActiveCanvasId(view.activeCanvasId);
        setUnreadResults(routed.inactiveResultCounts);
        remoteApplyingRef.current = true;
        setNodes(routed.activeSnapshot.nodes);
        setEdges(routed.activeSnapshot.edges);
        setHydrated(true);
        setSaveState("saved");
        window.setTimeout(
          () =>
            void fitViewCrisp({ padding: 0.2, duration: 450, maxZoom: 1 }),
          80
        );
      } catch (error) {
        if (cancelled) return;
        setSaveState("error");
        setSaveError(
          error instanceof Error ? error.message : "无法打开本地画布"
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fitViewCrisp, setEdges, setNodes, workspace]);

  const flushCanvas = useCallback(
    (canvasId: string): Promise<void> => {
      if (saveLoopRef.current) return saveLoopRef.current;

      const run = async () => {
        while (
          activeCanvasIdRef.current === canvasId &&
          localDirtyRef.current
        ) {
          const versionAtStart = editVersionRef.current;
          const candidate: CanvasSnapshot = {
            version: 1,
            nodes: nodesRef.current,
            edges: edgesRef.current,
            updatedAt: new Date().toISOString()
          };
          const result = await workspace.commit(canvasId, candidate);
          if (activeCanvasIdRef.current !== canvasId) return;
          if (!result.ok) {
            setSaveState("error");
            setSaveError(result.message);
            return;
          }

          const unchanged =
            editVersionRef.current === versionAtStart;
          if (result.merged) {
            const current: CanvasSnapshot = {
              version: 1,
              nodes: nodesRef.current,
              edges: edgesRef.current,
              updatedAt: new Date().toISOString()
            };
            const combined = unchanged
              ? result.snapshot
              : mergeCanvasSnapshots(candidate, current, result.snapshot);
            remoteApplyingRef.current = true;
            nodesRef.current = combined.nodes;
            edgesRef.current = combined.edges;
            setNodes(combined.nodes);
            setEdges(combined.edges);
          }

          if (unchanged) {
            localDirtyRef.current = false;
            setSaveState("saved");
            setSaveError("");
            return;
          }
        }
      };

      const pending = run().finally(() => {
        if (saveLoopRef.current === pending) saveLoopRef.current = null;
      });
      saveLoopRef.current = pending;
      return pending;
    },
    [setEdges, setNodes, workspace]
  );

  useEffect(() => {
    if (!hydrated || !activeCanvasId) return;
    if (remoteApplyingRef.current) {
      remoteApplyingRef.current = false;
      return;
    }
    editVersionRef.current += 1;
    localDirtyRef.current = true;
    setSaveState("saving");
    setSaveError("");
    const canvasId = activeCanvasId;
    const timeout = window.setTimeout(() => {
      void flushCanvas(canvasId);
    }, 420);
    return () => window.clearTimeout(timeout);
  }, [activeCanvasId, edges, flushCanvas, hydrated, nodes]);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return;
    const listener = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "branchboard:inbox-updated"
      ) {
        void listInboxImages()
          .then(async (images) => {
            await applyInbox(images);
            await removeInboxImages(images.map((image) => image.id));
          })
          .catch((error) => {
            setSaveState("error");
            setSaveError(
              error instanceof Error ? error.message : "生成结果暂未写入画布"
            );
          });
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [applyInbox]);

  useEffect(() => {
    const handleParentMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (event.data?.type !== "branchboard:canvas-visible") return;
      window.setTimeout(
        () => void fitViewCrisp({ padding: 0.2, duration: 320, maxZoom: 1 }),
        40
      );
    };
    window.addEventListener("message", handleParentMessage);
    return () => window.removeEventListener("message", handleParentMessage);
  }, [fitViewCrisp]);

  const insertImages = useCallback(
    async (files: File[], dropPosition?: { x: number; y: number }) => {
      if (!files.length) return;
      const dataUrls = await Promise.all(files.map(fileToDataUrl));
      const currentNodes = nodesRef.current;
      const currentEdges = edgesRef.current;
      const parent =
        currentNodes.find(
          (node) =>
            node.id === selectedPromptId.current && node.data.kind === "prompt"
        ) ??
        [...currentNodes].reverse().find((node) => node.data.kind === "prompt");
      const outgoingCount = parent
        ? currentEdges.filter((edge) => edge.source === parent.id).length
        : 0;
      const addedNodes: CanvasNode[] = dataUrls.map((dataUrl, index) => ({
        id: crypto.randomUUID(),
        type: "image",
        position: dropPosition
          ? {
              x: dropPosition.x + index * 28,
              y: dropPosition.y + index * 28
            }
          : parent
            ? {
                x: parent.position.x + 430,
                y: parent.position.y + (outgoingCount + index) * 360
              }
            : { x: 520 + index * 40, y: 180 + index * 40 },
        data: {
          kind: "image",
          name: files[index]?.name || `粘贴图片 ${index + 1}`,
          dataUrl,
          createdAt: new Date().toISOString()
        }
      }));
      const addedEdges: CanvasEdge[] = parent
        ? addedNodes.map((node) => ({
            id: `edge-${parent.id}-${node.id}`,
            source: parent.id,
            target: node.id,
            type: "smoothstep",
            label: "生成结果"
          }))
        : [];
      setNodes((existing) => [...existing, ...addedNodes]);
      setEdges((existing) => [...existing, ...addedEdges]);
    },
    [setEdges, setNodes]
  );

  const handleCanvasDragEnter = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragActive(true);
    },
    []
  );

  const handleCanvasDragLeave = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragActive(false);
    },
    []
  );

  const handleCanvasDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    },
    []
  );

  const handleCanvasDrop = useCallback(
    async (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setDragActive(false);

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY
      });
      const files = Array.from(event.dataTransfer.files).filter((file) =>
        file.type.startsWith("image/")
      );
      if (files.length) {
        await insertImages(files, position);
        return;
      }

      const imageUrl = imageUrlFromDataTransfer(event.dataTransfer);
      if (!imageUrl) {
        setSaveState("error");
        setSaveError("拖入的内容没有可用图片");
        return;
      }

      const parentPromptId =
        selectedPromptId.current ??
        [...nodesRef.current]
          .reverse()
          .find((node) => node.data.kind === "prompt")?.id ??
        "";
      const embedded =
        new URLSearchParams(window.location.search).get("embedded"…494 tokens truncated…;
      node.data = { ...node.data, title: "粘贴的提示词", prompt: text };
      setNodes((existing) => [...existing, node]);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [insertImages, screenToFlowPosition, setNodes]);

  const addPrompt = () => {
    const position = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2
    });
    const node = newPromptNode(position);
    node.data = { ...node.data, title: "新提示词" };
    setNodes((existing) => [
      ...existing.map((item) => ({ ...item, selected: false })),
      { ...node, selected: true }
    ]);
  };

  const snapshotOfCurrentCanvas = useCallback(
    (): CanvasSnapshot => ({
      version: 1,
      nodes: nodesRef.current,
      edges: edgesRef.current,
      updatedAt: new Date().toISOString()
    }),
    []
  );

  const applyCanvasSnapshot = useCallback(
    (snapshot: CanvasSnapshot) => {
      const nextNodes = (
        snapshot.nodes.length ? snapshot.nodes : [newPromptNode()]
      ).map((node) => ({ ...node, selected: false }));
      const nextEdges = decorateEdges(nextNodes, snapshot.edges);
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      selectedPromptId.current = null;
      setNodes(nextNodes);
      setEdges(nextEdges);
      void setActivePrompt(null);
      window.setTimeout(
        () => void fitViewCrisp({ padding: 0.2, duration: 420, maxZoom: 1 }),
        40
      );
    },
    [fitViewCrisp, setEdges, setNodes]
  );

  const applyWorkspaceView = useCallback(
    (view: WorkspaceView) => {
      remoteApplyingRef.current = true;
      canvasTabsRef.current = view.canvases;
      activeCanvasIdRef.current = view.activeCanvasId;
      setCanvasTabs(view.canvases);
      setActiveCanvasId(view.activeCanvasId);
      setUnreadResults((current) => {
        const next = { ...current };
        delete next[view.activeCanvasId];
        return next;
      });
      applyCanvasSnapshot(view.snapshot);
    },
    [applyCanvasSnapshot]
  );

  const switchCanvas = useCallback(
    async (canvasId: string) => {
      const currentCanvasId = activeCanvasIdRef.current;
      if (
        canvasActionPending ||
        !currentCanvasId ||
        canvasId === currentCanvasId
      ) {
        return;
      }

      setCanvasActionPending(true);
      setSaveState("saving");
      setSaveError("");
      try {
        await saveLoopRef.current;
        const result = await workspace.selectCanvas(
          currentCanvasId,
          snapshotOfCurrentCanvas(),
          canvasId
        );
        if (!result.ok) {
          setSaveState("error");
          setSaveError(result.failure.message);
          return;
        }
        applyWorkspaceView(result.view);
        localDirtyRef.current = false;
        setSaveState("saved");
      } finally {
        setCanvasActionPending(false);
      }
    },
    [
      applyWorkspaceView,
      canvasActionPending,
      snapshotOfCurrentCanvas,
      workspace
    ]
  );

  const createCanvas = useCallback(async () => {
    if (canvasActionPending) return;
    setCanvasActionPending(true);
    setSaveState("saving");
    setSaveError("");
    try {
      await saveLoopRef.current;
      const currentCanvasId = activeCanvasIdRef.current;
      const result = await workspace.createCanvas(
        currentCanvasId,
        snapshotOfCurrentCanvas()
      );
      if (!result.ok) {
        setSaveState("error");
        setSaveError(result.failure.message);
        return;
      }
      applyWorkspaceView(result.view);
      localDirtyRef.current = false;
      setSaveState("saved");
    } finally {
      setCanvasActionPending(false);
    }
  }, [
    applyWorkspaceView,
    canvasActionPending,
    snapshotOfCurrentCanvas,
    workspace
  ]);

  const beginRenameCanvas = useCallback(
    (canvas: CanvasTab) => {
      if (canvasActionPending) return;
      editingCanvasIdRef.current = canvas.id;
      setCanvasTitleDraft(canvas.title);
      setEditingCanvasId(canvas.id);
    },
    [canvasActionPending]
  );

  const cancelRenameCanvas = useCallback(() => {
    editingCanvasIdRef.current = "";
    setEditingCanvasId("");
    setCanvasTitleDraft("");
  }, []);

  const commitRenameCanvas = useCallback(
    async (canvasId: string) => {
      if (editingCanvasIdRef.current !== canvasId) return;
      const title = canvasTitleDraft.trim();
      const previous = canvasTabsRef.current.find(
        (canvas) => canvas.id === canvasId
      );
      editingCanvasIdRef.current = "";
      setEditingCanvasId("");
      setCanvasTitleDraft("");
      if (!title || title === previous?.title) return;

      setCanvasActionPending(true);
      setSaveState("saving");
      setSaveError("");
      try {
        const result = await workspace.renameCanvas(canvasId, title);
        if (!result.ok) {
          setSaveState("error");
          setSaveError(result.failure.message);
          return;
        }
        canvasTabsRef.current = result.canvases;
        setCanvasTabs(result.canvases);
        setSaveState("saved");
      } finally {
        setCanvasActionPending(false);
      }
    },
    [canvasTitleDraft, workspace]
  );

  const deleteCanvas = useCallback(
    async (canvas: CanvasTab) => {
      if (canvasActionPending || canvasTabsRef.current.length <= 1) return;
      if (!window.confirm(`删除“${canvas.title}”？其中的节点和图片也会删除。`)) {
        return;
      }

      setCanvasActionPending(true);
      setSaveState("saving");
      setSaveError("");
      try {
        await saveLoopRef.current;
        const promptIds = Object.values(executions)
          .filter((execution) => execution.canvasId === canvas.id)
          .map((execution) => execution.promptId);
        cancelPrompts(promptIds);
        if (
          promptIds.length &&
          new URLSearchParams(window.location.search).get("embedded") === "1"
        ) {
          window.parent.postMessage(
            { type: "branchboard:cancel-execution", promptIds },
            "*"
          );
        }

        const result = await workspace.deleteCanvas(
          activeCanvasIdRef.current,
          snapshotOfCurrentCanvas(),
          canvas.id
        );
        if (!result.ok) {
          setSaveState("error");
          setSaveError(result.failure.message);
          return;
        }
        applyWorkspaceView(result.view);
        localDirtyRef.current = false;
        setUnreadResults((current) => {
          const next = { ...current };
          delete next[canvas.id];
          return next;
        });
        setSaveState("saved");
      } finally {
        setCanvasActionPending(false);
      }
    },
    [
      applyWorkspaceView,
      cancelPrompts,
      canvasActionPending,
      executions,
      snapshotOfCurrentCanvas,
      workspace
    ]
  );

  useEffect(
    () =>
      workspace.subscribe((change) => {
        void (async () => {
          if (change.kind === "registry") {
            const registry = await workspace.refreshRegistry();
            if (!registry) return;
            if (
              !registry.canvases.some(
                (canvas) => canvas.id === activeCanvasIdRef.current
              )
            ) {
              const view = await workspace.open();
              applyWorkspaceView(view);
              localDirtyRef.current = false;
              setSaveState("saved");
              setSaveError("");
              return;
            }
            canvasTabsRef.current = registry.canvases;
            setCanvasTabs(registry.canvases);
            return;
          }
          if (
            change.canvasId !== activeCanvasIdRef.current ||
            localDirtyRef.current
          ) {
            return;
          }
          const snapshot = await workspace.refreshCanvas(change.canvasId);
          if (
            !snapshot ||
            change.canvasId !== activeCanvasIdRef.current ||
            localDirtyRef.current
          ) {
            return;
          }
          remoteApplyingRef.current = true;
          applyCanvasSnapshot(snapshot);
          setSaveState("saved");
          setSaveError("");
        })();
      }),
    [applyCanvasSnapshot, applyWorkspaceView, workspace]
  );

  const handleSelectionChange = ({
    nodes: selectedNodes
  }: OnSelectionChangeParams<CanvasNode, CanvasEdge>) => {
    const prompt = selectedNodes.find((node) => node.data.kind === "prompt");
    selectedPromptId.current = prompt?.id ?? null;
    if (prompt && prompt.data.kind === "prompt") {
      void setActivePrompt({
        id: prompt.id,
        title: prompt.data.title,
        prompt: prompt.data.prompt
      });
    }
  };

  const minimapColor = useCallback(
    (_node: CanvasNode) => "#e9783e",
    []
  );

  const defaultEdgeOptions = useMemo(
    () => ({
      style: {
        stroke: theme === "light" ? "#b8c0c7" : "#34414d",
        strokeWidth: 1.6
      },
      animated: false
    }),
    [theme]
  );

  const executionToneByCanvas = useMemo(() => {
    const tones: Record<string, "working" | "error" | "done"> = {};
    const priority = { done: 1, error: 2, working: 3 };
    for (const execution of Object.values(executions)) {
      const current = tones[execution.canvasId];
      if (!current || priority[execution.tone] > priority[current]) {
        tones[execution.canvasId] = execution.tone;
      }
    }
    return tones;
  }, [executions]);

  const handleNodesDelete = useCallback((deletedNodes: CanvasNode[]) => {
    const promptIds = deletedNodes
      .filter((node) => node.data.kind === "prompt")
      .map((node) => node.id);
    if (!promptIds.length) return;
    cancelPrompts(promptIds);
    if (promptIds.includes(selectedPromptId.current || "")) {
      selectedPromptId.current = null;
      void setActivePrompt(null);
    }
    if (
      new URLSearchParams(window.location.search).get("embedded") === "1"
    ) {
      window.parent.postMessage(
        {
          type: "branchboard:cancel-execution",
          promptIds
        },
        "*"
      );
    }
  }, [cancelPrompts]);

  return (
    <main className="canvas-shell">
      <div className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <path d="M7.5 12V7.5H12M20 7.5h4.5V12M24.5 20v4.5H20M12 24.5H7.5V20" />
              <path d="m10.5 11.5 5 4.5 6-5M15.5 16v5" />
              <circle cx="10.5" cy="11.5" r="2.35" />
              <circle cx="21.5" cy="11" r="2.35" />
              <circle cx="15.5" cy="21" r="2.35" />
            </svg>
          </span>
          <div>
            <strong>分支画布</strong>
            <span>BRANCHBOARD</span>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="mode-switch" role="group" aria-label="工作模式">
            <button
              type="button"
              className={mode === "manual" ? "active" : ""}
              onClick={() => setMode("manual")}
            >
              标注模式
            </button>
            <button
              type="button"
              className={mode === "auto" ? "active script" : "script"}
              onClick={() => setMode("auto")}
            >
              自动
            </button>
          </div>
          <span className={`save-state ${saveState}`}>
            <i />
            {saveState === "saved"
              ? "已保存到本地"
              : saveState === "saving"
                ? "正在保存"
                : "保存失败"}
          </span>
          <span className="paste-hint">
            <kbd>Ctrl</kbd>
            <b>+</b>
            <kbd>V</kbd>
            粘贴图片
          </span>
          <button
            className="theme-toggle"
            type="button"
            aria-pressed={theme === "light"}
            title={theme === "light" ? "切换到深色模式" : "切换到白色模式"}
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            <span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span>
            {theme === "light" ? "深色模式" : "白色模式"}
          </button>
          <button className="toolbar-button" type="button" onClick={addPrompt}>
            <span>＋</span>
            新建提示词
          </button>
        </div>
      </div>

      <nav className="canvas-tabs" aria-label="画布标签">
        <div className="canvas-tabs-scroll">
          {canvasTabs.map((canvas, index) => {
            const isActive = canvas.id === activeCanvasId;
            return (
              <div
                key={canvas.id}
                className={`canvas-tab${isActive ? " active" : ""}${
                  editingCanvasId === canvas.id ? " editing" : ""
                }`}
              >
                {editingCanvasId === canvas.id ? (
                  <input
                    className="canvas-tab-input"
                    aria-label="画布名称"
                    value={canvasTitleDraft}
                    maxLength={40}
                    autoFocus
                    onChange={(event) => setCanvasTitleDraft(event.target.value)}
                    onBlur={() => void commitRenameCanvas(canvas.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitRenameCanvas(canvas.id);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelRenameCanvas();
                      }
                    }}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      className="canvas-tab-select"
                      aria-pressed={isActive}
                      title="双击改名"
                      disabled={canvasActionPending}
                      onClick={() => void switchCanvas(canvas.id)}
                      onDoubleClick={() => beginRenameCanvas(canvas)}
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{canvas.title}</strong>
                      {executionToneByCanvas[canvas.id] ? (
                        <i
                          className={`tab-activity ${executionToneByCanvas[canvas.id]}`}
                          aria-label={
                            executionToneByCanvas[canvas.id] === "working"
                              ? "正在运行"
                              : executionToneByCanvas[canvas.id] === "error"
                                ? "运行失败"
                                : "运行完成"
                          }
                        >
                          {executionToneByCanvas[canvas.id] === "working"
                            ? "●"
                            : executionToneByCanvas[canvas.id] === "error"
                              ? "!"
                              : "✓"}
                        </i>
                      ) : unreadResults[canvas.id] ? (
                        <i aria-label={`${unreadResults[canvas.id]} 个新结果`}>
                          {unreadResults[canvas.id]}
                        </i>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="canvas-tab-rename"
                      aria-label={`重命名${canvas.title}`}
                      title="重命名画布"
                      disabled={canvasActionPending}
                      onClick={() => beginRenameCanvas(canvas)}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="canvas-tab-delete"
                      aria-label={`删除${canvas.title}`}
                      title={
                        canvasTabs.length <= 1
                          ? "至少保留一个画布"
                          : "删除画布"
                      }
                      disabled={canvasActionPending || canvasTabs.length <= 1}
                      onClick={() => void deleteCanvas(canvas)}
                    >
                      ×
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="canvas-tab-add"
          aria-label="新建画布"
          title="新建画布"
          disabled={canvasActionPending}
          onClick={() => void createCanvas()}
        >
          ＋
        </button>
      </nav>

      {saveState === "error" ? (
        <div className="save-error-banner" role="alert">
          <span>{saveError || "当前修改尚未保存"}</span>
          <button
            type="button"
            onClick={() =>
              setNodes((current) => current.map((node) => ({ ...node })))
            }
          >
            重试
          </button>
        </div>
      ) : null}

      <div
        className={`flow-region${dragActive ? " drag-active" : ""}`}
        onDragEnter={handleCanvasDragEnter}
        onDragLeave={handleCanvasDragLeave}
        onDragOver={handleCanvasDragOver}
        onDrop={(event) => void handleCanvasDrop(event)}
      >
        <ReactFlow<CanvasNode, CanvasEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodesDelete={handleNodesDelete}
          onSelectionChange={handleSelectionChange}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={0.12}
          maxZoom={2}
          selectionOnDrag
          nodesConnectable={false}
          panOnScroll={false}
          zoomOnScroll
          deleteKeyCode={["Backspace", "Delete"]}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={0.75}
            color={
              theme === "light"
                ? "rgba(70, 81, 92, 0.13)"
                : "rgba(135, 148, 161, 0.12)"
            }
          />
          <MiniMap
            nodeColor={minimapColor}
            nodeStrokeWidth={0}
            maskColor={
              theme === "light"
                ? "rgba(225, 220, 213, 0.88)"
                : "rgba(21, 29, 37, 0.88)"
            }
            pannable
            zoomable
          />
          <Controls showInteractive={false} />
        </ReactFlow>
        <div className="canvas-drop-overlay" role="status" aria-live="polite">
          <span>＋</span>
          <strong>松开以加入图片</strong>
          <small>支持电脑文件和 ChatGPT 生成图</small>
        </div>
      </div>

      <aside className="canvas-note">
        <span>01</span>
        {mode === "auto" ? (
          <p>
            发送后会留在画布中等待 ChatGPT，
            <br />
            生成图片完成后自动回到当前节点。
          </p>
        ) : (
          <p>
            选择一个提示词节点后粘贴图片，
            <br />
            结果会自动接到它的下一层。
          </p>
        )}
      </aside>
    </main>
  );
}

export function CanvasApp() {
  return (
    <ExecutionSettingsProvider>
      <ExecutionSessionProvider>
        <ReactFlowProvider>
          <CanvasWorkspace />
        </ReactFlowProvider>
      </ExecutionSessionProvider>
    </ExecutionSettingsProvider>
  );
}

