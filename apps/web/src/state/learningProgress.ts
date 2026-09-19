import type {
  KnowledgeNode,
  KnowledgePrompt,
  LearningDomainResponse,
  LearningModule,
} from "../api/types";

/**
 * Discovery progress for the pre-quiz knowledge maps.
 *
 * This is deliberately separate from scored learning evidence. A card reveal is
 * not mastery and never becomes a `learning_event`; it only tracks which
 * prompts and code annotations a learner has explored so the map can show what
 * is unlocked.
 *
 * Only revealed prompt ids and revealed code-annotation ids are stored. Node
 * and module state are derived from them, so progress cannot drift out of sync
 * with the curriculum.
 */

/** Versioned storage key so a future schema can migrate cleanly. */
export const LEARNING_PROGRESS_KEY = "adaptive-learn.learning-progress.v2";

/** Previous storage key, read once and migrated into v2. */
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
   * Knowledge node id -> prompt id -> revealed code annotation ids.
   *
   * Kept beside prompt progress because a code-file prompt is completed by its
   * required annotations rather than by one whole-prompt reveal.
   */
  revealedAnnotationIds: Record<string, Record<string, string[]>>;
  /** Last update time, ISO-8601. */
  updatedAt: string;
}

interface LearningProgressStore {
  version: 2;
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
  revealedAnnotationIds: Record<string, Record<string, string[]>>;
  moduleProgress: Record<string, ModuleProgress>;
  unlockedNodeIds: Set<string>;
  unlockedCount: number;
  totalNodeCount: number;
  domainComplete: boolean;
  /** First node the learner can work on now, if any. */
  nextNodeId: string | null;
}

function emptyStore(): LearningProgressStore {
  return { version: 2, domains: {} };
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

function sanitizeAnnotationMap(
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

function normalizeDomain(value: unknown): DomainLearningProgress | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const domain = value as Partial<DomainLearningProgress>;
  if (typeof domain.domainId !== "string") {
    return null;
  }
  return {
    certificationVersion:
      typeof domain.certificationVersion === "string"
        ? domain.certificationVersion
        : "",
    domainId: domain.domainId,
    contentVersion:
      typeof domain.contentVersion === "string" ? domain.contentVersion : "",
    revealedPromptIds: sanitizePromptMap(domain.revealedPromptIds),
    revealedAnnotationIds: sanitizeAnnotationMap(domain.revealedAnnotationIds),
    updatedAt:
      typeof domain.updatedAt === "string"
        ? domain.updatedAt
        : new Date(0).toISOString(),
  };
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

/**
 * Reads the v2 store, migrating a legacy v1 store on first read.
 *
 * V1 kept only `revealedPromptIds`; converting it preserves every prompt reveal
 * (including unknown/stale ids, which stay ignored downstream) and starts the
 * annotation map empty. The legacy key is removed after a successful write so
 * the migration runs once.
 */
function readStore(): LearningProgressStore {
  try {
    const raw = window.localStorage.getItem(LEARNING_PROGRESS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { version?: unknown; domains?: unknown };
      if (
        parsed &&
        parsed.version === 2 &&
        parsed.domains &&
        typeof parsed.domains === "object"
      ) {
        return normalizeStore(parsed.domains);
      }
      return emptyStore();
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
    writeStore(migrated);
    try {
      window.localStorage.removeItem(LEGACY_LEARNING_PROGRESS_KEY);
    } catch {
      // Leaving the legacy key behind is safe: it is only read when v2 is absent.
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

const EMPTY_REVEALS: string[] = [];
const EMPTY_REVEALS_SET: ReadonlySet<string> = new Set();

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
      revealedAnnotationIds: existing?.revealedAnnotationIds ?? {},
      updatedAt: new Date().toISOString(),
    };
    writeStore(store);
  }

  return store.domains[key];
}

/**
 * Reveals one annotation inside a code file and persists it.
 *
 * Annotation reveals are discovery actions, not mastery evidence. Idempotent so
 * an unlock transition can be detected reliably.
 */
export function revealAnnotation(
  certificationVersion: string,
  domainId: string,
  contentVersion: string,
  nodeId: string,
  promptId: string,
  annotationId: string,
): DomainLearningProgress {
  const store = readStore();
  const key = domainKey(certificationVersion, domainId);
  const existing = store.domains[key];
  const nodeAnnotations = existing?.revealedAnnotationIds[nodeId] ?? {};
  const revealed = new Set(nodeAnnotations[promptId] ?? EMPTY_REVEALS);
  const alreadyRevealed = revealed.has(annotationId);
  revealed.add(annotationId);

  if (!alreadyRevealed || !existing || existing.contentVersion !== contentVersion) {
    store.domains[key] = {
      certificationVersion,
      domainId,
      contentVersion,
      revealedPromptIds: existing?.revealedPromptIds ?? {},
      revealedAnnotationIds: {
        ...(existing?.revealedAnnotationIds ?? {}),
        [nodeId]: {
          ...nodeAnnotations,
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
    revealedAnnotationIds: {},
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
  const required = node.prompts.filter((prompt) => prompt.required !== false);
  return (required.length > 0 ? required : node.prompts).map(
    (prompt) => prompt.id,
  );
}

/**
 * Whether one prompt counts as completed.
 *
 * A code file with required annotations completes when every required
 * annotation is revealed; optional annotations never block it. A code file
 * without required annotations (including an empty list) completes on an
 * explicit mark-as-reviewed reveal. Every other reveal completes on its own
 * prompt reveal.
 */
export function isPromptComplete(
  prompt: KnowledgePrompt,
  revealedPromptIds: ReadonlySet<string>,
  revealedAnnotationIds: ReadonlySet<string> = EMPTY_REVEALS_SET,
): boolean {
  if (
    prompt.reveal.type === "code_file" &&
    (prompt.reveal.annotations ?? []).some((annotation) => annotation.required === true)
  ) {
    return (prompt.reveal.annotations ?? [])
      .filter((annotation) => annotation.required === true)
      .every((annotation) => revealedAnnotationIds.has(annotation.id));
  }
  return revealedPromptIds.has(prompt.id);
}

/** Whether every required prompt on a node has been completed. */
export function isNodeUnlocked(
  node: KnowledgeNode,
  revealed: ReadonlySet<string>,
  revealedAnnotations: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
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
        revealedAnnotations.get(id) ?? EMPTY_REVEALS_SET,
      );
    })
  );
}

/**
 * Derives per-node, per-module, and per-domain state from revealed prompt and
 * annotation ids.
 *
 * Unknown stored node, prompt, or annotation ids are ignored, so progress
 * recorded against a previous content revision never breaks a newer map.
 */
export function deriveLearningState(
  domain: Pick<LearningDomainResponse, "modules">,
  progress: DomainLearningProgress | null,
): DerivedLearningState {
  const revealedPromptIds = progress?.revealedPromptIds ?? {};
  const revealedAnnotationIds = progress?.revealedAnnotationIds ?? {};

  const nodeState: Record<string, NodeState> = {};
  const unlockedNodeIds = new Set<string>();
  const revealedByNode = new Map<string, Set<string>>();
  const annotationsByNode = new Map<string, Map<string, Set<string>>>();

  for (const module of domain.modules) {
    for (const node of module.nodes) {
      const revealed = new Set(revealedPromptIds[node.id] ?? EMPTY_REVEALS);
      revealedByNode.set(node.id, revealed);

      const annotationSets = new Map<string, Set<string>>();
      for (const [promptId, ids] of Object.entries(
        revealedAnnotationIds[node.id] ?? {},
      )) {
        annotationSets.set(promptId, new Set(ids));
      }
      annotationsByNode.set(node.id, annotationSets);

      if (isNodeUnlocked(node, revealed, annotationSets)) {
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
      const annotationSets = annotationsByNode.get(node.id) ?? new Map();
      const hasAnnotationProgress = [...annotationSets.values()].some(
        (set) => set.size > 0,
      );
      const unlocked = unlockedNodeIds.has(node.id);

      let state: NodeState;
      if (unlocked) {
        state = "unlocked";
      } else if (!moduleReady || !prerequisitesUnlocked) {
        state = "locked";
      } else if (revealed.size > 0 || hasAnnotationProgress) {
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
    revealedAnnotationIds,
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
