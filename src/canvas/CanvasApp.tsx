import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
      position: parent
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
  const { screenToFlowPosition, fitView } = useReactFlow<CanvasNode, CanvasEdge>();
  const { mode, setMode } = useExecutionSettings();
  const {
    executions,
    setCurrentCanvasId,
    cancelPrompts
  } = useExecutionSession();

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
          () => void fitView({ padding: 0.18, duration: 500, maxZoom: 1 }),
          40
        );
      }
    },
    [fitView, setEdges, setNodes, workspace]
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
          () => void fitView({ padding: 0.2, duration: 450, maxZoom: 1 }),
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
  }, [fitView, setEdges, setNodes, workspace]);

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
        () => void fitView({ padding: 0.2, duration: 320, maxZoom: 1 }),
        40
      );
    };
    window.addEventListener("message", handleParentMessage);
    return () => window.removeEventListener("message", handleParentMessage);
  }, [fitView]);

  const insertImages = useCallback(
    async (files: File[]) => {
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
        position: parent
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

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const imageFiles = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));

      if (imageFiles.length) {
        event.preventDefault();
        void insertImages(imageFiles);
        return;
      }

      if (isTextInput(event.target)) return;
      const text = event.clipboardData?.getData("text/plain").trim();
      if (!text) return;
      event.preventDefault();
      const position = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2
      });
      const node = newPromptNode(position);
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
        () => void fitView({ padding: 0.2, duration: 420, maxZoom: 1 }),
        40
      );
    },
    [fitView, setEdges, setNodes]
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

  useEffect(
    () =>
      workspace.subscribe((change) => {
        void (async () => {
          if (change.kind === "registry") {
            const registry = await workspace.refreshRegistry();
            if (!registry) return;
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
    [applyCanvasSnapshot, workspace]
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
    (node: CanvasNode) => (node.data.kind === "prompt" ? "#ff6b35" : "#f0dfbf"),
    []
  );

  const defaultEdgeOptions = useMemo(
    () => ({
      style: { stroke: "#887e6d", strokeWidth: 1.6 },
      animated: false
    }),
    []
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
          <span className="brand-mark">B</span>
          <div>
            <strong>Branchboard</strong>
            <span>GPT WEB IMAGE WORKSPACE</span>
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
          <button className="toolbar-button" type="button" onClick={addPrompt}>
            <span>＋</span>
            新建提示词
          </button>
        </div>
      </div>

      <nav className="canvas-tabs" aria-label="画布标签">
        <div className="canvas-tabs-scroll">
          {canvasTabs.map((canvas, index) => (
            <button
              key={canvas.id}
              type="button"
              className={canvas.id === activeCanvasId ? "active" : ""}
              aria-pressed={canvas.id === activeCanvasId}
              disabled={canvasActionPending}
              onClick={() => void switchCanvas(canvas.id)}
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
          ))}
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

      <div className="flow-region">
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
          panOnScroll
          deleteKeyCode={["Backspace", "Delete"]}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1}
            color="#3b3c35"
          />
          <MiniMap
            nodeColor={minimapColor}
            nodeStrokeWidth={0}
            maskColor="rgba(19, 20, 17, 0.7)"
            pannable
            zoomable
          />
          <Controls showInteractive={false} />
        </ReactFlow>
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

