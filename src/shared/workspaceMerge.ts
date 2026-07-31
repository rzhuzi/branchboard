import type { CanvasEdge, CanvasNode, CanvasSnapshot } from "./types";

const MISSING = Symbol("missing");

type Missing = typeof MISSING;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => valuesEqual(value, right[index]))
    );
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(right, key) &&
          valuesEqual(left[key], right[key])
      )
    );
  }
  return false;
}

function mergeValue(
  base: unknown | Missing,
  local: unknown | Missing,
  remote: unknown | Missing
): unknown | Missing {
  if (local !== MISSING && remote !== MISSING && valuesEqual(local, remote)) {
    return local;
  }
  if (base !== MISSING && local !== MISSING && valuesEqual(local, base)) {
    return remote;
  }
  if (base !== MISSING && remote !== MISSING && valuesEqual(remote, base)) {
    return local;
  }

  if (local === MISSING) {
    return base === MISSING ? remote : MISSING;
  }
  if (remote === MISSING) {
    if (base === MISSING) return local;
    return valuesEqual(local, base) ? MISSING : local;
  }

  if (isRecord(local) && isRecord(remote)) {
    const baseRecord = isRecord(base) ? base : {};
    const keys = new Set([
      ...Object.keys(baseRecord),
      ...Object.keys(local),
      ...Object.keys(remote)
    ]);
    const merged: Record<string, unknown> = {};
    for (const key of keys) {
      const next = mergeValue(
        Object.prototype.hasOwnProperty.call(baseRecord, key)
          ? baseRecord[key]
          : MISSING,
        Object.prototype.hasOwnProperty.call(local, key)
          ? local[key]
          : MISSING,
        Object.prototype.hasOwnProperty.call(remote, key)
          ? remote[key]
          : MISSING
      );
      if (next !== MISSING) merged[key] = next;
    }
    return merged;
  }

  // Both sides changed the same scalar. The current editor wins while all
  // independent fields continue to merge recursively.
  return local;
}

function mergeEntities<T extends { id: string }>(
  baseItems: T[],
  localItems: T[],
  remoteItems: T[]
): T[] {
  const base = new Map(baseItems.map((item) => [item.id, item]));
  const local = new Map(localItems.map((item) => [item.id, item]));
  const remote = new Map(remoteItems.map((item) => [item.id, item]));
  const orderedIds = [
    ...localItems.map((item) => item.id),
    ...remoteItems
      .map((item) => item.id)
      .filter((id) => !local.has(id))
  ];
  const merged: T[] = [];

  for (const id of orderedIds) {
    const next = mergeValue(
      base.get(id) ?? MISSING,
      local.get(id) ?? MISSING,
      remote.get(id) ?? MISSING
    );
    if (next !== MISSING) merged.push(next as T);
  }
  return merged;
}

export function mergeCanvasSnapshots(
  base: CanvasSnapshot,
  local: CanvasSnapshot,
  remote: CanvasSnapshot
): CanvasSnapshot {
  return {
    version: 1,
    nodes: mergeEntities<CanvasNode>(base.nodes, local.nodes, remote.nodes),
    edges: mergeEntities<CanvasEdge>(base.edges, local.edges, remote.edges),
    updatedAt: new Date().toISOString()
  };
}

