import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
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
  reference: "7 5",
  branch: "2 4"
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
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 10
  });

  return (
    <g className={`bb-edge bb-edge--${relation} ${selected ? "is-selected" : ""}`}>
      <BaseEdge
        path={path}
        markerEnd={`url(#bb-arrow-${relation})`}
        interactionWidth={16}
        style={{
          stroke: `var(--bb-edge-${relation})`,
          strokeWidth: selected ? 2 : 1.5,
          strokeDasharray: RELATION_DASH[relation],
          strokeLinecap: "round",
          opacity: selected ? 1 : 0.72
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
