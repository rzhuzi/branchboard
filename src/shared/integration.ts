import type {
  CanvasEdge,
  CanvasNode,
  CanvasSnapshot,
  PendingImage,
  RelationKind
} from "./types";
import { findFreePosition, placeChild, placeIncoming } from "./placement.ts";

function edgeId(source: string, target: string, relation: RelationKind): string {
  return `edge-${source}-${target}-${relation}`;
}

export function integratePendingIntoSnapshot(
  snapshot: CanvasSnapshot,
  pending: PendingImage[]
): { snapshot: CanvasSnapshot; addedNodeIds: string[]; addedImageCount: number } {
  if (!pending.length) {
    return { snapshot, addedNodeIds: [], addedImageCount: 0 };
  }

  const nodes: CanvasNode[] = [...snapshot.nodes];
  const edges: CanvasEdge[] = [...snapshot.edges];
  const addedNodeIds: string[] = [];

  for (const record of pending) {
    if (!record.assetId) continue;
    if (
      nodes.some(
        (node) => node.data.kind === "image" && node.data.assetId === record.assetId
      )
    ) {
      continue;
    }

    const parent = record.promptId
      ? nodes.find(
          (node) => node.id === record.promptId && node.data.kind === "prompt"
        )
      : undefined;
    const relation: RelationKind | null = parent
      ? record.relation ?? "generated"
      : null;
    const size = {
      width: 320,
      height: Math.min(
        440,
        Math.max(100, Math.round((320 * (record.height || 1024)) / Math.max(1, record.width || 1024)))
      )
    };

    const position =
      relation === "generated" && parent
        ? placeChild(nodes, edges, parent.id, size)
        : relation === "reference" && parent
          ? placeIncoming(nodes, edges, parent.id, size)
          : findFreePosition(
              nodes,
              size,
              record.position ?? {
                x: 120,
                y: 120
              }
            );

    const nodeId = `image-${record.assetId}`;
    const imageNode: CanvasNode = {
      id: nodeId,
      type: "image",
      position,
      data: {
        kind: "image",
        assetId: record.assetId,
        name: record.name || "生成结果",
        createdAt: record.createdAt,
        width: record.width,
        height: record.height
      }
    };
    nodes.push(imageNode);
    addedNodeIds.push(nodeId);

    if (parent && relation === "generated") {
      edges.push({
        id: edgeId(parent.id, nodeId, relation),
        source: parent.id,
        target: nodeId,
        type: "relation",
        data: { relation }
      });
    } else if (parent && relation === "reference") {
      edges.push({
        id: edgeId(nodeId, parent.id, relation),
        source: nodeId,
        target: parent.id,
        type: "relation",
        data: { relation }
      });
    }
  }

  return {
    snapshot: {
      ...snapshot,
      nodes,
      edges,
      updatedAt: new Date().toISOString()
    },
    addedNodeIds,
    addedImageCount: addedNodeIds.length
  };
}
