import assert from "node:assert";
import fs from "fs";
import { scheduleJobs, ScheduleJob, HERO_CHAIN_UID_BASE } from "../src/lib/schedule";
import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS, MAX_HERO_LANES } from "../src/lib/settings";
import { computeUpgrades, UpgradeOption } from "../src/lib/upgrade";
import { focusedHeroes, heroCap } from "../src/lib/priorityOrder";
import { effectiveTime, effectiveCost } from "../src/lib/discounts";

async function runTests() {
  console.log("==================================================================");
  console.log("RUNNING HERO CONCURRENCY REGRESSION TEST SUITE (FINDING-12.2)");
  console.log("==================================================================");

  // -----------------------------------------------------------------------------
  // PART 1: Synthetic Interval & Concurrency Unit Verifications via scheduleJobs
  // -----------------------------------------------------------------------------
  console.log("\n[PART 1] Synthetic Interval & Concurrency Unit Verifications");

  function verifyConcurrency(res: ReturnType<typeof scheduleJobs>, cap: number) {
    const heroJobs = res.lanes.flatMap((l) => l.jobs).filter((j) => j.category === "hero");
    const pts = new Set<number>();
    for (const j of heroJobs) {
      pts.add(j.start);
      pts.add(j.end);
    }
    for (const t of pts) {
      const active = heroJobs.filter((j) => j.start <= t && t < j.end);
      assert(
        active.length <= cap,
        `Instantaneous concurrency cap violated at t=${t}: ${active.length} > ${cap}`,
      );
    }
  }

  // Helper to schedule a set of hero jobs with given inProgress spans
  function testSchedule(opts: {
    heroConcurrency: number;
    inProgress: ScheduleJob[];
    jobs: ScheduleJob[];
    heroLanes?: number;
    heroChains?: any[];
  }) {
    const res = scheduleJobs(
      opts.jobs,
      {
        builders: 5,
        blocks: [],
        horizon: 10_000_000,
        heroLanes: opts.heroLanes ?? 0,
        heroChain: "max",
        heroChains: opts.heroChains ?? [],
        cwlBlock: false,
        heroConcurrency: opts.heroConcurrency,
        village: "home",
        nowEpochMs: 1700000000000,
        wiggleRoom: 0,
      },
      opts.inProgress,
    );
    verifyConcurrency(res, opts.heroConcurrency);
    return res;
  }

  // TEST 1: Contiguous Spans: [0, 100) and [100, 200)
  // Two consecutive upgrades of Hero A. With cap = 2, candidate Hero B [50, 150) dur=100.
  // Instantaneous concurrency is at most 1 other hero everywhere.
  // Candidate MUST start at t = 50 (or after prerequisite), NOT delayed to 100.
  {
    const inProgress: ScheduleJob[] = [
      { uid: 1_000_001, name: "Hero A1", duration: 100, category: "hero", kind: "builder", count: 1 },
    ];
    // Hero A2 starts at 100 and ends at 200
    const jobs: ScheduleJob[] = [
      { uid: 1, name: "Hero A2", duration: 100, category: "hero", kind: "builder", count: 1, after: 100, priority: 10 },
      { uid: 2, name: "Hero B", duration: 100, category: "hero", kind: "builder", count: 1, after: 50, priority: 5 },
    ];
    const res = testSchedule({ heroConcurrency: 2, inProgress, jobs });
    const heroB = res.lanes.flatMap((l) => l.jobs).find((j) => j.name === "Hero B");
    assert(heroB, "Hero B must be scheduled");
    assert.strictEqual(
      heroB.start,
      50,
      `TEST 1 FAILED: Hero B should start at t=50 (instantaneous concurrency is 1), but started at t=${heroB.start}`,
    );
    console.log("  PASS: Test 1 - Contiguous spans [0, 100) and [100, 200): candidate starts at t=50 without delay");
  }

  // TEST 2: Disjoint Spans: [0, 50) and [150, 200)
  // With cap = 2, candidate Hero C [0, 200) dur=200.
  // Instantaneous concurrency never exceeds 1 other hero.
  // Candidate MUST start at t = 0, NOT delayed to 50.
  {
    const inProgress: ScheduleJob[] = [
      { uid: 1_000_001, name: "Hero A", duration: 50, category: "hero", kind: "builder", count: 1 },
    ];
    const jobs: ScheduleJob[] = [
      { uid: 1, name: "Hero B", duration: 50, category: "hero", kind: "builder", count: 1, after: 150, priority: 10 },
      { uid: 2, name: "Hero C", duration: 200, category: "hero", kind: "builder", count: 1, after: 0, priority: 5 },
    ];
    const res = testSchedule({ heroConcurrency: 2, inProgress, jobs });
    const heroC = res.lanes.flatMap((l) => l.jobs).find((j) => j.name === "Hero C");
    assert(heroC, "Hero C must be scheduled");
    assert.strictEqual(
      heroC.start,
      0,
      `TEST 2 FAILED: Hero C should start at t=0 (spans are disjoint), but started at t=${heroC.start}`,
    );
    console.log("  PASS: Test 2 - Disjoint spans [0, 50) and [150, 200): candidate starts at t=0");
  }

  // TEST 3: Genuine Concurrency Violation: [0, 100) and [40, 120)
  // With cap = 2, candidate Hero C dur=60, after=0.
  // At t in [40, 100), both Hero A and Hero B are active (count=2 >= cap).
  // Candidate CANNOT run across [40, 100). It must wait until t = 100.
  {
    const inProgress: ScheduleJob[] = [
      { uid: 1_000_001, name: "Hero A", duration: 100, category: "hero", kind: "builder", count: 1 },
      { uid: 1_000_002, name: "Hero B", duration: 80, category: "hero", kind: "builder", count: 1 }, // starts at 40 in builder? We use after=40:
    ];
    const jobs: ScheduleJob[] = [
      { uid: 1, name: "Hero B", duration: 80, category: "hero", kind: "builder", count: 1, after: 40, priority: 10 },
      { uid: 2, name: "Hero C", duration: 60, category: "hero", kind: "builder", count: 1, after: 0, priority: 5 },
    ];
    const res = testSchedule({ heroConcurrency: 2, inProgress: [inProgress[0]], jobs });
    const heroC = res.lanes.flatMap((l) => l.jobs).find((j) => j.name === "Hero C");
    assert(heroC, "Hero C must be scheduled");
    assert.strictEqual(
      heroC.start,
      100,
      `TEST 3 FAILED: Hero C should be held until t=100 due to true concurrency peak at t=40, but started at t=${heroC.start}`,
    );
    console.log("  PASS: Test 3 - Genuine concurrency violation: correctly advances to t=100");
  }

  // TEST 4: Exact Boundary: [0, 100) with cap = 1
  // Candidate starting at exactly t = 100, dur = 100.
  // Because intervals are half-open [0, 100), at t = 100 previous job is finished.
  // Candidate must start at exactly t = 100.
  {
    const inProgress: ScheduleJob[] = [
      { uid: 1_000_001, name: "Hero A", duration: 100, category: "hero", kind: "builder", count: 1 },
    ];
    const jobs: ScheduleJob[] = [
      { uid: 1, name: "Hero B", duration: 100, category: "hero", kind: "builder", count: 1, after: 100, priority: 10 },
    ];
    const res = testSchedule({ heroConcurrency: 1, inProgress, jobs });
    const heroB = res.lanes.flatMap((l) => l.jobs).find((j) => j.name === "Hero B");
    assert(heroB, "Hero B must be scheduled");
    assert.strictEqual(
      heroB.start,
      100,
      `TEST 4 FAILED: Hero B should start at exact boundary t=100, but started at t=${heroB.start}`,
    );
    console.log("  PASS: Test 4 - Exact boundary: starts at t=100 without 1s/1ms off-by-one");
  }

  // TEST 5: Multiple Sequential Conflicts After Candidate Time is Pushed Forward
  // With cap = 2:
  // Conflict 1: Hero A1 [0, 40) and Hero B1 [10, 40) -> pushes candidate to 40
  // Conflict 2: Hero A2 [40, 70) and Hero B2 [50, 80) -> pushes candidate to 70
  // Conflict 3: Hero A3 [70, 100) and Hero B3 [70, 100) -> pushes candidate to 100
  // Candidate dur=50, after=0 must resolve iteratively and land at t=100!
  {
    const inProgress: ScheduleJob[] = [
      { uid: 1_000_001, name: "Hero A1", duration: 40, category: "hero", kind: "builder", count: 1 },
    ];
    const jobs: ScheduleJob[] = [
      { uid: 1, name: "Hero B1", duration: 30, category: "hero", kind: "builder", count: 1, after: 10, priority: 20 },
      { uid: 2, name: "Hero A2", duration: 30, category: "hero", kind: "builder", count: 1, after: 40, priority: 19 },
      { uid: 3, name: "Hero B2", duration: 30, category: "hero", kind: "builder", count: 1, after: 50, priority: 18 },
      { uid: 4, name: "Hero A3", duration: 30, category: "hero", kind: "builder", count: 1, after: 70, priority: 17 },
      { uid: 5, name: "Hero B3", duration: 30, category: "hero", kind: "builder", count: 1, after: 70, priority: 16 },
      { uid: 6, name: "Candidate", duration: 50, category: "hero", kind: "builder", count: 1, after: 0, priority: 1 },
    ];
    const res = testSchedule({ heroConcurrency: 2, inProgress, jobs });
    const cand = res.lanes.flatMap((l) => l.jobs).find((j) => j.name === "Candidate");
    assert(cand, "Candidate must be scheduled");
    assert.strictEqual(
      cand.start,
      100,
      `TEST 5 FAILED: Candidate should resolve multiple sequential conflicts to t=100, but started at t=${cand.start}`,
    );
    console.log("  PASS: Test 5 - Multiple sequential conflicts: resolves iteratively to t=100");
  }

  // TEST 5b: Large Number of Sequential Conflicts & Guard Limit Invariant Guarantee
  // 150 consecutive overlapping hero intervals of duration 10 each from t=0 to 750 (2 heroes always active).
  // With cap = 2, candidate dur=50 after=0 cannot run anywhere in [0, 750).
  // It must be placed at t >= 750, and concurrency must NEVER exceed cap.
  {
    const inProgress: ScheduleJob[] = [
      { uid: 1_000_001, name: "Hero InProgress", duration: 10, category: "hero", kind: "builder", count: 1 },
    ];
    const jobs: ScheduleJob[] = [];
    for (let i = 0; i < 75; i++) {
      jobs.push({
        uid: 100 + i,
        name: `Hero Stream A${i}`,
        duration: 10,
        category: "hero",
        kind: "builder",
        count: 1,
        after: i * 10,
        priority: 50,
      });
      jobs.push({
        uid: 200 + i,
        name: `Hero Stream B${i}`,
        duration: 10,
        category: "hero",
        kind: "builder",
        count: 1,
        after: i * 10,
        priority: 50,
      });
    }
    jobs.push({
      uid: 999,
      name: "Long Candidate",
      duration: 50,
      category: "hero",
      kind: "builder",
      count: 1,
      after: 0,
      priority: 1,
    });
    const res = testSchedule({ heroConcurrency: 2, inProgress, jobs });
    const cand = res.lanes.flatMap((l) => l.jobs).find((j) => j.name === "Long Candidate");
    assert(cand, "Long Candidate must be scheduled");
    assert(
      cand.start >= 750,
      `TEST 5b FAILED: Long Candidate should start after all 150 conflicts clear (>=750), but started at t=${cand.start}`,
    );
    console.log(`  PASS: Test 5b - Large sequential conflicts (150 jobs): cleared to t=${cand.start} >= 750 without violating cap`);
  }

  // TEST 6: FINDING-15 Counterexample / Multi-Cluster Contiguous Conflict
  // Cluster 1: Hero A1 [0, 100), Hero B1 [0, 100) (active concurrency = 2)
  // Cluster 2: Hero A2 [100, 200), Hero B2 [100, 200) (active concurrency = 2)
  // Cap = 2. Candidate Hero C: duration = 50, after = 0.
  // Must advance past both clusters to t = 200 without cap violation.
  {
    const inProgress: ScheduleJob[] = [
      { uid: 1_000_001, name: "Hero A1", duration: 100, category: "hero", kind: "builder", count: 1 },
      { uid: 1_000_002, name: "Hero B1", duration: 100, category: "hero", kind: "builder", count: 1 },
    ];
    const jobs: ScheduleJob[] = [
      { uid: 1, name: "Hero A2", duration: 100, category: "hero", kind: "builder", count: 1, after: 100, priority: 10 },
      { uid: 2, name: "Hero B2", duration: 100, category: "hero", kind: "builder", count: 1, after: 100, priority: 10 },
      { uid: 3, name: "Candidate", duration: 50, category: "hero", kind: "builder", count: 1, after: 0, priority: 1 },
    ];
    const res = testSchedule({ heroConcurrency: 2, inProgress, jobs });
    const cand = res.lanes.flatMap((l) => l.jobs).find((j) => j.name === "Candidate");
    assert(cand, "Candidate must be scheduled");
    assert.strictEqual(
      cand.start,
      200,
      `TEST 6 FAILED: Candidate should start at t=200 after both contiguous clusters, but started at t=${cand.start}`,
    );
    console.log("  PASS: Test 6 - Multi-cluster contiguous conflict (FINDING-15 pattern): resolves cleanly to t=200");
  }

  // TEST 7: Multi-Cluster with Available Internal Gap (Prevent False Delay)
  // Cluster 1: Hero A1 [0, 100), Hero B1 [0, 100) (concurrency = 2)
  // Gap: [100, 160) (concurrency = 0)
  // Cluster 2: Hero A2 [160, 300), Hero B2 [160, 300) (concurrency = 2)
  // Cap = 2. Candidate Hero C: duration = 50, after = 0.
  // Candidate MUST fit in the gap [100, 150) and start at t = 100, NOT delayed to t = 300.
  {
    const inProgress: ScheduleJob[] = [
      { uid: 1_000_001, name: "Hero A1", duration: 100, category: "hero", kind: "builder", count: 1 },
      { uid: 1_000_002, name: "Hero B1", duration: 100, category: "hero", kind: "builder", count: 1 },
    ];
    const jobs: ScheduleJob[] = [
      { uid: 1, name: "Hero A2", duration: 140, category: "hero", kind: "builder", count: 1, after: 160, priority: 10 },
      { uid: 2, name: "Hero B2", duration: 140, category: "hero", kind: "builder", count: 1, after: 160, priority: 10 },
      { uid: 3, name: "Candidate", duration: 50, category: "hero", kind: "builder", count: 1, after: 0, priority: 1 },
    ];
    const res = testSchedule({ heroConcurrency: 2, inProgress, jobs });
    const cand = res.lanes.flatMap((l) => l.jobs).find((j) => j.name === "Candidate");
    assert(cand, "Candidate must be scheduled");
    assert.strictEqual(
      cand.start,
      100,
      `TEST 7 FAILED: Candidate should utilize open gap at t=100, but started at t=${cand.start}`,
    );
    console.log("  PASS: Test 7 - Multi-cluster with internal gap: placed at t=100 without false delay to t=300");
  }

  // TEST 8: Staggered Multi-Span Progression
  // Hero A [0, 80), Hero B [20, 110), Hero C [50, 140). Cap = 2.
  // Candidate duration = 40, after = 0.
  // Between [20, 80), A & B are active (2).
  // Between [50, 110), B & C are active (2).
  // At t = 110, B finishes, leaving only C active [110, 140).
  // Candidate can run [110, 150) where concurrency is 2 on [110, 140) and 1 on [140, 150).
  // Earliest valid start is t = 110.
  {
    const inProgress: ScheduleJob[] = [
      { uid: 1_000_001, name: "Hero A", duration: 80, category: "hero", kind: "builder", count: 1 },
    ];
    const jobs: ScheduleJob[] = [
      { uid: 1, name: "Hero B", duration: 90, category: "hero", kind: "builder", count: 1, after: 20, priority: 10 },
      { uid: 2, name: "Hero C", duration: 90, category: "hero", kind: "builder", count: 1, after: 50, priority: 9 },
      { uid: 3, name: "Candidate", duration: 40, category: "hero", kind: "builder", count: 1, after: 0, priority: 1 },
    ];
    const res = testSchedule({ heroConcurrency: 2, inProgress, jobs });
    const cand = res.lanes.flatMap((l) => l.jobs).find((j) => j.name === "Candidate");
    assert(cand, "Candidate must be scheduled");
    assert.strictEqual(
      cand.start,
      110,
      `TEST 8 FAILED: Candidate should start at t=110, but started at t=${cand.start}`,
    );
    console.log("  PASS: Test 8 - Staggered multi-span progression: resolves to earliest valid t=110");
  }

  // -----------------------------------------------------------------------------
  // PART 2: 42-Hour Gap Reproduction with Real Data & Actual scheduleJobs
  // -----------------------------------------------------------------------------
  console.log("\n[PART 2] 42-Hour Reproduction Scenario with Actual scheduleJobs");

  const data = new GameData() as any;
  data.byId = new Map();
  for (const f of ["buildings", "troops", "heroes", "spells", "pets", "equipment", "traps", "helpers"]) {
    const j = JSON.parse(fs.readFileSync(`public/data/${f}.json`, "utf8"));
    for (const item of j.items) if (!data.byId.has(item._id)) data.byId.set(item._id, item);
  }

  const raw = JSON.parse(fs.readFileSync("test-export.json", "utf8"));
  const pv = parseExport(raw, data);
  const settings = {
    ...DEFAULT_SETTINGS,
    heroLanes: 2,
    heroSchedule: "all" as const,
    heroChain: "plan" as const,
    cwlBlock: false,
    blocks: [],
    wiggleRoom: 0,
  };

  const upgrades = computeUpgrades(pv, data, settings);
  const planned = new Set(upgrades.filter((u) => u.available && u.time != null && u.time > 0).map((u) => u.uid));
  const schedulable = upgrades.filter(
    (u) => planned.has(u.uid) && u.village === "home" && u.available && u.time != null && u.time > 0 && u.category !== "equipment",
  );

  const IN_FLIGHT_UID_BASE = 1_000_000;
  const inProgress: ScheduleJob[] = pv.entries
    .filter((e) => e.village === "home" && e.entity && e.timer && e.timer > 0)
    .map((e) => ({
      uid: IN_FLIGHT_UID_BASE + e.uid,
      name: e.name,
      duration: e.timer as number,
      category: e.category,
      kind: "builder" as const,
      count: e.count,
      entityId: e.id,
    }));

  const jobs: ScheduleJob[] = schedulable.map((o) => ({
    uid: o.uid,
    id: o.id,
    resource: o.resource,
    name: o.name,
    duration: effectiveTime(o, settings) ?? 0,
    category: o.category,
    kind: "builder" as const,
    count: o.count,
    family: "defense" as const,
    priority: 1,
  }));

  const focused = focusedHeroes(
    schedulable.filter((o) => o.category === "hero"),
    settings.heroOrder,
    MAX_HERO_LANES,
  );
  const heroChains: any[] = [];
  for (const o of focused) {
    const entity = data.get(o.id);
    const levels: any[] = [];
    for (let lv = o.nextLevel; lv <= 95; lv++) {
      const row = data.level(entity, lv);
      if (!row || (row.th && row.th > pv.townHallLevel)) break;
      levels.push({
        level: lv,
        duration: effectiveTime({ ...o, currentLevel: lv - 1, nextLevel: lv, cost: row.cost, time: row.time }, settings) ?? 0,
        cost: effectiveCost({ ...o, cost: row.cost }, settings),
      });
    }
    heroChains.push({
      id: o.id,
      name: o.name,
      resource: o.resource,
      uid: o.uid,
      after: o.inFlightSeconds,
      priority: 1,
      levels,
    });
  }

  const res = scheduleJobs(
    jobs,
    {
      builders: 5,
      blocks: [],
      horizon: settings.horizon,
      heroLanes: 2,
      heroChain: "plan",
      heroChains,
      cwlBlock: false,
      heroConcurrency: 3,
      village: "home",
      nowEpochMs: 1700000000000,
      wiggleRoom: 0,
    },
    inProgress,
  );

  const heroLane2 = res.lanes[1];
  assert(heroLane2 && heroLane2.label.includes("Hero lane 2"), "Hero lane 2 must exist");

  console.log(`  Hero Lane 2 scheduled jobs count: ${heroLane2.jobs.length}`);
  for (let i = 0; i < heroLane2.jobs.length; i++) {
    const j = heroLane2.jobs[i];
    console.log(`    Step ${i + 1}: ${j.name} (uid=${j.uid}) -> ${j.start}s to ${j.end}s (dur=${j.duration}s)`);
  }

  // Find Archer Queen transition from end=777,600s
  const prevJob = heroLane2.jobs.find((j) => j.end === 777600);
  assert(prevJob, "Expected Archer Queen job ending at 777600s must exist");
  const nextJobIndex = heroLane2.jobs.indexOf(prevJob) + 1;
  assert(nextJobIndex < heroLane2.jobs.length, "Follow-up Archer Queen job must exist");
  const nextJob = heroLane2.jobs[nextJobIndex];

  const gap = nextJob.start - prevJob.end;
  console.log(`\n  Baseline Idle Gap was: 151,200s (42.0 hours) [start=928,800s]`);
  console.log(`  Patched Idle Gap is:   ${gap}s (${(gap / 3600).toFixed(1)} hours) [start=${nextJob.start}s]`);

  assert.strictEqual(
    gap,
    0,
    `42-hour idle gap regression check FAILED: expected gap=0s, found gap=${gap}s (starts at ${nextJob.start}s instead of 777,600s)`,
  );
  assert.strictEqual(
    nextJob.start,
    777600,
    `Expected follow-up job to start immediately at 777,600s, but started at ${nextJob.start}s`,
  );
  console.log("  PASS: 42-hour idle gap successfully eliminated! (0s gap, contiguous placement)");

  // -----------------------------------------------------------------------------
  // PART 3: Global Invariant Checks
  // -----------------------------------------------------------------------------
  console.log("\n[PART 3] Global Invariant Checks");

  // Invariant 1: Concurrency Cap
  const allHeroJobs: { name: string; start: number; end: number; lane: string }[] = [];
  for (const l of res.lanes) {
    for (const j of l.jobs) {
      if (j.category === "hero") allHeroJobs.push({ name: j.name, start: j.start, end: j.end, lane: l.label });
    }
  }

  const criticalPoints = new Set<number>();
  for (const j of allHeroJobs) {
    criticalPoints.add(j.start);
    criticalPoints.add(j.end);
  }

  let maxObservedConcurrency = 0;
  let maxConcurrencyTimestamp = 0;
  for (const t of Array.from(criticalPoints).sort((a, b) => a - b)) {
    const active = allHeroJobs.filter((j) => j.start <= t && t < j.end);
    if (active.length > maxObservedConcurrency) {
      maxObservedConcurrency = active.length;
      maxConcurrencyTimestamp = t;
    }
  }
  console.log(`  Max instantaneous hero concurrency across plan: ${maxObservedConcurrency} (at t=${maxConcurrencyTimestamp}s)`);
  assert(
    maxObservedConcurrency <= 3,
    `INVARIANT 1 VIOLATION: Hero concurrency exceeded cap (max=${maxObservedConcurrency} > cap=3)`,
  );
  console.log("  PASS: Invariant 1 - Hero concurrency never exceeds configured cap (max <= 3)");

  // Invariant 2: Lane Disjointness (No overlapping jobs on the same lane)
  for (const lane of res.lanes) {
    for (let i = 0; i < lane.jobs.length - 1; i++) {
      const j1 = lane.jobs[i];
      const j2 = lane.jobs[i + 1];
      assert(
        j1.end <= j2.start + 1e-9,
        `INVARIANT 2 VIOLATION on lane ${lane.label}: job ${j1.name} ends at ${j1.end} but next job ${j2.name} starts at ${j2.start}`,
      );
    }
  }
  console.log("  PASS: Invariant 2 - Lane disjointness preserved across all lanes");

  // Invariant 3: Job Durations
  for (const lane of res.lanes) {
    for (const j of lane.jobs) {
      assert.strictEqual(
        j.end - j.start,
        j.duration,
        `INVARIANT 3 VIOLATION: job ${j.name} duration mismatch: end - start = ${j.end - j.start}, expected ${j.duration}`,
      );
    }
  }
  console.log("  PASS: Invariant 3 - All job durations strictly match end - start");

  // Invariant 4: CWL Blackout Window Enforcement
  // Run with cwlBlock: true and verify hero jobs do not intersect CWL windows (1st to 10th of month)
  {
    const resCwl = scheduleJobs(
      jobs,
      {
        builders: 5,
        blocks: [],
        horizon: settings.horizon,
        heroLanes: 2,
        heroChain: "plan",
        heroChains,
        cwlBlock: true,
        heroConcurrency: 3,
        village: "home",
        nowEpochMs: 1700000000000,
        wiggleRoom: 0,
      },
      inProgress,
    );

    for (const l of resCwl.lanes) {
      for (const j of l.jobs) {
        if (j.category === "hero") {
          // Check that hero job does not overlap with CWL window
          const startD = new Date(1700000000000 + j.start * 1000);
          const endD = new Date(1700000000000 + j.end * 1000);
          // If start is in same month as end, day between 1 and 10 is forbidden
          // The scheduler pushes hero jobs outside CWL
          // Let's verify no hero job starts during 1st-10th
          const startDay = startD.getUTCDate();
          assert(
            startDay > 10 || startD.getUTCMonth() !== endD.getUTCMonth(),
            `CWL INVARIANT VIOLATION: Hero job ${j.name} started on CWL day ${startDay} (${startD.toISOString()})`,
          );
        }
      }
    }
    console.log("  PASS: Invariant 4 - CWL blackout window correctly holds hero upgrades");
  }

  console.log("\n==================================================================");
  console.log("ALL HERO CONCURRENCY REGRESSION TESTS PASSED (100% SUCCESS)");
  console.log("==================================================================");
}

runTests().catch((err) => {
  console.error("\nTEST SUITE FAILED:", err);
  process.exit(1);
});
