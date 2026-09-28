import type { TowerUpgradeDefinition } from "../models/tower";

/**
 * Tower / HQ room definitions.
 *
 * Costs mirror `crates/domain/src/cyber_defense.rs` exactly. Benefits are
 * modest, information- and option-oriented, never a blanket power boost: see
 * Stage2.md step 7.3 and section 10.
 */
export const TOWER_UPGRADES: TowerUpgradeDefinition[] = [
  {
    id: "soc",
    roomId: "soc",
    name: "Security Operations Center",
    description:
      "Watch the board more clearly. Each level reveals more of the incoming wave before it lands.",
    maxLevel: 4,
    costs: [40, 90, 180, 320],
    icon: "🖥️",
    color: "#38bdf8",
    levelBenefits: [
      { level: 1, description: "Standard mission information." },
      { level: 2, description: "Show the first upcoming wave in the briefing." },
      {
        level: 3,
        description: "Show two upcoming wave categories in the briefing.",
      },
      {
        level: 4,
        description: "Expose a little more pre-wave information.",
      },
    ],
  },
  {
    id: "threat_intelligence",
    roomId: "threat_intelligence",
    name: "Threat Intelligence",
    description:
      "Study recurring adversaries and learn what each Operation hides.",
    maxLevel: 3,
    costs: [60, 150, 300],
    icon: "🛰️",
    color: "#a78bfa",
    prerequisites: [{ upgradeId: "soc", level: 1 }],
    levelBenefits: [
      { level: 1, description: "Show the adversary's specialty." },
      {
        level: 2,
        description: "Reveal one Operation modifier before you start.",
      },
      { level: 3, description: "Reveal boss presence before you start." },
    ],
  },
  {
    id: "training_center",
    roomId: "training_center",
    name: "Training Center",
    description:
      "Turn your operators into long-term characters with talents and growth.",
    maxLevel: 3,
    costs: [50, 120, 260],
    icon: "🎓",
    color: "#34d399",
    levelBenefits: [
      { level: 1, description: "Hero progression screen enabled." },
      { level: 2, description: "Small hero XP bonus." },
      { level: 3, description: "Talent respec unlocked and discounted." },
    ],
  },
  {
    id: "engineering_lab",
    roomId: "engineering_lab",
    name: "Engineering Lab",
    description: "Experiment with how you take an Operation into the field.",
    maxLevel: 2,
    costs: [70, 200],
    icon: "🧪",
    color: "#fbbf24",
    prerequisites: [{ upgradeId: "soc", level: 2 }],
    levelBenefits: [
      { level: 1, description: "One Operation loadout customization feature." },
      { level: 2, description: "Unlock one alternate strategic option." },
    ],
  },
  {
    id: "resilience_center",
    roomId: "resilience_center",
    name: "Resilience Center",
    description:
      "Recover faster and understand failures better. Never a way to erase mistakes.",
    maxLevel: 2,
    costs: [80, 220],
    icon: "🧯",
    color: "#60a5fa",
    prerequisites: [{ upgradeId: "training_center", level: 1 }],
    levelBenefits: [
      {
        level: 1,
        description: "Improved recovery and postmortem information.",
      },
      { level: 2, description: "A modest recovery-oriented benefit." },
    ],
  },
];

export const TOWER_UPGRADES_BY_ID: Record<string, TowerUpgradeDefinition> =
  Object.fromEntries(TOWER_UPGRADES.map((upgrade) => [upgrade.id, upgrade]));
