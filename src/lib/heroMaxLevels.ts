/**
 * DEPRECATED: This module's logic has been consolidated into gameLogic.ts,
 * which includes the fix for spells/pets/equipment/helpers (village inference)
 * and the performance-optimized computeMissingBuildings (single-pass, O(1) byVillage index).
 *
 * We re-export here for backward compatibility. This file will be removed in a future refactor.
 */

// Re-export from the consolidated logic in gameLogic.ts.
// gameLogic.ts uses HERO_MAX_LEVELS (identical values to this file's HERO_MAX_LEVELS_BY_TH).
export {
  HERO_MAX_LEVELS as HERO_MAX_LEVELS_BY_TH,
  getMaxHeroLevel,
  areAllAvailableBuildingsBuilt,
  getMissingBuildings,
} from "./gameLogic";
