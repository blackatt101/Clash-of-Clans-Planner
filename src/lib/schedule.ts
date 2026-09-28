import {
  blockWindow,
  cwlWindow,
  nextUnblocked,
  type BlockSpec,
  type UnavailableWindow,
} from "./sleep";
import type { HeroChain } from "./settings";
import type { Cost, Family, Village } from "./types";
import type { UpgradeOption } from "./upgrade";

export type JobKind = "builder" | "lab" | "pet";

/**
 * Jobs a dedicated hero lane makes get their own uid space, the way the B.O.B
 * chain does: one hero is scheduled many times over, and every chained level
 * needs an identity of its own — the views look a job up in one shared map by
 * uid, so sharing the hero's entry uid would give all forty of its bars one
 * label between them.
 */
export const HERO_CHAIN_UID_BASE = 4_000_000;

/** One level a hero on a lane of its own still has to climb. */
export interface HeroChainLevel {
  /** The level this step reaches. */
  level: number;
  duration: number;
  cost: Cost | null;
}

/**
 * A hero that owns a builder for as long as the plan runs.
 *
 * The export and the upgrade list between them can only ever describe the NEXT
 * level of a hero, because the level after that depends on the one not built
 * yet. That is fine for a building — one level per lane is a plan — but a hero
 * has forty levels and a lane of its own, so a one-level-per-hero plan put four
 * bars on the hero lane and left the rest of the row empty. This carries the
 * levels so the lane can be filled.
 */
export interface HeroChainSpec {
  id: number;
  name: string;
  /** "Elixir" or "Dark Elixir" — what the levels are paid in. */
  resource: string;
  /** The uid of the ticked upgrade for this hero; the first level keeps it. */
  uid: number;
  /** A live upgrade to wait for first, in seconds from now (the hero's own). */
  after?: number;
  /** The ticked option's weight, so a focused hero keeps its focus boost. */
  priority: number;
  /** Every level still to come, in order: `levels[0]` is the ticked one. */
  levels: HeroChainLevel[];
}

export interface ScheduleJob {
  uid: number;
  name: string;
  duration: number;
  category: string;
  kind: JobKind;
  priority?: number;
  /** Earliest start, in seconds from now — set for follow-ups to a live upgrade. */
  after?: number;
  /** Levels shown while a job is the one already running. */
  levelFrom?: number;
  levelTo?: number;
  /**
   * How many identical copies of this upgrade exist. The export aggregates
   * copies of a building that sit at the same level into one entry with `cnt`,
   * and every copy has to be upgraded separately — so 7 Gold Mines at level 12
   * are 7 jobs, not one. Ignoring this made the plan wildly optimistic.
   */
  count?: number;
  /**
   * What this upgrade IS — the bar's colour. Carried on the job
   * rather than looked up in the view because the view only has the job, and
   * because the family is decided where the entity is still in hand.
   */
  family?: Family;
  /**
   * The game entity this job upgrades. Only set on jobs built from the export's
   * live timers, where the job has to be told apart from its own follow-up: the
   * B.O.B goal planner reads it to know which entry is busy and until when.
   */
  entityId?: number;
}

export interface AssignedJob extends ScheduleJob {
  start: number;
  end: number;
  inProgress?: boolean;
  /** Stable identity for ONE instance; `uid` repeats when `count` > 1. */
  key: string;
  /** 1-based position within `count`. */
  instance: number;
  /** How many instances this job has in total (its job's `count`). */
  instances: number;
}

export interface Lane {
  key: string;
  label: string;
  jobs: AssignedJob[];
}

export interface ScheduleOptions {
  builders: number;
  blocks: BlockSpec[]; // recurring spans when no work happens
  horizon: number; // seconds; 0 = unlimited
  /**
   * Which village is being planned. Only used to name the lanes: the Builder
   * Base researches in the Star Lab, not a Laboratory, and it has no Pet House
   * at all — the Home Village names would be wrong labels rather than just a
   * different word for the same thing.
   */
  village?: Village;
  /** How many builders are dedicated to hero upgrades (0 = none). */
  heroLanes?: number;
  /** How far those lanes run — see `heroChain` in settings. */
  heroChain?: HeroChain;
  /**
   * The heroes that own those lanes, most focused first: `heroChains[0]` gets
   * the first hero lane. Only heroes the player actually planned appear here —
   * a lane for a hero nobody ticked is a lane doing nothing.
   */
  heroChains?: HeroChainSpec[];
  cwlBlock: boolean; // defer hero upgrades during CWL (1st–10th)
  /**
   * Most heroes that may be upgrading at the same time — this is what "keep N
   * heroes available" actually means, and it is a *concurrency* limit, not a cap
   * on how many heroes get planned. Every hero still gets upgraded; the schedule
   * just never has more than this many of them in a builder at once.
   */
  heroConcurrency?: number;
  /**
   * Seconds from now before each builder exists. The Builder Base's second
   * builder is O.T.T.O's Outpost, which needs Builder Hall 6 — so on a younger
   * base the second lane is not late, it is absent, and planning it as available
   * from t=0 promises throughput the player does not have.
   */
  builderUnlock?: number[];
  nowEpochMs: number; // export timestamp, for window math
  wiggleRoom: number; // seconds buffer between consecutive upgrades
}

export interface ScheduleResult {
  lanes: Lane[];
  makespan: number;
  beyondHorizon: number;
  /**
   * Detail rows for the jobs the schedule made that no upgrade list could offer:
   * the chained hero levels past the ticked one. The views look every job up by
   * uid, so without these a hero's second bar has no name, no level and no cost.
   */
  options?: UpgradeOption[];
}

const jobOrder = (a: ScheduleJob, b: ScheduleJob) =>
  (b.priority ?? 0) - (a.priority ?? 0) || b.duration - a.duration;

export function scheduleJobs(
  jobs: ScheduleJob[],
  opts: ScheduleOptions,
  inProgress: ScheduleJob[] = [],
): ScheduleResult {
  const n = Math.max(1, opts.builders);

  type Instance = ScheduleJob & { key: string; instance: number; instances: number };

  // The export aggregates copies of a building that sit at the same level into a
  // single entry carrying `cnt` — and every copy needs its own upgrade, so 7 Gold
  // Mines at level 12 are 7 jobs, not one. Expand them here; the lane allocator
  // then spreads the copies across builders, which is how they really run.
  // Copies keep their `uid` (so `details` lookups still resolve) but each gets a
  // distinct `key`, so hovering or selecting one bar never touches its siblings.
  const expand = (list: ScheduleJob[]): Instance[] =>
    list.flatMap((j) => {
      const copies = Math.max(1, Math.floor(j.count ?? 1));
      return Array.from({ length: copies }, (_, i) => ({
        ...j,
        key: `${j.uid}#${i}`,
        instance: i + 1,
        instances: copies,
      }));
    });
  const inflight = expand(inProgress);
  const queue = expand(jobs);

  const builderLanes: AssignedJob[][] = Array.from({ length: n }, () => []);
  const labLane: AssignedJob[] = [];
  const petLane: AssignedJob[] = [];

  /**
   * What is already booked on a lane, earliest first. A lane is a timeline, not
   * a queue: an upgrade held back by `after` (a follow-up to a running one) or
   * by the hero limit cannot start when the lane frees, and the stretch before
   * it is still usable — another upgrade can run there and be out of the way
   * again before the held-back one begins. Tracking only the lane's last end
   * would hide that stretch, and the planner would idle a builder it has work
   * for.
   */
  type Span = { start: number; end: number };
  const laneSpans: Span[][] = Array.from({ length: n }, (_, i) => {
    const unlock = opts.builderUnlock?.[i] ?? 0;
    // A lane that does not exist yet is booked from now until it does.
    return unlock > 0 ? [{ start: 0, end: unlock }] : [];
  });
  const labSpans: Span[] = [];
  const petSpans: Span[] = [];
  const lastEnd = (spans: Span[]) => spans.reduce((m, s) => Math.max(m, s.end), 0);
  const book = (spans: Span[], start: number, end: number) => {
    spans.push({ start, end });
    spans.sort((a, b) => a.start - b.start || a.end - b.end);
  };

  /**
   * The dedicated hero lanes: lanes 0…K-1, one per focused hero.
   *
   * K is capped three ways and every cap matters. By the setting, obviously; by
   * `n - 1`, because a village with nothing but hero lanes has nowhere to put
   * anything else and the rest of the plan would vanish; and by the number of
   * focused heroes, because a lane reserved for a hero that is not planned is a
   * lane drawn empty — which is the complaint this feature exists to answer, not
   * a thing to add more of.
   */
  const chains = opts.heroChains ?? [];
  const heroLaneCount = Math.min(
    Math.max(0, Math.floor(opts.heroLanes ?? 0)),
    Math.max(0, n - 1),
    chains.length,
  );
  /**
   * Which lane each focused hero owns. A hero past the lane count — more heroes
   * ticked than lanes asked for, or more lanes asked for than the village has
   * builders — is not dropped on the floor: it has no lane of its own, so it
   * queues with everything else. Being in `heroChains` means "these are the
   * heroes to focus", not "these and no others are upgraded", and the caller
   * sends every planned hero up to the maximum number of lanes.
   */
  const chainLane = new Map<number, number>();
  for (let i = 0; i < heroLaneCount; i++) chainLane.set(chains[i].uid, i);

  // In-progress items occupy their lane from t=0 (blocks are not applied: they
  // are already running and their remaining timer just elapses). Each goes to
  // the currently least-loaded lane rather than a fixed rotation, so two live
  // upgrades never land on the same lane.
  //
  // If the export lists more running upgrades than the player has lanes — which
  // happens when the builder count is set too low — the overflow queues behind
  // what is already on that lane instead of being drawn on top of it.
  const occupy = (lane: AssignedJob[], spans: Span[], ip: Instance) => {
    const start = lastEnd(spans);
    lane.push({ ...ip, start, end: start + ip.duration, inProgress: true });
    book(spans, start, start + ip.duration);
  };
  for (const ip of inflight) {
    if (ip.kind === "lab") {
      occupy(labLane, labSpans, ip);
    } else if (ip.kind === "pet") {
      occupy(petLane, petSpans, ip);
    } else {
      // A running upgrade takes the lane it belongs on: a focused hero sits on
      // its own hero lane, because its chain is scheduled from the end of this
      // very bar and the lane is meant to be that hero's — and nothing else goes
      // on a hero lane at all, since a dedicated lane with a building in it is
      // not one. Everything else takes the least-loaded lane that is left.
      const focused = chains.find((c) => c.id === ip.entityId);
      const own = focused ? chainLane.get(focused.uid) : undefined;
      let bi = own ?? heroLaneCount;
      if (own == null) {
        for (let i = heroLaneCount + 1; i < n; i++) {
          if (lastEnd(laneSpans[i]) < lastEnd(laneSpans[bi]) - 1e-9) bi = i;
        }
      }
      const start = lastEnd(laneSpans[bi]);
      builderLanes[bi].push({ ...ip, start, end: start + ip.duration, inProgress: true });
      book(laneSpans[bi], start, start + ip.duration);
    }
  }

  // Partition the remaining jobs by lane.
  const builderJobs: Instance[] = [];
  const labJobs: Instance[] = [];
  const petJobs: Instance[] = [];
  for (const j of queue) {
    if (j.kind === "lab") labJobs.push(j);
    else if (j.kind === "pet") petJobs.push(j);
    // A focused hero is scheduled by its chain, which begins at exactly this
    // level: placing both would book its next level twice.
    else if (chainLane.has(j.uid)) continue;
    // A hero without a lane of its own is an ordinary job — that is what a hero
    // does on every other setting — but it keeps its category, because the
    // concurrency limit counts heroes wherever they run.
    else builderJobs.push(j);
  }

  builderJobs.sort(jobOrder);
  labJobs.sort(jobOrder);
  petJobs.sort(jobOrder);

  // Every hero already on a lane, in flight or planned, so the concurrency limit
  // below can be checked against the whole plan rather than one lane. The
  // running ones matter as much as the planned ones — they are in a builder
  // right now, so they are heroes the player does not have — which is why the
  // caller must label an in-flight hero with its real category (see
  // `inProgress` in app/page.tsx).
  const heroSpans: { start: number; end: number }[] = builderLanes
    .concat(labLane, petLane)
    .flat()
    .filter((ip): ip is AssignedJob => ip.inProgress === true && ip.category === "hero")
    .map((ip) => ({ start: ip.start, end: ip.end }));

  /**
   * Push a hero's start forward until no more than `cap` other heroes overlap
   * it. The limit is what keeps heroes available for war: with "keep 2", two
   * heroes are never both in a builder, so two are always ready to attack.
   *
   * A `cap` below 1 is read as "no limit", which is what an absent one means —
   * but it is not a value the settings produce for a "keep N" preset, because
   * that arithmetic bottoms out at a hero upgrading one at a time and never at
   * zero (see `heroCap`). Zero here would stall every hero for ever, not free
   * them.
   */
  const respectHeroCap = (job: Instance, start: number): number => {
    const cap = opts.heroConcurrency;
    if (cap == null || job.category !== "hero") return start;
    if (cap < 1) return start;
    for (let guard = 0; guard < 64; guard++) {
      const overlapping = heroSpans.filter(
        (h) => h.end > start && h.start < start + job.duration,
      );
      if (overlapping.length < cap) break;
      start = Math.min(...overlapping.map((h) => h.end));
    }
    return start;
  };

  /**
   * When a job placed on a lane that is busy until `load` would actually start.
   * Pure — it reads `heroSpans` but never adds to it — so the allocator can ask
   * every lane what it would do with the job before committing to one.
   */
  const startAt = (job: Instance, load: number): number => {
    // The login buffer sits between two upgrades *you have to tap*. It belongs
    // after whichever comes first — the lane's own work or the running upgrade
    // this job is a follow-up to. Applying it only to a lane that already has
    // work would make an idle lane look `wiggleRoom` faster than the lane that
    // is actually busy until then, and the job would strand the idle one for
    // the whole wait to save those few minutes.
    const floor = Math.max(load, job.after ?? 0);
    const raw = floor > 0 ? floor + opts.wiggleRoom : 0;
    const windows: UnavailableWindow[] = opts.blocks.map(blockWindow);
    const isHero = job.category === "hero";
    const cwl = opts.cwlBlock && isHero ? cwlWindow() : null;
    if (cwl) windows.push(cwl);

    /**
     * Move an instant to the first moment that is allowed to *start* work:
     * out of every unavailable window, and — for CWL — early enough to finish
     * before the window opens.
     *
     * An unavailable window means you're not there to tap "start", so the next
     * upgrade waits for the window to lift. Once started, though, an upgrade
     * runs to completion — nothing pauses it. So the bar is exactly `duration`
     * wide at a true wall-clock position, and windows show up as idle gaps.
     */
    const settle = (from: number): number => {
      let t = (nextUnblocked(opts.nowEpochMs + from * 1000, windows) - opts.nowEpochMs) / 1000;
      // CWL is the one window an upgrade may not run *through*: the point of
      // blocking heroes for war is that they are available for the whole league,
      // so a hero that would still be in a builder when the window opens waits
      // for it to close instead.
      if (!cwl) return t;
      for (let guard = 0; guard < 8; guard++) {
        const endMs = opts.nowEpochMs + (t + job.duration) * 1000;
        const lifted = nextUnblocked(endMs - 1, [cwl]);
        if (lifted === endMs - 1) break;
        t = (nextUnblocked(lifted, windows) - opts.nowEpochMs) / 1000;
      }
      return t;
    };

    let start = settle(raw);
    if (isHero) {
      // The concurrency limit and the windows fight each other: waiting for a
      // hero to come out of a builder can land the next one inside a sleep or
      // CWL window that was cleared a moment ago, and clearing the window can
      // push it back on top of the hero it was waiting for. Each rule only ever
      // moves the start later, so applying them in turn converges.
      for (let guard = 0; guard < 8; guard++) {
        // The cap only ever holds a hero *later* — until another hero leaves a
        // builder. That hero leaving is the follow-up point, so the login
        // buffer is owed on top of it, the way it is on top of lane load:
        // settle the capped instant as a floor (buffered) rather than from the
        // bare end, which would start the hero the moment its predecessor's
        // timer hits zero with no time to be there to tap it.
        const capped = respectHeroCap(job, start);
        if (capped === start) break;
        start = Math.max(start, settle(capped + opts.wiggleRoom));
      }
    }
    return start;
  };

  /**
   * The earliest a job can start on a lane, given what is booked there. It
   * walks the lane's holes in order instead of only appending at the end, so a
   * stretch of a lane that a held-back upgrade is not using gets used.
   */
  const startIn = (job: Instance, spans: Span[]): number => {
    let from = 0;
    for (const s of spans) {
      const cand = startAt(job, from);
      // Starts after this booking: it is not in the way.
      if (cand >= s.end - 1e-9) continue;
      // Finishes before it opens: this is the slot.
      if (cand + job.duration <= s.start + 1e-9) return cand;
      from = s.end;
    }
    return startAt(job, from);
  };

  const place = (
    job: Instance,
    start: number,
    lane: AssignedJob[],
    spans: Span[],
  ): AssignedJob => {
    const a: AssignedJob = { ...job, start, end: start + job.duration };
    if (job.category === "hero") heroSpans.push({ start, end: a.end });
    lane.push(a);
    book(spans, start, a.end);
    return a;
  };

  for (const j of labJobs) {
    place(j, startIn(j, labSpans), labLane, labSpans);
  }
  for (const j of petJobs) {
    place(j, startIn(j, petSpans), petLane, petSpans);
  }

  // Everything that is not a focused hero, on the lanes that are not hero lanes.
  // Hero lanes are exclusive on purpose: a lane that also takes buildings is not
  // the dedicated lane the setting promises, and a builder dropped into it would
  // sit in the middle of a hero's chain.
  const firstBuilder = heroLaneCount;
  for (const j of builderJobs) {
    // Pick the lane that gets this upgrade started soonest — not the emptiest
    // one. The two differ for any job that may not start yet: a follow-up to a
    // running upgrade (`after`), or a hero the concurrency limit is holding
    // back. Such a job dropped on an idle builder reserves it for the whole
    // wait and leaves it empty — a Builder King upgrade finishing in 19 hours
    // would idle a builder for 19 hours before the next level could begin.
    // On a tie the *busier* lane wins: one that is busy until then has nothing
    // to lose, while the idle one can still take work that is ready now.
    let bi = firstBuilder;
    let best = startIn(j, laneSpans[bi]);
    for (let i = firstBuilder + 1; i < n; i++) {
      const s = startIn(j, laneSpans[i]);
      if (s < best || (s === best && lastEnd(laneSpans[i]) > lastEnd(laneSpans[bi]))) {
        bi = i;
        best = s;
      }
    }
    place(j, best, builderLanes[bi], laneSpans[bi]);
  }

  /**
   * The hero lanes, filled.
   *
   * Each focused hero has a lane, and the lane takes its levels one after
   * another until the lane has caught up with the rest of the plan — that is
   * what stops four bars from being the whole hero lane. The levels come from
   * the rulebook rather than the upgrade list, which can only ever name the
   * level after the next one; this is the same chaining the B.O.B plan does,
   * over a different set of buildings.
   *
   * The fill is bounded by the plan's own end, not by the hero's last level, so
   * the ETA stays the answer to the question the ticked list asks ("when is this
   * work done") and a hero does not drag a two-month plan out to two years. The
   * first level of each chain is exempt: it is work the player ticked, and it
   * stays in the plan even if it runs past everything else.
   *
   * `heroChain: "max"` deliberately goes the other way and runs to the hero's
   * last level, which answers the question a hero push is really asking — "when
   * are they done" — at the cost of a plan that runs far past the ticked work.
   * Note the lanes are placed after the builder jobs, so a hero cannot delay
   * anything that was already scheduled: it fills what is left.
   */
  const chainOptions: UpgradeOption[] = [];
  if (heroLaneCount > 0) {
    // "The rest of the plan" is the work that is not a hero — buildings,
    // research, pets — wherever it landed. A hero without a lane of its own is
    // not part of it: the fallback hero's single bar ends in a day or two, and
    // measuring the lane against it would stop the chain at its first level,
    // which is the empty lane again by another route. Counting only non-hero
    // work also makes the answer stable as heroes move between lanes and
    // builders.
    const endOf = (jobs: AssignedJob[]) =>
      jobs.reduce((m, j) => (j.category === "hero" ? m : Math.max(m, j.end)), 0);
    const anchor = Math.max(
      0,
      ...builderLanes.slice(heroLaneCount).map(endOf),
      endOf(labLane),
      endOf(petLane),
    );
    // Nothing else is planned: there is no "rest of the plan" to be as long as,
    // so the lane does the only other thing it can and runs to the hero's max.
    // Matching a plan of length zero would be the four-bars-and-then-nothing
    // lane this feature exists to remove, drawn on purpose — and it is a real
    // account, not a hypothetical: ticking nothing but the heroes is how a hero
    // push is planned. `endOf` alone cannot tell the two apart: lanes that hold
    // zero-duration ticked jobs (Walls take no time at all in the rulebook)
    // read as 0 just like lanes that hold nothing, and the hero would run to
    // max even though the player ticked real work that is done by t=0. Count
    // the jobs, not their ends: the escape is for "nothing else is planned",
    // not for "everything else finishes at once".
    const otherWorkPlanned =
      builderLanes.slice(heroLaneCount).some((l) => l.length > 0) ||
      labLane.length > 0 ||
      petLane.length > 0;
    const toMax = opts.heroChain === "max" || (anchor === 0 && !otherWorkPlanned);
    for (let i = 0; i < heroLaneCount; i++) {
      const chain = chains[i];
      let after = chain.after ?? 0;
      let first = true;
      let prev = 0;
      for (const lv of chain.levels) {
        const uid = first ? chain.uid : HERO_CHAIN_UID_BASE + chain.id * 1000 + lv.level;
        const job: Instance = {
          uid,
          name: chain.name,
          duration: lv.duration,
          category: "hero",
          kind: "builder",
          count: 1,
          family: "hero",
          priority: chain.priority,
          after,
          key: `${uid}#0`,
          instance: 1,
          instances: 1,
        };
        const start = startIn(job, laneSpans[i]);
        if (!first && !toMax && start + lv.duration > anchor) break;
        const placed = place(job, start, builderLanes[i], laneSpans[i]);
        // The ticked level already has a detail row of its own (it is in the
        // upgrade list); the chained ones exist nowhere else, so they bring one.
        if (!first) {
          chainOptions.push({
            uid,
            id: chain.id,
            name: chain.name,
            category: "hero",
            village: opts.village ?? "home",
            resource: chain.resource,
            // The chain is not guaranteed to be contiguous — a caller may skip
            // levels — so track the level the lane just placed and name the step
            // from there. lv.level - 1 lies about any gap the levels have.
            currentLevel: prev,
            nextLevel: lv.level,
            cost: lv.cost,
            time: lv.duration,
            available: true,
            count: 1,
          });
        }
        after = placed.end;
        prev = lv.level;
        first = false;
      }
    }
  }

  const bb = opts.village === "builderBase";
  // A job may have been dropped into a hole behind a later one, so a lane is
  // not in start order by construction — and every view reads it as a timeline.
  const byStart = (jobs: AssignedJob[]) => jobs.sort((a, b) => a.start - b.start);
  // Builders are not all equal in a plan: a village with 6 of them may have work
  // for only 2, and the rest draw as blank rows — the "so many empty lanes"
  // complaint. Drop a builder lane that has no job and no live upgrade, but
  // keep at least one so a village that ticked nothing still has a row to plan
  // onto, and never drop a lane the user is watching a running upgrade on.
  const lanes: Lane[] = [];
  let keptAny = false;
  const pushLane = (i: number) =>
    lanes.push({
      key: `builder-${i}`,
      label: i < heroLaneCount ? `Hero lane ${i + 1}` : `Builder ${i + 1}`,
      jobs: byStart(builderLanes[i]),
    });
  for (let i = 0; i < n; i++) {
    const idle = builderLanes[i].length === 0;
    // A hero lane whose chain still has work on it keeps its row — and a
    // running upgrade counts as work: the user is watching a live timer on
    // that very lane, which is the case the original never prunes. But a hero
    // lane whose chain has no levels left to climb shows nothing of its own;
    // it must not take the one "kept lane" slot, because it sits at index 0,
    // ahead of every builder lane: if it claimed the slot, keptAny would be
    // set before a single builder lane was examined, every idle builder lane
    // would be pruned, the fallback below would never fire, and the plan would
    // have no builder lane at all — the same empty row the hero-lane feature
    // exists to remove, back through the pruning.
    if (idle && (i < heroLaneCount || keptAny)) continue;
    keptAny = true;
    pushLane(i);
  }
  if (!keptAny) {
    lanes.push({ key: "builder-0", label: "Builder 1", jobs: [] });
  }
  lanes.push({ key: "lab", label: bb ? "Star Lab" : "Laboratory", jobs: byStart(labLane) });
  // The Builder Base has no Pet House, so the lane is not drawn there at all
  // rather than drawn permanently empty.
  if (!bb) lanes.push({ key: "pethouse", label: "Pet House", jobs: byStart(petLane) });

  const makespan = lanes.reduce(
    (m, l) => l.jobs.reduce((mm, j) => Math.max(mm, j.end), m),
    0,
  );

  const beyondHorizon = opts.horizon
    ? lanes.reduce(
        (acc, l) => acc + l.jobs.filter((j) => j.end > opts.horizon).length,
        0,
      )
    : 0;

  return {
    lanes,
    makespan,
    beyondHorizon,
    options: chainOptions.length ? chainOptions : undefined,
  };
}
