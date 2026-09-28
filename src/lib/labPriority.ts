import type { LabPriority } from "./settings";
import type { SlimEntity } from "./types";

// Troops treated as "farming" — cheap, resource-focused, or core barch.
const FARM_TROOP_IDS = new Set([
  4000000, // Barbarian
  4000001, // Archer
  4000002, // Goblin
  4000004, // Wall Breaker
  4000055, // Sneaky Goblin
]);

/**
 * Priority boost applied to lab jobs.
 *
 * Two independent sources, and they stack:
 *  - the explicit `labOrder` list from the Lab Priority Editor, where an id's
 *    position in the list decides its boost;
 *  - the quick `labPriority` preset, which bumps air / ground / farming units
 *    without the user having to build a list.
 */
export function labPriorityBoost(
  labPriority: LabPriority,
  labOrder: number[],
  category: string,
  entity: SlimEntity | null,
): number {
  if (category !== "troop" && category !== "spell" && category !== "siege") return 0;
  if (!entity) return 0;

  let boost = 0;

  const idx = labOrder.indexOf(entity._id);
  if (idx >= 0) boost += Math.max(0, 300 - idx * 12);

  if (labPriority !== "general" && category === "troop") {
    const flying = entity.flying === true;
    switch (labPriority) {
      case "air":
        if (flying) boost += 200;
        break;
      case "ground":
        if (!flying) boost += 200;
        break;
      case "farming":
        if (FARM_TROOP_IDS.has(entity._id)) boost += 200;
        break;
    }
  }

  return boost;
}
