import { memo, useEffect, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { CanvasNode, ImageNodeData } from "../../shared/types";
import { AnnotationEditor } from "../overlays/AnnotationEditor";
import { ImagePreview } from "../overlays/ImagePreview";
import { useAsset } from "../state/AssetProvider";
import { useEditorActions } from "../state/EditorContext";
import { IconButton } from "../ui/controls";
import {
  BranchIcon,
  CopyIcon,
  DownloadIcon,
  ExpandIcon,
  ImageIcon,
  MoreIcon,
  PenIcon,
  TrashIcon
} from "../ui/icons";
import { Menu, type MenuEntry } from "../ui/Menu";

type MenuState = { x: number; y: number };

export const ImageNode = memo(function ImageNode({
  id,
  data: rawData,
  selected
}: NodeProps<CanvasNode>) {
  const data = rawData as ImageNodeData;
  const actions = useEditorActions();
  const { asset, error, loading } = useAsset(data.assetId);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const handleCopy = async (): Promise<boolean> => {
    const copied = await actions.copyImage(id);
    setCopyState(copied ? "copied" : "error");
    return copied;
  };

  const menuItems: MenuEntry[] = [
    {
      label: "预览大图",
      icon: <ExpandIcon size={14} />,
      disabled: !asset,
      onSelect: () => setPreviewing(true)
    },
    {
      label: "继续修改",
      icon: <BranchIcon size={14} />,
      onSelect: () => actions.continueFromImage(id)
    },
    "separator",
    {
      label: "复制图片",
      icon: <CopyIcon size={14} />,
      disabled: !asset,
      onSelect: () => void handleCopy()
    },
    {
      label: "下载图片",
      icon: <DownloadIcon size={14} />,
      disabled: !asset,
      onSelect: () => actions.downloadImage(id)
    },
    {
      label: "标注图片",
      icon: <PenIcon size={14} />,
      disabled: !asset,
      onSelect: () => setAnnotating(true)
    },
    ...(data.originalAssetId
      ? [
          {
            label: "恢复原图",
            icon: <ImageIcon size={14} />,
            onSelect: () => actions.restoreOriginal(id)
          } satisfies MenuEntry
        ]
      : []),
    "separator",
    {
      label: "删除节点",
      icon: <TrashIcon size={14} />,
      danger: true,
      onSelect: () => actions.deleteNode(id)
    }
  ];

  return (
    <article
      className={`bb-node bb-image-node ${selected ? "is-selected" : ""}`.trim()}
      style={{ width: 320 }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <Handle type="target" position={Position.Left} className="bb-handle" />
      <div
        className="bb-image-card"
        onDoubleClick={() => {
          if (asset) setPreviewing(true);
        }}
        title={asset ? "双击预览大图" : error || "图片加载中"}
      >
        <div className="bb-image-frame">
          {asset ? (
            <img src={asset.url} alt={data.name || "图片"} draggable={false} />
          ) : (
            <div className={`bb-image-placeholder ${error ? "error" : ""}`}>
              {loading ? <span className="bb-image-loading">正在加载图片</span> : null}
              {error ? (
                <>
                  <ImageIcon size={18} />
                  <span>图片不可用</span>
                </>
              ) : null}
            </div>
          )}

          {data.originalAssetId ? (
            <span className="bb-image-badge" title="已标注，可从菜单恢复原图">
              已标注
            </span>
          ) : null}
          {copyState !== "idle" ? (
            <span className={`bb-image-feedback ${copyState}`}>
              {copyState === "copied" ? "已复制" : "复制失败"}
            </span>
          ) : null}

          <button
            type="button"
            className="bb-image-menu-button nodrag"
            aria-label="图片操作"
            title="图片操作"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMenu({ x: rect.left, y: rect.bottom + 4 });
            }}
          >
            <MoreIcon size={14} />
          </button>
        </div>

        <div className="bb-image-label">
          <ImageIcon size={13} />
          <span className="bb-image-label-name">{data.name || "图片"}</span>
          {data.width && data.height ? (
            <span className="bb-image-size">
              {data.width} × {data.height}
            </span>
          ) : null}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="bb-handle" />

      {asset ? (
        <div className="bb-image-actions nodrag">
          <button
            type="button"
            className="primary"
            onClick={() => actions.continueFromImage(id)}
          >
            <BranchIcon size={13} />
            继续修改
          </button>
          <span className="bb-actions-divider" aria-hidden="true" />
          <IconButton
            label="预览图片"
            onClick={() => setPreviewing(true)}
          >
            <ExpandIcon size={14} />
          </IconButton>
          <IconButton
            label="下载图片"
            onClick={() => actions.downloadImage(id)}
          >
            <DownloadIcon size={14} />
          </IconButton>
        </div>
      ) : null}

      {menu ? (
        <Menu
          x={menu.x}
          y={menu.y}
          header={data.name || "图片"}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {previewing && asset ? (
        <ImagePreview
          url={asset.url}
          name={data.name}
          onClose={() => setPreviewing(false)}
          onContinue={() => {
            setPreviewing(false);
            actions.continueFromImage(id);
          }}
          onCopy={handleCopy}
          onDownload={() => actions.downloadImage(id)}
          onAnnotate={() => {
            setPreviewing(false);
            setAnnotating(true);
          }}
        />
      ) : null}

      {annotating && asset ? (
        <AnnotationEditor
          url={asset.url}
          name={data.name}
          onCancel={() => setAnnotating(false)}
          onSave={(blob, size) => {
            setAnnotating(false);
            void actions.annotateImage(id, blob, size);
          }}
        />
      ) : null}
    </article>
  );
});
