import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import { createPortal } from "react-dom";
import { Button, IconButton } from "../ui/controls";
import {
  ArrowIcon,
  CloseIcon,
  PenIcon,
  SquareIcon,
  TrashIcon,
  UndoIcon
} from "../ui/icons";

type Point = { x: number; y: number };
type Size = { width: number; height: number };
type AnnotationTool = "pen" | "rect" | "arrow";

type AnnotationOperation = {
  tool: AnnotationTool;
  color: string;
  width: number;
  points: Point[];
};

const COLORS = ["#ef4a3d", "#f0a12d", "#2f7de1", "#ffffff", "#151714"];

function drawArrow(
  context: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  width: number
) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const headLength = Math.max(12, width * 5.5);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(
    end.x - headLength * Math.cos(angle - Math.PI / 6),
    end.y - headLength * Math.sin(angle - Math.PI / 6)
  );
  context.moveTo(end.x, end.y);
  context.lineTo(
    end.x - headLength * Math.cos(angle + Math.PI / 6),
    end.y - headLength * Math.sin(angle + Math.PI / 6)
  );
  context.stroke();
}

function drawOperation(
  context: CanvasRenderingContext2D,
  operation: AnnotationOperation
) {
  const [start, ...remaining] = operation.points;
  if (!start) return;
  const end = operation.points[operation.points.length - 1] ?? start;
  context.save();
  context.strokeStyle = operation.color;
  context.lineWidth = operation.width;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (operation.tool === "pen") {
    context.beginPath();
    context.moveTo(start.x, start.y);
    for (const point of remaining) context.lineTo(point.x, point.y);
    context.stroke();
  } else if (operation.tool === "rect") {
    context.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
  } else {
    drawArrow(context, start, end, operation.width);
  }
  context.restore();
}

export function AnnotationEditor({
  url,
  name,
  onCancel,
  onSave
}: {
  url: string;
  name: string;
  onCancel: () => void;
  onSave: (blob: Blob, size: Size) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [naturalSize, setNaturalSize] = useState<Size>({ width: 0, height: 0 });
  const [stageSize, setStageSize] = useState<Size>({ width: 0, height: 0 });
  const [zoomRatio, setZoomRatio] = useState(1);
  const [tool, setTool] = useState<AnnotationTool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(5);
  const [operations, setOperations] = useState<AnnotationOperation[]>([]);
  const [draft, setDraft] = useState<AnnotationOperation | null>(null);
  const [saving, setSaving] = useState(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !ready) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const operation of operations) drawOperation(context, operation);
    if (draft) drawOperation(context, draft);
  }, [draft, operations, ready]);

  useEffect(() => {
    setReady(false);
    setZoomRatio(1);
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      imageRef.current = image;
      setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
      setReady(true);
    };
    image.src = url;
  }, [url]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      setStageSize({
        width: Math.max(1, stage.clientWidth - 48),
        height: Math.max(1, stage.clientHeight - 48)
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "z"
      ) {
        event.preventDefault();
        setOperations((current) => current.slice(0, -1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const canvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height)
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!ready) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const scale = event.currentTarget.width / bounds.width;
    setDraft({
      tool,
      color,
      width: strokeWidth * scale,
      points: [canvasPoint(event)]
    });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!draft) return;
    const point = canvasPoint(event);
    setDraft((current) => {
      if (!current) return null;
      return current.tool === "pen"
        ? { ...current, points: [...current.points, point] }
        : { ...current, points: [current.points[0], point] };
    });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!draft) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setOperations((current) => [...current, draft]);
    setDraft(null);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas || saving) return;
    redraw();
    setSaving(true);
    canvas.toBlob(
      (blob) => {
        setSaving(false);
        if (!blob) return;
        onSave(blob, {
          width: naturalSize.width,
          height: naturalSize.height
        });
      },
      "image/png"
    );
  };

  const fitScale = useMemo(() => {
    if (!naturalSize.width || !stageSize.width) return 0;
    return Math.min(
      stageSize.width / naturalSize.width,
      stageSize.height / naturalSize.height,
      1
    );
  }, [naturalSize, stageSize]);

  const displayScale = fitScale * zoomRatio;
  const displayWidth = Math.round(naturalSize.width * displayScale);
  const displayHeight = Math.round(naturalSize.height * displayScale);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!fitScale || !ready) return;
    event.preventDefault();
    const delta = Math.max(-120, Math.min(120, event.deltaY));
    const factor = Math.exp(-delta * 0.0022);
    setZoomRatio((current) => {
      const nextScale = Math.max(0.05, Math.min(4, fitScale * current * factor));
      return nextScale / fitScale;
    });
  };

  return createPortal(
    <div className="bb-overlay bb-annotation-overlay" role="dialog" aria-modal="true">
      <section className="bb-annotation-panel">
        <header className="bb-overlay-header">
          <div>
            <strong>标注图片</strong>
            <span>{name || "图片"}</span>
          </div>
          <IconButton label="关闭标注" size="sm" onClick={onCancel}>
            <CloseIcon size={15} />
          </IconButton>
        </header>

        <div className="bb-annotation-toolbar">
          <div className="bb-tool-group" role="group" aria-label="标注工具">
            <IconButton
              label="画笔"
              size="sm"
              active={tool === "pen"}
              onClick={() => setTool("pen")}
            >
              <PenIcon size={15} />
            </IconButton>
            <IconButton
              label="矩形"
              size="sm"
              active={tool === "rect"}
              onClick={() => setTool("rect")}
            >
              <SquareIcon size={15} />
            </IconButton>
            <IconButton
              label="箭头"
              size="sm"
              active={tool === "arrow"}
              onClick={() => setTool("arrow")}
            >
              <ArrowIcon size={15} />
            </IconButton>
          </div>
          <div className="bb-color-group" aria-label="标注颜色">
            {COLORS.map((value) => (
              <button
                key={value}
                type="button"
                className={`bb-color-swatch ${color === value ? "active" : ""}`}
                style={{ backgroundColor: value }}
                aria-label={`颜色 ${value}`}
                onClick={() => setColor(value)}
              />
            ))}
          </div>
          <label className="bb-width-control">
            <span>粗细</span>
            <input
              type="range"
              min="2"
              max="18"
              value={strokeWidth}
              onChange={(event) => setStrokeWidth(Number(event.target.value))}
            />
          </label>
          <div className="bb-tool-group">
            <IconButton
              label="撤销笔画"
              size="sm"
              disabled={!operations.length}
              onClick={() => setOperations((current) => current.slice(0, -1))}
            >
              <UndoIcon size={15} />
            </IconButton>
            <IconButton
              label="清空标注"
              size="sm"
              disabled={!operations.length}
              onClick={() => setOperations([])}
            >
              <TrashIcon size={15} />
            </IconButton>
          </div>
        </div>

        <div className="bb-annotation-stage-shell">
          <div className="bb-annotation-stage" ref={stageRef} onWheel={handleWheel}>
            <div
              className="bb-annotation-space"
              style={{ minWidth: displayWidth, minHeight: displayHeight }}
            >
              <canvas
                ref={canvasRef}
                style={{
                  width: displayWidth || undefined,
                  height: displayHeight || undefined,
                  visibility: displayScale ? "visible" : "hidden"
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={() => setDraft(null)}
              />
            </div>
          </div>
          <button
            type="button"
            className="bb-zoom-value floating"
            onClick={() => setZoomRatio(1)}
            title="恢复自动适配"
          >
            {displayScale ? `${Math.round(displayScale * 100)}%` : "适配中"}
          </button>
        </div>

        <footer className="bb-annotation-footer">
          <span className="bb-annotation-hint">Esc 关闭 · Ctrl+Z 撤销 · 滚轮缩放</span>
          <div>
            <Button variant="secondary" onClick={onCancel}>
              取消
            </Button>
            <Button variant="primary" disabled={!ready || saving} onClick={handleSave}>
              {saving ? "保存中…" : "保存标注"}
            </Button>
          </div>
        </footer>
      </section>
    </div>,
    document.body
  );
}
