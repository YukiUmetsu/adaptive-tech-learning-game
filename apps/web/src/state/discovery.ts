import type { DomainDiscoveryInput } from "../api/types";

/**
 * Monotonic set-union helpers for Knowledge Map discovery progress.
 *
 * Discovery is append-only: a union of any two states contains every reveal from
 * both, so an older device can never remove a newer reveal and duplicate ids
 * collapse. This mirrors the server's `merge_domain_discovery` so local and
 * persisted progress merge with identical semantics.
 */

/** Union of two `node -> ids` maps, with sorted, deduplicated id lists. */
export function unionPromptIds(
  base: Record<string, string[]>,
  incoming: Record<string, string[]>,
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const [nodeId, ids] of Object.entries(base)) {
    merged[nodeId] = [...new Set(ids)].sort();
  }
  for (const [nodeId, ids] of Object.entries(incoming)) {
    merged[nodeId] = [...new Set([...(merged[nodeId] ?? []), ...ids])].sort();
  }
  return merged;
}

/** Union of two `node -> prompt -> ids` maps, with sorted, deduplicated lists. */
export function unionElementIds(
  base: Record<string, Record<string, string[]>>,
  incoming: Record<string, Record<string, string[]>>,
): Record<string, Record<string, string[]>> {
  const merged: Record<string, Record<string, string[]>> = {};
  for (const [nodeId, prompts] of Object.entries(base)) {
    const promptMap: Record<string, string[]> = {};
    for (const [promptId, ids] of Object.entries(prompts)) {
      promptMap[promptId] = [...new Set(ids)].sort();
    }
    merged[nodeId] = promptMap;
  }
  for (const [nodeId, prompts] of Object.entries(incoming)) {
    const promptMap = merged[nodeId] ?? {};
    for (const [promptId, ids] of Object.entries(prompts)) {
      promptMap[promptId] = [...new Set([...(promptMap[promptId] ?? []), ...ids])].sort();
    }
    merged[nodeId] = promptMap;
  }
  return merged;
}

/** Unions two raw domain discovery inputs. */
export function mergeDiscoveryInputs(
  base: DomainDiscoveryInput,
  incoming: DomainDiscoveryInput,
): DomainDiscoveryInput {
  return {
    domain_id: base.domain_id || incoming.domain_id,
    revealed_prompt_ids: unionPromptIds(
      base.revealed_prompt_ids ?? {},
      incoming.revealed_prompt_ids ?? {},
    ),
    revealed_element_ids: unionElementIds(
      base.revealed_element_ids ?? {},
      incoming.revealed_element_ids ?? {},
    ),
  };
}

/** Unions two lists of domain discovery inputs, keyed by domain id. */
export function mergeDiscoveryLists(
  base: DomainDiscoveryInput[],
  incoming: DomainDiscoveryInput[],
): DomainDiscoveryInput[] {
  const merged = new Map<string, DomainDiscoveryInput>();
  for (const domain of base) {
    merged.set(domain.domain_id, domain);
  }
  for (const domain of incoming) {
    const existing = merged.get(domain.domain_id);
    merged.set(
      domain.domain_id,
      existing ? mergeDiscoveryInputs(existing, domain) : domain,
    );
  }
  return [...merged.values()].sort((a, b) =>
    a.domain_id.localeCompare(b.domain_id),
  );
}
