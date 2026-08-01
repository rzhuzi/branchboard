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
      title: "ç¬¬ä¸€å¼ å›¾",
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
    return "ç”Ÿæˆç»“æžœ";
  }
  if (source?.data.kind === "image" && target?.data.kind === "prompt") {
    return "å‚è€ƒå›¾";
  }
  if (source?.data.kind === "prompt" && target?.data.kind === "prompt") {
    return "æç¤ºè¯åˆ†æ”¯";
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
        label: "ç”Ÿæˆç»“æžœ"
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
          error instanceof Error ? error.message : "æ— æ³•æ‰“å¼€æœ¬åœ°ç”»å¸ƒ"
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
      void flushCanvas(canvasId)ßßw¶‰žËkºwµçUÍÕ±Ð¹™…¥±ÕÉ”¹µ•ÍÍ…”¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô(€€€€€€€…¹Ù…ÍQ…‰ÍI•˜¹ÕÉÉ•¹Ð€ôÉ•ÍÕ±Ð¹…¹Ù…Í•Ìì(€€€€€€€Í•Ñ…¹Ù…ÍQ…‰Ì¡É•ÍÕ±Ð¹…¹Ù…Í•Ì¤ì(€€€€€€€Í•ÑM…Ù•MÑ…Ñ” ‰Í…Ù•ˆ¤ì(€€€€€ô™¥¹…±±äì(€€€€€€€Í•Ñ…¹Ù…ÍÑ¥½¹A•¹‘¥¹œ¡™…±Í”¤ì(€€€€€ô(€€€ô°(€€€m…¹Ù…ÍQ¥Ñ±•É…™Ð°Ý½É­ÍÁ…•t(€€¤ì((€½¹ÍÐ‘•±•Ñ•…¹Ù…Ì€ôÕÍ•…±±‰…¬ (€€€…Íå¹Œ€¡…¹Ù…Ìè…¹Ù…ÍQ…ˆ¤€ôøì(€€€€€¥˜€¡…¹Ù…ÍÑ¥½¹A•¹‘¥¹œñð…¹Ù…ÍQ…‰ÍI•˜¹ÕÉÉ•¹Ð¹±•¹Ñ €ðô€Ä¤É•ÑÕÉ¸ì(€€€€€¥˜€ …Ý¥¹‘½Ü¹½¹™¥É´¡ƒ–"ƒ¦f“Šp‘í…¹Ù…Ì¹Ñ¥Ñ±•÷Šw¾ò–Û’â·žj¢*ž
ç–J3–nûž&’æ’òk–"ƒ¦f“Ž	€¤¤ì(€€€€€€€É•ÑÕÉ¸ì(€€€€€ô((€€€€€Í•Ñ…¹Ù…ÍÑ¥½¹A•¹‘¥¹œ¡ÑÉÕ”¤ì(€€€€€Í•ÑM…Ù•MÑ…Ñ” ‰Í…Ù¥¹œˆ¤ì(€€€€€Í•ÑM…Ù•ÉÉ½È ˆˆ¤ì(€€€€€ÑÉäì(€€€€€€€…Ý…¥ÐÍ…Ù•1½½ÁI•˜¹ÕÉÉ•¹Ðì(€€€€€€€½¹ÍÐÁÉ½µÁÑ%‘Ì€ô=‰©•Ð¹Ù…±Õ•Ì¡•á•ÕÑ¥½¹Ì¤(€€€€€€€€€€¹™¥±Ñ•È ¡•á•ÕÑ¥½¸¤€ôø•á•ÕÑ¥½¸¹…¹Ù…Í%€ôôô…¹Ù…Ì¹¥¤(€€€€€€€€€€¹µ…À ¡•á•ÕÑ¥½¸¤€ôø•á•ÕÑ¥½¸¹ÁÉ½µÁÑ%¤ì(€€€€€€€…¹•±AÉ½µÁÑÌ¡ÁÉ½µÁÑ%‘Ì¤ì(€€€€€€€¥˜€ (€€€€€€€€€ÁÉ½µÁÑ%‘Ì¹±•¹Ñ €˜˜(€€€€€€€€€¹•ÜUI1M•…É¡A…É…µÌ¡Ý¥¹‘½Ü¹±½…Ñ¥½¸¹Í•…É ¤¹•Ð ‰•µ‰•‘‘•ˆ¤€ôôô€ˆÄˆ(€€€€€€€€¤ì(€€€€€€€€€Ý¥¹‘½Ü¹Á…É•¹Ð¹Á½ÍÑ5•ÍÍ…” (€€€€€€€€€€€ìÑåÁ”è€‰‰É…¹¡‰½…Éé…¹•°µ•á•ÕÑ¥½¸ˆ°ÁÉ½µÁÑ%‘Ìô°(€€€€€€€€€€€€ˆ¨ˆ(€€€€€€€€€€¤ì(€€€€€€€ô((€€€€€€€½¹ÍÐÉ•ÍÕ±Ð€ô…Ý…¥ÐÝ½É­ÍÁ…”¹‘•±•Ñ•…¹Ù…Ì (€€€€€€€€€…Ñ¥Ù•…¹Ù…Í%‘I•˜¹ÕÉÉ•¹Ð°(€€€€€€€€€Í¹…ÁÍ¡½Ñ=™ÕÉÉ•¹Ñ…¹Ù…Ì ¤°(€€€€€€€€€…¹Ù…Ì¹¥(€€€€€€€€¤ì(€€€€€€€¥˜€ …É•ÍÕ±Ð¹½¬¤ì(€€€€€€€€€Í•ÑM…Ù•MÑ…Ñ” ‰•ÉÉ½Èˆ¤ì(€€€€€€€€€Í•ÑM…Ù•ÉÉ½È¡É•ÍÕ±Ð¹™…¥±ÕÉ”¹µ•ÍÍ…”¤ì(€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€ô(€€€€€€€…ÁÁ±å]½É­ÍÁ…•Y¥•Ü¡É•ÍÕ±Ð¹Ù¥•Ü¤ì(€€€€€€€±½…±¥ÉÑåI•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì(€€€€€€€Í•ÑU¹É•…‘I•ÍÕ±ÑÌ ¡ÕÉÉ•¹Ð¤€ôøì(€€€€€€€€€½¹ÍÐ¹•áÐ€ôì€¸¸¹ÕÉÉ•¹Ðôì(€€€€€€€€€‘•±•Ñ”¹•áÑm…¹Ù…Ì¹¥‘tì(€€€€€€€€€É•ÑÕÉ¸¹•áÐì(€€€€€€€ô¤ì(€€€€€€€Í•ÑM…Ù•MÑ…Ñ” ‰Í…Ù•ˆ¤ì(€€€€€ô™¥¹…±±äì(€€€€€€€Í•Ñ…¹Ù…ÍÑ¥½¹A•¹‘¥¹œ¡™…±Í”¤ì(€€€€€ô(€€€ô°(€€€l(€€€€€…ÁÁ±å]½É­ÍÁ…•Y¥•Ü°(€€€€€…¹•±AÉ½µÁÑÌ°(€€€€€…¹Ù…ÍÑ¥½¹A•¹‘¥¹œ°(€€€€€•á•ÕÑ¥½¹Ì°(€€€€€Í¹…ÁÍ¡½Ñ=™ÕÉÉ•¹Ñ…¹Ù…Ì°(€€€€€Ý½É­ÍÁ…”(€€€t(€€¤ì((€ÕÍ•™™•Ð (€€€€ ¤€ôø(€€€€€Ý½É­ÍÁ…”¹ÍÕ‰ÍÉ¥‰” ¡¡…¹”¤€ôøì(€€€€€€€Ù½¥€¡…Íå¹Œ€ ¤€ôøì(€€€€€€€€€¥˜€¡¡…¹”¹­¥¹€ôôô€‰É•¥ÍÑÉäˆ¤ì(€€€€€€€€€€€½¹ÍÐÉ•¥ÍÑÉä€ô…Ý…¥ÐÝ½É­ÍÁ…”¹É•™É•Í¡I•¥ÍÑÉä ¤ì(€€€€€€€€€€€¥˜€ …É•¥ÍÑÉä¤É•ÑÕÉ¸ì(€€€€€€€€€€€¥˜€ (€€€€€€€€€€€€€€…É•¥ÍÑÉä¹…¹Ù…Í•Ì¹Í½µ” (€€€€€€€€€€€€€€€€¡…¹Ù…Ì¤€ôø…¹Ù…Ì¹¥€ôôô…Ñ¥Ù•…¹Ù…Í%‘I•˜¹ÕÉÉ•¹Ð(€€€€€€€€€€€€€€¤(€€€€€€€€€€€€¤ì(€€€€€€€€€€€€€½¹ÍÐÙ¥•Ü€ô…Ý…¥ÐÝ½É­ÍÁ…”¹½Á•¸ ¤ì(€€€€€€€€€€€€€…ÁÁ±å]½É­ÍÁ…•Y¥•Ü¡Ù¥•Ü¤ì(€€€€€€€€€€€€€±½…±¥ÉÑåI•˜¹ÕÉÉ•¹Ð€ô™…±Í”ì(€€€€€€€€€€€€€Í•ÑM…Ù•MÑ…Ñ” ‰Í…Ù•ˆ¤ì(€€€€€€€€€€€€€Í•ÑM…Ù•ÉÉ½È ˆˆ¤ì(€€€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€€€ô(€€€€€€€€€€€…¹Ù…ÍQ…‰ÍI•˜¹ÕÉÉ•¹Ð€ôÉ•¥ÍÑÉä¹…¹Ù…Í•Ìì(€€€€€€€€€€€Í•Ñ…¹Ù…ÍQ…‰Ì¡É•¥ÍÑÉä¹…¹Ù…Í•Ì¤ì(€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€ô(€€€€€€€€€¥˜€ (€€€€€€€€€€€¡…¹”¹…¹Ù…Í%€„ôô…Ñ¥Ù•…¹Ù…Í%‘I•˜¹ÕÉÉ•¹Ðñð(€€€€€€€€€€€±½…±¥ÉÑåI•˜¹ÕÉÉ•¹Ð(€€€€€€€€€€¤ì(€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€ô(€€€€€€€€€½¹ÍÐÍ¹…ÁÍ¡½Ð€ô…Ý…¥ÐÝ½É­ÍÁ…”¹É•™É•Í¡…¹Ù…Ì¡¡…¹”¹…¹Ù…Í%¤ì(€€€€€€€€€¥˜€ (€€€€€€€€€€€€…Í¹…ÁÍ¡½Ðñð(€€€€€€€€€€€¡…¹”¹…¹Ù…Í%€„ôô…Ñ¥Ù•…¹Ù…Í%‘I•˜¹ÕÉÉ•¹Ðñð(€€€€€€€€€€€±½…±¥ÉÑåI•˜¹ÕÉÉ•¹Ð(€€€€€€€€€€¤ì(€€€€€€€€€€€É•ÑÕÉ¸ì(€€€€€€€€€ô(€€€€€€€€€É•µ½Ñ•ÁÁ±å¥¹I•˜¹ÕÉÉ•¹Ð€ôÑÉÕ”ì(€€€€€€€€€…ÁÁ±å…¹Ù…ÍM¹…ÁÍ¡½Ð¡Í¹…ÁÍ¡½Ð¤ì(€€€€€€€€€Í•ÑM…Ù•MÑ…Ñ” ‰Í…Ù•ˆ¤ì(€€€€€€€€€Í•ÑM…Ù•ÉÉ½È ˆˆ¤ì(€€€€€€€ô¤ ¤ì(€€€€€ô¤°(€€€m…ÁÁ±å…¹Ù…ÍM¹…ÁÍ¡½Ð°…ÁÁ±å]½É­ÍÁ…•Y¥•Ü°Ý½É­ÍÁ…•t(€€¤ì((€½¹ÍÐ¡…¹‘±•M•±•Ñ¥½¹¡…¹”€ô€¡ì(€€€¹½‘•ÌèÍ•±•Ñ•‘9½‘•Ì(€ôè=¹M•±•Ñ¥½¹¡…¹•A…É…µÌñ…¹Ù…Í9½‘”°…¹Ù…Í‘”ø¤€ôøì(€€€½¹ÍÐÁÉ½µÁÐ€ôÍ•±•Ñ•‘9½‘•Ì¹™¥¹ ¡¹½‘”¤€ôø¹½‘”¹‘…Ñ„¹­¥¹€ôôô€‰ÁÉ½µÁÐˆ¤ì(€€€Í•±•Ñ•‘AÉ½µÁÑ%¹ÕÉÉ•¹Ð€ôÁÉ½µÁÐü¹¥€üü¹Õ±°ì(€€€¥˜€¡ÁÉ½µÁÐ€˜˜ÁÉ½µÁÐ¹‘…Ñ„¹­¥¹€ôôô€‰ÁÉ½µÁÐˆ¤ì(€€€€€Ù½¥Í•ÑÑ¥Ù•AÉ½µÁÐ¡ì(€€€€€€€¥èÁÉ½µÁÐ¹¥°(€€€€€€€Ñ¥Ñ±”èÁÉ½µÁÐ¹‘…Ñ„¹Ñ¥Ñ±”°(€€€€€€€ÁÉ½µÁÐèÁÉ½µÁÐ¹‘…Ñ„¹ÁÉ½µÁÐ(€€€€€ô¤ì(€€€ô(€ôì((€½¹ÍÐµ¥¹¥µ…Á½±½È€ôÕÍ•…±±‰…¬ (€€€€¡}¹½‘”è…¹Ù…Í9½‘”¤€ôø€ˆ”äÜàÍ”ˆ°(€€€mt(€€¤ì((€½¹ÍÐ‘•™…Õ±Ñ‘•=ÁÑ¥½¹Ì€ôÕÍ•5•µ¼ (€€€€ ¤€ôø€¡ì(€€€€€ÍÑå±”èì(€€€€€€€ÍÑÉ½­”èÑ¡•µ”€ôôô€‰±¥¡Ðˆ€ü€ˆˆáŒÁŒÜˆ€è€ˆŒÌÐÐÄÑˆ°(€€€€€€€ÍÑÉ½­•]¥‘Ñ è€Ä¸Ø(€€€€€ô°(€€€€€…¹¥µ…Ñ•è™…±Í”(€€€ô¤°(€€€mÑ¡•µ•t(€€¤ì((€½¹ÍÐ•á•ÕÑ¥½¹Q½¹•	å…¹Ù…Ì€ôÕÍ•5•µ¼  ¤€ôøì(€€€½¹ÍÐÑ½¹•ÌèI•½ÉñÍÑÉ¥¹œ°€‰Ý½É­¥¹œˆð€‰•ÉÉ½Èˆð€‰‘½¹”ˆø€ôíôì(€€€½¹ÍÐÁÉ¥½É¥Ñä€ôì‘½¹”è€Ä°•ÉÉ½Èè€È°Ý½É­¥¹œè€Ìôì(€€€™½È€¡½¹ÍÐ•á•ÕÑ¥½¸½˜=‰©•Ð¹Ù…±Õ•Ì¡•á•ÕÑ¥½¹Ì¤¤ì(€€€€€½¹ÍÐÕÉÉ•¹Ð€ôÑ½¹•Ím•á•ÕÑ¥½¸¹…¹Ù…Í%‘tì(€€€€€¥˜€ …ÕÉÉ•¹ÐñðÁÉ¥½É¥Ñåm•á•ÕÑ¥½¸¹Ñ½¹•t€øÁÉ¥½É¥ÑåmÕÉÉ•¹Ñt¤ì(€€€€€€€Ñ½¹•Ím•á•ÕÑ¥½¸¹…¹Ù…Í%‘t€ô•á•ÕÑ¥½¸¹Ñ½¹”ì(€€€€€ô(€€€ô(€€€É•ÑÕÉ¸Ñ½¹•Ìì(€ô°m•á•ÕÑ¥½¹Ít¤ì((€½¹ÍÐ¡…¹‘±•9½‘•Í•±•Ñ”€ôÕÍ•…±±‰…¬ ¡‘•±•Ñ•‘9½‘•Ìè…¹Ù…Í9½‘•mt¤€ôøì(€€€½¹ÍÐÁÉ½µÁÑ%‘Ì€ô‘•±•Ñ•‘9½‘•Ì(€€€€€€¹™¥±Ñ•È ¡¹½‘”¤€ôø¹½‘”¹‘…Ñ„¹­¥¹€ôôô€‰ÁÉ½µÁÐˆ¤(€€€€€€¹µ…À ¡¹½‘”¤€ôø¹½‘”¹¥¤ì(€€€¥˜€ …ÁÉ½µÁÑ%‘Ì¹±•¹Ñ ¤É•ÑÕÉ¸ì(€€€…¹•±AÉ½µÁÑÌ¡ÁÉ½µÁÑ%‘Ì¤ì(€€€¥˜€¡ÁÉ½µÁÑ%‘Ì¹¥¹±Õ‘•Ì¡Í•±•Ñ•‘AÉ½µÁÑ%¹ÕÉÉ•¹Ðñð€ˆˆ¤¤ì(€€€€€Í•±•Ñ•‘AÉ½µÁÑ%¹ÕÉÉ•¹Ð€ô¹Õ±°ì(€€€€€Ù½¥Í•ÑÑ¥Ù•AÉ½µÁÐ¡¹Õ±°¤ì(€€€ô(€€€¥˜€ (€€€€€¹•ÜUI1M•…É¡A…É…µÌ¡Ý¥¹‘½Ü¹±½…Ñ¥½¸¹Í•…É ¤¹•Ð ‰•µ‰•‘‘•ˆ¤€ôôô€ˆÄˆ(€€€€¤ì(€€€€€Ý¥¹‘½Ü¹Á…É•¹Ð¹Á½ÍÑ5•ÍÍ…” (€€€€€€€ì(€€€€€€€€€ÑåÁ”è€‰‰É…¹¡‰½…Éé…¹•°µ•á•ÕÑ¥½¸ˆ°(€€€€€€€€€ÁÉ½µÁÑ%‘Ì(€€€€€€€ô°(€€€€€€€€ˆ¨ˆ(€€€€€€¤ì(€€€ô(€ô°m…¹•±AÉ½µÁÑÍt¤ì((€É•ÑÕÉ¸€ (€€€€ñµ…¥¸±…ÍÍ9…µ”ô‰…¹Ù…ÌµÍ¡•±°ˆø(€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Ñ½Á‰…Èˆø(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰‰É…¹ˆø(€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰‰É…¹µµ…É¬ˆ…É¥„µ¡¥‘‘•¸ô‰ÑÉÕ”ˆø(€€€€€€€€€€€€ñÍÙœÙ¥•Ý	½àôˆÀ€À€ÌÈ€ÌÈˆø(€€€€€€€€€€€€€€ñÁ…Ñ ô‰4Ü¸Ô€ÄÉXÜ¸Õ ÄÉ4ÈÀ€Ü¸Õ Ð¸ÕXÄÉ4ÈÐ¸Ô€ÈÁØÐ¸Õ ÈÁ4ÄÈ€ÈÐ¸Õ Ü¸ÕXÈÀˆ€¼ø(€€€€€€€€€€€€€€ñÁ…Ñ ô‰´ÄÀ¸Ô€ÄÄ¸Ô€Ô€Ð¸Ô€Ø´Õ4ÄÔ¸Ô€ÄÙØÔˆ€¼ø(€€€€€€€€€€€€€€ñ¥É±”àôˆÄÀ¸ÔˆäôˆÄÄ¸ÔˆÈôˆÈ¸ÌÔˆ€¼ø(€€€€€€€€€€€€€€ñ¥É±”àôˆÈÄ¸ÔˆäôˆÄÄˆÈôˆÈ¸ÌÔˆ€¼ø(€€€€€€€€€€€€€€ñ¥É±”àôˆÄÔ¸ÔˆäôˆÈÄˆÈôˆÈ¸ÌÔˆ€¼ø(€€€€€€€€€€€€ð½ÍÙœø(€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€ñ‘¥Øø(€€€€€€€€€€€€ñÍÑÉ½¹œû–"šR¿žRï–âð½ÍÑÉ½¹œø(€€€€€€€€€€€€ñÍÁ…¸ù	I9!	=Ið½ÍÁ…¸ø(€€€€€€€€€€ð½‘¥Øø(€€€€€€€€ð½‘¥Øø(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Ñ½Á‰…Èµ…Ñ¥½¹Ìˆø(€€€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰µ½‘”µÍÝ¥Ñ ˆÉ½±”ô‰É½ÕÀˆ…É¥„µ±…‰•°ô‹–Þ—’ösš¢‡–ò<ˆø(€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ(€€€€€€€€€€€€€±…ÍÍ9…µ”õíµ½‘”€ôôô€‰µ…¹Õ…°ˆ€ü€‰…Ñ¥Ù”ˆ€è€ˆ‰ô(€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ5½‘” ‰µ…¹Õ…°ˆ¥ô(€€€€€€€€€€€€ø(€€€€€€€€€€€€€ƒš‚šÎ£š¢‡–ò<(€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ(€€€€€€€€€€€€€±…ÍÍ9…µ”õíµ½‘”€ôôô€‰…ÕÑ¼ˆ€ü€‰…Ñ¥Ù”ÍÉ¥ÁÐˆ€è€‰ÍÉ¥ÁÐ‰ô(€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•Ñ5½‘” ‰…ÕÑ¼ˆ¥ô(€€€€€€€€€€€€ø(€€€€€€€€€€€€€ƒ¢«–* (€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”õíÍ…Ù”µÍÑ…Ñ”€‘íÍ…Ù•MÑ…Ñ•õôø(€€€€€€€€€€€€ñ¤€¼ø(€€€€€€€€€€€íÍ…Ù•MÑ…Ñ”€ôôô€‰Í…Ù•ˆ(€€€€€€€€€€€€€€ü€‹–ÞË’þw–¶c–"Ãšr³–rÀˆ(€€€€€€€€€€€€€€èÍ…Ù•MÑ…Ñ”€ôôô€‰Í…Ù¥¹œˆ(€€€€€€€€€€€€€€€€ü€‹š¶–r£’þw–¶`ˆ(€€€€€€€€€€€€€€€€è€‹’þw–¶c–’Ç¢Ò”‰ô(€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€ñÍÁ…¸±…ÍÍ9…µ”ô‰Á…ÍÑ”µ¡¥¹Ðˆø(€€€€€€€€€€€€ñ­‰ùÑÉ°ð½­‰ø(€€€€€€€€€€€€ñˆø¬ð½ˆø(€€€€€€€€€€€€ñ­‰ùXð½­‰ø(€€€€€€€€€€€ƒžÊc¢ÒÓ–nûž&(€€€€€€€€€€ð½ÍÁ…¸ø(€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€±…ÍÍ9…µ”ô‰Ñ¡•µ”µÑ½±”ˆ(€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ(€€€€€€€€€€€…É¥„µÁÉ•ÍÍ•õíÑ¡•µ”€ôôô€‰±¥¡Ð‰ô(€€€€€€€€€€€Ñ¥Ñ±”õíÑ¡•µ”€ôôô€‰±¥¡Ðˆ€ü€‹–"š6‹–"ÃšÞÇ¢&Ëš¢‡–ò<ˆ€è€‹–"š6‹–"Ãžf÷¢&Ëš¢‡–ò<‰ô(€€€€€€€€€€€½¹±¥¬õì ¤€ôøÍ•ÑQ¡•µ”¡Ñ¡•µ”€ôôô€‰±¥¡Ðˆ€ü€‰‘…É¬ˆ€è€‰±¥¡Ðˆ¥ô(€€€€€€€€€€ø(€€€€€€€€€€€€ñÍÁ…¸…É¥„µ¡¥‘‘•¸ô‰ÑÉÕ”ˆùíÑ¡•µ”€ôôô€‰±¥¡Ðˆ€ü€‹Šbøˆ€è€‹Šb ‰ôð½ÍÁ…¸ø(€€€€€€€€€€€íÑ¡•µ”€ôôô€‰±¥¡Ðˆ€ü€‹šÞÇ¢&Ëš¢‡–ò<ˆ€è€‹žf÷¢&Ëš¢‡–ò<‰ô(€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€ñ‰ÕÑÑ½¸±…ÍÍ9…µ”ô‰Ñ½½±‰…Èµ‰ÕÑÑ½¸ˆÑåÁ”ô‰‰ÕÑÑ½¸ˆ½¹±¥¬õí…‘‘AÉ½µÁÑôø(€€€€€€€€€€€€ñÍÁ…¸û¾ò,ð½ÍÁ…¸ø(€€€€€€€€€€€ƒšZÃ–îëš>Cž’ë¢¾4(€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€ð½‘¥Øø(€€€€€€ð½‘¥Øø((€€€€€€ñ¹…Ø±…ÍÍ9…µ”ô‰…¹Ù…ÌµÑ…‰Ìˆ…É¥„µ±…‰•°ô‹žRï–âš‚ž¶øˆø(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…¹Ù…ÌµÑ…‰ÌµÍÉ½±°ˆø(€€€€€€€€€í…¹Ù…ÍQ…‰Ì¹µ…À ¡…¹Ù…Ì°¥¹‘•à¤€ôøì(€€€€€€€€€€€½¹ÍÐ¥ÍÑ¥Ù”€ô…¹Ù…Ì¹¥€ôôô…Ñ¥Ù•…¹Ù…Í%ì(€€€€€€€€€€€É•ÑÕÉ¸€ (€€€€€€€€€€€€€€ñ‘¥Ø(€€€€€€€€€€€€€€€­•äõí…¹Ù…Ì¹¥‘ô(€€€€€€€€€€€€€€€±…ÍÍ9…µ”õí…¹Ù…ÌµÑ…ˆ‘í¥ÍÑ¥Ù”€ü€ˆ…Ñ¥Ù”ˆ€è€ˆ‰ô‘ì(€€€€€€€€€€€€€€€€€•‘¥Ñ¥¹…¹Ù…Í%€ôôô…¹Ù…Ì¹¥€ü€ˆ•‘¥Ñ¥¹œˆ€è€ˆˆ(€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€í•‘¥Ñ¥¹…¹Ù…Í%€ôôô…¹Ù…Ì¹¥€ü€ (€€€€€€€€€€€€€€€€€€ñ¥¹ÁÕÐ(€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…¹Ù…ÌµÑ…ˆµ¥¹ÁÕÐˆ(€€€€€€€€€€€€€€€€€€€…É¥„µ±…‰•°ô‹žRï–â–B7žžÀˆ(€€€€€€€€€€€€€€€€€€€Ù…±Õ”õí…¹Ù…ÍQ¥Ñ±•É…™Ñô(€€€€€€€€€€€€€€€€€€€µ…á1•¹Ñ õìÐÁô(€€€€€€€€€€€€€€€€€€€…ÕÑ½½ÕÌ(€€€€€€€€€€€€€€€€€€€½¹¡…¹”õì¡•Ù•¹Ð¤€ôøÍ•Ñ…¹Ù…ÍQ¥Ñ±•É…™Ð¡•Ù•¹Ð¹Ñ…É•Ð¹Ù…±Õ”¥ô(€€€€€€€€€€€€€€€€€€€½¹	±ÕÈõì ¤€ôøÙ½¥½µµ¥ÑI•¹…µ•…¹Ù…Ì¡…¹Ù…Ì¹¥¥ô(€€€€€€€€€€€€€€€€€€€½¹-•å½Ý¸õì¡•Ù•¹Ð¤€ôøì(€€€€€€€€€€€€€€€€€€€€€¥˜€¡•Ù•¹Ð¹­•ä€ôôô€‰¹Ñ•Èˆ¤ì(€€€€€€€€€€€€€€€€€€€€€€€•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€€€€€€€€€€€€€€€€€€€€€Ù½¥½µµ¥ÑI•¹…µ•…¹Ù…Ì¡…¹Ù…Ì¹¥¤ì(€€€€€€€€€€€€€€€€€€€€€ô•±Í”¥˜€¡•Ù•¹Ð¹­•ä€ôôô€‰Í…Á”ˆ¤ì(€€€€€€€€€€€€€€€€€€€€€€€•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€€€€€€€€€€€€€€€€€€€€€…¹•±I•¹…µ•…¹Ù…Ì ¤ì(€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€õô(€€€€€€€€€€€€€€€€€€¼ø(€€€€€€€€€€€€€€€€¤€è€ (€€€€€€€€€€€€€€€€€€ðø(€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ(€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…¹Ù…ÌµÑ…ˆµÍ•±•Ðˆ(€€€€€€€€€€€€€€€€€€€€€…É¥„µÁÉ•ÍÍ•õí¥ÍÑ¥Ù•ô(€€€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”ô‹–>3–ïšRç–B4ˆ(€€€€€€€€€€€€€€€€€€€€€‘¥Í…‰±•õí…¹Ù…ÍÑ¥½¹A•¹‘¥¹ô(€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÙ½¥ÍÝ¥Ñ¡…¹Ù…Ì¡…¹Ù…Ì¹¥¥ô(€€€€€€€€€€€€€€€€€€€€€½¹½Õ‰±•±¥¬õì ¤€ôø‰•¥¹I•¹…µ•…¹Ù…Ì¡…¹Ù…Ì¥ô(€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€ñÍÁ…¸ùíMÑÉ¥¹œ¡¥¹‘•à€¬€Ä¤¹Á…‘MÑ…ÉÐ È°€ˆÀˆ¥ôð½ÍÁ…¸ø(€€€€€€€€€€€€€€€€€€€€€€ñÍÑÉ½¹œùí…¹Ù…Ì¹Ñ¥Ñ±•ôð½ÍÑÉ½¹œø(€€€€€€€€€€€€€€€€€€€€€í•á•ÕÑ¥½¹Q½¹•	å…¹Ù…Ím…¹Ù…Ì¹¥‘t€ü€ (€€€€€€€€€€€€€€€€€€€€€€€€ñ¤(€€€€€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”õíÑ…ˆµ…Ñ¥Ù¥Ñä€‘í•á•ÕÑ¥½¹Q½¹•	å…¹Ù…Ím…¹Ù…Ì¹¥‘uõô(€€€€€€€€€€€€€€€€€€€€€€€€€…É¥„µ±…‰•°õì(€€€€€€€€€€€€€€€€€€€€€€€€€€€•á•ÕÑ¥½¹Q½¹•	å…¹Ù…Ím…¹Ù…Ì¹¥‘t€ôôô€‰Ý½É­¥¹œˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‹š¶–r£¢þC¢†0ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è•á•ÕÑ¥½¹Q½¹•	å…¹Ù…Ím…¹Ù…Ì¹¥‘t€ôôô€‰•ÉÉ½Èˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‹¢þC¢†3–’Ç¢Ò”ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è€‹¢þC¢†3–º3š"@ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€€€€€í•á•ÕÑ¥½¹Q½¹•	å…¹Ù…Ím…¹Ù…Ì¹¥‘t€ôôô€‰Ý½É­¥¹œˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‹Š^<ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€è•á•ÕÑ¥½¹Q½¹•	å…¹Ù…Ím…¹Ù…Ì¹¥‘t€ôôô€‰•ÉÉ½Èˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€ü€ˆ„ˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€€€€€è€‹ŠrL‰ô(€€€€€€€€€€€€€€€€€€€€€€€€ð½¤ø(€€€€€€€€€€€€€€€€€€€€€€¤€èÕ¹É•…‘I•ÍÕ±ÑÍm…¹Ù…Ì¹¥‘t€ü€ (€€€€€€€€€€€€€€€€€€€€€€€€ñ¤…É¥„µ±…‰•°õí€‘íÕ¹É•…‘I•ÍÕ±ÑÍm…¹Ù…Ì¹¥‘uôƒ’â«šZÃžîOšzqôø(€€€€€€€€€€€€€€€€€€€€€€€€€íÕ¹É•…‘I•ÍÕ±ÑÍm…¹Ù…Ì¹¥‘uô(€€€€€€€€€€€€€€€€€€€€€€€€ð½¤ø(€€€€€€€€€€€€€€€€€€€€€€¤€è¹Õ±±ô(€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ(€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…¹Ù…ÌµÑ…ˆµÉ•¹…µ”ˆ(€€€€€€€€€€€€€€€€€€€€€…É¥„µ±…‰•°õíƒ¦7–F÷–B4‘í…¹Ù…Ì¹Ñ¥Ñ±•õô(€€€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”ô‹¦7–F÷–B7žRï–âˆ(€€€€€€€€€€€€€€€€€€€€€‘¥Í…‰±•õí…¹Ù…ÍÑ¥½¹A•¹‘¥¹ô(€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôø‰•¥¹I•¹…µ•…¹Ù…Ì¡…¹Ù…Ì¥ô(€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€ƒŠr8(€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ(€€€€€€€€€€€€€€€€€€€€€±…ÍÍ9…µ”ô‰…¹Ù…ÌµÑ…ˆµ‘•±•Ñ”ˆ(€€€€€€€€€€€€€€€€€€€€€…É¥„µ±…‰•°õíƒ–"ƒ¦f‘í…¹Ù…Ì¹Ñ¥Ñ±•õô(€€€€€€€€€€€€€€€€€€€€€Ñ¥Ñ±”õì(€€€€€€€€€€€€€€€€€€€€€€€…¹Ù…ÍQ…‰Ì¹±•¹Ñ €ðô€Ä(€€€€€€€€€€€€€€€€€€€€€€€€€€ü€‹¢Ï–ÂG’þwžVg’â’â«žRï–âˆ(€€€€€€€€€€€€€€€€€€€€€€€€€€è€‹–"ƒ¦f“žRï–âˆ(€€€€€€€€€€€€€€€€€€€€€ô(€€€€€€€€€€€€€€€€€€€€€‘¥Í…‰±•õí…¹Ù…ÍÑ¥½¹A•¹‘¥¹œñð…¹Ù…ÍQ…‰Ì¹±•¹Ñ €ðô€Åô(€€€€€€€€€€€€€€€€€€€€€½¹±¥¬õì ¤€ôøÙ½¥‘•±•Ñ•…¹Ù…Ì¡…¹Ù…Ì¥ô(€€€€€€€€€€€€€€€€€€€€ø(€€€€€€€€€€€€€€€€€€€€€ƒ\(€€€€€€€€€€€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€€€€€€€€€€€ð¼ø(€€€€€€€€€€€€€€€€¥ô(€€€€€€€€€€€€€€ð½‘¥Øø(€€€€€€€€€€€€¤ì(€€€€€€€€€ô¥ô(€€€€€€€€ð½‘¥Øø(€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ(€€€€€€€€€±…ÍÍ9…µ”ô‰…¹Ù…ÌµÑ…ˆµ…‘ˆ(€€€€€€€€€…É¥„µ±…‰•°ô‹šZÃ–îëžRï–âˆ(€€€€€€€€€Ñ¥Ñ±”ô‹šZÃ–îëžRï–âˆ(€€€€€€€€€‘¥Í…‰±•õí…¹Ù…ÍÑ¥½¹A•¹‘¥¹ô(€€€€€€€€€½¹±¥¬õì ¤€ôøÙ½¥É•…Ñ•…¹Ù…Ì ¥ô(€€€€€€€€ø(€€€€€€€€€ƒ¾ò,(€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€ð½¹…Øø((€€€€€íÍ…Ù•MÑ…Ñ”€ôôô€‰•ÉÉ½Èˆ€ü€ (€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰Í…Ù”µ•ÉÉ½Èµ‰…¹¹•ÈˆÉ½±”ô‰…±•ÉÐˆø(€€€€€€€€€€ñÍÁ…¸ùíÍ…Ù•ÉÉ½Èñð€‹–öO–&7’þ»šRç–Âkšr«’þw–¶`‰ôð½ÍÁ…¸ø(€€€€€€€€€€ñ‰ÕÑÑ½¸(€€€€€€€€€€€ÑåÁ”ô‰‰ÕÑÑ½¸ˆ(€€€€€€€€€€€½¹±¥¬õì ¤€ôø(€€€€€€€€€€€€€Í•Ñ9½‘•Ì ¡ÕÉÉ•¹Ð¤€ôøÕÉÉ•¹Ð¹µ…À ¡¹½‘”¤€ôø€¡ì€¸¸¹¹½‘”ô¤¤¤(€€€€€€€€€€€ô(€€€€€€€€€€ø(€€€€€€€€€€€ƒ¦7¢¾T(€€€€€€€€€€ð½‰ÕÑÑ½¸ø(€€€€€€€€ð½‘¥Øø(€€€€€€¤€è¹Õ±±ô((€€€€€€ñ‘¥Ø(€€€€€€€±…ÍÍ9…µ”õí™±½ÜµÉ•¥½¸‘í‘É…Ñ¥Ù”€ü€ˆ‘É…œµ…Ñ¥Ù”ˆ€è€ˆ‰õô(€€€€€€€½¹É…¹Ñ•Èõí¡…¹‘±•…¹Ù…ÍÉ…¹Ñ•Éô(€€€€€€€½¹É…1•…Ù”õí¡…¹‘±•…¹Ù…ÍÉ…1•…Ù•ô(€€€€€€€½¹É…=Ù•Èõí¡…¹‘±•…¹Ù…ÍÉ…=Ù•Éô(€€€€€€€½¹É½Àõì¡•Ù•¹Ð¤€ôøÙ½¥¡…¹‘±•…¹Ù…ÍÉ½À¡•Ù•¹Ð¥ô(€€€€€€ø(€€€€€€€€ñI•…Ñ±½Üñ…¹Ù…Í9½‘”°…¹Ù…Í‘”ø(€€€€€€€€€¹½‘•Ìõí¹½‘•Íô(€€€€€€€€€•‘•Ìõí•‘•Íô(€€€€€€€€€¹½‘•QåÁ•Ìõí¹½‘•QåÁ•Íô(€€€€€€€€€‘•™…Õ±Ñ‘•=ÁÑ¥½¹Ìõí‘•™…Õ±Ñ‘•=ÁÑ¥½¹Íô(€€€€€€€€€½¹9½‘•Í¡…¹”õí½¹9½‘•Í¡…¹•ô(€€€€€€€€€½¹‘•Í¡…¹”õí½¹‘•Í¡…¹•ô(€€€€€€€€€½¹9½‘•Í•±•Ñ”õí¡…¹‘±•9½‘•Í•±•Ñ•ô(€€€€€€€€€½¹M•±•Ñ¥½¹¡…¹”õí¡…¹‘±•M•±•Ñ¥½¹¡…¹•ô(€€€€€€€€€™¥ÑY¥•Ü(€€€€€€€€€™¥ÑY¥•Ý=ÁÑ¥½¹ÌõíìÁ…‘‘¥¹œè€À¸È°µ…ái½½´è€Äõô(€€€€€€€€€µ¥¹i½½´õìÀ¸ÄÉô(€€€€€€€€€µ…ái½½´õìÉô(€€€€€€€€€Í•±•Ñ¥½¹=¹É…œ(€€€€€€€€€¹½‘•Í½¹¹•Ñ…‰±”õí™…±Í•ô(€€€€€€€€€Á…¹=¹MÉ½±°õí™…±Í•ô(€€€€€€€€€é½½µ=¹MÉ½±°(€€€€€€€€€‘•±•Ñ•-•å½‘”õíl‰	…­ÍÁ…”ˆ°€‰•±•Ñ”‰uô(€€€€€€€€€ÁÉ½=ÁÑ¥½¹Ìõíì¡¥‘•ÑÑÉ¥‰ÕÑ¥½¸èÑÉÕ”õô(€€€€€€€€ø(€€€€€€€€€€ñ	…­É½Õ¹(€€€€€€€€€€€Ù…É¥…¹Ðõí	…­É½Õ¹‘Y…É¥…¹Ð¹½ÑÍô(€€€€€€€€€€€…ÀõìÈÉô(€€€€€€€€€€€Í¥é”õìÀ¸ÜÕô(€€€€€€€€€€€½±½Èõì(€€€€€€€€€€€€€Ñ¡•µ”€ôôô€‰±¥¡Ðˆ(€€€€€€€€€€€€€€€€ü€‰É‰„ ÜÀ°€àÄ°€äÈ°€À¸ÄÌ¤ˆ(€€€€€€€€€€€€€€€€è€‰É‰„ ÄÌÔ°€ÄÐà°€ÄØÄ°€À¸ÄÈ¤ˆ(€€€€€€€€€€€ô(€€€€€€€€€€¼ø(€€€€€€€€€€ñ5¥¹¥5…À(€€€€€€€€€€€¹½‘•½±½Èõíµ¥¹¥µ…Á½±½Éô(€€€€€€€€€€€¹½‘•MÑÉ½­•]¥‘Ñ õìÁô(€€€€€€€€€€€µ…Í­½±½Èõì(€€€€€€€€€€€€€Ñ¡•µ”€ôôô€‰±¥¡Ðˆ(€€€€€€€€€€€€€€€€ü€‰É‰„ ÈÈÔ°€ÈÈÀ°€ÈÄÌ°€À¸àà¤ˆ(€€€€€€€€€€€€€€€€è€‰É‰„ ÈÄ°€Èä°€ÌÜ°€À¸àà¤ˆ(€€€€€€€€€€€ô(€€€€€€€€€€€Á…¹¹…‰±”(€€€€€€€€€€€é½½µ…‰±”(€€€€€€€€€€¼ø(€€€€€€€€€€ñ½¹ÑÉ½±ÌÍ¡½Ý%¹Ñ•É…Ñ¥Ù”õí™…±Í•ô€¼ø(€€€€€€€€ð½I•…Ñ±½Üø(€€€€€€€€ñ‘¥Ø±…ÍÍ9…µ”ô‰…¹Ù…Ìµ‘É½Àµ½Ù•É±…äˆÉ½±”ô‰ÍÑ…ÑÕÌˆ…É¥„µ±¥Ù”ô‰Á½±¥Ñ”ˆø(€€€€€€€€€€ñÍÁ…¸û¾ò,ð½ÍÁ…¸ø(€€€€€€€€€€ñÍÑÉ½¹œûšvû–ò’î—–*ƒ–—–nûž&ð½ÍÑÉ½¹œø(€€€€€€€€€€ñÍµ…±°ûšR¿š2žR×¢GšZ’îÛ–J0¡…ÑAPƒžRš"C–nøð½Íµ…±°ø(€€€€€€€€ð½‘¥Øø(€€€€€€ð½‘¥Øø((€€€€€€ñ…Í¥‘”±…ÍÍ9…µ”ô‰…¹Ù…Ìµ¹½Ñ”ˆø(€€€€€€€€ñÍÁ…¸øÀÄð½ÍÁ…¸ø(€€€€€€€íµ½‘”€ôôô€‰…ÕÑ¼ˆ€ü€ (€€€€€€€€€€ñÀø(€€€€€€€€€€€ƒ–>G¦–B;’òkžVg–r£žRï–â’â·ž¶'–ú¡…ÑAS¾ò0(€€€€€€€€€€€€ñ‰È€¼ø(€€€€€€€€€€€ƒžRš"C–nûž&–º3š"C–B;¢«–*£–n{–"Ã–öO–&7¢*ž
çŽ(€€€€€€€€€€ð½Àø(€€€€€€€€¤€è€ (€€€€€€€€€€ñÀø(€€€€€€€€€€€ƒ¦'š.§’â’â«š>Cž’ë¢¾7¢*ž
ç–B;žÊc¢ÒÓ–nûž&¾ò0(€€€€€€€€€€€€ñ‰È€¼ø(€€€€€€€€€€€ƒžîOšzs’òk¢«–*£š:—–"Ã–ºžj’â/’â–ÆŽ(€€€€€€€€€€ð½Àø(€€€€€€€€¥ô(€€€€€€ð½…Í¥‘”ø(€€€€ð½µ…¥¸ø(€€¤ì)ô()•áÁ½ÉÐ™Õ¹Ñ¥½¸…¹Ù…ÍÁÀ ¤ì(€É•ÑÕÉ¸€ (€€€€ñá•ÕÑ¥½¹M•ÑÑ¥¹ÍAÉ½Ù¥‘•Èø(€€€€€€ñá•ÕÑ¥½¹M•ÍÍ¥½¹AÉ½Ù¥‘•Èø(€€€€€€€€ñI•…Ñ±½ÝAÉ½Ù¥‘•Èø(€€€€€€€€€€ñ…¹Ù…Í]½É­ÍÁ…”€¼ø(€€€€€€€€ð½I•…Ñ±½ÝAÉ½Ù¥‘•Èø(€€€€€€ð½á•ÕÑ¥½¹M•ÍÍ¥½¹AÉ½Ù¥‘•Èø(€€€€ð½á•ÕÑ¥½¹M•ÑÑ¥¹ÍAÉ½Ù¥‘•Èø(€€¤ì)ô(