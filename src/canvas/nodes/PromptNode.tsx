import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import {
  Handle,
  Position,
  useReactFlow,
  useStore,
  type NodeProps
} from "@xyflow/react";
import type {
  CanvasEdge,
  CanvasNode,
  PromptNodeData
} from "../../shared/types";
import { useEditorActions } from "../state/EditorContext";
import { useExecution } from "../state/ExecutionProvider";
import { IconButton, Spinner } from "../ui/controls";
import { BranchIcon, CloseIcon, CopyIcon, GripIcon } from "../ui/icons";

function useElapsed(startedAt: number, active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return Math.max(0, now - startedAt);
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export const PromptNode = memo(function PromptNode({
  id,
  data: rawData,
  selected
}: NodeProps<CanvasNode>) {
  const data = rawData as PromptNodeData;
  const actions = useEditorActions();
  const executionApi = useExecution();
  const execution = executionApi.entries[id] ?? null;
  const { getEdges, getNodes } = useReactFlow<CanvasNode, CanvasEdge>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const elapsed = useElapsed(execution?.startedAt ?? Date.now(), execution?.tone === "working");

  const generatedCount = useStore((state) => {
    const edges = state.edges as CanvasEdge[];
    return edges.filter(
      (edge) => edge.source === id && edge.data?.relation === "generated"
    ).length;
  });
  const referenceCount = useStore((state) => {
    const edges = state.edges as CanvasEdge[];
    return edges.filter(
      (edge) => edge.target === id && edge.data?.relation === "reference"
    ).length;
  });

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    const next = Math.min(320, Math.max(96, textarea.scrollHeight));
    textarea.style.height = `${next}px`;
  }, [data.prompt]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const locateRelated = (relation: "generated" | "reference") => {
    const edges = getEdges();
    const nodes = getNodes();
    const ids = edges
      .filter((edge) =>
        relation === "generated"
          ? edge.source === id && edge.data?.relation === "generated"
          : edge.target === id && edge.data?.relation === "reference"
      )
      .map((edge) => (relation === "generated" ? edge.target : edge.source))
      .filter((nodeId) => nodes.some((node) => node.id === nodeId));
    if (ids.length) actions.locateNodes(ids);
  };

  const busy = execution?.tone === "working" || execution?.tone === "queued";
  const failed = execution?.tone === "error";
  const generateLabel = busy ? "取消" : failed ? "重试" : "生成";

  const handleGenerate = () => {
    if (busy) {
      executionApi.cancelPrompt(id);
      return;
    }
    void actions.generatePrompt(id);
  };

  const handleCopy = async () => {
    const copied = await actions.copyPrompt(id);
    setCopyState(copied ? "copied" : "error");
  };

  return (
    <article
      className={`bb-node bb-prompt-node ${selected ? "is-selected" : ""} ${
        execution?.tone === "working" ? "is-running" : ""
      } ${execution?.tone === "error" ? "has-error" : ""}`.trim()}
    >
      <Handle type="target" position={Position.Left} className="bb-handle" />
      <header className="bb-prompt-head" title="拖动节点">
        <span className="bb-grip" aria-hidden="true">
          <GripIcon size={14} />
        </span>
        <div className="bb-node-counts">
          {generatedCount > 0 ? (
            <button
              type="button"
              className="bb-node-count nodrag"
              title="定位生成结果"
              onClick={() => locateRelated("generated")}
            >
              {generatedCount} 结果
            </button>
          ) : null}
          {referenceCount > 0 ? (
            <button
              type="button"
              className="bb-node-count nodrag"
              title="定位参考图"
              onClick={() => locateRelated("reference")}
            >
              {referenceCount} 参考
            </button>
          ) : null}
        </div>
      </header>

      <textarea
        ref={textareaRef}
        className="bb-prompt-input nodrag nowheel"
        value={data.prompt}
        placeholder="描述你想生成的画面…"
        aria-label="提示词内容"
        spellCheck={false}
        onChange={(event) => actions.updatePrompt(id, event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            void actions.generatePrompt(id);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />

      {execution ? (
        <div className={`bb-node-status ${execution.tone}`}>
          {execution.tone === "working" || execution.tone === "queued" ? (
            <Spinner size={12} />
          ) : execution.tone === "done" ? (
            <span className="bb-status-mark" aria-hidden="true">
              ✓
            </span>
          ) : execution.tone === "error" ? (
            <span className="bb-status-mark" aria-hidden="true">
              !
            </span>
          ) : null}
          <span className="bb-status-text">{execution.message}</span>
          {execution.tone === "working" ? (
            <span className="bb-status-time">{formatElapsed(elapsed)}</span>
          ) : (
            <button
              type="button"
              className="bb-status-close nodrag"
              aria-label="关闭状态"
              onClick={() => executionApi.dismissPrompt(id)}
            >
              <CloseIcon size={12} />
            </button>
          )}
        </div>
      ) : null}

      <footer className="bb-node-footer">
        <span className={`bb-node-feedback ${copyState}`}>
          {copyState === "copied" ? "已复制" : copyState === "error" ? "复制失败" : ""}
        </span>
        <div className="bb-node-actions">
          <IconButton
            label="复制提示词"
            size="sm"
            className="nodrag"
            disabled={!data.prompt.trim()}
            onClick={() => void handleCopy()}
          >
            <CopyIcon size={14} />
          </IconButton>
          <IconButton
            label="创建分支"
            size="sm"
            className="nodrag"
            onClick={() => actions.branchPrompt(id)}
          >
            <BranchIcon size={14} />
          </IconButton>
          <button
            type="button"
            className={`bb-generate-button nodrag ${busy ? "cancel" : ""} ${
              failed ? "retry" : ""
            }`}
            disabled={!data.prompt.trim() && !busy}
            onClick={handleGenerate}
          >
            {execution?.tone === "working" || execution?.tone === "queued" ? (
              <Spinner size={11} />
            ) : null}
            {generateLabel}
          </button>
        </div>
      </footer>
      <Handle type="source" position={Position.Right} className="bb-handle" />
    </article>
  );
});
