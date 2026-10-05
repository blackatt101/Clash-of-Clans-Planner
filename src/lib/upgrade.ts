import { BB_BOB_CONTROL, BB_HERO_IDS, SIEGE_MACHINE_IDS } from "./bbRush";
import type { GameData } from "./staticData";
import { townHallIdFor, type ParsedEntry, type ParsedVillage } from "./parse";
import type { Cost, Village, Category } from "./types";
import { computeMissingBuildings } from "./gameLogic";


/** A requirement standing between an entry and a start, and what owns it. */
export interface LevelGate {
  label: string;
  level: number;
  reason?: string;
}

export interface UpgradeOption {
  uid: number;
  id: number;
  name: string;
  category: Category;
  village: Village;
  resource: string;
  currentLevel: number;
  nextLevel: number;
  cost: Cost | null;
  time: number | null;
  /** The unmet requirement, when there is one. `available` is `gate == null`. */
  gate?: LevelGate;
  available: boolean;
  count: number;
  /**
   * Seconds left on the upgrade already running for this entry, if any. The
   * export reports `lvl` as the level the entry is CURRENTLY at, so an entry
   * with a timer is mid-way through `lvl -> lvl+1`; `currentLevel`/`nextLevel`
   * here describe the FOLLOW-UP step (`lvl+1 -> lvl+2`), which is the one a
   * planner can actually schedule.
   */
  inFlightSeconds?: number;
  /**
   * The follow-up steps this item still has at the current TH/BH level, in
   * order — present only when more than one level is left. `upgrade.ts` fills
   * it for owned entries so the list can show a `13 → 15` climb and the
   * scheduler can run one copy's steps back-to-back on a single builder. The
   * first step (this row) is `currentLevel → nextLevel` and is NOT repeated
   * here; these are the steps *after* it.
   */
  chain?: Array<{ level: number; cost: Cost | null; time: number | null }>;
}

export function villageLevel(
  pv: ParsedVillage,
  village: Village,
): number | null {
  return village === "home" ? pv.townHallLevel : pv.builderHallLevel;
}

/**
 * The buildings a level can be gated on besides the Town Hall / Builder Hall,
 * and the level-row field that names each requirement.
 *
 * A troop level needs a Laboratory level, a pet level a Pet House, an equipment
 * level a Blacksmith — the static data carries that on every row (`lab`, `ph`,
 * `bs`) and only `th` used to be read, so a rushed account with the Laboratory
 * several levels behind its Town Hall was offered research the Lab cannot
 * start. That is the exact account this planner is for. The Builder Base
 * researches in the Star Laboratory, hence the second id.
 */
const FACILITY_GATES: {
  field: "lab" | "bs" | "ph";
  home: { id: number; label: string };
  builderBase?: { id: number; label: string };
}[] = [
  {
    field: "lab",
    home: { id: 1000007, label: "Lab" },
    builderBase: { id: 1000046, label: "Star Lab" },
  },
  { field: "bs", home: { id: 1000070, label: "Blacksmith" } },
  { field: "ph", home: { id: 1000068, label: "Pet House" } },
];

/** The level of each gating building the village actually owns. */
function facilityLevels(pv: ParsedVillage, village: Village): Map<number, number> {
  const m = new Map<number, number>();
  for (const g of FACILITY_GATES) {
    const spec = village === "builderBase" ? g.builderBase : g.home;
    if (!spec) continue;
    const e = pv.entries.find((x) => x.village === village && x.id === spec.id);
    if (e) m.set(spec.id, e.level);
  }
  return m;
}

/**
 * Why a level cannot be started yet, or undefined when it can.
 *
 * The village level is reported first because it is the gate that opens the
 * others: a level the Town Hall does not allow is not unlocked by any
 * Laboratory, so naming the Lab there would send the reader to the wrong
 * building.
 */
function levelGate(
  pv: ParsedVillage,
  village: Village,
  next: { th?: number; lab?: number; bs?: number; ph?: number },
  facilities: Map<number, number>,
): LevelGate | undefined {
  const vl = villageLevel(pv, village);
  const required = next.th ?? 0;

  // Check if the required village level is met
  if (vl == null || vl < required) {
    return {
      label: village === "home" ? "TH" : "BH",
      level: required,
      reason: `Requires ${village === "home" ? "Town Hall" : "Builder Hall"} level ${required}`
    };
  }

  // Check other facility requirements
  for (const g of FACILITY_GATES) {
    const spec = village === "builderBase" ? g.builderBase : g.home;
    if (!spec) continue;
    const need = next[g.field];
    if (typeof need !== "number") continue;
    const have = facilities.get(spec.id);
    // A facility the export lists gates only when it is below the level the
    // step asks for. A facility the export does NOT list is a different case:
    // for work that belongs to that facility at all (a Lab / Star Lab
    // requirement on a troop or spell, a Pet House requirement on a pet, a
    // Blacksmith requirement on equipment) the requirement is real and simply
    // cannot be met by any lane in this plan — the research cannot run without
    // its building. That is the `missingFacility` gate, and only for
    // research: a plain building whose level row mentions a building the
    // export never listed stays ungated, because for a building the row
    // existing at all is the evidence it was unlocked, and a trimmed export
    // must not lock the whole list behind one building it happens to omit.
    if (have != null && have < need) return {
      label: spec.label,
      level: need,
      reason: `Requires ${spec.label} level ${need}`,
    };
  }
  return undefined;
}

/**
 * A requirement named by a row's facility gate that the village's export does
 * not list — so the facility the gate names is not on the base at all.
 *
 * Applied to BOTH halves of the rule, and only to them:
 *
 * - an entry the export lists: its row asks for, say, a Star Lab level, and
 *   the export has no Star Lab — the research cannot run, so the row is gated
 *   behind the facility and named "Star Lab N required, not on this base".
 * - an unlock row for something not yet built: same requirement, same gate.
 *
 * A row whose facility gate is satisfied by the village level alone (no
 * facility column, or the facility is listed) is never touched here — that is
 * `levelGate`'s business.
 */
/**
 * A `lab` / `ph` / `bs` gate the village cannot satisfy because the facility
 * the gate names is not in the export at all.
 *
 * One test, applied to two kinds of row:
 *  - a listed entry's next level (`computeUpgrades`): the work is real and the
 *    facility is the thing standing in the way, so the row is gated and named.
 *  - an unlock row for an entity not yet built (`unlockOptions`): the same
 *    requirement, same answer.
 *
 * A building the export DOES list is never gated this way: its row's
 * existence is the evidence the game unlocked it, and a trimmed export must
 * not lock the list behind one building it happens to omit. That distinction
 * is between a facility gate (research) and a village gate (TH / Builder Hall),
 * not between listed and unlisted rows — both row kinds gate on a missing
 * facility alike.
 */
function missingFacilityGate(
  lv: { lab?: number | null; bs?: number | null; ph?: number | null },
  facilities: Map<number, number>,
  village: Village,
): LevelGate | undefined {
  for (const g of FACILITY_GATES) {
    const spec = village === "builderBase" ? g.builderBase : g.home;
    if (!spec) continue;
    if (facilities.has(spec.id)) continue; // facility present: levelGate covers it
    const need = lv[g.field];
    if (typeof need === "number" && need > 0)
      return {
        label: spec.label,
        level: need,
        reason: `Requires ${spec.label} level ${need}, which is not in this base yet`,
      };
  }
  return undefined;
}

/**
 * The upgrade already running for an entry, as a display-only row. `timer` is
 * the remaining seconds; `lvl` is the level the entry is currently at, so the
 * running step is `lvl -> lvl+1`.
 */
export function inFlightOption(
  e: ParsedEntry,
  data: GameData,
): UpgradeOption | null {
  if (!e.entity || !e.timer || e.timer <= 0) return null;
  // An entry already at its absolute max cannot be mid-upgrade, so a timer on
  // it is stale (a hand-edited or cached export) and gets no row: a step above
  // the max does not exist, and claiming one would let a consumer schedule it.
  if (e.level > 0 && e.level >= data.maxLevel(e.entity)) return null;
  const step = data.level(e.entity, e.level + 1);
  return {
    uid: e.uid,
    id: e.id,
    name: e.name,
    category: e.category,
    village: e.village,
    resource: e.entity.resource ?? "Resource",
    currentLevel: e.level,
    nextLevel: e.level + 1,
    cost: step?.cost ?? null,
    time: e.timer, // remaining, not the full step
    available: false,
    count: e.count,
  };
}

/**
 * UID space for rows that have no export entry behind them, so they cannot
 * borrow one. Keyed by the entity id, which makes the uid stable: a tick on
 * "Giant Cannon" survives re-pasting the export, and the share link stays valid.
 */
export const UNLOCK_UID_BASE = 3_000_000;

/**
 * The rest of the Builder Base rulebook is handed out rather than bought: the
 * Builder Hall and O.T.T.O's Outpost arrive with the game's own milestones, a
 * Wall is never absent (walls are bought in batches and the export counts them),
 * and B.O.B Control is the goal itself — a checklist task paid in gold with no
 * build time at all.
 *
 * (The former `BUILDABLE_TYPES` set lived here to model "what can be built";
 * it was exported but never consulted — the rulebook above is the source of
 * truth, so the dead code went with its stale claim.)
 */

/**
 * Which file an entity came from, stamped in at load time (see
 * `GameData.load`). The source data itself is ambiguous for 196 of the 272
 * entities: no troops, no heroes, no spells, no pets, no equipment and no
 * traps carry a `type` field, so "which category is this?" could not be
 * answered from the entity at all. The file it came from is the only source of
 * truth: the home Laboratory researches troops, the Star Lab researches the
 * Builder Base's, and only the Spell Factory file lists spells.
 */
export function entityCategory(
  entity: { _id: number; type?: string; fromFile?: string },
  village: Village,
): Category {
  // Builder Base heroes are heroes in their own file, but their ALTARS are
  // army buildings of the same name — the village disambiguates.
  if (village === "builderBase" && BB_HERO_IDS.includes(entity._id)) return "hero";
  // Siege machines live in troops.json (fromFile="troops") but queue in the
  // Siege Workshop, so they must be classified as "siege" before the generic
  // fromFile fallback lumps them in with lab troops.
  if (village === "home" && SIEGE_MACHINE_IDS.includes(entity._id)) return "siege";
  if (entity.fromFile) {
    switch (entity.fromFile) {
      case "troops":
        return "troop";
      case "heroes":
        return "hero";
      case "spells":
        return "spell";
      case "pets":
        return "pet";
      case "equipment":
        return "equipment";
      case "traps":
        return "trap";
      case "helpers":
        return "helper";
      case "guardians":
        return "guardian";
      case "crafted-defenses":
        return "building";
    }
  }
  // Buildings (and anything whose file is unknown): fall back to the type
  // column, which is only ever populated on buildings.
  if (entity.type) {
    switch (entity.type) {
      case "Trap":
        return "trap";
      case "Hero":
        return "hero";
      case "Pet":
        return "pet";
      case "Spell":
        return "spell";
      case "Siege":
        return "siege";
      case "Equipment":
        return "equipment";
    }
  }
  return "building";
}

/**
 * Rows for the buildings and troops that have been unlocked by Town Hall/Builder Hall
 * but the player has not placed/built yet.
 *
 * Both Home Village and Builder Base have entities that unlock at specific levels:
 * - Home Village: Buildings like Eagle Artillery unlock at specific Town Hall levels
 * - Builder Base: Buildings unlock at specific Builder Hall levels
 *
 * The export only lists what STANDS on the base, so unlocked but unbuilt entities
 * are absent from it. This function shows those as potential upgrades with appropriate gates.
 *
 * So each such entity gets one row: its first level, at that level's own price
 * and build time, gated by whatever the rulebook says unlocks it (`th` for the
 * Town Hall/Builder Hall, `lab` for the Star Lab, etc.). `available` is then true exactly when
 * the base can place it today, and false with the requirement named when it is
 * still behind a Town Hall/Builder Hall level.
 */
function unlockOptions(pv: ParsedVillage, data: GameData): UpgradeOption[] {
  const opts: UpgradeOption[] = [];

  // Process both villages
  for (const village of ["home", "builderBase"] as const) {
    // Skip Builder Base if not present in export
    if (village === "builderBase" && !pv.entries.some((e) => e.village === "builderBase")) continue;

    const owned = new Set(pv.entries.filter(e => e.village === village).map((e) => e.id));

    // PERFORMANCE FIX: Use pre-built byVillage index instead of full scan of byId.
    // Previously this looped through ALL 274 entities and filtered by village field,
    // which was O(all_entities) per village. Now we only iterate that village's entities.
    // This also includes spells, pets, equipment, helpers via the index built at load time.
    const entitiesForVillage = data.byVillage[village];
    // Hoisted above the entity loop: one facility scan per village, not one per
    // entity (the comment at the old call site claimed this already — it did not).
    const facilitiesForVillage = facilityLevels(pv, village);

    for (const entity of entitiesForVillage) {
      if (owned.has(entity._id)) continue;

      // Skip special Builder Base control entity
      if (village === "builderBase" && entity._id === BB_BOB_CONTROL) continue;
      // Milestone-granted buildings: the game hands out O.T.T.O's Outpost with
      // Builder Hall 6 and the Gem Mine with its milestone — neither L1 row is
      // a purchase (both cost 0, time 0 in the data). Offer only their L2+
      // follow-ups; the L0→L1 row would book a free "job" into the plan.
      let rows = entity.levels;
      if (village === "builderBase" && (entity._id === 1000078 || entity._id === 1000058)) {
        const followups = entity.levels.filter((r) => r.l > 1);
        if (followups.length === 0) continue;
        rows = followups;
      }

      const first = rows[0];
      if (!first) continue;

      // Determine category for this entity. The gate columns (lab / ph / bs /
      // hero id) and the source file stamp it, one way or the other — see
      // entityCategory. The old heuristic read "no lab gate" as "not a troop",
      // which swallowed event-only troops (Ice Wizard, Battle Ram, …) and the
      // whole "no gate" reading backfired on a trimmed export.
      const category = entityCategory(entity, village);

      // Only buildings can be "placed" — a 0 → 1 row is a build job.
      //
      // - The four gating facilities really do go 0→1: that is how the Lab,
      //   Star Lab, Blacksmith and Pet House get put down before any research
      //   (or troop) that depends on them. They are the exception, so they
      //   are listed explicitly by id.
      // - Equipment, traps, siege machines, pets, heroes and spells never
      //   start at level 0: their level-1 row is a craft/forge/research step,
      //   not a placement.
      // - Troops do not start at level 0 either — their level-1 row is a
      //   research step, and event / cosmetic research starts even higher
      //   (Super Barbarian L5, Meteor Golem at its event cap, the Totem
      //   Spell). Offering a 0 → N row for those is a build job the game will
      //   never schedule, so they stay out of the plan; a later level of an
      //   entity that is not in the export yet is just the next research step,
      //   which a base without that unit cannot act on.
      if (
        category !== "building" &&
        category !== "guardian" &&
        !FACILITY_GATES.some(
          (g) =>
            (village === "home" ? g.home?.id : g.builderBase?.id) ===
            entity._id,
        )
      ) continue;

      const gate = levelGate(pv, village, first, facilitiesForVillage) ?? missingFacilityGate(first, facilitiesForVillage, village);

      // The four gating facilities gate their OWN placement on the village
      // level, not on themselves: `levelGate` above applies `first.th` to the
      // facility's own row exactly like any other row (it is the first clause
      // of levelGate and the facility's row carries no facility column of its
      // own, so `missingFacilityGate` never fires here). Two rows in the same
      // village therefore agree on the same fact: a Lab row gated on "TH 18"
      // and a troop row gated on "Lab 1, not in this base yet" are no longer
      // contradictory — the Lab really is not placeable until the TH allows it.

      // Heroes carry no separate "max at this TH" table the game recognises —
      // the `th` column of the first level row is the whole gate, and it is the
      // `levelGate` check above. (The removed hero-cap gate here is the same
      // mistake as the one in `computeUpgrades`: it would have hidden a hero
      // that the rulebook says is placeable.)

      opts.push({
        uid: UNLOCK_UID_BASE + entity._id,
        id: entity._id,
        name: entity.name,
        category,
        village,
        resource: entity.resource ?? "Resource",
        // Nothing of it stands yet, so the step on offer is the one that puts it
        // there — its own first level, which for troops or heroes may not be level 1.
        currentLevel: 0,
        nextLevel: first.l,
        cost: first.cost,
        time: first.time,
        gate,
        available: gate == null,
        count: 1,
      });
    }
  }

  return opts;
}

/**
 * One row per entry's next schedulable upgrade. Entries at their absolute max
 * are omitted. `available` is true when every requirement is already met — the
 * upgrade can be started now rather than gated behind a higher Town Hall,
 * Builder Hall, Laboratory, Pet House or Blacksmith.
 *
 * An entry with a live `timer` is already upgrading (`lvl -> lvl+1`), so this
 * yields the step AFTER it (`lvl+1 -> lvl+2`) and records the remaining time in
 * `inFlightSeconds` — otherwise the in-flight upgrade would show up as both
 * "currently upgrading" and a fresh plannable job, double-booking a builder.
 *
 * In the Builder Base it also carries the rows for what the base has unlocked
 * but not built (see `unlockOptions`) — those are the levels the export cannot
 * offer, because the export is a list of what already stands.
 */
export function computeUpgrades(
  pv: ParsedVillage,
  data: GameData,
): UpgradeOption[] {
  const opts: UpgradeOption[] = [];
  const facilities: Record<Village, Map<number, number>> = {
    home: facilityLevels(pv, "home"),
    builderBase: facilityLevels(pv, "builderBase"),
  };

  // PERFORMANCE FIX: Compute missing buildings ONCE instead of potentially calling
  // areAllAvailableBuildingsBuilt + getMissingBuildings separately (two full scans).
  // The previous code called these for every Builder Hall entry — but there's only
  // one BH entry, so compute it lazily before the loop and cache the result.
  let bbMissingBuildings: ReturnType<typeof computeMissingBuildings> | null = null;
  const getBbMissing = () => {
    if (!bbMissingBuildings) {
      bbMissingBuildings = computeMissingBuildings(pv, data, "builderBase");
    }
    return bbMissingBuildings;
  };

  for (const e of pv.entries) {
    if (!e.entity) continue;
    const inFlight = e.timer != null && e.timer > 0;
    const from = inFlight ? e.level + 1 : e.level;
    const next = data.level(e.entity, from + 1);

    // FIX max-level detection: previously `if (!next) continue;` silently dropped
    // items at their TH-gated ceiling. Now we check maxLevelAt and include the item
    // with a gate explaining it's maxed at the current TH/BH level. This lets the
    // UI show "Level 15 (max at TH12)" instead of hiding the item entirely.
    if (!next) {
      const currentVillageLevel = villageLevel(pv, e.village);
      // A live timer on the topmost row (in-flight N → absolute max) still
      // shows the running step: a terminal placeholder row, not a row claiming
      // an upgrade past the max — the old `continue` silently dropped the
      // running final step and left consumers keying on the uid with nothing.
      // For an in-flight entry the step in flight is `e.level → e.level + 1`,
      // so the ceiling test must look at the target level, not the current one.
      const targetLevel = inFlight ? e.level + 1 : e.level;
      const terminalInFlight = inFlight && targetLevel >= data.maxLevel(e.entity);
      const atAbsoluteMax = targetLevel >= data.maxLevel(e.entity) && targetLevel > 0;
      if (
        (currentVillageLevel !== null && targetLevel >= data.maxLevelAt(e.entity, currentVillageLevel)) ||
        atAbsoluteMax ||
        terminalInFlight
      ) {
        opts.push({
          uid: e.uid,
          id: e.id,
          name: e.name,
          category: e.category,
          village: e.village,
          resource: e.entity.resource ?? "Resource",
          // Show the running step for the in-flight case: `N → N+1 (max)`, not
          // "at the ceiling" — the entry is not there yet, it is on the way.
          currentLevel: e.level,
          nextLevel: terminalInFlight ? e.level + 1 : e.level,
          cost: null,
          time: null,
          gate: {
            label: e.village === "home" ? "TH" : "BH",
            level: currentVillageLevel ?? e.level,
            reason: terminalInFlight
              ? `In flight to max level ${e.level + 1} for ${e.village === "home" ? "TH" : "BH"} ${currentVillageLevel ?? "?"}`
              : `Max level ${e.level} reached for ${e.village === "home" ? "TH" : "BH"} ${currentVillageLevel ?? "?"}`,
          },
          available: false, // Gated — can't upgrade further at this TH/BH
          count: e.count,
          // A running final step (in-flight to the absolute max) keeps its uid
          // for the consumers that key on it, and carries the remaining timer
          // for the in-flight display; the same row without a timer says the
          // entry is at its ceiling.
          inFlightSeconds: terminalInFlight ? e.timer : undefined,
        });
      }
      continue;
    }

    // Check basic gate requirements (TH, lab, etc.)
    let gate =
      levelGate(pv, e.village, next, facilities[e.village]) ??
      missingFacilityGate(next, facilities[e.village], e.village);

    // If basic gates pass, check additional game constraints
    if (!gate) {
      // Heroes: the `th` column of each level row IS the unlock gate, and it is
      // what `levelGate` already applied above. There is no separate "hero max
      // at this TH" table the game has — so this hero chain climbing past the
      // level the TH cap would call "the max" is correct, not a violation.
      // (The old `getMaxHeroLevel` gate kept a TH11 Barbarian King at level 50
      // forever, even though level 51's own row only asks for TH12.)

      // For Builder Hall upgrades, check if all available buildings are built
      if (e.village === "builderBase" && e.id === 1000034) { // Builder Hall ID
        const missing = getBbMissing();
        if (!missing.allBuilt) {
          gate = {
            label: "Buildings",
            level: 1,
            reason: `Must build available buildings first: ${missing.missingNames.slice(0, 3).join(", ")}`
          };
        }
      }
    }

    // The first row is the item's next step; `chain` carries every step still
    // reachable at this TH/BH so the list can show the climb (13 → 15) and the
    // scheduler can run one copy's steps back-to-back on a single builder.
    // The village halls are the exception: a TH/BH upgrade is a milestone,
    // gated on everything else at the current level being maxed, and the
    // levels it unlocks only become reachable after the upgrade lands — so
    // the hall plans one step at a time, never a climb to the max.
    const isVillageHall = e.id === townHallIdFor(e.village);
    const ceiling =
      villageLevel(pv, e.village) == null
        ? data.maxLevel(e.entity)
        : data.maxLevelAt(e.entity, villageLevel(pv, e.village)!);
    const chain: UpgradeOption["chain"] = [];
    if (!isVillageHall) {
      for (const row of e.entity.levels) {
        if (row.l > next.l && row.l <= ceiling)
          chain.push({ level: row.l, cost: row.cost, time: row.time });
      }
    }
    opts.push({
      uid: e.uid,
      id: e.id,
      name: e.name,
      category: e.category,
      village: e.village,
      resource: e.entity.resource ?? "Resource",
      currentLevel: from,
      nextLevel: next.l,
      cost: next.cost,
      time: next.time,
      gate,
      available: gate == null,
      count: e.count,
      inFlightSeconds: inFlight ? e.timer : undefined,
      ...(chain.length ? { chain } : {}),
    });
  }
  return [...opts, ...unlockOptions(pv, data)];
}

export function countMaxed(
  entries: ParsedEntry[],
  data: GameData,
  village: Village,
  villageLevel: number,
): { maxed: number; total: number } {
  let maxed = 0;
  let total = 0;
  for (const e of entries) {
    if (e.village !== village || !e.entity) continue;
    total += e.count;
    if (e.level >= data.maxLevelAt(e.entity, villageLevel)) maxed += e.count;
  }
  return { maxed, total };
}
