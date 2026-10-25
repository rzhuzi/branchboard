import { extensionForMime } from "../../shared/blob.ts";
import type {
  CanvasDocument,
  CanvasEdge,
  CanvasNode,
  CanvasSnapshot,
  RelationKind
} from "../../shared/types";

export const MAX_HISTORY = 60;
export const MAX_REFERENCES = 4;

export type HistoryEntry = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
};

export type HistoryStacks = {
  past: HistoryEntry[];
  future: HistoryEntry[];
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function firstLineTitle(prompt: string): string {
  const line = prompt.trim().split("\n")[0] ?? "";
  return line.slice(0, 48) || "生成图片";
}

export function sanitizeNode(node: CanvasNode): CanvasNode {
  return {
    id: node.id,
    type: node.type,
    position: { x: node.position.x, y: node.position.y },
    data: { ...node.data }
  };
}

export function sanitizeEdge(edge: CanvasEdge): CanvasEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "relation",
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    data: { relation: edge.data?.relation ?? "generated" }
  };
}

export function prepareNodes(nodes: CanvasNode[]): CanvasNode[] {
  return nodes.map((node) => ({ ...node, selected: false, dragging: false }));
}

export function prepareEdges(edges: CanvasEdge[], nodes: CanvasNode[]): CanvasEdge[] {
  const kindById = new Map(
    nodes.map((node) => [node.id, node.data.kind] as const)
  );
  const prepared: CanvasEdge[] = [];
  for (const edge of edges) {
    const sourceKind = kindById.get(edge.source);
    const targetKind = kindById.get(edge.target);
    let relation = edge.data?.relation;
    if (!relation) {
      if (sourceKind === "prompt" && targetKind === "image") relation = "generated";
      else if (sourceKind === "image" && targetKind === "prompt") relation = "reference";
      else if (sourceKind === "prompt" && targetKind === "prompt") relation = "branch";
    }
    if (!relation) continue;
    prepared.push({
      ...edge,
      type: "relation",
      selected: false,
      data: { relation }
    });
  }
  return prepared;
}

export function snapshotFromDocument(document: CanvasDocument): CanvasSnapshot {
  return {
    nodes: document.nodes,
    edges: document.edges,
    viewport: document.viewport,
    updatedAt: document.updatedAt
  };
}

export function positionsChanged(before: HistoryEntry, after: HistoryEntry): boolean {
  if (before.nodes.length !== after.nodes.length) return true;
  const positions = new Map(
    after.nodes.map((node) => [node.id, node.position] as const)
  );
  return before.nodes.some((node) => {
    const position = positions.get(node.id);
    if (!position) return true;
    return (
      Math.abs(position.x - node.position.x) > 0.5 ||
      Math.abs(position.y - node.position.y) > 0.5
    );
  });
}

export function relationForConnection(
  source: CanvasNode | undefined,
  target: CanvasNode | undefined
): RelationKind | null {
  if (!source || !target || source.id === target.id) return null;
  if (source.data.kind === "image" && target.data.kind === "prompt") return "reference";
  if (source.data.kind === "prompt" && target.data.kind === "prompt") return "branch";
  return null;
}

export function savedEdgeId(relation: RelationKind): string {
  return `edge-${crypto.randomUUID()}-${relation}`;
}

export function downloadFileName(name: string, mime: string): string {
  const base = name.replace(/[\\/:*?"<>|]/g, "_").trim() || "branchboard-image";
  return `${base}.${extensionForMime(mime)}`;
}
