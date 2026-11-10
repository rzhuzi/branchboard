import type { CanvasEdge, CanvasNode } from "./types";
import { clamp } from "./geometry.ts";

export const PROMPT_WIDTH = 300;
export const IMAGE_WIDTH = 320;
const NODE_GAP = 36;
const CASCADE_STEP = 40;

export type NodeSize = {
  width: number;
  height: number;
};

export type Point = {
  x: number;
  y: number;
};

function promptHeight(prompt: string): number {
  if (!prompt.trim()) return 210;
  const lines = prompt.split("\n").reduce((total, line) => {
    return total + Math.max(1, Math.ceil(line.length / 24));
  }, 0);
  return clamp(94 + lines * 24.5, 210, 438);
}

export function estimateNodeSize(node: Pick<CanvasNode, "type" | "data">): NodeSize {
  if (node.type === "image" || node.data?.kind === "image") {
    const width = Number(node.data?.width) || 1024;
    const height = Number(node.data?.height) || 1024;
    return {
      width: IMAGE_WIDTH,
      height: clamp(Math.round((IMAGE_WIDTH * height) / Math.max(1, width)), 100, 440) + 44
    };
  }
  return {
    width: PROMPT_WIDTH,
    height: promptHeight(String(node.data?.prompt ?? ""))
  };
}

export function measuredNodeSize(node: CanvasNode): NodeSize {
  const estimate = estimateNodeSize(node);
  const measuredWidth = Number(node.measured?.width ?? node.width ?? 0);
  const measuredHeight = Number(node.measured?.height ?? node.height ?? 0);
  return {
    width: measuredWidth > 0 ? measuredWidth : estimate.width,
    height: measuredHeight > 0 ? measuredHeight : estimate.height
  };
}

function nodeBounds(node: CanvasNode): { x: number; y: number; width: number; height: number } {
  const size = measuredNodeSize(node);
  return {
    x: node.position.x,
    y: node.position.y,
    width: size.width,
    height: size.height
  };
}

export function isPositionFree(
  nodes: Pick<CanvasNode, "id" | "position" | "type" | "data" | "measured" | "width" | "height">[],
  size: NodeSize,
  position: Point
): boolean {
  return !nodes.some((node) => {
    const bounds = nodeBounds(node as CanvasNode);
    return (
      position.x < bounds.x + bounds.width + NODE_GAP &&
      position.x + size.width + NODE_GAP > bounds.x &&
      position.y < bounds.y + bounds.height + NODE_GAP &&
      position.y + size.height + NODE_GAP > bounds.y
    );
  });
}

export function findFreePosition(
  nodes: Pick<CanvasNode, "id" | "position" | "type" | "data" | "measured" | "width" | "height">[],
  size: NodeSize,
  desired: Point
): Point {
  const stepX = size.width + NODE_GAP;
  const stepY = size.height + NODE_GAP;
  const candidates: Point[] = [{ x: desired.x, y: desired.y }];
  for (let ring = 1; ring <= 12; ring += 1) {
    candidates.push({ x: desired.x, y: desired.y + ring * stepY });
    candidates.push({ x: desired.x + ring * stepX, y: desired.y });
    candidates.push({ x: desired.x - ring * stepX, y: desired.y });
  }
  for (let diagonal = 1; diagonal <= 6; diagonal += 1) {
    candidates.push({
      x: desired.x + diagonal * stepX,
      y: desired.y + diagonal * stepY
    });
  }
  for (const candidate of candidates) {
    if (isPositionFree(nodes, size, candidate)) {
      return { x: Math.round(candidate.x), y: Math.round(candidate.y) };
    }
  }

  let { x, y } = desired;
  for (let guard = 0; guard < 48; guard += 1) {
    if (isPositionFree(nodes, size, { x, y })) {
      return { x: Math.round(x), y: Math.round(y) };
    }
    x += CASCADE_STEP;
    y += CASCADE_STEP;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

export function placeChild(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  parentId: string,
  childSize: NodeSize
): Point {
  const parent = nodes.find((node) => node.id === parentId);
  if (!parent) return findFreePosition(nodes, childSize, { x: 0, y: 0 });
  const parentSize = measuredNodeSize(parent);
  const childIds = new Set(
    edges
      .filter((edge) => edge.source === parentId)
      .map((edge) => edge.target)
  );
  const children = nodes.filter((node) => childIds.has(node.id));
  const lowestChild = children.reduce((lowest, child) => {
    const bounds = nodeBounds(child);
    const bottom = bounds.y + bounds.height;
    return bottom > lowest ? bottom : lowest;
  }, Number.NEGATIVE_INFINITY);
  const rightPosition = {
    x: parent.position.x + parentSize.width + 72,
    y: Number.isFinite(lowestChild) ? lowestChild + 40 : parent.position.y
  };
  if (isPositionFree(nodes, childSize, rightPosition)) {
    return {
      x: Math.round(rightPosition.x),
      y: Math.round(rightPosition.y)
    };
  }
  const belowPosition = {
    x: parent.position.x,
    y: parent.position.y + parentSize.height + 40
  };
  if (isPositionFree(nodes, childSize, belowPosition)) {
    return {
      x: Math.round(belowPosition.x),
      y: Math.round(belowPosition.y)
    };
  }
  return findFreePosition(nodes, childSize, rightPosition);
}

export function placeIncoming(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  promptId: string,
  childSize: NodeSize
): Point {
  const prompt = nodes.find((node) => node.id === promptId);
  if (!prompt) return findFreePosition(nodes, childSize, { x: 0, y: 0 });
  const promptSize = measuredNodeSize(prompt);
  const sourceIds = new Set(
    edges
      .filter((edge) => edge.target === promptId)
      .map((edge) => edge.source)
  );
  const references = nodes.filter((node) => sourceIds.has(node.id));
  const topmost = references.reduce((top, node) => {
    return node.position.y < top ? node.position.y : top;
  }, Number.POSITIVE_INFINITY);
  return findFreePosition(nodes, childSize, {
    x: prompt.position.x - childSize.width - 64,
    y: Number.isFinite(topmost)
      ? topmost - childSize.height - 40
      : prompt.position.y + Math.max(0, (promptSize.height - childSize.height) / 2)
  });
}

export function offsetPosition(position: Point, index = 0): Point {
  return {
    x: position.x + 36 + index * 28,
    y: position.y + 36 + index * 28
  };
}
