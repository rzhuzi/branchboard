import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps
} from "@xyflow/react";
import type { CanvasEdge } from "../../shared/types";

const RELATION_LABEL = {
  generated: "生成结果",
  reference: "参考图",
  branch: "提示词分支"
} as const;

const RELATION_DASH = {
  generated: undefined,
  reference: "5 5",
  branch: "2 5"
} as const;

export function RelationEdge({
  data,
  selected,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition
}: EdgeProps<CanvasEdge>) {
  const relation = data?.relation ?? "generated";
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.28
  });

  return (
    <g className={`bb-edge bb-edge--${relation} ${selected ? "is-selected" : ""}`}>
      <BaseEdge
        path={path}
        markerEnd={`url(#bb-arrow-${relation})`}
        interactionWidth={16}
        style={{
          stroke: selected ? "var(--bb-accent)" : `var(--bb-edge-${relation})`,
          strokeWidth: selected ? 1.8 : 1.35,
          strokeDasharray: RELATION_DASH[relation],
          strokeLinecap: "round",
          opacity: 1
        }}
      />
      {selected ? (
        <EdgeLabelRenderer>
          <span
            className={`bb-edge-label ${relation}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`
            }}
          >
            {RELATION_LABEL[relation]}
          </span>
        </EdgeLabelRenderer>
      ) : null}
    </g>
  );
}
