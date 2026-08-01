import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Point = {
  x: number;
  y: number;
};

type Size = {
  width: number;
  height: number;
};

type AnnotationTool = "pen" | "rect" | "arrow";

type AnnotationOperation = {
  tool: AnnotationTool;
  color: string;
  width: number;
  points: Point[];
};

type AnnotationEditorProps = {
  dataUrl: string;
  onCancel: () => void;
  onSave: (dataUrl: string) => void;
};

const COLORS = ["#ff4d3d", "#ffb020", "#2f80ed", "#ffffff", "#151611"];

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
  const [start, ...remainingPoints] = operation.points;
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
    for (const point of remainingPoints) context.lineTo(point.x, point.y);
    context.stroke();
  } else if (operation.tool === "rect") {
    context.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
  } else {
    drawArrow(context, start, end, operation.width);
  }
  context.restore();
}

export function AnnotationEditor({
  dataUrl,
  onCancel,
  onSave
}: AnnotationEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [naturalSize, setNaturalSize] = useState<Size>({
    width: 0,
    height: 0
  });
  const [stageSize, setStageSize] = useState<Size>({ width: 0, height: 0 });
  const [zoomRatio, setZoomRatio] = useState(1);
  const [tool, setTool] = useState<AnnotationTool>("pen");
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(5);
  const [operations, setOperations] = useState<AnnotationOperation[]>([]);
  const [draft, setDraft] = useState<AnnotationOperation | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !imageReady) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const operation of operations) drawOperation(context, operation);
    if (draft) drawOperation(context, draft);
  }, [draft, imageReady, operations]);

  useEffect(() => {
    setImageReady(false);
    setZoomRatio(1);
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      imageRef.current = image;
      setNaturalSize({
        width: image.naturalWidth,
        height: image.naturalHeight
      });
      setImageReady(true);
    };
    image.src = dataUrl;
  }, [dataUrl]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const updateSize = () => {
      const style = window.getComputedStyle(stage);
      const horizontalPadding =
        Number.parseFloat(style.paddingLeft) +
        Number.parseFloat(style.paddingRight);
      const verticalPadding =
        Number.parseFloat(style.paddingTop) +
        Number.parseFloat(style.paddingBottom);
      setStageSize({
        width: Math.max(1, stage.clientWidth - horizontalPadding),
        height: Math.max(1, stage.clientHeight - verticalPadding)
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        setOperations((current) => current.slice(0, -1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height)
    };
  };

  const handlePointerDown = (
    event: React.PointerEvent<HTMLCanvasElement>
  ) => {
    if (!imageReady) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const scale = event.currentTarget.width / bounds.width;
    const point = canvasPoint(event);
    setDraft({
      tool,
      color,
      width: strokeWidth * scale,
      points: [point]
    });
  };

  const handlePointerMove = (
    event: React.PointerEvent<HTMLCanvasElement>
  ) => {
    if (!draft) return;
    const point = canvasPoint(event);
    setDraft((current) => {
      if (!current) return null;
      if (current.tool === "pen") {
        return { ...current, points: [...current.points, point] };
      }
      return { ...current, points: [current.points[0], point] };
    });
  };

  const handlePointerUp = (
    event: React.PointerEvent<HTMLCanvasElement>
  ) => {
    if (!draft) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setOperations((current) => [...current, draft]);
    setDraft(null);
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    redraw();
    onSave(canvas.toDataURL("image/png"));
  };

  const fitScale = useMemo(() => {
    if (
      !naturalSize.width ||
      !naturalSize.height ||
      !stageSize.width ||
      !stageSize.height
    ) {
      return 0;
    }
    return Math.min(
      stageSize.width / naturalSize.width,
      stageSize.height / naturalSize.height,
      1
    );
  }, [naturalSize, stageSize]);

  const displayScale = fitScale * zoomRatio;
  const displayWidth = Math.round(naturalSize.width * displayScale);
  const displayHeight = Math.round(naturalSize.height * displayScale);

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!fitScale || !imageReady) return;
    event.preventDefault();

    const stage = event.currentTarget;
    const bounds = stage.getBoundingClientRect();
    const pointerOffsetX = event.clientX - bounds.left;
    const pointerOffsetY = event.clientY - bounds.top;
    const originX =
      (stage.scrollLeft + pointerOffsetX) / Math.max(stage.scrollWidth, 1);
    const originY =
      (stage.scrollTop + pointerOffsetY) / Math.max(stage.scrollHeight, 1);
    const delta = Math.max(-120, Math.min(120, event.deltaY));
    const factor = Math.exp(-delta * 0.0022);

    setZoomRatio((current) => {
      const currentScale = fitScale * current;
      const nextScale = Math.max(
        0.05,
        Math.min(4, currentScale * factor)
      );
      const nextRatio = nextScale / fitScale;

      window.requestAnimationFrame(() => {
        stage.scrollLeft =
          originX * stage.scrollWidth - pointerOffsetX;
        stage.scrollTop =
          originY * stage.scrollHeight - pointerOffsetY;
      });
      return nextRatio;
    });
  };

  return (
    <div className="annotation-overlay" role="dialog" aria-modal="true">
      <section className="annotation-panel">
        <header className="annotation-header">
          <div>
            <span>IMAGE MARKUP</span>
            <strong>图片标注</strong>
          </div>
          <button type="button" onClick={onCancel} aria-label="关闭标注">
            ×
          </button>
        </header>

        <div className="annotation-toolbar">
          <div className="tool-group">
            <button
              type="button"
              className={tool === "pen" ? "active" : ""}
              onClick={() => setTool("pen")}
            >
              画笔
            </button>
            <button
              type="button"
              className={tool === "rect" ? "active" : ""}
              onClick={() => setTool("rect")}
            >
              矩形
            </button>
            <button
              type="button"
              className={tool === "arrow" ? "active" : ""}
              onClick={() => setTool("arrow")}
            >
              箭头
            </button>
          </div>

          <div className="color-group" aria-label="标注颜色">
            {COLORS.map((value) => (
              <button
                key={value}
                type="button"
                className={color === value ? "active" : ""}
                style={{ backgroundColor: value }}
                aria-label={`颜色 ${value}`}
                onClick={() => setColor(value)}
              />
            ))}
          </div>

          <label className="width-control">
            粗细
            <input
              type="range"
              min="2"
              max="16"
              value={strokeWidth}
              onChange={(event) => setStrokeWidth(Number(event.target.value))}
            />
          </label>

          <div className="history-actions">
            <button
              type="button"
              disabled={!operations.length}
              onClick={() => setOperations((current) => current.slice(0, -1))}
            >
              撤销
            </button>
            <button
              type="button"
              disabled={!operations.length}
              onClick={() => setOperations([])}
            >
              清空
            </button>
          </div>
        </div>

        <div className="annotation-stage-shell">
          <div
            ref={stageRef}
            className="annotation-stage"
            onWheel={handleWheel}
          >
            <div
              className="annotation-canvas-space"
              style={{
                minWidth: displayWidth,
                minHeight: displayHeight
              }}
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
            className="annotation-zoom"
            onClick={() => setZoomRatio(1)}
            title="恢复自动适配"
          >
            {displayScale ? `${Math.round(displayScale * 100)}%` : "适配中"}
            <span>滚轮缩放</span>
          </button>
        </div>

        <footer className="annotation-footer">
          <span>Esc 关闭 · Ctrl+Z 撤销 · 滚轮缩放</span>
          <div>
            <button type="button" className="cancel" onClick={onCancel}>
              取消
            </button>
            <button
              type="button"
              className="save"
              disabled={!imageReady}
              onClick={handleSave}
            >
              保存到图片节点
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
