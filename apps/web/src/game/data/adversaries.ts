import type {
  AdversaryDefinition,
  AdversaryDossierEntry,
} from "../models/adversary";

/**
 * Stage 2 recurring adversaries.
 *
 * Ids mirror `crates/domain/src/cyber_operation.rs`. The names are deliberately
 * fictional and never mimic a real vendor or threat group.
 */
export const ADVERSARIES: AdversaryDefinition[] = [
  {
    id: "ghost-7",
    name: "GHOST-7",
    specialty: "Identity and credential specialist",
    theme:
      "GHOST-7 rarely forces a door. It waits for a reused credential, hides its traffic, and applies identity pressure until an account falls.",
    modifierIds: ["hidden_traffic", "credential_surge", "identity_pressure"],
    color: "#a78bfa",
  },
  {
    id: "null",
    name: "NULL",
    specialty: "Web and application injection",
    theme:
      "NULL probes the application layer: injection, script execution, and mixed vectors that try to slip past a single filter.",
    modifierIds: ["mixed_vector", "strict_latency", "application_pressure"],
    color: "#38bdf8",
  },
  {
    id: "viper",
    name: "VIPER",
    specialty: "Malware impact and recovery pressure",
    theme:
      "VIPER does not care about stealth. It wants to encrypt everything it can reach and force a recovery fight on its terms.",
    modifierIds: ["recovery_pressure", "hardened_campaign", "delayed_impact"],
    color: "#f87171",
  },
];

export const ADVERSARIES_BY_ID: Record<string, AdversaryDefinition> =
  Object.fromEntries(ADVERSARIES.map((adversary) => [adversary.id, adversary]));

/**
 * Dossier entries per adversary.
 *
 * Entry ids match the server's dossier flags. Unknown entries are rendered as
 * locked placeholders that never expose the hidden text.
 */
export const ADVERSARY_DOSSIERS: Record<string, AdversaryDossierEntry[]> = {
  "ghost-7": [
    {
      id: "identity_specialist",
      label: "Credential specialist",
      rank: 1,
      detail:
        "GHOST-7 builds target lists from breach dumps and hunts accounts that reuse passwords. It avoids noisy brute force and prefers a single valid credential.",
    },
    {
      id: "uses_hidden_traffic",
      label: "Hidden traffic observed",
      rank: 2,
      detail:
        "Some of GHOST-7's requests mimic ordinary traffic. Detection — Monitoring or a Traffic Analyzer — exposes the hidden units before they reach the core.",
    },
    {
      id: "credential_surge_observed",
      label: "Credential surge observed",
      rank: 2,
      detail:
        "GHOST-7 can flood the sign-in flow to overwhelm rate limits. MFA still stops account takeover; rate limiting only slows the flood.",
    },
    {
      id: "rank_3_story_clue",
      label: "Story clue recovered",
      rank: 3,
      detail:
        "A fragment of GHOST-7's infrastructure points to a sponsor mapping a research network. The thread continues in a later chapter.",
    },
    {
      id: "boss_pattern_seen",
      label: "Boss pattern witnessed",
      rank: 5,
      detail:
        "GHOST-7 coordinates a botnet for a sustained push, summoning junk traffic while the main wave advances on the target.",
    },
    {
      id: "highest_threat_5",
      label: "Cleared Threat 5 or higher",
      rank: 5,
      detail:
        "You held the line against a high-Threat operation and kept the protected core intact.",
    },
  ],
  null: [
    {
      id: "web_specialist",
      label: "Web injection specialist",
      rank: 1,
      detail:
        "NULL probes input handling for SQL injection and script injection, chaining small application flaws into deeper access.",
    },
    {
      id: "uses_hidden_traffic",
      label: "Hidden traffic observed",
      rank: 2,
      detail:
        "Some of NULL's requests blend into normal traffic until detection is active. Monitoring reveals the hidden units.",
    },
    {
      id: "rank_3_story_clue",
      label: "Story clue recovered",
      rank: 3,
      detail:
        "NULL's tooling references the same research network as GHOST-7. The attacks are coordinated.",
    },
    {
      id: "boss_pattern_seen",
      label: "Boss pattern witnessed",
      rank: 5,
      detail:
        "NULL hides a botnet behind application-layer noise, forcing defenders to cover two fronts at once.",
    },
    {
      id: "highest_threat_5",
      label: "Cleared Threat 5 or higher",
      rank: 5,
      detail:
        "You held the line against a high-Threat operation and kept the protected core intact.",
    },
  ],
  viper: [
    {
      id: "impact_specialist",
      label: "Impact and recovery specialist",
      rank: 1,
      detail:
        "VIPER encrypts everything it can reach and forces a recovery fight, testing whether backups and least privilege are in place.",
    },
    {
      id: "rank_3_story_clue",
      label: "Story clue recovered",
      rank: 3,
      detail:
        "VIPER's payload is signed with tooling traced to the same sponsor. Recovery is now part of the campaign.",
    },
    {
      id: "boss_pattern_seen",
      label: "Boss pattern witnessed",
      rank: 5,
      detail:
        "VIPER escalates to a high-impact operation designed to overwhelm recovery capacity.",
    },
    {
      id: "highest_threat_5",
      label: "Cleared Threat 5 or higher",
      rank: 5,
      detail:
        "You held the line against a high-Threat operation and kept the protected core intact.",
    },
  ],
};

/** All dossier entry ids for an adversary. */
export function adversaryDossier(adversaryId: string): AdversaryDossierEntry[] {
  return ADVERSARY_DOSSIERS[adversaryId] ?? [];
}

/** Learner-facing label for a dossier flag id, shared across adversaries. */
const DOSSIER_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(ADVERSARY_DOSSIERS)
    .flat()
    .map((entry) => [entry.id, entry.label]),
);

/** Resolves a dossier flag id to its label, humanizing unknown ids. */
export function dossierLabelForFlag(flagId: string): string {
  return DOSSIER_LABELS[flagId] ?? flagId.replace(/_/g, " ");
}
