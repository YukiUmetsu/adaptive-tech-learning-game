/**
 * Locally acknowledged story nodes.
 *
 * The server owns which story nodes are complete; this only tracks which ones
 * the player has seen or skipped, so the dashboard can offer an unseen beat once
 * without repeatedly prompting. Skipping counts as acknowledging (Stage2.md
 * step 16.4). It is device-local UI state, never authoritative progression.
 */

const KEY = "adaptive-learn.cyber-story-ack.v1";

function readAcknowledged(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

let acknowledged = readAcknowledged();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function write(): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(acknowledged));
  } catch {
    // Storage may be unavailable; in-memory state still applies.
  }
}

/** Marks story nodes as seen/skipped. */
export function acknowledgeStoryNodes(nodeIds: string[]): void {
  if (nodeIds.length === 0) {
    return;
  }
  const next = new Set(acknowledged);
  for (const id of nodeIds) {
    next.add(id);
  }
  acknowledged = [...next];
  write();
  emit();
}

/** Completed nodes the player has not seen yet, in server order. */
export function unacknowledgedStoryNodes(completedNodeIds: string[]): string[] {
  return completedNodeIds.filter((id) => !acknowledged.includes(id));
}

/** Clears local acknowledgement (used on sign-out and in tests). */
export function resetStoryAcknowledgements(): void {
  acknowledged = [];
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Ignore unavailable storage.
  }
  emit();
}

export function subscribeStoryAck(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
