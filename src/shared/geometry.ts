export type FloatingGeometry = {
  left: string;
  top: string;
  width: string;
  height: string;
};

export type PixelViewport = {
  width: number;
  height: number;
};

export type NormalizeOptions = {
  minWidth?: number;
  minHeight?: number;
  defaultWidth?: number;
  defaultHeight?: number;
  margin?: number;
};

export type ViewportLike = {
  x: number;
  y: number;
  zoom: number;
};

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function pixelNumber(value: unknown, fallback: number): number {
  const match = String(value ?? "").match(/^(-?\d+(?:\.\d+)?)px$/);
  return match ? Number(match[1]) : fallback;
}

export function normalizeFloatingGeometry(
  geometry: { left?: unknown; top?: unknown; right?: unknown; bottom?: unknown; width?: unknown; height?: unknown } | null | undefined,
  viewport: PixelViewport,
  options: NormalizeOptions = {}
): { left: number; top: number; width: number; height: number } {
  const margin = Math.max(0, Number(options.margin ?? 8));
  const viewportWidth = Math.max(1, Number(viewport?.width || 0));
  const viewportHeight = Math.max(1, Number(viewport?.height || 0));
  const maxWidth = Math.max(1, viewportWidth - margin * 2);
  const maxHeight = Math.max(1, viewportHeight - margin * 2);
  const minWidth = Math.min(Math.max(1, Number(options.minWidth ?? 480)), maxWidth);
  const minHeight = Math.min(Math.max(1, Number(options.minHeight ?? 360)), maxHeight);
  const width = clamp(
    pixelNumber(geometry?.width, Math.min(Number(options.defaultWidth ?? 900), maxWidth)),
    minWidth,
    maxWidth
  );
  const height = clamp(
    pixelNumber(geometry?.height, Math.min(Number(options.defaultHeight ?? 700), maxHeight)),
    minHeight,
    maxHeight
  );
  const fallbackLeft = viewportWidth - width - 18;
  const fallbackTop = viewportHeight - height - 18;
  const right = pixelNumber(geometry?.right, Number.NaN);
  const bottom = pixelNumber(geometry?.bottom, Number.NaN);
  const left = clamp(
    pixelNumber(
      geometry?.left,
      Number.isFinite(right) ? viewportWidth - width - right : fallbackLeft
    ),
    margin,
    Math.max(margin, viewportWidth - width - margin)
  );
  const top = clamp(
    pixelNumber(
      geometry?.top,
      Number.isFinite(bottom) ? viewportHeight - height - bottom : fallbackTop
    ),
    margin,
    Math.max(margin, viewportHeight - height - margin)
  );

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height)
  };
}

export function zoomAtPoint(
  viewport: ViewportLike,
  point: { x: number; y: number },
  nextZoom: number
): ViewportLike {
  const zoom = Math.max(0.01, nextZoom);
  const scale = zoom / viewport.zoom;
  return {
    x: point.x - (point.x - viewport.x) * scale,
    y: point.y - (point.y - viewport.y) * scale,
    zoom
  };
}

export function wheelPanDelta(
  event: { deltaX: number; deltaY: number; deltaMode: number },
  viewportHeight: number,
  shiftKey = false
): { x: number; y: number } {
  const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewportHeight : 1;
  const deltaX = event.deltaX * multiplier;
  const deltaY = event.deltaY * multiplier;
  if (shiftKey && Math.abs(deltaX) < 1) {
    return { x: deltaY === 0 ? 0 : -deltaY, y: 0 };
  }
  return { x: deltaX === 0 ? 0 : -deltaX, y: deltaY === 0 ? 0 : -deltaY };
}
