import { useState } from "react";
import { createPortal } from "react-dom";
import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps
} from "@xyflow/react";
import type {
  CanvasEdge,
  CanvasNode,
  ImageNodeData,
  PromptNodeData
} from "../../shared/types";
import { copyImage } from "../../shared/browser";
import { AnnotationEditor } from "../AnnotationEditor";

export function ImageNode(props: NodeProps<CanvasNode>) {
  const { id, data: rawData, selected } = props;
  const data = rawData as ImageNodeData;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle"
  );
  const [isAnnotating, setIsAnnotating] = useState(false);
  const { setNodes, setEdges, getNode, getEdges } = useReactFlow<
    CanvasNode,
    CanvasEdge
  >();

  const handleCopy = async () => {
    try {
      await copyImage(data.dataUrl);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    window.setTimeout(() => setCopyState("idle"), 1600);
  };

  const handleContinue = () => {
    const parent = getNode(id);
    if (!parent) return;
    const childId = crypto.randomUUID();
    const siblingCount = getEdges().filter((edge) => edge.source === id).length;
    const promptData: PromptNodeData = {
      kind: "prompt",
      title: "继续修改",
      prompt: "",
      createdAt: new Date().toISOString()
    };

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
        data: promptData
      }
    ]);
    setEdges((edges) => [
      ...edges,
      {
        id: `edge-${id}-${childId}`,
        source: id,
        target: childId,
        type: "smoothstep",
        label: "参考图"
      }
    ]);
  };

  const handleSaveAnnotation = (dataUrl: string) => {
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id && node.data.kind === "image"
          ? {
              ...node,
              data: {
                ...node.data,
                dataUrl,
                annotatedAt: new Date().toISOString()
              }
            }
          : node
      )
    );
    setIsAnnotating(false);
  };

  return (
    <article className={`image-node ${selected ? "is-selected" : ""}`}>
      <Handle
        type="target"
        position={Position.Left}
        className="node-handle"
        isConnectable={false}
      />
      <div className="image-frame">
        <img src={data.dataUrl} alt={data.name || "生成图片"} draggable={false} />
        <span className="image-index">OUTPUT</span>
      </div>
      <div className="image-meta">
        <div>
          <strong>{data.name || "生成结果"}</strong>
          <span>{new Date(data.createdAt).toLocaleString("zh-CN")}</span>
        </div>
        <div className="image-actions">
          <button
            className="node-button nodrag"
            type="button"
            onClick={() => setIsAnnotating(true)}
          >
            标注
          </button>
          <button className="node-button nodrag" type="button" onClick={() => void handleCopy()}>
            {copyState === "copied"
              ? "已复制"
              : copyState === "error"
                ? "复制失败"
                : "复制图片"}
          </button>
          <button
            className="node-button node-button-primary nodrag"
            type="button"
            onClick={handleContinue}
          >
            继续修改
          </button>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="node-handle"
        isConnectable={false}
      />
      {isAnnotating
        ? createPortal(
            <AnnotationEditor
              dataUrl={data.dataUrl}
              onCancel={() => setIsAnnotating(false)}
              onSave={handleSaveAnnotation}
            />,
            document.body
          )
        : null}
    </article>
  );
}

