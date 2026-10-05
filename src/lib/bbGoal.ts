import {
  BB_BUILDER_HALL,
  BB_ELIXIR,
  BB_GOLD,
  BB_HERO_IDS,
  BB_MAX_BUILDERS,
  BB_OUTPOST_BUILDER_HALL,
  BB_STAR_LAB,
  GEAR_UPS,
  GEAR_UP_SECONDS,
  bbCostValue,
  bbHallCapacity,
  bbStorageCapacity,
  bbStoragePool,
  bobCriticalTargets,
  detectBbBuilders,
  gearUpInFlight,
  gearUpNeedsTrip,
  gearUpRemainingSeconds,
  gearUpSettled,
  hasGearUpFlag,
  levelOf,
  type BobTarget,
  type GearUp,
} from "./bbRush";
import { discountCost, discountTime } from "./discounts";
import { formatNumber } from "./format";
import type { ParsedEntry } from "./parse";
import { familyOf } from "./priorityOrder";
import { blockWindow, nextUnblocked, type UnavailableWindow } from "./sleep";
import type { GameData } from "./staticData";
import type { AssignedJob, JobKind, Lane, ScheduleJob, ScheduleResult } from "./schedule";
import type { PlannerSettings } from "./settings";
import { jobKind } from "./strategy";
import type { UpgradeOption } from "./upgrade";
import type { Cost, SlimEntity, SlimLevel, Category } from "./types";

/**
 * The plan that actually earns the 6th builder.
 *
 * The ordinary planner schedules one level per building — the next one the
 * upgrade list can offer — so a Builder Base "rush" plan is a week long and ends
 * nowhere near B.O.B, whose path is Builder Hall 9, Star Lab 9, a troop at 18,
 * heroes at a combined 45, a defence at 9 and three gear-ups. Those are levels
 * the list cannot show, because the level after the next one depends on the one
 * that has not been built yet.
 *
 * So this is a small event simulation instead: it chains a level at a time,
 * gating each on the Builder Hall and Star Lab levels the plan itself will have
 * reached, and stops the moment every requirement is met. That stopping point is
 * the 6th-builder ETA the Builder Base view reports.
 */

/**
 * Jobs this module makes get their own uid space. Every chained level needs its
 * own identity — the same entity is scheduled several times, and the views look
 * a job up in one shared map by uid, so sharing the entry's uid would give four
 * Builder Hall bars one level label between them.
 */
export const BOB_UID_BASE = 2_000_000;

export interface BobGoalResult extends ScheduleResult {
  /**
   * Requirements this plan cannot finish by itself — a gear-up whose Home
   * Village half is still short. The Builder Base view can plan the Builder Base
   * half and no more, so the ETA is a floor, not a date, while this is non-empty.
   */
  blockers: string[];
  /** One row per chained level, so tooltips and lane lists can name them. */
  options: UpgradeOption[];
  /** The ceilings the plan worked within, and any storage work it had to add. */
  resources: BobResourceLine[];
}

/**
 * One resource's story in a plan: what the base can hold now, what it will hold
 * once the storage work is done, and the requirement that forced that work.
 */
export interface BobResourceLine {
  resource: string;
  /** Total capacity now — the storages the export lists, plus the Builder Hall. */
  cap: number;
  /** Total capacity once the plan's own storage upgrades have landed. */
  capAtEnd: number;
  /** The storage levels the plan adds, e.g. "Gold Storage 1→6". */
  added: string[];
  /** The upgrade that did not fit, and what it costs. */
  forLabel?: string;
  forCost?: number;
}

/** One storage standing on the base. Copies are tracked apart: a player can
 *  perfectly well own one level-5 Gold Storage and one level-1. */
interface StorageCopy {
  /** Level now. */
  from: number;
  /** Level the plan has it at; rises as the plan upgrades this copy. */
  level: number;
  /** When this copy's own last upgrade finishes. */
  readyAt: number;
}

/** All the copies of one storage building, and the currency they hold. */
interface StoragePool {
  id: number;
  label: string;
  resource: string;
  copies: StorageCopy[];
}

export interface BobGoalOptions {
  data: GameData;
  entries: ParsedEntry[];
  settings: PlannerSettings;
  /** Live Builder Base upgrades, from the export's timers. */
  inProgress: ScheduleJob[];
  /** How many builders the Builder Base has (see `detectBbBuilders`). */
  builders: number;
  defenseId: number;
  nowEpochMs: number;
  wiggleRoom: number;
}

/** A level the goal needs, with everything the scheduler needs to place it. */
interface Candidate {
  id: number;
  level: number;
  label: string;
  category: Category;
  kind: JobKind;
  duration: number;
  cost: Cost | null;
  priority: number;
  /** Earliest moment the previous level and the entity's gates allow a start. */
  enablesAt: number;
  /** Lane to pin to — the Master Builder's for a gear-up — or null for any. */
  pinnedLane: number | null;
  /** Set on the gear-up job, whose BB half is a defence already at its level. */
  gearUp?: GearUp;
  /** Set on a storage upgrade: the copy it raises. */
  storage?: { pool: StoragePool; copy: StorageCopy };
}

interface Placement {
  lane: number; // -1 = the Star Lab lane
  start: number;
  end: number;
}

export function scheduleBobGoal(o: BobGoalOptions): BobGoalResult {
  const { data, entries, settings } = o;
  const windows: UnavailableWindow[] = settings.blocks.map(blockWindow);
  const laneCount = Math.max(1, Math.min(BB_MAX_BUILDERS, o.builders));

  /* ---- the base as the plan will leave it ------------------------------- */

  const simLevel = new Map<number, number>();
  /** When the last level placed for an entity finishes. */
  const readyAt = new Map<number, number>();
  /** entity -> level -> when the plan reaches it. */
  const reachedAt = new Map<number, Map<number, number>>();

  const record = (id: number, level: number, at: number) => {
    let m = reachedAt.get(id);
    if (!m) {
      m = new Map();
      reachedAt.set(id, m);
    }
    if (!m.has(level)) m.set(level, at);
  };
  const advance = (id: number, level: number, at: number) => {
    simLevel.set(id, Math.max(simLevel.get(id) ?? 0, level));
    readyAt.set(id, Math.max(readyAt.get(id) ?? 0, at));
    record(id, level, at);
  };

  for (const e of entries) {
    if (e.village !== "builderBase") continue;
    const live = e.timer != null && e.timer > 0;
    // `lvl` is the level the entry is at NOW, so a live timer is finishing
    // `lvl -> lvl+1`: when it elapses the base is one level higher than the
    // export says, which is exactly what the chain after it has to build on.
    advance(e.id, live ? e.level + 1 : e.level, live ? (e.timer as number) : 0);
  }
  const levelNow = (id: number) => simLevel.get(id) ?? 0;
  const readyOf = (id: number) => readyAt.get(id) ?? 0;

  /* ---- gear-up classification (needed early for pre-placement) ---------- */

  /** Gear-ups whose trip is still running in the base — in progress at t=0. */
  const inFlightKeys = new Set<string>();
  /** Gear-ups the plan needs no further work for (flag says done). */
  const gearUpDone = new Set<string>();
  for (const g of GEAR_UPS) {
    if (gearUpInFlight(entries, g)) {
      inFlightKeys.add(g.key);
    } else if (gearUpSettled(entries, g, hasGearUpFlag(entries))) {
      gearUpDone.add(g.key);
    }
  }

  /* ---- what the base can hold ------------------------------------------- */

  /**
   * The storages, copy by copy, because their levels differ and only the SUM of
   * them plus the Builder Hall is the ceiling the game actually enforces. A plan
   * that ignored this told players to upgrade Builder Hall 7 → 8 → 9 back to
   * back while their storages could not hold even the first of those prices.
   */
  const pools: StoragePool[] = [];
  for (const e of entries) {
    if (e.village !== "builderBase") continue;
    const resource = bbStoragePool(e.id);
    if (!resource) continue;
    let pool = pools.find((p) => p.id === e.id);
    if (!pool) {
      pool = { id: e.id, label: data.get(e.id)?.name ?? "Storage", resource, copies: [] };
      pools.push(pool);
    }
    const live = e.timer != null && e.timer > 0;
    for (let i = 0; i < Math.max(1, e.count); i++) {
      pool.copies.push({
        from: e.level,
        level: live ? e.level + 1 : e.level,
        readyAt: live ? (e.timer as number) : 0,
      });
    }
  }
  const poolFor = (resource: string): StoragePool | null =>
    pools.find((p) => p.resource === resource && p.copies.length > 0) ?? null;
  /** The currency an entity's own upgrades are paid in. */
  const entityResource = (id: number): string => data.get(id)?.resource ?? BB_GOLD;

  /**
   * Capacity is a function of TIME, not just of what the plan has decided.
   *
   * A ceiling rises when a storage or Builder Hall upgrade FINISHES, so the plan
   * must ask "could the base hold this at the moment this job would start" — and
   * a storage upgrade still running holds nothing yet. Crediting the room the
   * moment the plan made up its mind let a 1.2M Archer Tower start alongside the
   * storage upgrade that was supposed to pay for it.
   */
  const baseCap: Record<string, number> = {};
  const capEvents: { at: number; resource: string; delta: number }[] = [];
  const capAt = (resource: string, t: number): number => {
    let cap = baseCap[resource] ?? 0;
    for (const ev of capEvents) if (ev.resource === resource && ev.at <= t) cap += ev.delta;
    return cap;
  };

  const hallLevelNow = entries.find((e) => e.village === "builderBase" && e.id === BB_BUILDER_HALL)?.level ?? 0;
  const hallLive = (() => {
    const e = entries.find((x) => x.village === "builderBase" && x.id === BB_BUILDER_HALL);
    return e?.timer != null && e.timer > 0 ? (e.timer as number) : null;
  })();
  for (const r of [BB_GOLD, BB_ELIXIR]) baseCap[r] = bbHallCapacity(hallLevelNow);
  if (hallLive != null) {
    const delta = bbHallCapacity(hallLevelNow + 1) - bbHallCapacity(hallLevelNow);
    for (const r of [BB_GOLD, BB_ELIXIR]) capEvents.push({ at: hallLive, resource: r, delta });
  }
  for (const pool of pools) {
    for (const copy of pool.copies) {
      baseCap[pool.resource] = (baseCap[pool.resource] ?? 0) + bbStorageCapacity(copy.from);
      const gain = bbStorageCapacity(copy.level) - bbStorageCapacity(copy.from);
      // A copy with a live timer is already being raised: its room arrives.
      if (gain > 0) capEvents.push({ at: copy.readyAt, resource: pool.resource, delta: gain });
    }
  }

  /**
   * Whether the base can hold this price at `at`. No storage in the export means
   * no ceiling to check against — a trimmed export must not be read as a base
   * with nowhere to put anything.
   */
  const canHold = (cost: Cost | null, resource: string, at: number): boolean => {
    const need = bbCostValue(cost);
    if (need == null || need <= 0) return true;
    if (!poolFor(resource)) return true;
    return need <= capAt(resource, at);
  };

  /**
   * When the base could hold `need` of `resource`, counting only the ceiling
   * work the plan has already agreed to. A level too dear for the base today is
   * not refused, it is scheduled for the day the room lands — otherwise a price
   * the plan is actively raising the ceiling for would be rejected forever.
   *
   * Null means no room is coming: the storage pass is then what has to change,
   * and whichever requirement is asking becomes a blocker if it never fits.
   */
  const capReadyAt = (resource: string, need: number | null, from: number): number | null => {
    if (need == null || need <= 0) return from;
    if (!poolFor(resource)) return from; // no ceiling modelled in this export
    if (capAt(resource, from) >= need) return from;
    for (const ev of [...capEvents].sort((a, b) => a.at - b.at)) {
      if (ev.resource !== resource || ev.at <= from) continue;
      if (capAt(resource, ev.at) >= need) return ev.at;
    }
    return null;
  };
  /**
   * When an entity is at `need` — undefined while the plan has not got it there
   * yet, which is what keeps a level from being scheduled before its gate opens.
   * A gate of 0 (no requirement) resolves to "now".
   */
  const atLevel = (id: number, need: number): number | undefined =>
    need <= 0 ? 0 : reachedAt.get(id)?.get(need) ?? (levelNow(id) >= need ? 0 : undefined);

  /* ---- lanes ------------------------------------------------------------ */

  /**
   * A lane is a *timeline*, not one free-at counter. Keeping the booked spans
   * lets a job that may not start yet — held back by the Builder Hall gate, by
   * the storage room its price needs, or by the Master Builder being away on a
   * gear-up — take its slot without reserving the lane until then. Whatever
   * else is ready fills the hole in the meantime instead of idling.
   */
  type Span = { start: number; end: number };
  const builderLanes: AssignedJob[][] = Array.from({ length: laneCount }, () => []);
  const laneSpans: Span[][] = Array.from({ length: laneCount }, () => []);
  const labLane: AssignedJob[] = [];
  const labSpans: Span[] = [];
  const lastEnd = (spans: Span[]) => spans.reduce((m, s) => Math.max(m, s.end), 0);
  const book = (spans: Span[], start: number, end: number) => {
    spans.push({ start, end });
    spans.sort((a, b) => a.start - b.start || a.end - b.end);
  };

  // Which lanes exist, and from when. The Master Builder is always there and
  // B.O.T.O's Shack is bought with gems, so both are lanes from now; the only
  // builder whose arrival depends on a level is O.T.T.O, who comes with Builder
  // Hall 6 (O.T.T.O's Outpost). On a younger base a lane beyond the huts the
  // player owns is therefore not late, it is absent — and planning it from t=0
  // promises throughput they do not have.
  const owned = detectBbBuilders(entries);
  const ownedLanes = 1 + (owned.botoOwned ? 1 : 0);
  /** When O.T.T.O's lane opens, or null while the Builder Hall is short of 6. */
  let outpostLaneAt: number | null = owned.outpostOwned ? 0 : null;
  const laneUnlock = new Array<number>(laneCount).fill(Infinity);
  const openLanes = () => {
    if (outpostLaneAt == null) {
      const at = atLevel(BB_BUILDER_HALL, BB_OUTPOST_BUILDER_HALL);
      if (at != null) outpostLaneAt = at;
    }
    for (let i = 0; i < laneCount; i++) {
      laneUnlock[i] = i < ownedLanes ? 0 : outpostLaneAt ?? Infinity;
    }
  };
  openLanes();

  // The same login-lag buffer the ordinary scheduler keeps between two upgrades
  // in one lane. Applied when a lane is set free rather than when a job is
  // placed, so a lane's very first job still starts at t=0.
  const wig = Math.max(0, o.wiggleRoom);

  // In-progress work holds its lane from t=0 — blocks are not applied to it,
  // because it was started before the plan and its remaining timer just elapses.
  //
  // A lane that does not exist yet (locked behind O.T.T.O's Outpost) must not
  // receive in-progress work: the builder is not there. An upgrade that is
  // genuinely running while its gate is still locked queues on an owned lane
  // instead (the overflow path, which the regular scheduler also uses when the
  // export lists more live upgrades than lanes).
  const place = (job: ScheduleJob, lane: number) => {
    const spans = lane < 0 ? labSpans : laneSpans[lane];
    const start = lastEnd(spans);
    const assigned: AssignedJob = {
      ...job,
      count: 1,
      start,
      end: start + job.duration,
      inProgress: true,
      key: `${job.uid}#0`,
      instance: 1,
      instances: 1,
    };
    (lane < 0 ? labLane : builderLanes[lane]).push(assigned);
    book(spans, assigned.start, assigned.end);
  };
  for (const ip of o.inProgress) {
    // A running RESEARCH belongs on the lab lane: it is the facility's own work,
    // and that lane is where the next research queues behind it. A running
    // Star LAB UPGRADE does not — the game keeps the facility researching
    // while the building is constructed, so the Star Lab bar is an ordinary
    // builder job and the lane stays free for research that is ready now.
    // (The troop levels that need the Star Lab's NEXT level are held by the
    // simulation's own gate times, `atLevel`/`readyOf` — those do not move
    // with this bar; parking it here only delayed research the facility
    // already unlocked.)
    if (ip.kind === "lab") {
      place(ip, -1);
      continue;
    }
    // least-loaded lane among the lanes that exist right now — a lane past
    // the outpost unlock does not exist yet, so it cannot hold running work.
    let bi = -1;
    for (let i = 0; i < laneCount; i++) {
      if (!Number.isFinite(laneUnlock[i])) continue;
      if (bi < 0 || lastEnd(laneSpans[i]) < lastEnd(laneSpans[bi])) bi = i;
    }
    if (bi < 0) bi = 0; // lane 0 is always open from t=0
    place(ip, bi);
  }

  // In-progress gear-up trips: the Home Village building carries a live timer
  // (the Master Builder's journey running as that building's upgrade). It is
  // in progress at t=0, and its remaining duration is the timer itself — not
  // the full trip length. Pre-placed on the least-loaded lane, inProgress.
  let gearUpUid = 0;
  {
    let placed = 0;
    for (const g of GEAR_UPS) {
      if (gearUpDone.has(g.key) || !inFlightKeys.has(g.key)) continue;
      const remaining = gearUpRemainingSeconds(entries, g);
      if (remaining == null) continue; // not running — scheduled by the main loop
      if (placed >= laneCount) break;
      let bi = -1;
      for (let i = 0; i < laneCount; i++) {
        if (!Number.isFinite(laneUnlock[i])) continue;
        if (bi < 0 || lastEnd(laneSpans[i]) < lastEnd(laneSpans[bi])) bi = i;
      }
      if (bi < 0) bi = 0;
      const uid = BOB_UID_BASE + 900 + gearUpUid++;
      place(
        {
          uid,
          name: g.label,
          duration: remaining,
          category: "building",
          kind: "builder",
          family: "buildings",
          entityId: g.bbId,
        },
        bi,
      );
      placed++;
    }
  }

  for (const ip of o.inProgress) {
    if (ip.entityId == null) continue;
    // An in-flight upgrade has been running since before the export, so it
    // already finished what it committed to when it started; it cannot have
    // started on a lane that only opens later, so it is the only thing the
    // lane timeline has to make room for:
    const id = ip.entityId;
    const lvl = ip.levelTo ?? 0;
    simLevel.set(id, Math.max(simLevel.get(id) ?? 0, lvl));
    if (lvl > 0) record(id, lvl, 0);
  }

  /* ---- timing ----------------------------------------------------------- */

  /**
   * A duration with the same discounts the rest of the planner applies, so a
   * Gold Pass or a builder boost shortens this plan exactly as it shortens the
   * one on the timeline.
   */
  const boosted = (category: string, raw: number | null | undefined): number => {
    const kind = jobKind(category);
    const extra =
      kind === "lab" ? settings.researchBoost : kind === "builder" ? settings.builderBoost : 0;
    return discountTime(raw ?? 0, Math.min(100, settings.goldPass + extra)) ?? 0;
  };

  /**
   * The price as the player pays it, Gold Pass included — the same number the
   * cost summary adds up. The ceilings have to be compared against what is
   * actually spent, or a discounted upgrade would be held back for room it no
   * longer needs.
   */
  const payCost = (cost: Cost | null | undefined): Cost | null =>
    discountCost(cost ?? null, settings.goldPass);

  const settle = (from: number) =>
    (nextUnblocked(o.nowEpochMs + from * 1000, windows) - o.nowEpochMs) / 1000;

  /* ---- what the goal needs --------------------------------------------- */

  const targets = bobCriticalTargets(entries, settings, o.defenseId);

  const blockers = new Set<string>();
  /**
   * Star Lab gates that were still closed when their level was reached. The
   * Star Lab itself is a plan target, so each one is only reported at the end,
   * and only if the plan's own Star Lab chain never reaches its level.
   */
  const pendingLabGates = new Set<{ label: string; level: number; labNeed: number }>();
  const options: UpgradeOption[] = [];
  /**
   * The first requirement each resource's ceiling could not pay for, which is
   * the plan's own reason for the storage work it adds. Reported on the card so
   * "Gold Storage 5→6" reads as an answer to "the Builder Hall needs 1.8M".
   */
  const raisedFor = new Map<string, { label: string; cost: number }>();
  /**
   * Requirements the plan could not pay for at the moment it reached them, keyed
   * by entity and level. Most of these resolve themselves a few rounds later —
   * the ceiling work lands and the level becomes affordable — so they are only
   * reported at the end, and only if the level never made it into the plan.
   */
  const unmet = new Map<string, { label: string; resource: string; need: number; why: string | null }>();
  let uidSeq = 0;

  /**
   * Priority, mirroring `bbRushBoost`: the Builder Hall unlocks everything else,
   * the Star Lab unlocks the troop, and the gear-ups have to be started early
   * because the Master Builder is away for days while they run.
   */
  const priorityOf = (id: number, level: number): number => {
    if (id === BB_BUILDER_HALL) return 600;
    if (id === BB_STAR_LAB) return 500;
    if (id === settings.bbMaxTroop) return 350;
    if (BB_HERO_IDS.includes(id)) return 300;
    for (const g of GEAR_UPS) if (id === g.bbId && level <= g.bbTarget) return 340;
    if (id === o.defenseId) return 300;
    return 200;
  };

  /**
   * The data row for one level of one entity. A level with no row is not a level
   * that cannot be built — the generator drops exactly those rows that have
   * neither a cost nor a build time, which is what an unlock step is (a troop's
   * first level arrives with the Star Lab that unlocks it). So it is read as an
   * instant, free step, gated by the nearest level above it: requirements climb
   * with the level, so the next recorded one is never a lower gate than this
   * level's own.
   */
  const stepOf = (id: number, level: number): { entity: SlimEntity; step: SlimLevel } | null => {
    const entity = data.get(id);
    if (!entity) return null;
    const step = data.level(entity, level);
    if (step) return { entity, step };
    const above = entity.levels.find((l) => l.l > level);
    if (!above) return null;
    return { entity, step: { ...above, l: level, cost: null, time: 0 } };
  };

  /**
   * The cheapest next level among a pool's copies.
   *
   * Cheapest, not highest: the point is to raise the total ceiling, and a
   * level-1 storage reaching level 2 buys 80k of room for a fraction of what
   * pushing the level-5 one up costs. Both copies sit in the same sum, so the
   * cheap one is simply better value — which is also how anyone plays it.
   *
   * "gated" is not a dead end — the next level exists, the Builder Hall that
   * unlocks it is simply still on its way, and the Builder Hall itself is on
   * this plan. Only "maxed" means the base has no more room to make.
   */
  type StorageStep =
    | { kind: "step"; copy: StorageCopy; level: number; step: SlimLevel; at: number; cost: number }
    | { kind: "gated"; level: number; needHall: number }
    | { kind: "maxed" };

  const nextStorageStep = (pool: StoragePool): StorageStep => {
    let best: { copy: StorageCopy; level: number; step: SlimLevel; at: number; cost: number } | null = null;
    let gated: { level: number; needHall: number } | null = null;
    for (const copy of pool.copies) {
      const found = stepOf(pool.id, copy.level + 1);
      if (!found) continue; // this copy is at its last level
      const gate = atLevel(BB_BUILDER_HALL, found.step.th ?? 0);
      if (gate == null) {
        const needHall = found.step.th ?? 0;
        if (!gated || needHall < gated.needHall) gated = { level: copy.level + 1, needHall };
        continue;
      }
      const cost = bbCostValue(found.step.cost) ?? 0;
      if (!best || cost < best.cost) {
        best = { copy, level: copy.level + 1, step: found.step, at: Math.max(gate, copy.readyAt), cost };
      }
    }
    if (best) return { kind: "step", ...best };
    if (gated) return { kind: "gated", ...gated };
    return { kind: "maxed" };
  };

  /**
   * The earliest a candidate can begin, from a given point: its own gates (the
   * Builder Hall level, the Star Lab level, the level below it finishing) and
   * the availability windows, in one place. The login buffer sits between two
   * upgrades you have to tap, so it only applies once something precedes it.
   */
  const startAt = (c: Candidate, from: number): number => {
    const floor = Math.max(from, c.enablesAt);
    return settle(floor > 0 ? floor + wig : 0);
  };

  /**
   * The earliest a candidate can start on one lane, walking that lane's holes in
   * order instead of only appending at its end, so a stretch the lane is not
   * using gets used.
   */
  const startIn = (c: Candidate, lane: number): number => {
    if (lane >= 0 && !Number.isFinite(laneUnlock[lane])) return Infinity;
    const spans = lane < 0 ? labSpans : laneSpans[lane];
    let from = lane < 0 ? 0 : laneUnlock[lane];
    for (const s of spans) {
      const cand = startAt(c, from);
      if (cand >= s.end - 1e-9) continue;
      if (cand + c.duration <= s.start + 1e-9) return cand;
      from = Math.max(from, s.end);
    }
    return startAt(c, from);
  };

  /**
   * Where this candidate should go: the lane that gets it started soonest — not
   * the emptiest one. The two differ for any job that may not start yet, and a
   * job dropped on an idle lane books only the slot it needs. On a tie the
   * *busier* lane wins: one that is busy until then has nothing to lose, while
   * the idle one can still take work that is ready now.
   *
   * Gear-up trips are NOT scheduled here: they are in-progress at t=0 and are
   * pre-placed onto distinct lanes before the main loop (see `pendingTrips`
   * below), because a trip is not work a builder queues — it is running now.
   */
  const earliest = (c: Candidate): Placement | null => {
    const laneIdx = c.pinnedLane != null
      ? [c.pinnedLane]
      : c.kind === "lab"
        ? [-1]
        : Array.from({ length: laneCount }, (_, i) => i);
    let best: Placement | null = null;
    let bestBusy = -1;
    for (const li of laneIdx) {
      const start = startIn(c, li);
      if (!Number.isFinite(start)) continue;
      const busy = lastEnd(li < 0 ? labSpans : laneSpans[li]);
      if (!best || start < best.start - 1e-9 || (start < best.start + 1e-9 && busy > bestBusy)) {
        best = { lane: li, start, end: start + c.duration };
        bestBusy = busy;
      }
    }
    return best;
  };

  /** Everything that could be started next, with its earliest possible start. */
  const collect = (): Candidate[] => {
    const out: Candidate[] = [];

    /**
     * Storage work to make `resource` holdable again, offered in place of a
     * requirement the base is too small to pay for.
     *
     * The two storages pay for each other, so raising one ceiling can itself be
     * unaffordable — that is the recursion below, and it is the game's own
     * shape rather than an artefact: more gold room costs elixir, and more
     * elixir room costs gold. Each pass offers the step that is affordable at
     * the moment it would run; the capacity only ever grows, so the sequence
     * converges.
     */
    const storageWork = (resource: string, depth = 0): string | null => {
      const pool = poolFor(resource);
      if (!pool) return `no ${resource} storage is in this export`;
      const next = nextStorageStep(pool);
      if (next.kind === "maxed") return `every ${pool.label} is already at its highest level`;
      if (next.kind === "gated") {
        return `${pool.label} level ${next.level} needs Builder Hall ${next.needHall} first`;
      }
      const cand: Candidate = {
        id: pool.id,
        level: next.level,
        label: pool.label,
        category: "building",
        kind: "builder",
        duration: boosted("building", next.step.time),
        cost: payCost(next.step.cost),
        // Above every requirement: when a tie happens this is the work that
        // unlocks the rest, and it is only ever offered because something else
        // is already stuck behind it.
        priority: 700,
        enablesAt: next.at,
        pinnedLane: null,
        storage: { pool, copy: next.copy },
      };
      const place = earliest(cand);
      if (!place) return `${pool.label} has no free lane to be built on`;
      const pays = entityResource(pool.id);
      if (!canHold(payCost(next.step.cost), pays, place.start)) {
        // The room this step buys has to be paid for with the other storage's
        // room. Returning null means the deeper pass offered a step, so this
        // requirement is waiting rather than impossible.
        if (depth >= 3) return `the ${pool.resource} and ${pays} room are both too small to raise the other`;
        return storageWork(pays, depth + 1);
      }
      out.push(cand);
      return null;
    };

    const push = (id: number, level: number, target: BobTarget, gearUp?: GearUp) => {
      if (!data.get(id)) {
        // Nothing in the rulebook for this requirement — the plan cannot reach
        // it, so the ETA is a floor rather than a date and the card says why.
        blockers.add(`${target.label} — no upgrade data for this entity`);
        return;
      }
      const found = stepOf(id, level);
      if (!found) return;
      const { step } = found;
      const gate = atLevel(BB_BUILDER_HALL, step.th ?? 0);
      if (gate == null) return;
      // A gear-up level in the target loop is not a builder build but the
      // Master Builder's trip. It does NOT gate on the Builder Hall the way an
      // ordinary level does: the trip is not a construction the builders do,
      // and it has no `th` requirement of its own. Gating it on the hall
      // (which is what the code above does for ordinary levels) would hold the
      // trip until the hall finishes — but a trip whose requirements are met
      // starts whenever the Master Builder's lane is free, i.e. t=0 when that
      // lane is empty. The cost is null (the game charges no gold/elixir for
      // a trip) and the duration is the trip's own, not the level's build time.
      if (gearUp) {
        const trip: Candidate = {
          id,
          level,
          label: gearUp.label,
          category: "building",
          kind: "builder",
          duration: GEAR_UP_SECONDS[gearUp.key] ?? 0,
          cost: null,
          priority: 340,
          // No Builder Hall gate, no lab gate: the trip's own requirements
          // (the HV and BB level halves) are already checked by the caller.
          enablesAt: 0,
          pinnedLane: 0,
          gearUp,
        };
        out.push(trip);
        return;
      }
      // A `lab` requirement on this row is a Star Lab level, and the Star Lab
      // lane does not exist before the building stands: an export with no Star
      // Lab lists no 1000046, so `atLevel` can never resolve it, and the row
      // has to say so instead of being scheduled onto a lane the base does
      // not have. The level-18 B.O.B troop is exactly this case on a base
      // whose Star Lab has not been placed yet.
      const labNeed = step.lab ?? 0;
      const labGate = atLevel(BB_STAR_LAB, labNeed);
      // A Star Lab gate that has not opened yet is provisional, not final: the
      // Star Lab itself is one of the plan's own targets, so the moment the
      // plan's upgrade chain reaches that level the gate is open and the "not
      // in this base yet" message is false. Record it here and only turn it
      // into a real blocker at the end, if the plan still cannot open it.
      if (labNeed > 0 && labGate == null) {
        pendingLabGates.add({ label: target.label, level, labNeed });
        return;
      }
      if (labGate == null) return;
      const candidate: Candidate = {
        id,
        level,
        label: target.label,
        category: target.category,
        kind: jobKind(target.category),
        duration: boosted(target.category, step.time),
        cost: payCost(step.cost),
        priority: priorityOf(id, level),
        enablesAt: Math.max(gate, labGate, readyOf(id)),
        pinnedLane: gearUp ? 0 : null,
        gearUp,
      };
      // The base has to be able to HOLD the price, at the moment this level would
      // actually run. A player with two level-5 Gold Storages cannot put 1.8M
      // towards a Builder Hall 7, so the plan raises the ceilings first and
      // schedules this level after them — instead of chaining Builder Hall levels
      // the player can only watch.
      const place = earliest(candidate);
      const resource = entityResource(id);
      const need = bbCostValue(payCost(step.cost));
      // Waiting for room is a start time, not a refusal. The ceiling the plan
      // already agreed to raise only counts once that upgrade is done, so the
      // level is booked for the moment it fits — and the lane stays open for
      // whatever else is ready in the meantime.
      const room = place ? capReadyAt(resource, need, place.start) : null;
      if (place && room == null) {
        if (!raisedFor.has(resource) && need != null) {
          raisedFor.set(resource, { label: target.label, cost: need });
        }
        // Not a failure yet: the ceilings go up first and this level comes back
        // around. It is only a blocker if the plan ends without it, and then the
        // reason says which ceiling ran out (see the tail).
        unmet.set(`${id}:${level}`, { label: target.label, resource, need: need ?? 0, why: storageWork(resource) });
        return;
      }
      if (room != null && room > candidate.enablesAt) candidate.enablesAt = room;
      unmet.delete(`${id}:${level}`);
      out.push(candidate);
    };

    for (const t of targets) {
      if (!t.heroTotal) {
        const level = levelNow(t.id) + 1;
        if (level <= t.target) {
          // Every target's next level-up is ordinary builder work, gear-up
          // targets included: a gear-up building below its target still needs
          // that level built by a normal builder before the Master Builder's
          // trip can run. The trip itself is booked separately below.
          push(t.id, level, t);
        }
        continue;
      }
      // Two heroes, one requirement: either altar raises the sum, and both may
      // be built at once, so both are offered while the pair is short.
      const have = BB_HERO_IDS.reduce((s, id) => s + levelNow(id), 0);
      if (have >= t.target) continue;
      for (const id of BB_HERO_IDS) push(id, levelNow(id) + 1, t);
    }

    // The gear-up trips that are NOT running yet: a trip is pending when the
    // Home Village half is done, the trip has not been performed, and no timer
    // is running (it is not in progress). It starts once the Builder Base side
    // reaches the gear level (enablesAt = bbAt), pinned to the Master Builder's
    // lane (lane 0), for the trip's full duration.
    //
    // NOTE the gate: a trip is scheduled only when it is neither done nor
    // already in flight. The old condition `!inFlightKeys.has(g.key)` is not
    // equivalent — it is also false for a trip that has NOT started at all (no
    // in-flight timer yet), and skipping those left a pending Archer Tower /
    // Cannon / Mortar trip with no duration on the plan, so the Master
    // Builder's lane sat idle and lane 2 picked up nothing.
    for (const g of GEAR_UPS) {
      if (gearUpDone.has(g.key) || gearUpInFlight(entries, g)) continue;
      if (gearUpRemainingSeconds(entries, g) != null) continue; // running, pre-placed
      const bbAt = atLevel(g.bbId, g.bbTarget);
      if (bbAt == null) continue;
      out.push({
        id: g.bbId,
        level: g.bbTarget,
        label: g.label,
        category: "building",
        kind: "builder",
        duration: GEAR_UP_SECONDS[g.key] ?? 0,
        cost: null,
        priority: 340,
        enablesAt: bbAt,
        // The Master Builder performs every gear-up trip, so a pending trip is
        // pinned to his lane (lane 0) exactly like an in-flight one — otherwise it
        // could be dropped onto lane 2 and leave that lane idle while the trip
        // duration that should own it never materialises.
        pinnedLane: 0,
        gearUp: g,
      });
    }
    return out;
  };

  const commit = (c: Candidate, p: Placement) => {
    const found = stepOf(c.id, c.level);
    const entity = found?.entity ?? null;
    // A gear-up trip wears its own label ("Gear Up: Archer Tower"), not the
    // defence it converts — otherwise the bar reads "Archer Tower 5→6",
    // indistinguishable from the ordinary level-up that actually runs on the
    // other builders' lanes.
    const displayName = c.gearUp ? c.gearUp.label : (entity?.name ?? c.label);
    const uid = BOB_UID_BASE + uidSeq++;
    options.push({
      uid,
      id: c.id,
      name: displayName,
      category: c.category,
      village: "builderBase",
      resource: entity?.resource ?? "Builder Gold",
      currentLevel: c.gearUp ? c.level : c.level - 1,
      nextLevel: c.level,
      cost: c.cost,
      time: c.gearUp ? c.duration : (found?.step.time ?? null),
      available: true,
      count: 1,
    });
    if (c.storage) {
      // One copy, not the entity: the other copy keeps its own level, and the
      // ceiling is their sum. `advance` would record the higher level against
      // the entity and hide the copy that is still low.
      const gain = bbStorageCapacity(c.level) - bbStorageCapacity(c.storage.copy.level);
      c.storage.copy.level = c.level;
      c.storage.copy.readyAt = p.end;
      // The room only exists once the upgrade is done, so it is dated at the end.
      if (gain > 0) {
        capEvents.push({ at: p.end, resource: c.storage.pool.resource, delta: gain });
      }
    } else {
      if (c.id === BB_BUILDER_HALL) {
        const gain = bbHallCapacity(c.level) - bbHallCapacity(c.level - 1);
        if (gain > 0) {
          for (const r of [BB_GOLD, BB_ELIXIR]) capEvents.push({ at: p.end, resource: r, delta: gain });
        }
      }
      advance(c.id, c.level, p.end);
    }
    if (c.gearUp) gearUpDone.add(c.gearUp.key);

    // A level that costs resources but no builder time — every Builder Base wall
    // level, and the Builder Hall's own first steps — cannot be a bar and cannot
    // hold a builder: it happens as soon as its gate opens, and the chain moves
    // straight on.
    if (c.duration <= 0) return;

    const job: AssignedJob = {
      uid,
      name: displayName,
      duration: c.duration,
      category: c.category,
      kind: c.kind,
      count: 1,
      // A gear-up is the Master Builder's own trip, not the defence it converts,
      // so it wears the buildings family rather than the defence one.
      family: c.gearUp ? "buildings" : familyOf(c.category, entity, c.id === BB_BUILDER_HALL),
      priority: c.priority,
      start: p.start,
      end: p.end,
      key: `${uid}#0`,
      instance: 1,
      instances: 1,
      entityId: c.id,
      // A gear-up trip changes a building's gear, not its level: the
      // levelFrom/levelTo pair that a level-up bar shows does not apply, so
      // leave it unset and let the timeline render the trip's own label.
      ...(c.gearUp ? {} : { levelFrom: c.level - 1, levelTo: c.level }),
    };
    if (p.lane < 0) {
      labLane.push(job);
      book(labSpans, p.start, p.end);
    } else {
      builderLanes[p.lane].push(job);
      book(laneSpans[p.lane], p.start, p.end);
    }
  };

  /* ---- run it, earliest start first ------------------------------------- */

  // Every round places the candidate that can start soonest, breaking ties on
  // priority: that is what keeps the Builder Hall ahead of the hero altars when
  // both are free, while never leaving a builder or the Star Lab idle when there
  // is critical work that could be running on it.
  for (let guard = 0; guard < 4096; guard++) {
    const candidates = collect();
    if (candidates.length === 0) break;
    let best: { c: Candidate; p: Placement } | null = null;
    for (const c of candidates) {
      const p = earliest(c);
      if (!p) continue;
      if (
        !best ||
        p.start < best.p.start ||
        (p.start === best.p.start && c.priority > best.c.priority)
      ) {
        best = { c, p };
      }
    }
    if (!best) break;
    commit(best.c, best.p);
    // Committing a Builder Hall level can be the moment O.T.T.O's hut goes up,
    // which is the moment his lane exists.
    openLanes();
  }

  const lanes: Lane[] = [];
  for (let i = 0; i < laneCount; i++) {
    lanes.push({ key: `builder-${i}`, label: `Builder ${i + 1}`, jobs: builderLanes[i] });
  }
  lanes.push({ key: "lab", label: "Star Lab", jobs: labLane });

  const makespan = lanes.reduce(
    (m, l) => l.jobs.reduce((mm, j) => Math.max(mm, j.end), m),
    0,
  );

  // What the base could hold before the plan and after it. Reported even when
  // no storage work was needed: the ceiling is what makes an ETA believable, and
  // "1.07M now → 2.0M by the end" answers the question the timeline raises.
  const hallNow = bbHallCapacity(o.entries.find((e) => e.village === "builderBase" && e.id === BB_BUILDER_HALL)?.level ?? 0);
  const resources: BobResourceLine[] = pools.map((pool) => {
    const forced = raisedFor.get(pool.resource);
    return {
      resource: pool.resource,
      cap: hallNow + pool.copies.reduce((sum, c) => sum + bbStorageCapacity(c.from), 0),
      capAtEnd: capAt(pool.resource, Infinity),
      added: pool.copies
        .filter((c) => c.level > c.from)
        .map((c) => `${pool.label} ${c.from}→${c.level}`),
      forLabel: forced?.label,
      forCost: forced?.cost,
    };
  });

  // Requirements the plan never got to. The reason is the last one the storage
  // pass gave: a ceiling that hit its own maximum, or a Builder Hall level the
  // plan stops short of.
  for (const u of unmet.values()) {
    blockers.add(
      u.why
        ? `${u.label} costs ${formatNumber(u.need)} ${u.resource} — ${u.why}`
        : `${u.label} costs ${formatNumber(u.need)} ${u.resource} — the plan runs out of room before it gets there`,
    );
  }

  // A Star Lab gate recorded as provisional while the plan was still below its
  // level only becomes a real blocker if the plan's own Star Lab chain never
  // reaches it — otherwise the gate is open and the "not in this base yet"
  // message is false, because the plan itself builds that level.
  for (const g of pendingLabGates) {
    if (atLevel(BB_STAR_LAB, g.labNeed) == null) {
      blockers.add(
        `${g.label} — level ${g.level} requires Star Lab ${g.labNeed}, which is not in this base yet`,
      );
    }
  }

  return { lanes, makespan, beyondHorizon: 0, blockers: [...blockers], options, resources };
}
