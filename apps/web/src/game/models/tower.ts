/**
 * Persistent Tower / Cyber Defense HQ model.
 *
 * The Tower is the primary long-term Bits sink. Costs and levels are display
 * copies of the server's canonical rules in
 * `crates/domain/src/cyber_defense.rs`; the server remains authoritative and
 * the client only previews affordability. See Stage2.md step 7.
 */

export type TowerRoomId =
  | "soc"
  | "threat_intelligence"
  | "training_center"
  | "engineering_lab"
  | "resilience_center";

/** One unlockable benefit at a room level. */
export interface TowerLevelBenefit {
  level: number;
  description: string;
}

/** A prerequisite room and level. */
export interface TowerUpgradeRequirement {
  upgradeId: TowerRoomId;
  level: number;
}

/** A Tower/HQ room upgrade track. */
export interface TowerUpgradeDefinition {
  id: TowerRoomId;
  roomId: TowerRoomId;
  name: string;
  description: string;
  maxLevel: number;
  /** `costs[i]` is the Bits cost to go from level `i` to `i + 1`. */
  costs: number[];
  levelBenefits: TowerLevelBenefit[];
  prerequisites?: TowerUpgradeRequirement[];
  icon: string;
  color: string;
}

/** Aggregate Tower level: `1 + sum(room levels)`, matching the server rule. */
export function towerLevel(roomLevels: number[]): number {
  return 1 + roomLevels.reduce((sum, level) => sum + Math.max(0, level), 0);
}

/** Bits cost to reach the next level, or `null` at the cap. */
export function nextTowerCost(
  definition: TowerUpgradeDefinition,
  currentLevel: number,
): number | null {
  if (currentLevel < 0 || currentLevel >= definition.maxLevel) {
    return null;
  }
  return definition.costs[currentLevel] ?? null;
}

/** Whether every prerequisite room level is met. */
export function towerPrerequisitesMet(
  definition: TowerUpgradeDefinition,
  roomLevels: Record<string, number>,
): boolean {
  return (definition.prerequisites ?? []).every(
    (requirement) => (roomLevels[requirement.upgradeId] ?? 0) >= requirement.level,
  );
}

/** The benefit gained by upgrading to `currentLevel + 1`, if any. */
export function nextTowerBenefit(
  definition: TowerUpgradeDefinition,
  currentLevel: number,
): TowerLevelBenefit | undefined {
  return definition.levelBenefits.find(
    (benefit) => benefit.level === currentLevel + 1,
  );
}
