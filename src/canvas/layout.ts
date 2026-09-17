import type { CanvasNode } from "../shared/types";

const NODE_WIDTH = 350;
const NODE_HEIGHT = 340;
const CASCADE_STEP = 46;

export function findFreePosition(
  nodes: Pick<CanvasNode, "position">[],
  desired: { x: number; y: number }
): { x: number; y: number } {
  let { x, y } = desired;
  for (let guard = 0; guard < 32; guard += 1) {
    const collides = nodes.some(
      (node) =>
        Math.abs(node.position.x - x) < NODE_WIDTH * 0.9 &&
        Math.abs(node.position.y - y) < NODE_HEIGHT * 0.9
    );
    if (!collides) return { x, y };
    x += CASCADE_STEP;
    y += CASCADE_STEP;
  }
  return { x, y };
}
