import type {
  KnowledgeNode,
  KnowledgePrompt,
  LearningDomainResponse,
  LearningModule,
} from "../api/types";
import { deriveProgressiveTable, elementId } from "../lib/learningElements";

/**
 * Discovery progress for the pre-quiz knowledge maps.
 *
 * This is deliberately separate from scored learning evidence. A card reveal is
 * not mastery and never becomes a `learning_event`; it only tracks which
 * prompts and interactive elements a learner has explored so the map can show
 * what is unlocked.
 *
 * Only revealed prompt ids and revealed element ids are stored. Node and module
 * state are derived from them, so progress cannot drift out of sync with the
 * curriculum.
 *
 * Element ids are namespaced (`annotation:`, `row:`, `column:`, `cell:`) so code
 * annotations and progressive-table units share one generic structure.
 */

/** Versioned storage key so a future schema can migrate cleanly. */
export const LEARNING_PROGRESS_KEY = "adaptive-learn.learning-progress.v3";

/** Previous v2 storage key: prompt progress plus raw code-annotation ids. */
export const V2_LEARNING_PROGRESS_KEY = "adaptive-learn.learning-progress.v2";

/** Previous v1 storage key: prompt progress only. */
export const LEGACY_LEARNING_PROGRESS_KEY = "adaptive-learn.learning-progress.v1";

/** A node's derived state on the map. */
export type NodeState = "locked" | "ready" | "in_progress" | "unlocked";

/** Stored discovery progress for one certification domain. */
export interface DomainLearningProgress {
  /** Certification version the progress was recorded against. */
  certificationVersion: string;
  /** Domain identifier. */
  domainId: string;
  /** Learning content version the progress was recorded against. */
  contentVersion: string;
  /** Knowledge node id to the prompt ids the learner has revealed. */
  revealedPromptIds: Record<string, string[]>;
  /**
   * Knowledge node id -> prompt id -> revealed discovery element ids.
   *
   * Element ids are namespaced: `annotation:<id>`, `row:<id>`,
   * `column:<id>`, or `cell:<row_id>:<column_id>`.
   */
  revealedElementIds: Record<string, Record<string, string[]>>;
  /** Last update time, ISO-8601. */
  updatedAt: string;
}

interface LearningProgressStore {
  version: 3;
  domains: Record<string, DomainLearningProgress>;
}

/** Progress for one module, derived from node reveals. */
export interface ModuleProgress {
  moduleId: string;
  unlocked: number;
  total: number;
  complete: boolean;
  available: boolean;
}

/** Everything the map and card need, derived from curriculum + reveals. */
export interface DerivedLearningState {
  nodeState: Record<string, NodeState>;
  revealedPromptIds: Record<string, string[]>;
  revealedElementIds: Record<string, Record<string, string[]>>;
  moduleProgress: Record<string, ModuleProgress>;
  unlockedNodeIds: Set<string>;
  unlockedCount: number;
  totalNodeCount: number;
  domainComplete: boolean;
  /** First node the learner can work on now, if any. */
  nextNodeId: string | null;
}

function emptyStore(): LearningProgressStore {
  return { version: 3, domains: {} };
}

function domainKey(certificationVersion: string, domainId: string): string {
  return `${certificationVersion}::${domainId}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function sanitizePromptMap(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const result: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(value as Record<string, unknown>)) {
    if (isStringArray(ids)) {
      result[key] = ids;
    }
  }
  return result;
}

function sanitizeNestedMap(
  value: unknown,
): Record<string, Record<string, string[]>> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const result: Record<string, Record<string, string[]>> = {};
  for (const [nodeId, prompts] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (!prompts || typeof prompts !== "object") {
      continue;
    }
    const promptMap: Record<string, string[]> = {};
    for (const [promptId, ids] of Object.entries(
      prompts as Record<string, unknown>,
    )) {
      if (isStringArray(ids)) {
        promptMap[promptId] = ids;
      }
    }
    result[nodeId] = promptMap;
  }
  return result;
}

/**
 * Normalizes one stored domain, accepting any historical shape.
 *
 * - v3: `revealedElementIds` are already namespaced and kept as-is.
 * - v2: `revealedAnnotationIds` are migrated to `annotation:<id>` element ids.
 * - v1: prompt progress only; the element map starts empty.
 */
function normalizeDomain(value: unknown): DomainLearningProgress | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const domain = value as Partial<DomainLearningProgress> & {
    revealedAnnotationIds?: unknown;
  };
  if (typeof domain.domainId !== "string") {
    return null;
  }

  const revealedElementIds =
    domain.revealedElementIds !== undefined
      ? sanitizeNestedMap(domain.revealedElementIds)
      : migrateAnnotationMap(domain.revealedAnnotationIds);

  return {
    certificationVersion:
      typeof domain.certificationVersion === "string"
        ? domain.certificationVersion
        : "",
    domainId: domain.domainId,
    contentVersion:
      typeof domain.contentVersion === "string" ? domain.contentVersion : "",
    revealedPromptIds: sanitizePromptMap(domain.revealedPromptIds),
    revealedElementIds,
    updatedAt:
      typeof domain.updatedAt === "string"
        ? domain.updatedAt
        : new Date(0).toISOString(),
  };
}

/** Prefixes legacy raw code-annotation ids with the `annotation:` namespace. */
function migrateAnnotationMap(
  value: unknown,
): Record<string, Record<string, string[]>> {
  const legacy = sanitizeNestedMap(value);
  const migrated: Record<string, Record<string, string[]>> = {};
  for (const [nodeId, prompts] of Object.entries(legacy)) {
    const promptMap: Record<string, string[]> = {};
    for (const [promptId, ids] of Object.entries(prompts)) {
      promptMap[promptId] = ids.map((id) =>
        id.startsWith("annotation:") ? id : elementId.annotation(id),
      );
    }
    migrated[nodeId] = promptMap;
  }
  return migrated;
}

function normalizeStore(domains: unknown): LearningProgressStore {
  const store = emptyStore();
  if (!domains || typeof domains !== "object") {
    return store;
  }
  for (const [key, value] of Object.entries(
    domains as Record<string, unknown>,
  )) {
    const domain = normalizeDomain(value);
    if (domain) {
      store.domains[key] = domain;
    }
  }
  return store;
}

function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Leaving the legacy key behind is safe: it is only read when v3 is absent.
  }
}

/**
 * Reads the v3 store, migrating v2 then v1 on first read.
 *
 * Migration preserves prompt progress and maps legacy code-annotation ids to
 * `annotation:<id>` element ids. The legacy key is removed only after a
 * successful v3 write, so the migration is idempotent and retryable.
 */
function readStore(): LearningProgressStore {
  try {
    const raw = window.localStorage.getItem(LEARNING_PROGRESS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { version?: unknown; domains?: unknown };
      if (
        parsed &&
        parsed.version === 3 &&
        parsed.domains &&
        typeof parsed.domains === "object"
      ) {
        return normalizeStore(parsed.domains);
      }
      return emptyStore();
    }

    const v2Raw = window.localStorage.getItem(V2_LEARNING_PROGRESS_KEY);
    if (v2Raw) {
      const parsed = JSON.parse(v2Raw) as {
        version?: unknown;
        domains?: unknown;
      };
      if (parsed?.version === 2 && parsed.domains) {
        const migrated = normalizeStore(parsed.domains);
        if (writeStore(migrated)) {
          removeKey(V2_LEARNING_PROGRESS_KEY);
        }
        return migrated;
      }
    }

    const legacyRaw = window.localStorage.getItem(LEGACY_LEARNING_PROGRESS_KEY);
    if (!legacyRaw) {
      return emptyStore();
    }
    const legacy = JSON.parse(legacyRaw) as {
      version?: unknown;
      domains?: unknown;
    };
    if (legacy?.version !== 1 || !legacy.domains) {
      return emptyStore();
    }
    const migrated = normalizeStore(legacy.domains);
    if (writeStore(migrated)) {
      removeKey(LEGACY_LEARNING_PROGRESS_KEY);
    }
    return migrated;
  } catch {
    return emptyStore();
  }
}

function writeStore(store: LearningProgressStore): boolean {
  try {
    window.localStorage.setItem(LEARNING_PROGRESS_KEY, JSON.stringify(store));
    return true;
  } catch {
    // Storage can be unavailable (private mode, quota); discovery still works
    // for the session.
    return false;
  }
}

/** Loads stored progress for a domain, or null when none exists. */
export function loadDomainProgress(
  certificationVersion: string,
  domainId: string,
): DomainLearningProgress | null {
  const stored = readStore().domains[domainKey(certificationVersion, domainId)];
  if (!stored || stored.domainId !== domainId) {
    return null;
  }
  return stored;
}

/**
 * Every knowledge-node id the learner has explored for a track version.
 *
 * Discovery progress lives on the client, so this is best-effort auxiliary
 * input for recommendations: unknown or stale keys are ignored. The result is
 * sorted so the recommendation query stays deterministic.
 */
export function loadTrackExploredNodeIds(certificationVersion: string): string[] {
  const prefix = `${certificationVersion}::`;
  const explored = new Set<string>();
  for (const [key, domain] of Object.entries(readStore().domains)) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    for (const [nodeId, prompts] of Object.entries(domain.revealedPromptIds)) {
      if (prompts.length > 0) {
        explored.add(nodeId);
      }
    }
    for (const [nodeId, prompts] of Object.entries(domain.revealedElementIds)) {
      if (Object.values(prompts).some((ids) => ids.length > 0)) {
        explored.add(nodeId);
      }
    }
  }
  return [...explored].sort();
}

const EMPTY_REVEALS: string[] = [];
const EMPTY_ELEMENTS_SET: ReadonlySet<string> = new Set();

/**
 * Reveals one prompt and persists it.
 *
 * Revealing an already-revealed prompt is a no-op, so the caller's unlock
 * transition can compare the before/after state and fire exactly once.
 */
export function revealPrompt(
  certificationVersion: string,
  domainId: string,
  contentVersion: string,
  nodeId: string,
  promptId: string,
): DomainLearningProgress {
  const store = readStore();
  const key = domainKey(certificationVersion, domainId);
  const existing = store.domains[key];
  const revealed = new Set(existing?.revealedPromptIds[nodeId] ?? EMPTY_REVEALS);
  const alreadyRevealed = revealed.has(promptId);
  revealed.add(promptId);

  if (!alreadyRevealed || !existing || existing.contentVersion !== contentVersion) {
    store.domains[key] = {
      certificationVersion,
      domainId,
      contentVersion,
      revealedPromptIds: {
        ...(existing?.revealedPromptIds ?? {}),
        [nodeId]: [...revealed],
      },
      revealedElementIds: existing?.revealedElementIds ?? {},
      updatedAt: new Date().toISOString(),
    };
    writeStore(store);
  }

  return store.domains[key];
}

/**
 * Reveals one discovery element (code annotation, table row/column/cell) and
 * persists it.
 *
 * Element reveals are discovery actions, not mastery evidence. Idempotent so an
 * unlock transition can be detected reliably.
 */
export function revealElement(
  certificationVersion: string,
  domainId: string,
  contentVersion: string,
  nodeId: string,
  promptId: string,
  element: string,
): DomainLearningProgress {
  const store = readStore();
  const key = domainKey(certificationVersion, domainId);
  const existing = store.domains[key];
  const nodeElements = existing?.revealedElementIds[nodeId] ?? {};
  const revealed = new Set(nodeElements[promptId] ?? EMPTY_REVEALS);
  const alreadyRevealed = revealed.has(element);
  revealed.add(element);

  if (!alreadyRevealed || !existing || existing.contentVersion !== contentVersion) {
    store.domains[key] = {
      certificationVersion,
      domainId,
      contentVersion,
      revealedPromptIds: existing?.revealedPromptIds ?? {},
      revealedElementIds: {
        ...(existing?.revealedElementIds ?? {}),
        [nodeId]: {
          ...nodeElements,
          [promptId]: [...revealed],
        },
      },
      updatedAt: new Date().toISOString(),
    };
    writeStore(store);
  }

  return store.domains[key];
}

/** Progress for a domain that has no stored reveals yet. */
export function emptyDomainProgress(
  certificationVersion: string,
  domainId: string,
  contentVersion: string,
): DomainLearningProgress {
  return {
    certificationVersion,
    domainId,
    contentVersion,
    revealedPromptIds: {},
    revealedElementIds: {},
    updatedAt: new Date(0).toISOString(),
  };
}

/** Clears discovery progress for one domain. */
export function clearDomainProgress(
  certificationVersion: string,
  domainId: string,
): void {
  const store = readStore();
  delete store.domains[domainKey(certificationVersion, domainId)];
  writeStore(store);
}

function requiredPromptIds(node: KnowledgeNode): string[] {
  return requiredPrompts(node).map((prompt) => prompt.id);
}

/**
 * The prompts that count toward a node's discovery progress.
 *
 * A node normally has required prompts; a node authored with none falls back to
 * all of its prompts, so it can still be completed.
 */
export function requiredPrompts(node: KnowledgeNode): KnowledgePrompt[] {
  const required = node.prompts.filter((prompt) => prompt.required !== false);
  return required.length > 0 ? required : node.prompts;
}

/**
 * Completed versus total prompts for a node, using every completion rule.
 *
 * This is the single source of truth for the map badge and the card charge, so
 * a node can never read "Unlocked" while showing partial progress.
 */
export function nodePromptProgress(
  node: KnowledgeNode,
  revealedPromptIds: ReadonlySet<string>,
  revealedElements: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): { completed: number; total: number } {
  const counted = requiredPrompts(node);
  const completed = counted.filter((prompt) =>
    isPromptComplete(
      prompt,
      revealedPromptIds,
      revealedElements.get(prompt.id) ?? EMPTY_ELEMENTS_SET,
    ),
  ).length;
  return { completed, total: counted.length };
}

/**
 * Whether one prompt counts as completed.
 *
 * - A code file with required annotations completes when every required
 *   annotation (`annotation:<id>`) is revealed; optional annotations never
 *   block it.
 * - A progressive table completes when every required reveal unit
 *   (row/column/cell) is revealed.
 * - A code file without required annotations (including an empty list)
 *   completes on an explicit mark-as-reviewed reveal, and every other reveal
 *   completes on its own prompt reveal.
 */
export function isPromptComplete(
  prompt: KnowledgePrompt,
  revealedPromptIds: ReadonlySet<string>,
  revealedElementIds: ReadonlySet<string> = EMPTY_ELEMENTS_SET,
): boolean {
  if (prompt.reveal.type === "code_file") {
    const required = (prompt.reveal.annotations ?? []).filter(
      (annotation) => annotation.required === true,
    );
    if (required.length > 0) {
      return required.every((annotation) =>
        revealedElementIds.has(elementId.annotation(annotation.id)),
      );
    }
    return revealedPromptIds.has(prompt.id);
  }

  if (
    prompt.reveal.type === "table" &&
    prompt.reveal.progressive_reveal != null
  ) {
    const units = deriveProgressiveTable(prompt.reveal).requiredUnits;
    return (
      units.length > 0 &&
      units.every((unit) => revealedElementIds.has(unit))
    );
  }

  return revealedPromptIds.has(prompt.id);
}

/** Whether every required prompt on a node has been completed. */
export function isNodeUnlocked(
  node: KnowledgeNode,
  revealed: ReadonlySet<string>,
  revealedElements: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
): boolean {
  const required = requiredPromptIds(node);
  return (
    required.length > 0 &&
    required.every((id) => {
      const prompt = node.prompts.find((candidate) => candidate.id === id);
      if (!prompt) {
        return false;
      }
      return isPromptComplete(
        prompt,
        revealed,
        revealedElements.get(id) ?? EMPTY_ELEMENTS_SET,
      );
    })
  );
}

/**
 * Derives per-node, per-module, and per-domain state from revealed prompt and
 * element ids.
 *
 * Unknown stored node, prompt, or element ids are ignored, so progress recorded
 * against a previous content revision never breaks a newer map.
 */
export function deriveLearningState(
  domain: Pick<LearningDomainResponse, "modules">,
  progress: DomainLearningProgress | null,
): DerivedLearningState {
  const revealedPromptIds = progress?.revealedPromptIds ?? {};
  const revealedElementIds = progress?.revealedElementIds ?? {};

  const nodeState: Record<string, NodeState> = {};
  const unlockedNodeIds = new Set<string>();
  const revealedByNode = new Map<string, Set<string>>();
  const elementsByNode = new Map<string, Map<string, Set<string>>>();

  for (const module of domain.modules) {
    for (const node of module.nodes) {
      const revealed = new Set(revealedPromptIds[node.id] ?? EMPTY_REVEALS);
      revealedByNode.set(node.id, revealed);

      const elementSets = new Map<string, Set<string>>();
      for (const [promptId, ids] of Object.entries(
        revealedElementIds[node.id] ?? {},
      )) {
        elementSets.set(promptId, new Set(ids));
      }
      elementsByNode.set(node.id, elementSets);

      if (isNodeUnlocked(node, revealed, elementSets)) {
        unlockedNodeIds.add(node.id);
      }
    }
  }

  const moduleComplete: Record<string, boolean> = {};
  for (const module of domain.modules) {
    moduleComplete[module.id] = module.nodes.every((node) =>
      unlockedNodeIds.has(node.id),
    );
  }

  const moduleAvailable: Record<string, boolean> = {};
  for (const module of domain.modules) {
    const prerequisites = module.prerequisite_module_ids ?? [];
    moduleAvailable[module.id] = prerequisites.every(
      (id) => moduleComplete[id] === true,
    );
  }

  const moduleProgress: Record<string, ModuleProgress> = {};
  let totalNodeCount = 0;
  let nextNodeId: string | null = null;

  for (const module of domain.modules) {
    const unlocked = module.nodes.filter((node) =>
      unlockedNodeIds.has(node.id),
    ).length;
    totalNodeCount += module.nodes.length;
    moduleProgress[module.id] = {
      moduleId: module.id,
      unlocked,
      total: module.nodes.length,
      complete: moduleComplete[module.id] === true,
      available: moduleAvailable[module.id] === true,
    };

    for (const node of module.nodes) {
      const moduleReady = moduleAvailable[module.id] === true;
      const prerequisites = node.prerequisite_node_ids ?? [];
      const prerequisitesUnlocked = prerequisites.every((id) =>
        unlockedNodeIds.has(id),
      );
      const revealed = revealedByNode.get(node.id) ?? new Set<string>();
      const elementSets = elementsByNode.get(node.id) ?? new Map();
      const hasElementProgress = [...elementSets.values()].some(
        (set) => set.size > 0,
      );
      const unlocked = unlockedNodeIds.has(node.id);

      let state: NodeState;
      if (unlocked) {
        state = "unlocked";
      } else if (!moduleReady || !prerequisitesUnlocked) {
        state = "locked";
      } else if (revealed.size > 0 || hasElementProgress) {
        state = "in_progress";
      } else {
        state = "ready";
      }
      nodeState[node.id] = state;

      if (nextNodeId === null && (state === "ready" || state === "in_progress")) {
        nextNodeId = node.id;
      }
    }
  }

  return {
    nodeState,
    revealedPromptIds,
    revealedElementIds,
    moduleProgress,
    unlockedNodeIds,
    unlockedCount: unlockedNodeIds.size,
    totalNodeCount,
    domainComplete:
      domain.modules.length > 0 &&
      domain.modules.every((module) => moduleComplete[module.id] === true),
    nextNodeId,
  };
}

/** The next node that becomes available after this module completes. */
export function nextModuleAfter(
  domain: Pick<LearningDomainResponse, "modules">,
  moduleId: string,
): LearningModule | null {
  const current = domain.modules.find((module) => module.id === moduleId);
  if (!current) {
    return null;
  }
  const later = domain.modules
    .filter((module) => module.order > current.order)
    .sort((a, b) => a.order - b.order);
  return later[0] ?? null;
}

/** Counts unlocked nodes for a module, for progress labels. */
export function moduleUnlockedCount(
  module: LearningModule,
  state: DerivedLearningState,
): number {
  return module.nodes.filter((node) => state.unlockedNodeIds.has(node.id)).length;
}
