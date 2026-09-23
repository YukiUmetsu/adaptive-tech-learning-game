/**
 * Local-first record of finished section (module) quizzes.
 *
 * A section quiz is the scored retrieval check that concludes a learning
 * module. The Bits completion bonus is settled server-side and is idempotent
 * per learner/section; this store only drives the learner-facing "section
 * finished" state on the knowledge map, so the map works offline and before the
 * next sync.
 *
 * It is deliberately separate from discovery progress: exploring a node is not
 * retrieval evidence, while finishing a section quiz is.
 */

const SECTION_QUIZ_KEY = "adaptive-learn.section-quiz.v1";

interface SectionQuizStore {
  version: 1;
  /** `certificationVersion::domainId` -> completed module ids. */
  sections: Record<string, string[]>;
}

function sectionKey(certificationVersion: string, domainId: string): string {
  return `${certificationVersion}::${domainId}`;
}

function emptyStore(): SectionQuizStore {
  return { version: 1, sections: {} };
}

function readStore(): SectionQuizStore {
  try {
    const raw = window.localStorage.getItem(SECTION_QUIZ_KEY);
    if (!raw) {
      return emptyStore();
    }
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      sections?: unknown;
    };
    if (
      parsed?.version !== 1 ||
      !parsed.sections ||
      typeof parsed.sections !== "object"
    ) {
      return emptyStore();
    }
    const sections: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(
      parsed.sections as Record<string, unknown>,
    )) {
      if (Array.isArray(value) && value.every((id) => typeof id === "string")) {
        sections[key] = value as string[];
      }
    }
    return { version: 1, sections };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: SectionQuizStore): void {
  try {
    window.localStorage.setItem(SECTION_QUIZ_KEY, JSON.stringify(store));
  } catch {
    // Storage may be unavailable (private mode, quota); the section still
    // finishes for the session.
  }
}

/** Module ids whose section quiz is complete for one domain. */
export function loadSectionQuizModules(
  certificationVersion: string,
  domainId: string,
): Set<string> {
  return new Set(
    readStore().sections[sectionKey(certificationVersion, domainId)] ?? [],
  );
}

/** Whether one section's quiz is complete locally. */
export function isSectionQuizComplete(
  certificationVersion: string,
  domainId: string,
  moduleId: string,
): boolean {
  return loadSectionQuizModules(certificationVersion, domainId).has(moduleId);
}

/** Records one completed section quiz. Idempotent. */
export function markSectionQuizComplete(
  certificationVersion: string,
  domainId: string,
  moduleId: string,
): void {
  if (!certificationVersion || !domainId || !moduleId) {
    return;
  }
  const store = readStore();
  const key = sectionKey(certificationVersion, domainId);
  const completed = new Set(store.sections[key] ?? []);
  if (completed.has(moduleId)) {
    return;
  }
  completed.add(moduleId);
  store.sections[key] = [...completed].sort();
  writeStore(store);
}

/** Clears the recorded section quizzes for one domain. */
export function clearSectionQuizProgress(
  certificationVersion: string,
  domainId: string,
): void {
  const store = readStore();
  delete store.sections[sectionKey(certificationVersion, domainId)];
  writeStore(store);
}
