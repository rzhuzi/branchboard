import { useState } from "react";
import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps
} from "@xyflow/react";
import {
  copyText,
  openChatGpt,
  setActivePrompt
} from "../../shared/browser";
import type {
  CanvasEdge,
  CanvasNode,
  PromptNodeData
} from "../../shared/types";
import { useExecutionSession } from "../ExecutionSessionContext";
import { useExecutionSettings } from "../ExecutionSettingsContext";

function createPromptData(prompt = ""): PromptNodeData {
  return {
    kind: "prompt",
    title: "新提示词",
    prompt,
    createdAt: new Date().toISOString()
  };
}

export function PromptNode(props: NodeProps<CanvasNode>) {
  const { id, data: rawData, selected } = props;
  const data = rawData as PromptNodeData;
  const isEmbedded =
    new URLSearchParams(window.location.search).get("embedded") === "1";
  const [copyState, setCopyState] = useState<
    "idle" | "copied" | "error"
  >("idle");
  const [copyError, setCopyError] = useState("");
  const { mode } = useExecutionSettings();
  const {
    executions,
    isBusy,
    currentCanvasId,
    beginExecution
  } = useExecutionSession();
  const executionState = executions[id] ?? {
    tone: "idle" as const,
    message: ""
  };
  const { setNodes, setEdges, getNode, getEdges } = useReactFlow<
    CanvasNode,
    CanvasEdge
  >();

  const updateData = (patch: Partial<PromptNodeData>) => {
    const nextData = {
      ...data,
      ...patch
    } satisfies PromptNodeData;
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: nextData
            }
          : node
      )
    );
    void setActivePrompt({
      id,
      title: nextData.title,
      prompt: nextData.prompt
    });
  };

  const markActive = async () => {
    await setActivePrompt({
      id,
      title: data.title,
      prompt: data.prompt
    });
  };

  const handleCopy = async () => {
    if (!data.prompt.trim()) return false;
    try {
      setCopyError("");
      await copyText(data.prompt);
      await markActive();
      setCopyState("copied");
    } catch (error) {
      setCopyState("error");
      setCopyError(
        error instanceof Error ? error.message : "复制提示词失败"
      );
      window.setTimeout(() => setCopyState("idle"), 2600);
      return false;
    }
    window.setTimeout(() => setCopyState("idle"), 1400);
    return true;
  };

  const handleCopyAndOpen = async () => {
    if (!data.prompt.trim()) return;
    if (!(await handleCopy())) return;
    if (isEmbedded) {
      window.parent.postMessage(
        { type: "branchboard:minimize-floating-canvas" },
        "*"
      );
      return;
    }
    await openChatGpt();
  };

  const handleExecute = async () => {
    if (!data.prompt.trim() || isBusy) return;
    await markActive();

    if (!isEmbedded) {
      await handleCopyAndOpen();
      return;
    }

    const upstreamImage = getEdges()
      .filter((edge) => edge.target === id)
      .map((edge) => getNode(edge.source))
      .reverse()
      .find((node) => node?.data.kind === "image");
    const requestId = crypto.randomUUID();
    const started = beginExecution({
      requestId,
      promptId: id,
      message: upstreamImage ? "正在附加参考图" : "正在填入 ChatGPT"
    });
    if (!started) return;
    window.parent.postMessage(
      {
        type: "branchboard:execute-prompt",
        requestId,
        canvasId: currentCanvasId,
        promptId: id,
        title: data.title,
        prompt: data.prompt,
        referenceImage:
          upstreamImage?.data.kind === "image"
            ? {
                dataUrl: upstreamImage.data.dataUrl,
                name: upstreamImage.data.name
              }
            : null
      },
      "*"
    );
  };

  const handleBranch = () => {
    const parent = getNode(id);
    if (!parent) return;
    const childId = crypto.randomUUID();
    const siblingCount = getEdges().filter((edge) => edge.source === id).length;

    setNodes((nodes) => [
      ...nodes.map((node) => ({ ...node, selected: false })),
      {
        id: childId,
        type: "prompt",
        position: {
          x: parent.position.x + 430,
          y: parent.position.y + siblingCount * 330
        },
        selected: true,
        data: createPromptData(data.prompt)
      }
    ]);
    setEdges((edges) => [
      ...edges,
      {
        id: `edge-${id}-${childId}`,
        source: id,
        target: childId,
        type: "smoothstep",
        label: "提示词分支"
      }
    ]);
  };

  return (
    <article
      className={`prompt-node ${selected ? "is-selected" : ""}`}
      onPointerDown={() => void markActive()}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="node-handle"
        isConnectable={false}
      />

      <header className="node-header">
        <span className="node-kicker">
          <i className="node-kicker-dot" />
          {mode === "auto" ? "AUTO PROMPT" : "PROMPT"}
        </span>
        <button
          className="icon-button nodrag"
          type="button"
          title="创建分支"
          onClick={handleBranch}
        >
          ↗
        </button>
      </header>

      <input
        className="node-title nodrag"
        value={data.title}
        aria-label="提示词标题"
        onChange={(event) => updateData({ title: event.target.value })}
        onFocus={() => void markActive()}
      />

      <textarea
        className="prompt-editor nodrag nowheel"
        value={data.prompt}
        aria-label="提示词内容"
        placeholder="描述你想生成的画面……"
        onChange={(event) => updateData({ prompt: event.target.value })}
        onFocus={() => void markActive()}
      />

      <footer className="node-actions">
        <button
          className="node-button nodrag"
          type="button"
          disabled={!data.prompt.trim()}
          onClick={() => void handleCopy()}
        >
          {copyState === "copied"
            ? "已复制"
            : copyState === "error"
              ? "复制失败"
              : "复制"}
        </button>
        <button
          className="node-button node-button-primary nodrag"
          type="button"
          disabled={!data.prompt.trim() || (mode === "auto" && isBusy)}
          onClick={() =>
            void (mode === "auto" ? handleExecute() : handleCopyAndOpen())
          }
        >
          {mode === "auto"
            ? executionState.tone === "working"
              ? "正在生成并回收…"
              : isBusy
                ? "其他节点运行中"
              : "发送并自动回收"
            : isEmbedded
              ? "复制并收起画布"
              : "复制并前往 GPT"}
        </button>
      </footer>

      {mode === "auto" && executionState.message ? (
        <div className={`execution-status ${executionState.tone}`}>
          <i />
          <span>{executionState.message}</span>
        </div>
      ) : null}
      {mode === "manual" && copyError ? (
        <div className="execution-status error">
          <i />
          <span>{copyError}</span>
        </div>
      ) : null}

      <Handle
        type="source"
        position={Position.Right}
        className="node-handle"
        isConnectable={false}
      />
    </article>
  );
}
