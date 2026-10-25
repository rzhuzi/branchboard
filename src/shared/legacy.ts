import type { RelationKind } from "./types";

export function legacyRelationFor(
  sourceKind: string | undefined,
  targetKind: string | undefined
): RelationKind | null {
  if (sourceKind === "prompt" && targetKind === "image") return "generated";
  if (sourceKind === "image" && targetKind === "prompt") return "reference";
  if (sourceKind === "prompt" && targetKind === "prompt") return "branch";
  return null;
}
