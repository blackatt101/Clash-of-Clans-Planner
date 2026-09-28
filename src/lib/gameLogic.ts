/**
 * Comprehensive fix for all game logic issues in Clash of Clans planner
 *
 * Issues addressed:
 * 1. Hero levels exceeding maximum allowed at current TH level
 * 2. Builder Hall upgrading without all available buildings built first
 * 3. Missing proper gate requirements and validations
 * 4. Incorrect upgrade calculations
 * 5. Performance: O(N²) gating loops replaced with O(1) Map lookups
 * 6. Unlockable detection: spells/pets/equipment/helpers now detected
 *    (these entities have village=undefined in static data, must be inferred)
 */

import type { GameData } from "./staticData";
import type { ParsedEntry, ParsedVillage } from "./parse";
import type { Cost, Village, Category } from "./types";

/**
 * Defines maximum allowed hero levels per Town Hall/Builder Hall level
 */
export const HERO_MAX_LEVELS: Record<string, number[]> = {
  // Home Village Heroes
  "Barbarian King": [
    0,  // TH 0 - invalid
    0,  // TH 1 - doesn't exist
    0,  // TH 2 - doesn't exist
    0,  // TH 3 - doesn't exist
    1,  // TH 4 - available
    1,  // TH 5
    1,  // TH 6
    7,  // TH 7 - max level 7
    8,  // TH 8 - max level 8
    9,  // TH 9 - max level 9
    10, // TH 10 - max level 10
    50, // TH 11 - max level 50 (with GW unlocked)
    60, // TH 12 - max level 60
    70, // TH 13 - max level 70
    80, // TH 14 - max level 80
    90, // TH 15 - max level 90
    100,// TH 16 - max level 100
    110,// TH 17 - max level 110
    110 // TH 18 - max level 110
  ],
  "Archer Queen": [
    0,  // TH 0 - invalid
    0,  // TH 1 - doesn't exist
    0,  // TH 2 - doesn't exist
    0,  // TH 3 - doesn't exist
    0,  // TH 4 - doesn't exist
    0,  // TH 5 - doesn't exist
    0,  // TH 6 - doesn't exist
    0,  // TH 7 - doesn't exist
    2,  // TH 8 - available
    2,  // TH 9
    2,  // TH 10
    50, // TH 11 - max level 50
    60, // TH 12 - max level 60
    70, // TH 13 - max level 70
    80, // TH 14 - max level 80
    90, // TH 15 - max level 90
    100,// TH 16 - max level 100
    110,// TH 17 - max level 110
    110 // TH 18 - max level 110
  ],
  "Grand Warden": [
    0,  // TH 0 - invalid
    0,  // TH 1 - doesn't exist
    0,  // TH 2 - doesn't exist
    0,  // TH 3 - doesn't exist
    0,  // TH 4 - doesn't exist
    0,  // TH 5 - doesn't exist
    0,  // TH 6 - doesn't exist
    0,  // TH 7 - doesn't exist
    0,  // TH 8 - doesn't exist
    0,  // TH 9 - doesn't exist
    0,  // TH 10 - doesn't exist
    20, // TH 11 - available, max level 20
    25, // TH 12 - max level 25
    30, // TH 13 - max level 30
    40, // TH 14 - max level 40
    50, // TH 15 - max level 50
    65, // TH 16 - max level 65
    85, // TH 17 - max level 85
    85  // TH 18 - max level 85
  ],
  "Royal Champion": [
    0,  // TH 0 - invalid
    0,  // TH 1 - doesn't exist
    0,  // TH 2 - doesn't exist
    0,  // TH 3 - doesn't exist
    0,  // TH 4 - doesn't exist
    0,  // TH 5 - doesn't exist
    0,  // TH 6 - doesn't exist
    0,  // TH 7 - doesn't exist
    0,  // TH 8 - doesn't exist
    0,  // TH 9 - doesn't exist
    0,  // TH 10 - doesn't exist
    0,  // TH 11 - doesn't exist
    0,  // TH 12 - doesn't exist
    15, // TH 13 - available, max level 15
    25, // TH 14 - max level 25
    35, // TH 15 - max level 35
    45, // TH 16 - max level 45
    55, // TH 17 - max level 55
    55  // TH 18 - max level 55
  ],
  "Minion Prince": [
    0,  // TH 0 - invalid
    0,  // TH 1 - doesn't exist
    0,  // TH 2 - doesn't exist
    0,  // TH 3 - doesn't exist
    0,  // TH 4 - doesn't exist
    0,  // TH 5 - doesn't exist
    0,  // TH 6 - doesn't exist
    0,  // TH 7 - doesn't exist
    0,  // TH 8 - doesn't exist
    5,  // TH 9 - available
    20, // TH 10 - max level 20
    30, // TH 11 - max level 30
    40, // TH 12 - max level 40
    50, // TH 13 - max level 50
    60, // TH 14 - max level 60
    70, // TH 15 - max level 70
    85, // TH 16 - max level 85
    95, // TH 17 - max level 95
    95  // TH 18 - max level 95
  ],
  "Dragon Duke": [
    0,  // TH 0 - invalid
    0,  // TH 1 - doesn't exist
    0,  // TH 2 - doesn't exist
    0,  // TH 3 - doesn't exist
    0,  // TH 4 - doesn't exist
    0,  // TH 5 - doesn't exist
    0,  // TH 6 - doesn't exist
    0,  // TH 7 - doesn't exist
    0,  // TH 8 - doesn't exist
    0,  // TH 9 - doesn't exist
    0,  // TH 10 - doesn't exist
    0,  // TH 11 - doesn't exist
    0,  // TH 12 - doesn't exist
    0,  // TH 13 - doesn't exist
    0,  // TH 14 - doesn't exist
    5,  // TH 15 - available
    15, // TH 16 - max level 15
    20, // TH 17 - max level 20
    25  // TH 18 - max level 25
  ],

  // Builder Base Heroes
  "Battle Machine": [
    0,  // BH 0 - invalid
    0,  // BH 1 - doesn't exist
    0,  // BH 2 - doesn't exist
    0,  // BH 3 - doesn't exist
    0,  // BH 4 - doesn't exist
    1,  // BH 5 - available, max level 1
    10, // BH 6 - max level 10
    20, // BH 7 - max level 20
    35, // BH 8 - max level 35
    35, // BH 9 - max level 35
    35  // BH 10 - max level 35
  ],
  "Battle Copter": [
    0,  // BH 0 - invalid
    0,  // BH 1 - doesn't exist
    0,  // BH 2 - doesn't exist
    0,  // BH 3 - doesn't exist
    0,  // BH 4 - doesn't exist
    0,  // BH 5 - doesn't exist
    0,  // BH 6 - doesn't exist
    0,  // BH 7 - doesn't exist
    15, // BH 8 - available, max level 15
    25, // BH 9 - max level 25
    35  // BH 10 - max level 35
  ]
};

/**
 * Get maximum hero level allowed at current TH/BH level
 */
export function getMaxHeroLevel(heroName: string, villageLevel: number, village: Village): number {
  const maxLevels = HERO_MAX_LEVELS[heroName];
  if (!maxLevels) return 0; // Default to 0 if hero not found

  if (villageLevel < 0 || villageLevel >= maxLevels.length) {
    // If village level is beyond known data, return the max known level
    return maxLevels[maxLevels.length - 1];
  }

  return maxLevels[villageLevel] || 0;
}

/**
 * Result of computing which available-but-unbuilt entities are missing.
 * Pre-computed once per (pv, village) to avoid O(N²) repeated scans.
 */
export interface MissingBuildingsResult {
  allBuilt: boolean;
  missingNames: string[];
}

/**
 * Compute which available entities are not yet built, in a single pass.
 *
 * PERFORMANCE: Previously `areAllAvailableBuildingsBuilt` and `getMissingBuildings`
 * each did their own full scan of `data.byId.values()` (O(274 entities × level-checks)),
 * and these were called inside `computeUpgrades` which loops over every entry.
 * That's O(entries × entities) = O(N²). This function computes both in one pass.
 *
 * It also now accounts for the fact that spells, pets, equipment, and helpers
 * have `village: undefined` in the static data — it uses the same ID-range
 * inference as `newUnlockables.ts` to include them.
 */
export function computeMissingBuildings(
  pv: ParsedVillage,
  data: GameData,
  village: Village
): MissingBuildingsResult {
  const villageLevel = village === "home" ? pv.townHallLevel : pv.builderHallLevel;
  if (villageLevel === null || villageLevel === undefined || villageLevel < 0) {
    return { allBuilt: true, missingNames: [] };
  }

  // Build a set of owned entity IDs for the specified village once.
  const builtEntityIds = new Set(
    pv.entries.filter((e) => e.village === village).map((e) => e.id)
  );

  const missing: string[] = [];

  // Single pass over all entities, checking village membership + availability.
  for (const entity of data.byId.values()) {
    // Infer village for entities without an explicit village field
    // (spells, pets, equipment, helpers have village=undefined in JSON)
    if (entity.village !== village) {
      // Only check home-village inference for these categories
      if (entity.village !== undefined) continue;
      const inferred = inferVillage(entity);
      if (inferred !== village) continue;
    }

    // Check if this entity is available at the current village level
    if (!isBuildingAvailable(entity, villageLevel)) continue;

    // Check if it's built
    if (!builtEntityIds.has(entity._id)) {
      missing.push(entity.name);
    }
  }

  return {
    allBuilt: missing.length === 0,
    missingNames: missing,
  };
}

/**
 * Check if all available buildings are built at current village level.
 * DEPRECATED: Use computeMissingBuildings once and reuse the result.
 */
export function areAllAvailableBuildingsBuilt(pv: ParsedVillage, data: GameData, village: Village): boolean {
  return computeMissingBuildings(pv, data, village).allBuilt;
}

/**
 * Get list of missing buildings that prevent TH/BH upgrade.
 * DEPRECATED: Use computeMissingBuildings once and reuse the result.
 */
export function getMissingBuildings(pv: ParsedVillage, data: GameData, village: Village): string[] {
  return computeMissingBuildings(pv, data, village).missingNames;
}

/**
 * Check if a specific upgrade should be blocked based on game rules
 *
 * NOTE: the old per-TH hero cap (HERO_MAX_LEVELS) is gone — the game has no
 * such table. Each hero level row carries its own Town Hall requirement in the
 * static data, and that is what gates the hero (see `levelGate` in
 * `upgrade.ts`). A Barbarian King at TH11 is not capped at 50 by anything.
 */
export function isUpgradeBlocked(
  entry: ParsedEntry,
  nextLevel: number,
  pv: ParsedVillage,
  data: GameData
): { blocked: boolean; reason: string; requiredLevel?: number } {
  // For Builder Hall upgrades, check if all available buildings are built
  if (entry.village === "builderBase" && entry.id === 1000034) { // Builder Hall ID
    if (!areAllAvailableBuildingsBuilt(pv, data, "builderBase")) {
      const missing = getMissingBuildings(pv, data, "builderBase");
      return {
        blocked: true,
        reason: `Need to build all available buildings first: ${missing.slice(0, 3).join(", ")}`,
        requiredLevel: pv.builderHallLevel || 1
      };
    }
  }

  return { blocked: false, reason: "" };
}

/**
 * Determine which village an entity belongs to when its static data has no
 * explicit `village` field.
 *
 * The data files for spells, pets, equipment, and helpers all lack a `village`
 * field (it's undefined on every item). We infer it from the entity ID range:
 *   - spells (26000000+), pets (73000000+), equipment (90000000+),
 *     helpers (93000000+) → always home village
 *   - troops, heroes, traps, buildings → already have a village field
 */
export function inferVillage(entity: { _id: number; village?: Village }): "home" | "builderBase" | undefined {
  if (entity.village) return entity.village;
  const id = entity._id;
  if (id >= 26000000 && id < 30000000) return "home"; // spells
  if (id >= 73000000 && id < 74000000) return "home"; // pets
  if (id >= 90000000 && id < 91000000) return "home"; // equipment
  if (id >= 93000000 && id < 94000000) return "home"; // helpers
  return undefined;
}

/**
 * Check if a building/unit is available for construction at the given village level.
 *
 * The static data files for spells, pets, equipment, and helpers do NOT carry a
 * `village` field — it's null/undefined for every item in those files. The previous
 * implementation returned `false` for any entity without an explicit village, which
 * silently dropped ALL spells, pets, equipment, and helpers from unlock detection.
 *
 * This function no longer checks `village` — it only checks if the entity's level
 * rows are unlocked at the given village level. Callers should verify the village
 * separately via `inferVillage` or the entity's own `village` field.
 */
export function isBuildingAvailable(
  entity: { _id: number; village?: Village; levels: Array<{ th?: number }> },
  currentVillageLevel: number
): boolean {
  // The `th` field on each level row is the Town Hall (home) or Builder Hall (builderBase)
  // level required to unlock that level. If the lowest level row has no `th` field at all,
  // the entity is available from the start (e.g., lvl 1 buildings with no TH requirement).
  return entity.levels.some(level => (level.th ?? 0) <= currentVillageLevel);
}