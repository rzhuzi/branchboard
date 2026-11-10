import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
  type OnSelectionChangeParams
} from "@xyflow/react";
import { clamp, wheelPanDelta, zoomAtPoint } from "../../shared/geometry";
import {
  MSG,
  type ForwardPasteMessage,
  type ImportUrlMessage
} from "../../shared/messages";
import type { CanvasEdge, CanvasNode } from "../../shared/types";
import { ImageNode } from "../nodes/ImageNode";
import { PromptNode } from "../nodes/PromptNode";
import { RelationEdge } from "../nodes/RelationEdge";
import { useEditorActions, useEditorState } from "../state/EditorContext";
import { useToast } from "../state/ToastProvider";
import { useWorkspace } from "../state/WorkspaceProvider";
import { IconButton } from "../ui/controls";
import {
  CursorIcon,
  HandIcon,
  ImagePlusIcon,
  MouseIcon,
  PlusIcon,
  RedoIcon,
  TextIcon,
  TrashIcon,
  UndoIcon
} from "../ui/icons";
import { Menu, type MenuEntry } from "../ui/Menu";
import { ZoomControls } from "../ui/ZoomControls";

type Tool = "select" | "hand";

const nodeTypes: NodeTypes = {
  prompt: PromptNode,
  image: ImageNode
};

const edgeTypes: EdgeTypes = {
  relation: RelationEdge
};

type ContextMenuState = {
  x: number;
  y: number;
  nodeId?: string;
  edgeId?: string;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "TEXTAREA" ||
    target.tagName === "INPUT" ||
    target.tagName === "SELECT" ||
    target.isContentEditable ||
    Boolean(target.closest("textarea, input, [contenteditable='true']"))
  );
}

function overlayOpen(): boolean {
  return Boolean(document.querySelector(".bb-overlay, .bb-dialog-backdrop, .bb-menu"));
}

function imageFromTransfer(transfer: DataTransfer): { url: string; name: string } | null {
  const html = transfer.getData("text/html");
  if (html) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const image = parsed.querySelector("img");
    const source = image?.getAttribute("src");
    if (source) return { url: source, name: image?.getAttribute("alt") || "拖入图片" };
  }
  const uri = transfer
    .getData("text/uri-list")
    .split(/\r?\n/)
    .find((line) => line && !line.startsWith("#"));
  if (uri) return { url: uri, name: "拖入图片" };
  const text = transfer.getData("text/plain").trim();
  if (/^(?:https?:|blob:|data:image\/)/i.test(text)) {
    return { url: text, name: "拖入图片" };
  }
  return null;
}

function promptLabel(node: CanvasNode | undefined): string {
  if (!node || node.data.kind !== "prompt") return "";
  const first = node.data.prompt.trim().split("\n")[0] ?? "";
  return first.slice(0, 24) || "未命名提示词";
}

export function CanvasView() {
  const { nodes, edges, selectedCount, canUndo, canRedo } = useEditorState();
  const actions = useEditorActions();
  const { activeCanvasId, busy, embedded } = useWorkspace();
  const { pushToast } = useToast();
  const { screenToFlowPosition, getViewport } = useReactFlow<CanvasNode, CanvasEdge>();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const dragDepthRef = useRef(0);
  const [tool, setTool] = useState<Tool>("select");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [dropTargetPromptId, setDropTargetPromptId] = useState("");
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const flowPointAt = useCallback(
    (clientX: number, clientY: number) =>
      screenToFlowPosition({ x: clientX, y: clientY }),
    [screenToFlowPosition]
  );

  const centerPoint = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return flowPointAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [flowPointAt]);

  const pastePoint = useCallback(() => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    const pointer = lastPointerRef.current;
    if (rect && pointer && pointer.x >= rect.left && pointer.x <= rect.right && pointer.y >= rect.top && pointer.y <= rect.bottom) {
      return flowPointAt(pointer.x, pointer.y);
    }
    return centerPoint();
  }, [centerPoint, flowPointAt]);

  const promptAtPoint = useCallback(
    (clientX: number, clientY: number): { id: string; element: HTMLElement } | null => {
      const element = document.elementFromPoint(clientX, clientY);
      const nodeElement = element instanceof HTMLElement
        ? element.closest<HTMLElement>(".react-flow__node")
        : null;
      if (!nodeElement) return null;
      const nodeId = nodeElement.getAttribute("data-id") ?? "";
      const node = nodes.find((item) => item.id === nodeId);
      if (!node || node.data.kind !== "prompt") return null;
      return { id: nodeId, element: nodeElement };
    },
    [nodes]
  );

  const clearDropTarget = useCallback(() => {
    setDropTargetPromptId("");
    document.querySelectorAll(".bb-drop-target").forEach((element) => {
      element.classList.remove("bb-drop-target");
    });
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest(".react-flow__minimap, .bb-zoom-controls")) {
        return;
      }
      const textarea = event.target instanceof Element
        ? event.target.closest("textarea")
        : null;
      if (
        textarea instanceof HTMLTextAreaElement &&
        document.activeElement === textarea &&
        textarea.scrollHeight > textarea.clientHeight + 1 &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        return;
      }
      event.preventDefault();
      const rect = wrapper.getBoundingClientRect();
      const viewport = getViewport();
      if (event.ctrlKey || event.metaKey) {
        const delta = clamp(event.deltaY, -120, 120);
        const factor = Math.exp(-delta * 0.0022);
        const next = zoomAtPoint(
          viewport,
          { x: event.clientX - rect.left, y: event.clientY - rect.top },
          clamp(viewport.zoom * factor, 0.1, 2.5)
        );
        actions.applyViewport(next);
        return;
      }
      const delta = wheelPanDelta(event, rect.height, event.shiftKey);
      actions.applyViewport({
        x: viewport.x + delta.x,
        y: viewport.y + delta.y,
        zoom: viewport.zoom
      });
    };
    wrapper.addEventListener("wheel", handleWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", handleWheel);
  }, [actions, getViewport]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (overlayOpen()) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) actions.redo();
        else actions.undo();
        return;
      }
      if (modifier && key === "y") {
        event.preventDefault();
        actions.redo();
        return;
      }
      if (modifier && key === "d") {
        event.preventDefault();
        actions.duplicateSelected();
        return;
      }
      if (modifier && key === "a") {
        event.preventDefault();
        actions.selectAll();
        return;
      }
      if (modifier && (event.key === "=" || event.key === "+")) {
        event.preventDefault();
        actions.zoomBy(1.2);
        return;
      }
      if (modifier && event.key === "-") {
        event.preventDefault();
        actions.zoomBy(1 / 1.2);
        return;
      }
      if (modifier && event.key === "0") {
        event.preventDefault();
        actions.zoomTo(1);
        return;
      }
      if (event.shiftKey && event.code === "Digit1") {
        event.preventDefault();
        actions.fitAll();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        const selectedEdges = edges.filter((edge) => edge.selected).map((edge) => edge.id);
        if (selectedEdges.length) {
          event.preventDefault();
          actions.deleteEdges(selectedEdges);
        } else if (selectedCount > 0) {
          event.preventDefault();
          actions.deleteSelected();
        }
        return;
      }
      if (event.key === "Escape") {
        actions.clearSelection();
        return;
      }
      if (!modifier && !event.altKey && key === "n") {
        event.preventDefault();
        actions.addPromptAtCenter();
        return;
      }
      if (!modifier && !event.altKey && !event.shiftKey && key === "v") {
        event.preventDefault();
        setTool("select");
        return;
      }
      if (!modifier && !event.altKey && !event.shiftKey && key === "h") {
        event.preventDefault();
        setTool("hand");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [actions, edges, selectedCount]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target) || overlayOpen()) return;
      const imageFiles = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      if (imageFiles.length) {
        event.preventDefault();
        void actions.addImagesFromFiles(imageFiles, pastePoint());
        return;
      }
      const text = event.clipboardData?.getData("text/plain").trim();
      if (!text) return;
      event.preventDefault();
      actions.addPromptFromText(text, pastePoint());
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [actions, pastePoint]);

  useEffect(() => {
    const handleParentMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const data = event.data as ForwardPasteMessage | undefined;
      if (!data || data.type !== MSG.forwardPaste || !data.dataUrl) return;
      if (overlayOpen()) return;
      void actions.addImagesFromDataUrls(
        [{ dataUrl: data.dataUrl, name: data.name || "粘贴图片" }],
        centerPoint()
      );
    };
    window.addEventListener("message", handleParentMessage);
    return () => window.removeEventListener("message", handleParentMessage);
  }, [actions, centerPoint]);

  useEffect(() => {
    const reset = () => {
      dragDepthRef.current = 0;
      setDragActive(false);
      clearDropTarget();
    };
    window.addEventListener("dragend", reset);
    return () => window.removeEventListener("dragend", reset);
  }, [clearDropTarget]);

  const handleDragEnter = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current += 1;
    if (event.dataTransfer?.types?.length) setDragActive(true);
  }, []);

  const handleDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      const target = promptAtPoint(event.clientX, event.clientY);
      if (target) {
        if (dropTargetPromptId !== target.id) {
          document.querySelectorAll(".bb-drop-target").forEach((element) => {
            element.classList.remove("bb-drop-target");
          });
          target.element.classList.add("bb-drop-target");
          setDropTargetPromptId(target.id);
        }
      } else if (dropTargetPromptId) {
        clearDropTarget();
      }
    },
    [clearDropTarget, dropTargetPromptId, promptAtPoint]
  );

  const handleDragLeave = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setDragActive(false);
        clearDropTarget();
      }
    },
    [clearDropTarget]
  );

  const handleDrop = useCallback(
    async (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setDragActive(false);
      clearDropTarget();
      const flowPoint = flowPointAt(event.clientX, event.clientY);
      const target = promptAtPoint(event.clientX, event.clientY);
      const targetPromptId = target?.id;
      const files = Array.from(event.dataTransfer.files).filter((file) =>
        file.type.startsWith("image/")
      );
      if (files.length) {
        await actions.addImagesFromFiles(files, flowPoint, targetPromptId);
        return;
      }
      const image = imageFromTransfer(event.dataTransfer);
      if (!image) {
        pushToast("拖入的内容里没有可用图片", { tone: "error" });
        return;
      }
      if (image.url.startsWith("data:image/")) {
        await actions.addImagesFromDataUrls(
          [{ dataUrl: image.url, name: image.name }],
          flowPoint,
          targetPromptId
        );
        return;
      }
      if (embedded) {
        window.parent.postMessage(
          {
            type: MSG.importUrl,
            imageUrl: image.url,
            canvasId: activeCanvasId,
            promptId: targetPromptId,
            position: flowPoint
          } satisfies ImportUrlMessage,
          "*"
        );
        pushToast("正在读取拖入的图片…", { tone: "info", duration: 2200 });
        return;
      }
      try {
        const response = await fetch(image.url);
        if (!response.ok) throw new Error("图片读取失败");
        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) throw new Error("拖入的不是图片");
        await actions.addImagesFromFiles(
          [new File([blob], image.name || "拖入图片", { type: blob.type })],
          flowPoint,
          targetPromptId
        );
      } catch {
        pushToast("图片拖取受限，请复制图片后在画布中粘贴", { tone: "error" });
      }
    },
    [
      actions,
      activeCanvasId,
      clearDropTarget,
      embedded,
      flowPointAt,
      promptAtPoint,
      pushToast
    ]
  );

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (
          target.closest(
            ".react-flow__node, .react-flow__edge, .react-flow__minimap, .bb-zoom-controls, .bb-empty-state, .bb-drop-hint, .bb-edge-label"
          )
        ) {
          return;
        }
      }
      actions.addPromptAt(flowPointAt(event.clientX, event.clientY));
    },
    [actions, flowPointAt]
  );

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    lastPointerRef.current = { x: event.clientX, y: event.clientY };
  }, []);

  const handleNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: CanvasNode) => {
      event.preventDefault();
      if (node.data.kind === "image") return;
      setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
    },
    []
  );

  const handlePaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    []
  );

  const handleEdgeContextMenu = useCallback((event: ReactMouseEvent, edge: CanvasEdge) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, edgeId: edge.id });
  }, []);

  const contextNode = contextMenu?.nodeId
    ? nodes.find((node) => node.id === contextMenu.nodeId)
    : undefined;

  const contextItems = useMemo<MenuEntry[]>(() => {
    if (contextMenu?.edgeId) {
      const edgeId = contextMenu.edgeId;
      return [
        {
          label: "删除关系",
          icon: <TrashIcon size={14} />,
          danger: true,
          onSelect: () => actions.deleteEdges([edgeId])
        }
      ];
    }
    if (contextNode && contextNode.data.kind === "prompt") {
      const nodeId = contextNode.id;
      return [
        {
          label: "生成",
          shortcut: "Ctrl+Enter",
          disabled: !contextNode.data.prompt.trim(),
          onSelect: () => void actions.generatePrompt(nodeId)
        },
        {
          label: "复制提示词",
          shortcut: "Ctrl+C",
          disabled: !contextNode.data.prompt.trim(),
          onSelect: () => {
            void actions.copyPrompt(nodeId).then((copied) => {
              if (copied) pushToast("已复制提示词", { tone: "success", duration: 1800 });
            });
          }
        },
        {
          label: "创建分支",
          onSelect: () => actions.branchPrompt(nodeId)
        },
        "separator",
        {
          label: "删除节点",
          icon: <TrashIcon size={14} />,
          danger: true,
          onSelect: () => actions.deleteNode(nodeId)
        }
      ];
    }
    const position = contextMenu
      ? flowPointAt(contextMenu.x, contextMenu.y)
      : centerPoint();
    return [
      {
        label: "在这里新建提示词",
        icon: <PlusIcon size={14} />,
        onSelect: () => actions.addPromptAt(position)
      },
      {
        label: "查看全部内容",
        onSelect: () => actions.fitAll()
      },
      {
        label: "缩放至 100%",
        onSelect: () => actions.zoomTo(1)
      }
    ];
  }, [
    actions,
    centerPoint,
    contextMenu,
    contextNode,
    flowPointAt,
    pushToast
  ]);

  const minimapNodeColor = useCallback((node: CanvasNode) => {
    return node.data.kind === "prompt"
      ? "var(--bb-accent)"
      : "var(--bb-minimap-image)";
  }, []);

  const handleSelectionChange = useCallback(
    (params: OnSelectionChangeParams<CanvasNode, CanvasEdge>) => {
      actions.onSelectionChange(params.nodes);
    },
    [actions]
  );

  return (
    <div
      ref={wrapperRef}
      className={`bb-canvas tool-${tool} ${dragActive ? "is-dragging-file" : ""}`}
      onDoubleClick={handleDoubleClick}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(event) => void handleDrop(event)}
      onPointerMove={handlePointerMove}
    >
      <svg className="bb-edge-markers" aria-hidden="true">
        <defs>
          <marker
            id="bb-arrow-generated"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0 0 8 4 0 8Z" fill="var(--bb-edge-generated)" />
          </marker>
          <marker
            id="bb-arrow-reference"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0 0 8 4 0 8Z" fill="var(--bb-edge-reference)" />
          </marker>
          <marker
            id="bb-arrow-branch"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0 0 8 4 0 8Z" fill="var(--bb-edge-branch)" />
          </marker>
        </defs>
      </svg>

      <ReactFlow<CanvasNode, CanvasEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={actions.onNodesChange}
        onEdgesChange={actions.onEdgesChange}
        onConnect={actions.onConnect}
        onNodeDragStart={actions.onNodeDragStart}
        onNodeDragStop={actions.onNodeDragStop}
        onMoveEnd={(_event, viewport) => actions.onMoveEnd(viewport)}
        onSelectionChange={handleSelectionChange}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneContextMenu={handlePaneContextMenu}
        onEdgeContextMenu={handleEdgeContextMenu}
        minZoom={0.1}
        maxZoom={2.5}
        panOnDrag={[0, 1]}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        nodesDraggable={tool !== "hand"}
        selectionKeyCode="Shift"
        multiSelectionKeyCode={["Meta", "Control"]}
        panActivationKeyCode="Space"
        deleteKeyCode={null}
        nodesConnectable
        onlyRenderVisibleElements
        connectionLineStyle={{
          stroke: "var(--bb-accent)",
          strokeWidth: 1.6
        }}
        proOptions={{ hideAttribution: true }}
        className="bb-flow"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={0.8}
          color="var(--bb-canvas-dot)"
        />
        {nodes.length ? (
          <MiniMap
            className="bb-minimap"
            nodeColor={minimapNodeColor}
            nodeStrokeWidth={0}
            maskColor="var(--bb-minimap-mask)"
            pannable
            zoomable
          />
        ) : null}
      </ReactFlow>

      {!nodes.length ? (
        <div className="bb-empty-state">
          <button
            type="button"
            className="bb-empty-add"
            aria-label="新建提示词"
            onClick={() => actions.addPromptAtCenter()}
          >
            <PlusIcon size={22} />
          </button>
          <strong>双击画布，写下一个想法</strong>
          <p>也可以把图片拖进来，或按 Ctrl+V 粘贴图片。</p>
        </div>
      ) : null}

      <div className="bb-tool-rail" role="toolbar" aria-label="画布工具">
        <IconButton
          label="选择 (V)"
          active={tool === "select"}
          onClick={() => setTool("select")}
        >
          <CursorIcon size={17} />
        </IconButton>
        <IconButton
          label="平移 (H)"
          active={tool === "hand"}
          onClick={() => setTool("hand")}
        >
          <HandIcon size={17} />
        </IconButton>
        <span className="bb-rail-line" aria-hidden="true" />
        <IconButton
          label="新建提示词 (N)"
          disabled={busy}
          onClick={() => actions.addPromptAtCenter()}
        >
          <TextIcon size={17} />
        </IconButton>
        <IconButton
          label="导入图片"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlusIcon size={17} />
        </IconButton>
      </div>

      <div className="bb-history-buttons">
        <IconButton label="撤销 (Ctrl+Z)" disabled={!canUndo} onClick={actions.undo}>
          <UndoIcon size={16} />
        </IconButton>
        <IconButton
          label="重做 (Shift+Ctrl+Z)"
          disabled={!canRedo}
          onClick={actions.redo}
        >
          <RedoIcon size={16} />
        </IconButton>
      </div>

      <div className="bb-canvas-hint" aria-hidden="true">
        <MouseIcon size={13} />
        双击新建 · 滚轮平移 · Ctrl + 滚轮缩放
      </div>

      <ZoomControls />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []).filter((file) =>
            file.type.startsWith("image/")
          );
          if (files.length) {
            void actions.addImagesFromFiles(files, centerPoint());
          }
          event.target.value = "";
        }}
      />

      {dragActive ? (
        <div className="bb-drop-hint">
          {dropTargetPromptId
            ? `松开作为参考图加入「${promptLabel(
                nodes.find((node) => node.id === dropTargetPromptId)
              )}」`
            : "松开以加入图片；拖到提示词上可作为参考图"}
        </div>
      ) : null}

      {contextMenu ? (
        <Menu
          x={contextMenu.x}
          y={contextMenu.y}
          header={
            contextMenu.edgeId
              ? "节点关系"
              : contextNode?.data.kind === "prompt"
                ? promptLabel(contextNode)
                : "画布"
          }
          items={contextItems}
          onClose={closeContextMenu}
        />
      ) : null}
    </div>
  );
}
