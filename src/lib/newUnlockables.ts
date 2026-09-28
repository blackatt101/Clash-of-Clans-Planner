import type { GameData } from "./staticData";
import type { SlimEntity } from "./types";
import type { ParsedVillage } from "./parse";
import { villageLevel } from "./upgrade";
import { isBuildingAvailable } from "./gameLogic";

/**
 * Determine which village an entity belongs to when its static data has no
 * explicit `village` field.
 *
 * The data files for spells, pets, equipment, and helpers all lack a `village`
 * field (it's undefined on every item). We infer it from the entity ID range:
 *   - spells, pets, equipment, helpers  → always home village
 *   - troops, heroes, traps, buildings  → already have a village field
 *
 * This avoids dropping these categories from unlock detection.
 */
function inferVillage(entity: SlimEntity): "home" | "builderBase" | undefined {
  if (entity.village) return entity.village;
  // ID-based inference for entities without a village field.
  // Supercell entity ID ranges: home-village spells start at 28000000+,
  // pets at 73000000+, equipment at 90000000+, helpers at 93000000+.
  // All of these are home-village-only.
  const id = entity._id;
  if (id >= 26000000 && id < 27000000) return "home"; // spells (heroes are 28M+)
  if (id >= 73000000 && id < 74000000) return "home"; // pets
  if (id >= 90000000 && id < 91000000) return "home"; // equipment
  if (id >= 93000000 && id < 94000000) return "home"; // helpers
  return undefined;
}

/**
 * Find all entities that become available at the new village level
 * but were not available at the previous level.
 */
export function getNewlyUnlockedEntities(
  pv: ParsedVillage,
  data: GameData,
  village: "home" | "builderBase",
  /** The previous village's level for the same village — the baseline to diff
   *  against. `null` means "no village before": there is no baseline to diff
   *  against, so nothing counts as newly unlocked (the banner is about what a
   *  level-up opened up, and there was no level-up). */
  previousLevel: number | null = null,
): SlimEntity[] {
  const currentLevel = villageLevel(pv, village);
  if (currentLevel === null || currentLevel < 0) return [];
  // No "before" level to compare with: nothing was *newly* unlocked. This is
  // the whole point of the feature — "your Town Hall 10→11 upgrade unlocked
  // these" — and on a first load of an export there is no previous level, so a
  // 141-item "everything in the rulebook" banner is wrong, not helpful.
  if (previousLevel == null || previousLevel < 0) return [];

  const newlyUnlocked: SlimEntity[] = [];

  // Get all entities for this village
  for (const entity of data.byId.values()) {
    // Infer village for entities that lack the field (spells, pets, equipment, helpers)
    const inferred = inferVillage(entity);
    if (inferred !== village) continue;

    // Check if this entity is available at the current level but was not
    // available at the previous one.
    const nowAvailable = isBuildingAvailable(entity, currentLevel);
    const wasAvailable = previousLevel > 0 ? isBuildingAvailable(entity, previousLevel) : false;

    if (nowAvailable && !wasAvailable) {
      newlyUnlocked.push(entity);
    }
  }

  return newlyUnlocked;
}

/**
 * Find all entities that are available to be built/placed at the current village level
 * but are not currently in the parsed village (haven't been built yet).
 */
export function getAvailableUnbuiltEntities(
  pv: ParsedVillage,
  data: GameData,
  village: "home" | "builderBase"
): SlimEntity[] {
  const currentLevel = villageLevel(pv, village);
  if (currentLevel === null || currentLevel < 0) return [];

  const ownedIds = new Set(pv.entries.filter(e => e.village === village).map(e => e.id));
  const availableUnbuilt: SlimEntity[] = [];

  // Get all entities for this village that are available at current level but not built yet
  for (const entity of data.byId.values()) {
    const inferred = inferVillage(entity);
    if (inferred !== village) continue;
    if (ownedIds.has(entity._id)) continue; // Skip if already owned/built

    // Check if entity is available at current village level
    if (isBuildingAvailable(entity, currentLevel)) {
      availableUnbuilt.push(entity);
    }
  }

  return availableUnbuilt;
}

/**
 * Check if there are new unlockables after a level change
 */
export function hasNewUnlockablesAfterLevelChange(
  oldPv: ParsedVillage | null,
  newPv: ParsedVillage,
  data: GameData
): boolean {
  const newLevel = villageLevel(newPv, "home");
  const newBh = villageLevel(newPv, "builderBase");

  // Check if TH level increased — diff against the *old* level, not one step
  // back, so an export that jumps several levels reports every new unlock.
  // oldPv null means "no village before": every level counts as an increase.
  if (newLevel !== null && newLevel > (oldPv ? (villageLevel(oldPv, "home") ?? 0) : 0)) {
    for (const entity of data.byId.values()) {
      const inferred = inferVillage(entity);
      if (inferred !== "home") continue;

      const nowAvailable = isBuildingAvailable(entity, newLevel);
      const oldHome = oldPv ? villageLevel(oldPv, "home") : null;
      const wasAvailable =
        oldHome != null && oldHome > 0 ? isBuildingAvailable(entity, oldHome) : false;

      if (nowAvailable && !wasAvailable) {
        return true;
      }
    }
  }

  // Check if BH level increased
  if (newBh !== null && newBh > (oldPv ? (villageLevel(oldPv, "builderBase") ?? 0) : 0)) {
    for (const entity of data.byId.values()) {
      const inferred = inferVillage(entity);
      if (inferred !== "builderBase") continue;

      const nowAvailable = isBuildingAvailable(entity, newBh);
      const oldBh = oldPv ? villageLevel(oldPv, "builderBase") : null;
      const wasAvailable =
        oldBh != null && oldBh > 0 ? isBuildingAvailable(entity, oldBh) : false;

      if (nowAvailable && !wasAvailable) {
        return true;
      }
    }
  }

  return false;
}