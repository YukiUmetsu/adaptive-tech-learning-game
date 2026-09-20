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

function subtractIds(base: string[], remove: string[]): string[] {
  const removed = new Set(remove);
  return base.filter((id) => !removed.has(id));
}

/**
 * Removes the reveals in `sent` from `base`, leaving reveals added later.
 *
 * Used after a successful sync so a reveal made while the request was in flight
 * is never dropped along with the values that were actually sent.
 */
export function subtractDiscovery(
  base: DomainDiscoveryInput,
  sent: DomainDiscoveryInput,
): DomainDiscoveryInput {
  const revealedPromptIds: Record<string, string[]> = {};
  for (const [nodeId, ids] of Object.entries(base.revealed_prompt_ids ?? {})) {
    const remaining = subtractIds(
      ids,
      sent.revealed_prompt_ids?.[nodeId] ?? [],
    );
    if (remaining.length > 0) {
      revealedPromptIds[nodeId] = remaining;
    }
  }

  const revealedElementIds: Record<string, Record<string, string[]>> = {};
  for (const [nodeId, prompts] of Object.entries(
    base.revealed_element_ids ?? {},
  )) {
    const promptMap: Record<string, string[]> = {};
    for (const [promptId, ids] of Object.entries(prompts)) {
      const remaining = subtractIds(
        ids,
        sent.revealed_element_ids?.[nodeId]?.[promptId] ?? [],
      );
      if (remaining.length > 0) {
        promptMap[promptId] = remaining;
      }
    }
    if (Object.keys(promptMap).length > 0) {
      revealedElementIds[nodeId] = promptMap;
    }
  }

  return {
    domain_id: base.domain_id,
    revealed_prompt_ids: revealedPromptIds,
    revealed_element_ids: revealedElementIds,
  };
}

/** Subtracts sent reveals from a list of domains, dropping emptied domains. */
export function subtractDiscoveryLists(
  base: DomainDiscoveryInput[],
  sent: DomainDiscoveryInput[],
): DomainDiscoveryInput[] {
  const sentByDomain = new Map(sent.map((domain) => [domain.domain_id, domain]));
  return base
    .map((domain) => {
      const sentDomain = sentByDomain.get(domain.domain_id);
      return sentDomain ? subtractDiscovery(domain, sentDomain) : domain;
    })
    .filter(
      (domain) =>
        Object.keys(domain.revealed_prompt_ids ?? {}).length > 0 ||
        Object.keys(domain.revealed_element_ids ?? {}).length > 0,
    );
}
