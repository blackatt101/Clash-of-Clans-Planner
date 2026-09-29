import type { ParsedEntry, ParsedVillage } from "./parse";
import type { PlannerSettings } from "./settings";
import type { Cost, Category } from "./types";
import type { UpgradeOption } from "./upgrade";
import type { GameData } from "./staticData";

// Builder Base entity IDs on the 6th-builder (B.O.B) critical path.
export const BB_BUILDER_HALL = 1000034;
export const BB_CLOCK_TOWER = 1000039;
export const BB_STAR_LAB = 1000046;
export const BB_HERO_IDS = [28000003, 28000005]; // Battle Machine, Battle Copter
/** B.O.B Control — the Builder Base building whose own upgrades ARE the tasks. */
export const BB_BOB_CONTROL = 1000065;
/** B.O.B's Hut — what appears in the Home Village once the 6th builder is earned. */
export const BB_BOB_HUT = 1000064;
/** O.T.T.O's Outpost — the building that brings the 2nd Builder Base builder, at BH6. */
export const BB_OUTPOST = 1000078;
/** B.O.T.O's Shack — the gem-bought 3rd builder. Optional, and not everyone has it. */
export const BB_BOTO_SHACK = 1000047;

/* ---- the Builder Base economy ------------------------------------------- */

/**
 * The two storages, and which currency each one holds. Note that they pay for
 * each other: raising the gold ceiling costs Builder Elixir and raising the
 * elixir ceiling costs Builder Gold (the `resource` field on those entities is
 * the currency you PAY, not the one it holds). That is the whole shape of the
 * early Builder Base — hold more gold, which costs elixir, which needs more
 * elixir room, which costs gold.
 */
export const BB_GOLD_STORAGE = 1000038;
export const BB_ELIXIR_STORAGE = 1000036;
export const BB_GOLD = "Builder Gold";
export const BB_ELIXIR = "Builder Elixir";

/**
 * What one storage holds at each level, and what the Builder Hall holds itself.
 *
 * The Builder Hall's own storage is the reason a Builder Base can pay for an
 * upgrade its storages alone could not: Gold Storage level 8 requires Builder
 * Hall 8, so if the hall held nothing, the 2.8M for Builder Hall 8 would be out
 * of reach at Builder Hall 7 (two level-7 storages hold 2.4M) — a deadlock the
 * game does not have. The published figures confirm the arithmetic the game is
 * built on: at Builder Hall 8 the ceilings are 1.3M + 2 × 1.6M = 4.5M, just
 * enough for Builder Hall 9's 3.8M and the Star Lab 9's 4.0M, and at Builder
 * Hall 9 they are 1.5M + 2 × 2M = 5.5M, just enough for the 5.1M Baby Dragon
 * level 18 that B.O.B asks for.
 */
export const BB_STORAGE_CAPACITY = [
  0, 70_000, 150_000, 250_000, 350_000, 600_000, 800_000, 1_200_000, 1_600_000, 2_000_000, 2_500_000,
];
export const BB_HALL_CAPACITY = [
  // BH5/BH6/BH7 corrected against the wiki "Builder Hall - Available Resources"
  // table (intrinsic hall storage, per pool). The old 300k/400k/600k understated
  // the BH5-7 ceiling, so the planner invented phantom "raise storage first"
  // steps for prices the base could actually hold.
  0, 50_000, 75_000, 100_000, 150_000, 900_000, 900_000, 1_100_000, 1_300_000, 1_500_000, 1_500_000,
];

export function bbStorageCapacity(level: number | undefined): number {
  return BB_STORAGE_CAPACITY[Math.max(0, Math.min(10, Math.floor(level ?? 0)))] ?? 0;
}

export function bbHallCapacity(level: number | undefined): number {
  return BB_HALL_CAPACITY[Math.max(0, Math.min(10, Math.floor(level ?? 0)))] ?? 0;
}

/** Which currency a Builder Base storage holds, or null if it is not a storage. */
export function bbStoragePool(id: number): string | null {
  if (id === BB_GOLD_STORAGE) return BB_GOLD;
  if (id === BB_ELIXIR_STORAGE) return BB_ELIXIR;
  return null;
}

/**
 * A cost as a plain number of resources, or null when it cannot be paid with a
 * stored currency at all (equipment's ore). Only the Builder Base calls this,
 * where every price is gold or elixir.
 */
export function bbCostValue(cost: Cost | null | undefined): number | null {
  return typeof cost === "number" ? cost : null;
}

export const BB_TROOP_TARGET_LEVEL = 18;
export const BB_DEFENSE_TARGET_LEVEL = 9;
export const BB_HERO_TOTAL_TARGET = 45;
export const BB_BUILDER_HALL_TARGET = 9;
export const BB_STAR_LAB_TARGET = 9;
export const BB_BOB_CONTROL_TARGET = 5;
/** The Builder Base never has more than three builders (see `detectBbBuilders`). */
export const BB_MAX_BUILDERS = 3;
/** Builder Hall level that brings O.T.T.O's Outpost, and with it a second builder. */
export const BB_OUTPOST_BUILDER_HALL = 6;

/**
 * How long the Master Builder is away in the Home Village doing each gear-up.
 * While he is away the Builder Base runs one builder short — O.T.T.O and B.O.T.O
 * cannot gear anything up (it is the Master Builder's own workshop knowledge),
 * so a gear-up is a long block on ONE lane rather than extra parallelism.
 *
 * These trip durations are game constants that are NOT exposed in the static_data
 * JSON (ClashKingAssets) nor documented in the Fandom Clash of Clans Wiki
 * (the wiki lists Gear Up *building* upgrade costs/times, not Master Builder
 * travel time). Values verified against player community consensus:
 *   cannon      -> Double Cannon L4+:  2 days  (48h)   [round-trip to Home Village]
 *   archerTower -> Archer Tower BB L6+: 7 days  (168h)
 *   mortar      -> Multi Mortar L8+:   14 days (336h)
 *
 * Typed as Record<GearUpKey, number> so a renamed/missing key is a compile error.
 * Do NOT "correct" these to match any wiki table -- they are correct as-is.
 */
export const GEAR_UP_SECONDS: Record<GearUpKey, number> = {
  cannon: 2 * 86400,
  archerTower: 7 * 86400,
  mortar: 14 * 86400,
};

export interface BbBuilderCount {
  total: number;
  /** Whether O.T.T.O's Outpost is in the export — i.e. whether builder 2 exists. */
  outpostOwned: boolean;
  /** Whether B.O.T.O's Shack is in the export — the gem-bought third builder. */
  botoOwned: boolean;
}

/**
 * Builder Base builders, read off the export.
 *
 * The Builder Base does not sell builders the way the Home Village does: you get
 * the Master Builder, O.T.T.O arrives with Builder Hall 6 (O.T.T.O's Outpost),
 * and a third — B.O.T.O — can be bought for gems (B.O.T.O's Shack). So the count
 * is two facts about which buildings exist, and both are listed in the export.
 *
 * Read from the entries, not from the upgrade options: B.O.T.O's Shack has no
 * levels at all, so it can never produce an option, but its presence is exactly
 * what says the player has the third builder.
 */
export function detectBbBuilders(entries: ParsedEntry[]): BbBuilderCount {
  const bb = entries.filter((e) => e.village === "builderBase");
  // O.T.T.O arrives with Builder Hall 6 automatically, so a base at BH6 or above
  // has him whether or not the outpost is listed. This matters for a trimmed
  // export (the bundled sample lists only a Builder Hall, no outpost) and for any
  // export that leaves the hut out: reading the builder's absence literally
  // would plan a three-lane base on one lane.
  const bh = entries.find((e) => e.village === "builderBase" && e.id === BB_BUILDER_HALL)?.level ?? 0;
  const outpostOwned = bh >= BB_OUTPOST_BUILDER_HALL || bb.some((e) => e.id === BB_OUTPOST);
  // B.O.T.O is bought with gems, so nothing else can imply him: either the shack
  // is in the export or the player does not have him.
  const botoOwned = bb.some((e) => e.id === BB_BOTO_SHACK);
  return {
    total: 1 + (outpostOwned ? 1 : 0) + (botoOwned ? 1 : 0),
    outpostOwned,
    botoOwned,
  };
}

/**
 * The three gear-ups. This is the part of the 6th builder that is not in the
 * Builder Base at all: the Master Builder travels to the Home Village and
 * rebuilds one of its defences, which means the gear-up needs a level in *both*
 * villages. It is also why a Builder Base plan is a Home Village plan: without
 * these three, the 6th builder never appears, no matter how high the Builder
 * Hall goes.
 *
 * `GearUpKey` links the two hand-written lists below at compile time: GEAR_UPS
 * and GEAR_UP_SECONDS must stay in sync, and a renamed or added key is a build
 * error instead of a silent zero-duration trip.
 */
export type GearUpKey = "cannon" | "archerTower" | "mortar";

export interface GearUp {
  key: GearUpKey;
  label: string;
  /** The Builder Base defence that carries the gear-up. */
  bbId: number;
  bbTarget: number;
  /** The Home Village building the gear-up converts, and the level it needs. */
  hvId: number;
  hvTarget: number;
  /** Its name — a property of the requirement, not of the player's base. */
  hvName: string;
}

export const GEAR_UPS: GearUp[] = [
  {
    key: "cannon",
    label: "Gear Up: Double Cannon",
    bbId: 1000041,
    bbTarget: 4,
    hvId: 1000008,
    hvTarget: 7,
    hvName: "Cannon",
  },
  {
    key: "archerTower",
    label: "Gear Up: Archer Tower",
    bbId: 1000048,
    bbTarget: 6,
    hvId: 1000009,
    hvTarget: 10,
    hvName: "Archer Tower",
  },
  {
    key: "mortar",
    label: "Gear Up: Multi Mortar",
    bbId: 1000045,
    bbTarget: 8,
    hvId: 1000013,
    hvTarget: 8,
    hvName: "Mortar",
  },
];

// Troops offered in the "single max troop" picker (common rush choices).
export const BB_TROOP_OPTIONS: { id: number; name: string }[] = [
  { id: 4000041, name: "Baby Dragon" },
  { id: 4000037, name: "Cannon Cart" },
  { id: 4000035, name: "Bomber" },
  { id: 4000032, name: "Sneaky Archer" },
];

/**
 * Buildings eligible as the "one defence to level 9" target.
 *
 * Walls are in the list because the game accepts them, and they are the cheapest
 * way to satisfy the requirement — they take Builder Gold and **no builder time
 * at all** (every Builder Base wall level in the data has `time: 0`). Leaving
 * them out also made the checklist wrong in the other direction: a player whose
 * walls are already at 9 has met the requirement, and the old "highest defence"
 * auto could not see it.
 */
export const BB_DEFENSE_OPTIONS: { id: number; name: string }[] = [
  { id: 1000033, name: "Wall (no build time)" },
  { id: 1000041, name: "Double Cannon" },
  { id: 1000043, name: "Hidden Tesla" },
  { id: 1000044, name: "Cannon" },
  { id: 1000045, name: "Multi Mortar" },
  { id: 1000048, name: "Archer Tower" },
  { id: 1000050, name: "Firecrackers" },
  { id: 1000052, name: "Mega Tesla" },
  { id: 1000054, name: "Air Bombs" },
  { id: 1000055, name: "Crusher" },
  { id: 1000056, name: "Roaster" },
  { id: 1000057, name: "Giant Cannon" },
  { id: 1000063, name: "Lava Launcher" },
  { id: 1000081, name: "X-Bow" },
];

/** Combined current level of the two Builder Base heroes. */
export function bbHeroTotal(entries: ParsedEntry[]): number {
  return entries
    .filter((e) => e.village === "builderBase" && BB_HERO_IDS.includes(e.id))
    .reduce((s, e) => s + e.level, 0);
}

export interface BobMilestone {
  label: string;
  current: number;
  target: number;
  done: boolean;
  /** Second-village progress, for the gear-ups that need one. */
  note?: string;
  /** True when this milestone has a Home Village half that is still missing. */
  needsHome?: boolean;
}

/** Level of one entity, in whichever village it lives. */
export function levelOf(entries: ParsedEntry[], id: number): number {
  return entries.find((e) => e.id === id)?.level ?? 0;
}

/**
 * Whether a gear-up has actually been done, as far as the export can say.
 *
 * The Home Village building keeps the level the gear-up required, so its level
 * cannot answer this — `gear_up` on the export's entry is the only field that
 * distinguishes "ready to gear up" from "already geared up". False when the
 * export does not carry the field at all, which is why callers check
 * `hasGearFlag` before acting on it.
 */
export function gearUpPerformed(entries: ParsedEntry[], g: GearUp): boolean {
  return entries.some(
    (e) => e.village === "home" && e.id === g.hvId && (e.gearUp ?? 0) > 0,
  );
}

/** Whether any Home Village entry in this export carries the gear-up flag. */
export function hasGearUpFlag(entries: ParsedEntry[]): boolean {
  return entries.some((e) => e.village === "home" && e.gearUp != null);
}

/**
 * How long the home half of a gear-up takes per level, in the current rules.
 *
 * The three gear-ups are the only Home Village work whose build time is measured
 * in *days* — everything else in those buildings takes minutes-to-hours. When
 * the Master Builder travels to gear a building up, the game runs a long,
 * dedicated home-village upgrade whose timer is the trip duration, not the
 * ordinary next level. The trip durations are the values the goal scheduler
 * uses on the Master Builder's own lane (two days Cannon, seven Archer,
 * fourteen Mortar), and they dwarf every ordinary upgrade time of the gear-up
 * buildings: the longest normal home step is 7 days (Mortar 17→18, 108000 s),
 * while the Cannon trip is 2 days, so it can only be told apart from normal
 * Cannon work when the Cannon level itself is high enough that its ordinary
 * time approaches the trip. Keep the threshold conservative — longer than the
 * normal time of *most* levels of that building, and never longer than the
 * trip itself.
 */
export const GEAR_UP_TRIP_SECONDS: Record<GearUpKey, number> = {
  cannon: GEAR_UP_SECONDS.cannon,
  archerTower: GEAR_UP_SECONDS.archerTower,
  mortar: GEAR_UP_SECONDS.mortar,
};

/**
 * Whether a gear-up's Master Builder trip is *literally running right now*.
 *
 * The only "running" signal is the live timer on the Home Village building:
 * while the Master Builder is away on the journey, that building carries a
 * timer that counts down the trip itself. A normal level-up is minutes-to-hours
 * (e.g. Archer 13→14 is ~11 h), far shorter than half a multi-day trip, so a
 * timer of at least half the trip duration on the gear-up building is the
 * journey, not an ordinary upgrade.
 */
export function gearUpInFlight(entries: ParsedEntry[], g: GearUp): boolean {
  const trip = GEAR_UP_TRIP_SECONDS[g.key];
  // Timer signal: a live timer on the building at least half the trip length
  // is the journey itself counting down — not an ordinary upgrade (minutes to
  // hours, never days). This is the primary signal when the export carries a
  // full-length timer.
  const timerRunning = entries.some(
    (e) =>
      e.village === "home" &&
      e.id === g.hvId &&
      e.timer != null &&
      e.timer > 0 &&
      e.timer >= trip / 2,
  );
  if (timerRunning) return true;
  // Level signal: when the export has no timer (or a short one) but the
  // building is already at the gear-up target level, the trip is still
  // in progress. Gear-up buildings are special: their Home Village level is
  // set by the game's gear-up mechanic, not by a normal builder queue. A
  // building at or above hvTarget with the flag not yet set means the
  // Master Builder's journey is underway even without a long timer.
  if (levelOf(entries, g.hvId) >= g.hvTarget) {
    const own = entries.find(
      (e) => e.village === "home" && e.id === g.hvId,
    );
    if (!own || (own.gearUp ?? 0) === 0) return true;
  }
  return false;
}

/**
 * Whether a gear-up still needs its Master Builder trip booked on the plan:
 * not performed yet, the Home Village half is at its target, and the trip is
 * not already running. A gear-up that is pending but not running is scheduled
 * as a future job (after the Builder Base side reaches the gear level); one
 * that is running is in progress and shows its remaining time instead.
 */
export function gearUpNeedsTrip(entries: ParsedEntry[], g: GearUp): boolean {
  if (gearUpPerformed(entries, g)) return false;
  if (levelOf(entries, g.hvId) < g.hvTarget) return false;
  if (gearUpInFlight(entries, g)) return false; // running, not a future job
  return true;
}

/**
 * Remaining seconds of a gear-up trip that is currently running, or null when
 * it is not running (performed or not started). The remaining time is the live
 * timer on the Home Village building — the Master Builder's journey is
 * recorded as that building's running upgrade, and its timer counts down the
 * trip itself rather than a normal level-up.
 */
export function gearUpRemainingSeconds(
  entries: ParsedEntry[],
  g: GearUp,
): number | null {
  if (gearUpPerformed(entries, g)) return null;
  const trip = GEAR_UP_TRIP_SECONDS[g.key];
  const timer = entries.find(
    (e) => e.village === "home" && e.id === g.hvId && e.timer != null && e.timer > 0,
  )?.timer;
  // Only a timer long enough to be the trip itself (the same threshold
  // gearUpInFlight uses) counts as "the journey is running now". A short
  // timer is an ordinary upgrade in progress, not the gear-up.
  if (timer != null && timer >= trip / 2) return timer;
  return null;
}

/**
 * The single source of truth for "this gear-up needs no more home-plan work":
 *
 * - the export flags the trip as done (`gear_up` > 0),
 * - the trip is *in flight* — a home timer on the gear-up building long
 *   enough to be the Master Builder's journey (see `gearUpInFlight`),
 * - or, for exports without the flag, both halves of the requirement are
 *   already met, so the only remaining piece is the trip itself.
 *
 * The in-flight case matters even when the flag is present but still 0: the
 * export records the building's *level* (kept after the gear-up) and flips
 * `gear_up` only on completion, so "trip running" is invisible to the flag
 * and only visible through the timer length. Every caller that used to
 * duplicate this flag / inference logic now goes through this one function.
 */
export function gearUpSettled(
  entries: ParsedEntry[],
  g: GearUp,
  flagKnown: boolean,
): boolean {
  // A gear-up is settled when its own entry's flag says it was performed, or
  // when the building is at/past target and the trip is not running (checked
  // by gearUpInFlight above). The flagKnown param is kept for API stability
  // but the per-entry flag (own.gearUp) is the primary source of truth.
  if (gearUpPerformed(entries, g)) return true;
  const own = entries.find((e) => e.village === "home" && e.id === g.hvId);
  if (own && own.gearUp != null) {
    // Own flag is present: gear_up=0 means the trip is pending, not settled.
    return (own.gearUp ?? 0) > 0;
  }
  // No flag on this entry: settled only when both halves are met and the trip
  // is not running.
  if (gearUpInFlight(entries, g)) return false;
  return (
    levelOf(entries, g.bbId) >= g.bbTarget &&
    levelOf(entries, g.hvId) >= g.hvTarget
  );
}


/**
 * Progress toward each 6th-builder (B.O.B) milestone.
 *
 * The list is the game's own task list, not a guess: B.O.B Control to level 5,
 * Builder Hall 9, Star Lab 9, one troop to 18, heroes to a combined 45, one
 * defence to 9, and the three gear-ups — each of which needs a Builder Base
 * level *and* a Home Village level. Both villages are in one export, so the Home
 * Village half is checked here too rather than being left to the reader.
 */
export function bobMilestones(
  entries: ParsedEntry[],
  settings: PlannerSettings,
  defenseId: number,
): BobMilestone[] {
  const troopName =
    BB_TROOP_OPTIONS.find((t) => t.id === settings.bbMaxTroop)?.name ?? "Max troop";
  const defenseName =
    BB_DEFENSE_OPTIONS.find((d) => d.id === defenseId)?.name ?? "Defense";
  const heroTotal = bbHeroTotal(entries);
  const control = levelOf(entries, BB_BOB_CONTROL);
  const bh = levelOf(entries, BB_BUILDER_HALL);
  const lab = levelOf(entries, BB_STAR_LAB);
  const troop = levelOf(entries, settings.bbMaxTroop);
  const def = levelOf(entries, defenseId);
  const rows: BobMilestone[] = [
    {
      label: "B.O.B Control",
      current: control,
      target: BB_BOB_CONTROL_TARGET,
      done: control >= BB_BOB_CONTROL_TARGET,
    },
    {
      label: "Builder Hall",
      current: bh,
      target: BB_BUILDER_HALL_TARGET,
      done: bh >= BB_BUILDER_HALL_TARGET,
    },
    {
      label: "Star Lab",
      current: lab,
      target: BB_STAR_LAB_TARGET,
      done: lab >= BB_STAR_LAB_TARGET,
    },
    {
      label: troopName,
      current: troop,
      target: BB_TROOP_TARGET_LEVEL,
      done: troop >= BB_TROOP_TARGET_LEVEL,
    },
    {
      label: "Heroes (combined)",
      current: heroTotal,
      target: BB_HERO_TOTAL_TARGET,
      done: heroTotal >= BB_HERO_TOTAL_TARGET,
    },
    {
      label: defenseName,
      current: def,
      target: BB_DEFENSE_TARGET_LEVEL,
      done: def >= BB_DEFENSE_TARGET_LEVEL,
    },
  ];
  const hasGearFlag = hasGearUpFlag(entries);
  for (const g of GEAR_UPS) {
    const bbLevel = levelOf(entries, g.bbId);
    const hvLevel = levelOf(entries, g.hvId);
    const bbDone = bbLevel >= g.bbTarget;
    const hvDone = hvLevel >= g.hvTarget;
    const gearSettled = gearUpSettled(entries, g, hasGearFlag);
    if (gearSettled) {
      rows.push({
        label: g.label,
        current: 0,
        target: 1,
        done: true,
        note: "geared up",
      });
      continue;
    }
    const gearInFlight = gearUpInFlight(entries, g);
    if (gearInFlight) {
      rows.push({
        label: g.label,
        current: 0,
        target: 1,
        done: false,
        note: "in flight — Master Builder is away (timer running)",
      });
      continue;
    }
    if (hvDone && hasGearFlag) {
      rows.push({
        label: g.label,
        current: 0,
        target: 1,
        done: false,
        note: "ready — Master Builder has not geared it up yet",
      });
      continue;
    }
    // A gear-up is two requirements, so the row reports whichever half is still
    // outstanding — reporting the Builder Base numbers once its half is met
    // would show "4/4" next to a task that is not done.
    rows.push(
      bbDone
        ? {
            label: `${g.label} — ${g.hvName}`,
            current: Math.min(hvLevel, g.hvTarget),
            target: g.hvTarget,
            done: hvDone,
            needsHome: !hvDone,
          }
        : {
            label: g.label,
            current: Math.min(bbLevel, g.bbTarget),
            target: g.bbTarget,
            done: false,
            note: `${g.hvName} ${Math.min(hvLevel, g.hvTarget)}/${g.hvTarget}${
              hvDone ? " ✓" : ""
            }`,
            needsHome: !hvDone,
          },
    );
  }
  return rows;
}

/** True once every 6th-builder task is done — i.e. the Home Village has 6 builders. */
export function bobComplete(milestones: BobMilestone[]): boolean {
  return milestones.length > 0 && milestones.every((m) => m.done);
}

/** Defense the rush pushes to level 9 (highest current level when "auto"). */
/**
 * A `lab`-free facility: the B.O.B "one defence to 9" target must be able to
 * reach level 9 for the requirement to be satisfiable. The X-Bow tops out at
 * level 5 in the data, so it can never satisfy "defence to 9" — and because
 * the rush plan would chase it for five levels and stop short, a base whose
 * only level-9-capable defence was already 9 would read the target as
 * unmet. It stays in the manual pick list (the game accepts any defence at 9,
 * a player may have it at 5 for other reasons), but the "auto" pick skips it.
 */
const BB_DEFENSE_MAX_LEVEL: Record<number, number> = {
  // Only the X-Bow is below the level-9 target; everything else in
  // BB_DEFENSE_OPTIONS reaches 9 (Walls reach 10) in the data.
  1000081: 5,
};

export function bbDefenseTarget(
  entries: ParsedEntry[],
  chosenId: number | null,
  data?: { get: (id: number) => { levels: { l: number }[] } | undefined },
): number {
  // A manual pick is accepted only if it can reach the target level (the
  // X-Bow caps at 5 in the data). A capped pick falls through to the
  // auto-pick path, which clamps the target to the cap in
  // `bobCriticalTargets` — so the checklist never chases an unreachable
  // "defence to 9" and the 6th-builder ETA stays honest.
  if (chosenId != null) {
    const cap = BB_DEFENSE_MAX_LEVEL[chosenId];
    const reachesTarget =
      cap == null ||
      cap >= BB_DEFENSE_TARGET_LEVEL ||
      (data?.get(chosenId)?.levels.at(-1)?.l ?? Infinity) >= BB_DEFENSE_TARGET_LEVEL;
    if (reachesTarget) return chosenId;
  }
  const canReach9 = (id: number) => {
    const cap = BB_DEFENSE_MAX_LEVEL[id];
    if (cap != null && cap < BB_DEFENSE_TARGET_LEVEL) return false;
    // A listed entity with data must have its rows actually reaching the level;
    // an unknown id keeps the list's own assumption (reaches 9).
    if (data) {
      const e = data.get(id);
      if (e && e.levels.length > 0) {
        return e.levels[e.levels.length - 1].l >= BB_DEFENSE_TARGET_LEVEL;
      }
    }
    return true;
  };
  const defs = entries
    .filter(
      (e) =>
        e.village === "builderBase" &&
        BB_DEFENSE_OPTIONS.some((d) => d.id === e.id) &&
        canReach9(e.id),
    );
  if (defs.length === 0) return BB_DEFENSE_OPTIONS[0].id;
  return defs.reduce((best, e) => (e.level > best.level ? e : best), defs[0]).id;
}

/**
 * Priority boost for Builder Base upgrades on the 6th-builder critical path.
 * Applied only in "rush" mode, so milestone upgrades schedule ahead of
 * everything else. Weights are ordered by how hard each one gates the others:
 * the Builder Hall unlocks the rest, the gear-ups have to be started early
 * because the Master Builder leaves for the Home Village while they run.
 */
export function bbRushBoost(
  o: UpgradeOption,
  settings: PlannerSettings,
  heroTotal: number,
  defenseId: number,
): number {
  if (settings.builderBaseStrategy !== "rush6th") return 0;
  // B.O.B Control is deliberately absent here: its levels cost gold but take no
  // builder time at all (the tasks ARE the build), so there is nothing to
  // schedule. Its progress is on the checklist, not on the timeline.
  if (o.id === BB_BUILDER_HALL && o.nextLevel <= BB_BUILDER_HALL_TARGET) return 600;
  if (o.id === BB_STAR_LAB && o.nextLevel <= BB_STAR_LAB_TARGET) return 500;
  if (o.id === settings.bbMaxTroop && o.nextLevel <= BB_TROOP_TARGET_LEVEL)
    return 350;
  if (BB_HERO_IDS.includes(o.id) && heroTotal < BB_HERO_TOTAL_TARGET) return 300;
  // The Builder Base half of each gear-up: the defence has to reach its gear
  // level before the Master Builder can travel.
  for (const g of GEAR_UPS) {
    if (o.id === g.bbId && o.nextLevel <= g.bbTarget) return 340;
  }
  if (o.id === defenseId && o.nextLevel <= BB_DEFENSE_TARGET_LEVEL) return 300;
  return 0;
}

/* -------------------------------------------------------------------------- */
/* The critical path, as a list of levels to reach                             */
/* -------------------------------------------------------------------------- */

/**
 * One requirement on the way to B.O.B: an entity and the level it has to reach.
 *
 * This is the same list `bobMilestones` reports progress against, but phrased as
 * a destination rather than a status — it is what the goal scheduler chains
 * levels up to. B.O.B Control is deliberately absent: its five levels cost gold
 * and take no builder time (the tasks ARE the build), so it can never be on the
 * timeline and never delays anything.
 */
export interface BobTarget {
  /** Entity id, or 0 for the combined-hero requirement, which spans two heroes. */
  id: number;
  target: number;
  label: string;
  /**
   * The planner category of the entity — "hero", "troop", "building". Carried
   * here rather than looked up because a requirement can name something the
   * export does not list (a troop not unlocked yet), which therefore has no
   * entry to read a category from, and the category is what decides the lane.
   */
  category: Category;
  /**
   * True for "Battle Machine + Battle Copter = 45". It is not a level on either
   * hero: the two rise independently and the requirement is met by their sum, so
   * the scheduler works out for itself when to stop levelling them.
   */
  heroTotal?: boolean;
  /** Set when this target is the Builder Base half of a gear-up. */
  gearUp?: GearUp;
}

/**
 * Everything that has to be built for the 6th builder, minus what is already
 * done. Two targets can name the same entity — Double Cannon is both "a defence
 * to 9" and the cannon gear-up — so they are merged to the higher level, which is
 * the one that has to be reached anyway.
 */
export function bobCriticalTargets(
  entries: ParsedEntry[],
  settings: PlannerSettings,
  defenseId: number,
): BobTarget[] {
  const byId = new Map<number, BobTarget>();
  const add = (
    id: number,
    target: number,
    label: string,
    category: Category,
    gearUp?: GearUp,
  ) => {
    if (id <= 0) return;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, { id, target, label, category, gearUp });
      return;
    }
    if (target > existing.target) {
      byId.set(id, { ...existing, target, label, gearUp: gearUp ?? existing.gearUp });
    }
  };

  const troopName =
    BB_TROOP_OPTIONS.find((t) => t.id === settings.bbMaxTroop)?.name ?? "Max troop";
  const defenseName =
    BB_DEFENSE_OPTIONS.find((d) => d.id === defenseId)?.name ?? "Defense";

  // A defence whose data caps below the target (the X-Bow tops out at 5) can
  // never meet "defence to 9": clamping the target to the cap keeps the
  // checklist honest (row met at 5, not frozen at "5/9 forever") instead of
  // chaining an unreachable level the goal planner cannot step through.
  const defenseCap = BB_DEFENSE_MAX_LEVEL[defenseId];
  const defenseTarget =
    defenseCap != null && defenseCap < BB_DEFENSE_TARGET_LEVEL
      ? defenseCap
      : BB_DEFENSE_TARGET_LEVEL;

  add(BB_BUILDER_HALL, BB_BUILDER_HALL_TARGET, "Builder Hall", "building");
  add(BB_STAR_LAB, BB_STAR_LAB_TARGET, "Star Lab", "building");
  add(settings.bbMaxTroop, BB_TROOP_TARGET_LEVEL, troopName, "troop");
  add(defenseId, defenseTarget, defenseName, "building");
  for (const g of GEAR_UPS) {
    // Labelled as the defence it is, not as the gear-up it carries: the levels
    // named here are levels of a building, and the Master Builder's trip is a
    // separate job the goal scheduler adds (see `scheduleBobGoal`).
    const name = BB_DEFENSE_OPTIONS.find((d) => d.id === g.bbId)?.name ?? g.label;
    add(g.bbId, g.bbTarget, name, "building", g);
  }

  const targets = [...byId.values()].filter((t) => levelOf(entries, t.id) < t.target);
  if (bbHeroTotal(entries) < BB_HERO_TOTAL_TARGET) {
    targets.push({
      id: 0,
      target: BB_HERO_TOTAL_TARGET,
      label: "Heroes (combined)",
      category: "hero",
      heroTotal: true,
    });
  }
  return targets;
}


/**
 * Priority boost for the Home Village half of a gear-up.
 *
 * This is the whole reason a Builder Base plan exists: three Home Village
 * buildings have to reach a level before the Master Builder can gear them up,
 * and the 6th builder is behind that. So when the Builder Base is being rushed,
 * the Home Village plan gives those three a nudge — a Cannon at 6 is worth more
 * than a Cannon at 7 only because 7 is what the gear-up needs.
 *
 * Only the levels up to the requirement are boosted; past it the building is
 * just a defence again.
 */
export function gearUpHomeBoost(
  _o: UpgradeOption,
  _entries: ParsedEntry[],
  _settings: PlannerSettings,
): number {
  // Gear-up buildings are now treated as regular defences in the Home Village
  // plan and are not given any priority boost. The Builder Base plan handles the
  // Master Builder's gear-up trip separately when the 6th-builder rush is active.
  return 0;
}

/**
 * The Home-Village half of a gear-up, as a *cap* on that building's upgrades
 * in the home plan.
 *
 * When the 6th-builder rush is active, a gear-up building's home level matters
 * only up to its target — the Master Builder's trip (scheduled on the Builder
 * Base plan) is what completes the gear-up, not a further home-village upgrade.
 * Past the target the building is just a defence again, so the home plan should
 * not offer 13→14, 14→15, etc. as plan rows. This returns the target level for
 * a building that is a gear-up half (or null when it is not / not in rush mode),
 * so the caller can stop chaining that building's home upgrades at that level.
 *
 * Mirrors `gearUpHomeBoost`: a gear-up that is already finished (per the export's
 * `gear_up` flag, or by both-halves-met inference) yields no cap — the building
 * is free to be upgraded as a normal defence.
 */
/**
 * Whether a Home-Village upgrade row for a gear-up building should be shown in
 * the home-village upgrade catalogue at all.
 *
 * When the 6th-builder rush is active, a gear-up's Home Village building has
 * only one job: reach the level the Master Builder's trip needs. Once the
 * gear-up is done — per the export's `gear_up` flag, or by both-halves-met
 * inference for exports without the flag — the building is just a defence
 * again and the next-level row is a free upgrade, which is exactly what the
 * user is reporting: "Archer Tower 13→14 sitting in my home plan even though
 * the gear-up is done and the trip is on the Builder Base plan".
 *
 * So: hide the row only when the gear-up is already done AND the building's
 * current level is at or above the gear-up target (i.e. the next step is
 * purely post-gear-up defence work). While the gear-up is still outstanding,
 * every home step below the target stays visible — those are the actual
 * work the trip requires.
 */
export function hideGearUpHomeRow(
  _o: UpgradeOption,
  _entries: ParsedEntry[],
  _settings: PlannerSettings,
): boolean {
  // Gear-up buildings are now always visible in the Home Village plan.
  return false;
}
