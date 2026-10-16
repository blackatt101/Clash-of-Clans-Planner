import type { BlockSpec } from "./sleep";
import type { Strategy } from "./strategy";

export type HeroSchedule = "all" | "keep1" | "keep2" | "keep3" | "keep4" | "none";
/** How far a dedicated hero lane runs — see `heroChain` on the settings. */
export type HeroChain = "plan" | "max";
export const HERO_CHAIN_OPTIONS: { value: HeroChain; label: string }[] = [
  { value: "plan", label: "For as long as the plan runs" },
  { value: "max", label: "Until the focused heroes are maxed" },
];
export const MAX_HERO_LANES = 5;
export type LabPriority = "general" | "air" | "ground" | "farming";
export type BuilderBaseStrategy = "general" | "rush6th";

/**
 * How many builders the Builder Base has. "auto" reads it off the export (see
 * `detectBbBuilders`), which is the only thing that knows: the second builder is
 * O.T.T.O, who comes with Builder Hall 6, and the third is B.O.T.O, bought with
 * gems — neither is a number the game reports, but both are buildings the export
 * lists. An explicit value overrides the reading, for anyone whose export is
 * missing the entry.
 */
export type BbBuilders = "auto" | 1 | 2 | 3;

/**
 * Builder Base presets. "Rush 6th Builder" is the one that matches why people
 * play the Builder Base at all, so it is the default and it is the one that
 * reaches back into the Home Village plan (see `hideGearUpHomeRow`: while a
 * gear-up is outstanding, its Home Village building is planned here instead).
 */
export const BB_STRATEGIES: {
  value: BuilderBaseStrategy;
  label: string;
  hint: string;
}[] = [
  {
    value: "rush6th",
    label: "Rush 6th Builder (B.O.B)",
    hint: "Push the B.O.B milestones first — gear-ups, Builder Hall 9, Star Lab 9 — to unlock the 6th builder in your Home Village.",
  },
  {
    value: "general",
    label: "Upgrade This Builder Hall Evenly",
    hint: "No milestone chasing: every Builder Base upgrade is ranked by the priority order instead.",
  },
];

/** Per-group weights from the Offense Percentages modal, 0–100. */
export type OffenseWeights = Record<string, number>;

export interface PlannerSettings {
  builders: number;
  /** Builder Base builders: "auto" detects them, 1–3 overrides. */
  bbBuilders: BbBuilders;
  /** Recurring windows when nothing is upgraded (sleep, work, school). */
  blocks: BlockSpec[];
  horizon: number; // seconds; 0 = unlimited
  /**
   * How many builders are dedicated to hero upgrades (0 = none, up to 5).
   *
   * A count rather than a switch because the question a player actually asks is
   * "how many heroes can run at once", and one lane was never the useful maximum:
   * with four heroes and one lane three of them sit still. The lanes run the
   * heroes in `heroOrder`, one hero per lane, so "which heroes to focus" is that
   * order and "how many at once" is this number.
   */
  heroLanes: number;
  /**
   * How far the hero lanes run. "plan" keeps a lane busy for exactly as long as
   * the rest of the plan lasts — the hero lane is never the empty row on the
   * chart — and "max" runs it until every focused hero is at its last level,
   * which answers "when are my heroes done" at the cost of a plan far longer
   * than the work that was ticked.
   */
  heroChain: HeroChain;
  /** Strategy preset for the Home Village. */
  strategy: Strategy;
  offenseBeforeTh: number; // 0 = TH first, 100 = offense first
  offenseWeights: OffenseWeights; // per-group weighting from Offense Percentages
  upgradeOrder: string[]; // group keys, highest priority first
  heroOrder: number[]; // hero entity ids, highest priority first ([] = built-in)
  petOrder: number[]; // pet entity ids, highest priority first ([] = built-in)
  labOrder: number[]; // troop/spell/siege ids, highest priority first ([] = off)
  goldPass: number; // Gold Pass discount % applied to cost + time
  builderBoost: number; // extra time discount %, builder lane
  researchBoost: number; // extra time discount %, lab lane
  wiggleRoom: number; // minutes buffer between upgrades (login lag)
  heroSchedule: HeroSchedule; // how many heroes to keep available
  cwlBlock: boolean; // defer hero upgrades during CWL (1st–10th)
  labPriority: LabPriority;
  includeTh: boolean; // include the Town Hall upgrade in the plan
  /**
   * The Builder Base strategy — its own preset set, not the Home Village's.
   * The two villages are not the same game: the Builder Base is two builders,
   * Star Lab research instead of a Laboratory, and one goal that the Home
   * Village does not have at all, which is to unlock the 6th builder at home.
   * That is why this is a different enum rather than a different value of
   * `strategy`: "Fastest Max TH" has no meaning here, and "Rush 6th Builder"
   * has none there.
   */
  builderBaseStrategy: BuilderBaseStrategy;
  bbMaxTroop: number; // troop id to push to level 18 for B.O.B
  bbDefense: number | null; // defense id to push to level 9 (null = auto)
}

/** Default weights: everything even, so the strategy presets decide the order. */
export const DEFAULT_WEIGHTS: OffenseWeights = {
  hero: 50,
  lab: 50,
  pet: 50,
  defense: 50,
  army: 50,
  resource: 50,
  trap: 50,
  wall: 50,
  townhall: 50,
  other: 50,
};

/** Group keys that appear in the Offense Percentages modal, in display order. */
export const OFFENSE_GROUPS: { key: string; label: string; hint: string }[] = [
  { key: "hero", label: "Heroes", hint: "Barbarian King, Archer Queen, …" },
  { key: "lab", label: "Laboratory", hint: "Troops, spells and siege machines" },
  { key: "pet", label: "Pets", hint: "Pet House research" },
  { key: "defense", label: "Defenses", hint: "Cannons, Inferno Towers, …" },
  { key: "army", label: "Army buildings", hint: "Camps, barracks, factories" },
  { key: "resource", label: "Resource buildings", hint: "Collectors and storages" },
  { key: "trap", label: "Traps", hint: "Bombs, spring traps, …" },
  { key: "wall", label: "Walls", hint: "Wall segments — a per-piece upgrade" },
  { key: "townhall", label: "Town Hall", hint: "The Town Hall upgrade itself" },
];

/** Default group order — what a maxing player upgrades first. */
export const DEFAULT_UPGRADE_ORDER = [
  "hero",
  "lab",
  "pet",
  "army",
  "defense",
  "trap",
  "wall",
  "resource",
  "townhall",
];

export const DEFAULT_SETTINGS: PlannerSettings = {
  builders: 5,
  bbBuilders: "auto",
  blocks: [],
  horizon: 0,
  heroLanes: 0,
  heroChain: "plan",
  strategy: "offenseFirst",
  offenseBeforeTh: 50,
  offenseWeights: { ...DEFAULT_WEIGHTS },
  upgradeOrder: [...DEFAULT_UPGRADE_ORDER],
  heroOrder: [],
  petOrder: [],
  labOrder: [],
  goldPass: 0,
  builderBoost: 0,
  researchBoost: 0,
  wiggleRoom: 0,
  heroSchedule: "all",
  cwlBlock: false,
  labPriority: "general",
  includeTh: true,
  builderBaseStrategy: "rush6th",
  bbMaxTroop: 4000041, // Baby Dragon
  bbDefense: null,
};

export const HORIZON_PRESETS: { label: string; seconds: number }[] = [
  { label: "1 week", seconds: 7 * 86400 },
  { label: "1 month", seconds: 30 * 86400 },
  { label: "3 months", seconds: 90 * 86400 },
  { label: "6 months", seconds: 182 * 86400 },
  { label: "1 year", seconds: 365 * 86400 },
  { label: "No limit", seconds: 0 },
];

export const GOLD_PASS_PRESETS = [0, 10, 15, 20];

/**
 * Merge a decoded/imported settings object over the defaults. Arrays and nested
 * objects are checked by type so a hand-edited or stale JSON file can't crash the
 * planner (a bad `blocks` entry, an order list that isn't numbers, …).
 */
export function normaliseSettings(raw: unknown): PlannerSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  const o = raw as Record<string, unknown>;
  const s: PlannerSettings = { ...DEFAULT_SETTINGS };

  // Every numeric field is clamped to the range its own control in the Settings
  // dialog offers, and to a real number: a hand-edited file, a stale share link
  // or a NaN that survived JSON is not allowed to make a nonsense plan. This
  // matters because these values are multipliers — `goldPass: -100` is a 2×
  // *penalty* on every upgrade (discounts.ts computes `1 - pct/100`, and only
  // the top of that range was ever bounded), and a huge `wiggleRoom` walks every
  // job in a lane arbitrarily far right.
  const num = (v: unknown, lo: number, hi: number, dflt: number): number =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;

  if (typeof o.builders === "number") s.builders = num(o.builders, 1, 6, s.builders);
  // A number is only a builder count when it is one: `"4"` (a string) or `7`
  // falls back to "auto" rather than to a village that cannot exist.
  if (o.bbBuilders === "auto") s.bbBuilders = "auto";
  else if (typeof o.bbBuilders === "number" && Number.isFinite(o.bbBuilders)) {
    const n = Math.round(o.bbBuilders);
    if (n >= 1 && n <= 3) s.bbBuilders = n as BbBuilders;
  }
  if (typeof o.horizon === "number") s.horizon = num(o.horizon, 0, Infinity, s.horizon);
  if (typeof o.heroLanes === "number") {
    s.heroLanes = Math.round(num(o.heroLanes, 0, MAX_HERO_LANES, s.heroLanes));
  }
  // Share links and saved settings from before the count existed carry the
  // on/off form. "On" was one lane, by definition.
  if (typeof o.heroLane === "boolean") s.heroLanes = o.heroLane ? 1 : 0;
  if (o.heroChain === "plan" || o.heroChain === "max") s.heroChain = o.heroChain;
  if (typeof o.strategy === "string") s.strategy = o.strategy as Strategy;
  if (typeof o.offenseBeforeTh === "number")
    s.offenseBeforeTh = num(o.offenseBeforeTh, 0, 100, s.offenseBeforeTh);
  if (typeof o.goldPass === "number") s.goldPass = num(o.goldPass, 0, 100, s.goldPass);
  if (typeof o.builderBoost === "number")
    s.builderBoost = num(o.builderBoost, 0, 100, s.builderBoost);
  if (typeof o.researchBoost === "number")
    s.researchBoost = num(o.researchBoost, 0, 100, s.researchBoost);
  if (typeof o.wiggleRoom === "number") s.wiggleRoom = num(o.wiggleRoom, 0, 120, s.wiggleRoom);
  if (typeof o.heroSchedule === "string") s.heroSchedule = o.heroSchedule as HeroSchedule;
  if (typeof o.cwlBlock === "boolean") s.cwlBlock = o.cwlBlock;
  if (typeof o.labPriority === "string") s.labPriority = o.labPriority as LabPriority;
  if (typeof o.includeTh === "boolean") s.includeTh = o.includeTh;
  if (typeof o.builderBaseStrategy === "string")
    s.builderBaseStrategy = o.builderBaseStrategy as BuilderBaseStrategy;
  if (typeof o.bbMaxTroop === "number") s.bbMaxTroop = o.bbMaxTroop;
  if (typeof o.bbDefense === "number" || o.bbDefense === null) s.bbDefense = o.bbDefense;

  if (Array.isArray(o.blocks)) {
    s.blocks = o.blocks
      .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
      .map((b, i) => ({
        id: typeof b.id === "string" ? b.id : `block-${i}`,
        label: typeof b.label === "string" ? b.label : "Unavailable",
        // Minutes-of-day, so anything outside one day is not a time at all.
        start: num(b.start, 0, 1439, 0),
        end: num(b.end, 0, 1439, 0),
        days: Array.isArray(b.days)
          ? b.days.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6)
          : [],
      }));
  }

  if (o.offenseWeights && typeof o.offenseWeights === "object") {
    s.offenseWeights = { ...DEFAULT_WEIGHTS };
    for (const [k, v] of Object.entries(o.offenseWeights as Record<string, unknown>)) {
      if (typeof v === "number") s.offenseWeights[k] = Math.min(100, Math.max(0, v));
    }
  }

  const idList = (v: unknown): number[] | null =>
    Array.isArray(v) && v.every((n) => typeof n === "number") ? (v as number[]) : null;

  const heroOrder = idList(o.heroOrder);
  if (heroOrder) s.heroOrder = heroOrder;
  const petOrder = idList(o.petOrder);
  if (petOrder) s.petOrder = petOrder;
  const labOrder = idList(o.labOrder);
  if (labOrder) s.labOrder = labOrder;

  if (Array.isArray(o.upgradeOrder) && o.upgradeOrder.every((k) => typeof k === "string")) {
    s.upgradeOrder = o.upgradeOrder as string[];
  }

  return s;
}
