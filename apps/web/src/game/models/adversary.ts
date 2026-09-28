/**
 * Recurring adversary model.
 *
 * Rank represents behaviour/story progression, never raw numeric difficulty:
 * Threat Level still controls numeric challenge. See Stage2.md step 14.
 */

export interface AdversaryDefinition {
  id: string;
  /** Display name, for example `GHOST-7`. */
  name: string;
  /** Short specialty shown in briefings. */
  specialty: string;
  /** Longer theme used by the dossier. */
  theme: string;
  /** Modifier ids the adversary can field. */
  modifierIds: string[];
  color: string;
}

/** Dossier entries unlock at these ranks (rank -> flag ids). */
export interface AdversaryDossierEntry {
  id: string;
  label: string;
  /** Rank at which the entry can be unlocked. */
  rank: number;
  /** In-world detail revealed when the entry is unlocked. */
  detail: string;
}

export interface AdversaryProgressView {
  adversaryId: string;
  progress: number;
  rank: number;
  encounters: number;
  victories: number;
  highestThreatLevelCleared: number;
  dossierFlags: string[];
}

/** Percentage of dossier entries revealed. */
export function dossierPercent(
  entries: AdversaryDossierEntry[],
  flags: string[],
): number {
  if (entries.length === 0) {
    return 0;
  }
  const known = entries.filter((entry) => flags.includes(entry.id)).length;
  return Math.round((known / entries.length) * 100);
}
