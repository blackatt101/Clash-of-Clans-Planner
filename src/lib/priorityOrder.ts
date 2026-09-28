import type { HeroSchedule } from "./settings";
import type { Family, SlimEntity } from "./types";

/* -------------------------------------------------------------------------- */
/* Focus orders — which hero / pet / lab unit to push first                     */
/* -------------------------------------------------------------------------- */

// Home-village hero IDs in the community-recommended upgrade focus order.
export const HOME_HERO_FOCUS = [
  28000000, // Barbarian King
  28000001, // Archer Queen
  28000002, // Grand Warden
  28000004, // Royal Champion
  28000006, // Minion Prince
  28000007, // Dragon Duke
];

// Pets unlock roughly in this order, which is also the usual upgrade order.
export const PET_FOCUS = [
  73000000, // L.A.S.S.I
  73000001, // Mighty Yak
  73000002, // Electro Owl
  73000003, // Unicorn
  73000004, // Phoenix
  73000007, // Poison Lizard
  73000008, // Diggy
  73000009, // Frosty
  73000010, // Spirit Fox
  73000011, // Angry Jelly
  73000016, // Sneezy
  73000017, // Greedy Raven
];

/**
 * The heroes a set of dedicated lanes goes to, most focused first.
 *
 * Which heroes to focus and how many lanes to give them are two questions with
 * one answer between them: the lanes take the top of the focus order, so the
 * order IS the chooser and there is no third list to keep in step with it. A
 * hero the order does not name still ranks — after the named ones, in id order,
 * which keeps the pick stable between renders — because it is a real hero the
 * player ticked, and leaving it out of the ranking would make it invisible to
 * the lanes entirely rather than merely last.
 *
 * `planned` is the ticked heroes of one village: a lane for a hero nobody is
 * upgrading is a lane drawn empty.
 */
export function focusedHeroes<T extends { id: number }>(
  planned: T[],
  heroOrder: number[],
  count: number,
): T[] {
  const order = heroOrder.length > 0 ? heroOrder : HOME_HERO_FOCUS;
  const rank = (id: number) => {
    const i = order.indexOf(id);
    // /1e6 would round every hero id to the same 28.x float, so unlisted heroes
    // tied and their lane order fell through to input order. id alone breaks
    // the tie deterministically.
    return i < 0 ? order.length + 1 + id / 1e9 : i;
  };
  return [...planned].sort((a, b) => rank(a.id) - rank(b.id)).slice(0, Math.max(0, count));
}

/**
 * Boost applied to a job by its position in a focus order (higher = sooner).
 * Falls back to the built-in order when the user hasn't set one, so the
 * community default (BK → AQ → GW → RC → …) applies out of the box.
 *
 * An id the user left out of a non-empty order gets no boost at all: a partial
 * order is a statement about those units, not a reason to re-rank the rest.
 */
export function focusBoost(order: number[], fallback: number[], id: number, span = 150): number {
  const list = order.length > 0 ? order : fallback;
  const rank = list.indexOf(id);
  if (rank < 0) return 0;
  return Math.max(0, span - rank * 15);
}

/**
 * How many heroes may be upgrading at once under a "keep N available" preset.
 *
 * Floored at 1 for every "keep" setting, because the arithmetic's zero is a
 * lie: on a 2-hero account "keep 2" computes 2 − 2 = 0, and 0 is the value the
 * scheduler reads as "no limit" — so the preset promising the most heroes
 * available produced the fewest, with every hero in a builder at once. One at a
 * time is the most any "keep" setting can honestly mean. "No hero upgrades" is
 * a separate setting (and answers 0 on purpose).
 */
export function heroCap(heroSchedule: HeroSchedule, totalHomeHeroes: number): number {
  const t = Math.max(0, totalHomeHeroes);
  switch (heroSchedule) {
    case "all": return t;
    case "none": return 0;
    case "keep1": return Math.max(1, t - 1);
    case "keep2": return Math.max(1, t - 2);
    case "keep3": return Math.max(1, t - 3);
    case "keep4": return Math.max(1, t - 4);
  }
}

/* -------------------------------------------------------------------------- */
/* Upgrade priority groups — the "Upgrade Priority Order" list                  */
/* -------------------------------------------------------------------------- */

export const GROUP_LABELS: Record<string, string> = {
  hero: "Heroes",
  lab: "Laboratory",
  pet: "Pets",
  army: "Army buildings",
  defense: "Defenses",
  resource: "Resource buildings",
  trap: "Traps",
  wall: "Walls",
  townhall: "Town Hall",
  other: "Other buildings",
};

/**
 * The schedulable group an upgrade belongs to. Deliberately coarser than
 * `category`: Laboratory covers troops/spells/siege because they all queue in one
 * place, and buildings split by their in-game `type` so defenses can be ordered
 * separately from army camps.
 */
export function groupKey(category: string, entity: SlimEntity | null, isTownHall: boolean): string {
  if (isTownHall) return "townhall";
  if (category === "hero") return "hero";
  if (category === "pet") return "pet";
  if (category === "troop" || category === "spell" || category === "siege") return "lab";
  if (category === "trap") return "trap";
  switch (entity?.type) {
    case "Defense": return "defense";
    case "Army": return "army";
    case "Resource": return "resource";
    // The Builder Base's Town Hall is the Builder Hall, but it does not need a
    // case here: the in-game *type* "BB Builder Hall" is shared with O.T.T.O's
    // Outpost, a hut, and `isTownHall` (from `townHallIdFor`) already names the
    // Builder Hall by id — so keying off the type would have put the second
    // builder's hut in the Town Hall priority group.
    case "Town Hall": return "townhall";
    case "Wall": return "wall";
  }
  return "other";
}

/**
 * Which family an upgrade belongs to, for colouring. Same question as
 * `groupKey` but answered for the reader rather than the scheduler: buildings
 * split by their in-game `type` because that is the split a player thinks in,
 * pets join the army because that is what they fight with, and the Town Hall
 * counts as a building.
 */
export function familyOf(
  category: string,
  entity: SlimEntity | null,
  isTownHall: boolean,
): Family {
  if (isTownHall) return "buildings";
  if (category === "hero") return "hero";
  if (category === "spell") return "spell";
  if (category === "troop" || category === "siege" || category === "pet") return "army";
  if (category === "trap") return "trap";
  switch (entity?.type) {
    case "Defense": return "defense";
    case "Army": return "army";
    case "Resource": return "resource";
  }
  // Walls, the Town Hall / Builder Hall, huts and helpers.
  return "buildings";
}

/** Boost for a group's position in the upgrade order (earlier = higher). */
export function upgradeOrderBoost(order: string[], key: string): number {
  const i = order.indexOf(key);
  if (i < 0) return 0;
  return (order.length - i) * 20;
}

/** Every group present in the given keys, in the order the user set. */
export function orderedGroups(order: string[], present: Set<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of order) {
    if (present.has(k) && !seen.has(k)) {
      out.push(k);
      seen.add(k);
    }
  }
  for (const k of present) if (!seen.has(k)) out.push(k);
  return out;
}
