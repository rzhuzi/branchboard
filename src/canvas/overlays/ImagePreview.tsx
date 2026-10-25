import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton } from "../ui/controls";
import { CloseIcon, DownloadIcon, CopyIcon, PenIcon } from "../ui/icons";

export function ImagePreview({
  url,
  name,
  onClose,
  onContinue,
  onCopy,
  onDownload,
  onAnnotate
}: {
  url: string;
  name: string;
  onClose: () => void;
  onContinue: () => void;
  onCopy: () => Promise<boolean>;
  onDownload: () => void;
  onAnnotate: () => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  return createPortal(
    <div
      className="bb-overlay bb-image-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="bb-preview-header">
        <span title={name}>{name || "图片预览"}</span>
        <IconButton label="关闭预览" size="sm" onClick={onClose}>
          <CloseIcon size={15} />
        </IconButton>
      </header>
      <div className="bb-preview-stage">
        <img src={url} alt={name || "图片预览"} draggable={false} />
      </div>
      <footer className="bb-preview-actions">
        <Button variant="primary" onClick={onContinue}>
          继续修改
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            const copied = await onCopy();
            setCopyState(copied ? "copied" : "error");
          }}
        >
          <CopyIcon size={14} />
          {copyState === "copied" ? "已复制" : copyState === "error" ? "复制失败" : "复制图片"}
        </Button>
        <Button variant="secondary" onClick={onDownload}>
          <DownloadIcon size={14} />
          下载
        </Button>
        <Button variant="secondary" onClick={onAnnotate}>
          <PenIcon size={14} />
          标注
        </Button>
      </footer>
    </div>,
    document.body
  );
}
