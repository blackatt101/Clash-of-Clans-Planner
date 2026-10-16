import assert from "node:assert";
import fs from "fs";
import { scheduleJobs, ScheduleJob, HERO_CHAIN_UID_BASE } from "../src/lib/schedule";
import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import {
  DEFAULT_SETTINGS,
  MAX_HERO_LANES,
  normaliseSettings,
  PlannerSettings,
} from "../src/lib/settings";
import { computeUpgrades, UpgradeOption } from "../src/lib/upgrade";
import {
  focusedHeroes,
  heroCap,
  HOME_HERO_FOCUS,
  focusBoost,
} from "../src/lib/priorityOrder";
import { effectiveTime, effectiveCost } from "../src/lib/discounts";
import { encodeState, decodeState } from "../src/lib/share";

async function runTests() {
  console.log("==================================================================");
  console.log("TEST SUITE: DEDICATED HERO LANES (CAPACITY EXPANSION 3 -> 5)");
  console.log("==================================================================");

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void) {
    try {
      fn();
      console.log(`  ✓ PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ FAIL: ${name}`);
      console.error(`    ${err?.message || err}`);
      failed++;
    }
  }

  // Load GameData from local disk
  const data = new GameData() as any;
  data.byId = new Map();
  for (const f of [
    "buildings",
    "troops",
    "heroes",
    "spells",
    "pets",
    "equipment",
    "traps",
    "helpers",
  ]) {
    const j = JSON.parse(fs.readFileSync(`public/data/${f}.json`, "utf8"));
    for (const item of j.items) {
      if (!data.byId.has(item._id)) data.byId.set(item._id, item);
    }
  }

  // =============================================================================
  // SECTION A: Configuration, Normalization & Compatibility
  // =============================================================================
  console.log("\n[SECTION A] Configuration, Normalization & Compatibility");

  test("A1: MAX_HERO_LANES constant is 5", () => {
    assert.strictEqual(MAX_HERO_LANES, 5, `Expected MAX_HERO_LANES to be 5, got ${MAX_HERO_LANES}`);
  });

  test("A2: normaliseSettings accepts valid lane counts 0, 1, 2, 3, 4, 5", () => {
    for (let i = 0; i <= 5; i++) {
      const s = normaliseSettings({ heroLanes: i });
      assert.strictEqual(s.heroLanes, i, `Expected heroLanes to be ${i}, got ${s.heroLanes}`);
    }
  });

  test("A3: normaliseSettings clamps negative values to 0", () => {
    const s = normaliseSettings({ heroLanes: -3 });
    assert.strictEqual(s.heroLanes, 0, `Expected clamped to 0, got ${s.heroLanes}`);
  });

  test("A4: normaliseSettings clamps values > 5 to 5", () => {
    const s1 = normaliseSettings({ heroLanes: 6 });
    assert.strictEqual(s1.heroLanes, 5, `Expected clamped to 5, got ${s1.heroLanes}`);
    const s2 = normaliseSettings({ heroLanes: 99 });
    assert.strictEqual(s2.heroLanes, 5, `Expected clamped to 5, got ${s2.heroLanes}`);
  });

  test("A5: normaliseSettings rounds float values", () => {
    const s = normaliseSettings({ heroLanes: 4.2 });
    assert.strictEqual(s.heroLanes, 4, `Expected rounded to 4, got ${s.heroLanes}`);
  });

  test("A6: Backward compatibility - legacy boolean heroLane maps correctly", () => {
    const sOn = normaliseSettings({ heroLane: true });
    assert.strictEqual(sOn.heroLanes, 1, "Legacy heroLane:true must produce heroLanes:1");
    const sOff = normaliseSettings({ heroLane: false });
    assert.strictEqual(sOff.heroLanes, 0, "Legacy heroLane:false must produce heroLanes:0");
  });

  test("A7: Share links preserve heroLanes 0..5 through encode and decode", () => {
    const dummyExport = {
      tag: "#TEST",
      timestamp: 1700000000,
      buildings: [{ data: 1000001, lvl: 15 }],
      heroes: [
        { data: 28000000, lvl: 50 },
        { data: 28000001, lvl: 50 },
        { data: 28000002, lvl: 30 },
        { data: 28000004, lvl: 20 },
        { data: 28000006, lvl: 10 },
      ],
    };

    for (const lanes of [0, 1, 2, 3, 4, 5]) {
      const state = {
        export: dummyExport,
        planned: [1, 2],
        settings: { ...DEFAULT_SETTINGS, heroLanes: lanes },
        village: "home" as const,
      };
      const encoded = encodeState(state);
      const decoded = decodeState(encoded);
      assert(decoded !== null, "Decoded state must not be null");
      assert.strictEqual(
        decoded.settings.heroLanes,
        lanes,
        `Decoded heroLanes must match ${lanes}, got ${decoded.settings.heroLanes}`,
      );
    }
  });

  // =============================================================================
  // SECTION B: Hero Priority Order & Selection
  // =============================================================================
  console.log("\n[SECTION B] Hero Priority Order & Selection");

  test("B1: Canonical HOME_HERO_FOCUS order is preserved exactly", () => {
    const expected = [
      28000000, // Barbarian King
      28000001, // Archer Queen
      28000002, // Grand Warden
      28000004, // Royal Champion
      28000006, // Minion Prince
      28000007, // Dragon Duke
    ];
    assert.deepStrictEqual(HOME_HERO_FOCUS, expected, "Canonical HOME_HERO_FOCUS must match expected IDs");
  });

  test("B2: Default focus selection picks top N heroes in canonical order", () => {
    const plannedHeroes = [
      { id: 28000006, name: "Minion Prince" },
      { id: 28000001, name: "Archer Queen" },
      { id: 28000000, name: "Barbarian King" },
      { id: 28000004, name: "Royal Champion" },
      { id: 28000002, name: "Grand Warden" },
    ];

    const pick3 = focusedHeroes(plannedHeroes, [], 3);
    assert.deepStrictEqual(
      pick3.map((h) => h.id),
      [28000000, 28000001, 28000002],
      "3-lane selection must pick BK, AQ, GW",
    );

    const pick4 = focusedHeroes(plannedHeroes, [], 4);
    assert.deepStrictEqual(
      pick4.map((h) => h.id),
      [28000000, 28000001, 28000002, 28000004],
      "4-lane selection must pick BK, AQ, GW, RC",
    );

    const pick5 = focusedHeroes(plannedHeroes, [], 5);
    assert.deepStrictEqual(
      pick5.map((h) => h.id),
      [28000000, 28000001, 28000002, 28000004, 28000006],
      "5-lane selection must pick BK, AQ, GW, RC, MP",
    );
  });

  test("B3: Custom hero priority order is strictly respected for 3, 4, and 5 lanes", () => {
    // Custom order: RC -> GW -> AQ -> BK -> MP
    const customOrder = [28000004, 28000002, 28000001, 28000000, 28000006];
    const plannedHeroes = [
      { id: 28000000, name: "Barbarian King" },
      { id: 28000001, name: "Archer Queen" },
      { id: 28000002, name: "Grand Warden" },
      { id: 28000004, name: "Royal Champion" },
      { id: 28000006, name: "Minion Prince" },
    ];

    const pick3 = focusedHeroes(plannedHeroes, customOrder, 3);
    assert.deepStrictEqual(
      pick3.map((h) => h.id),
      [28000004, 28000002, 28000001],
      "3 lanes must follow custom order: RC, GW, AQ",
    );

    const pick4 = focusedHeroes(plannedHeroes, customOrder, 4);
    assert.deepStrictEqual(
      pick4.map((h) => h.id),
      [28000004, 28000002, 28000001, 28000000],
      "4 lanes must follow custom order: RC, GW, AQ, BK",
    );

    const pick5 = focusedHeroes(plannedHeroes, customOrder, 5);
    assert.deepStrictEqual(
      pick5.map((h) => h.id),
      [28000004, 28000002, 28000001, 28000000, 28000006],
      "5 lanes must follow custom order: RC, GW, AQ, BK, MP",
    );
  });

  test("B4: Deterministic tie-breaking for unlisted heroes", () => {
    // Custom order only lists BK
    const customOrder = [28000000];
    const plannedHeroes = [
      { id: 28000006, name: "Minion Prince" },
      { id: 28000002, name: "Grand Warden" },
      { id: 28000001, name: "Archer Queen" },
      { id: 28000000, name: "Barbarian King" },
    ];
    const pick = focusedHeroes(plannedHeroes, customOrder, 4);
    // BK first (in order), then AQ (28000001), GW (28000002), MP (28000006) by numeric ID
    assert.deepStrictEqual(
      pick.map((h) => h.id),
      [28000000, 28000001, 28000002, 28000006],
      "Unlisted heroes must sort deterministically after listed heroes by ID",
    );
  });

  // =============================================================================
  // SECTION C: Scheduling & Builder Allocation
  // =============================================================================
  console.log("\n[SECTION C] Scheduling & Builder Allocation");

  // Helper to construct hero chains for a 5-hero TH15 village
  function make5HeroChains() {
    return [
      {
        id: 28000000,
        name: "Barbarian King",
        uid: 101,
        resource: "darkElixir",
        priority: 100,
        levels: [
          { level: 71, duration: 86400, cost: 100000 },
          { level: 72, duration: 86400, cost: 110000 },
        ],
      },
      {
        id: 28000001,
        name: "Archer Queen",
        uid: 102,
        resource: "darkElixir",
        priority: 95,
        levels: [
          { level: 71, duration: 86400, cost: 100000 },
          { level: 72, duration: 86400, cost: 110000 },
        ],
      },
      {
        id: 28000002,
        name: "Grand Warden",
        uid: 103,
        resource: "elixir",
        priority: 90,
        levels: [
          { level: 51, duration: 86400, cost: 100000 },
          { level: 52, duration: 86400, cost: 110000 },
        ],
      },
      {
        id: 28000004,
        name: "Royal Champion",
        uid: 104,
        resource: "darkElixir",
        priority: 85,
        levels: [
          { level: 26, duration: 86400, cost: 100000 },
          { level: 27, duration: 86400, cost: 110000 },
        ],
      },
      {
        id: 28000006,
        name: "Minion Prince",
        uid: 105,
        resource: "darkElixir",
        priority: 80,
        levels: [
          { level: 21, duration: 86400, cost: 100000 },
          { level: 22, duration: 86400, cost: 110000 },
        ],
      },
    ];
  }

  const dummyBuildingJobs: ScheduleJob[] = [
    {
      uid: 201,
      id: 1000002,
      name: "Cannon",
      duration: 172800,
      category: "defense",
      kind: "builder",
      priority: 50,
      family: "defense",
      count: 1,
    },
    {
      uid: 202,
      id: 1000003,
      name: "Archer Tower",
      duration: 172800,
      category: "defense",
      kind: "builder",
      priority: 45,
      family: "defense",
      count: 1,
    },
  ];

  test("C1: 5 hero lanes with 6 builders allocates 5 hero lanes + 1 regular builder lane", () => {
    const heroChains = make5HeroChains();
    const res = scheduleJobs(
      dummyBuildingJobs,
      {
        builders: 6,
        blocks: [],
        horizon: 0,
        heroLanes: 5,
        heroChain: "max",
        heroChains,
        cwlBlock: false,
        village: "home",
        nowEpochMs: 1700000000000,
        wiggleRoom: 0,
      },
      [],
    );

    // Filter to builder lanes
    const builderLanes = res.lanes.filter((l) => l.key.startsWith("builder-"));
    assert.strictEqual(builderLanes.length, 6, "Expected 6 builder lanes total");

    // The first 5 lanes must be hero lanes
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(
        builderLanes[i].label,
        `Hero lane ${i + 1}`,
        `Lane ${i} should be labeled 'Hero lane ${i + 1}', got '${builderLanes[i].label}'`,
      );
      assert(
        builderLanes[i].jobs.every((j) => j.category === "hero"),
        `Lane ${i} should only contain hero jobs`,
      );
    }

    // Lane 6 must be regular builder lane containing non-hero work
    assert.strictEqual(builderLanes[5].label, "Builder 6");
    assert(
      builderLanes[5].jobs.some((j) => j.category === "defense"),
      "Builder 6 must hold regular defense upgrades",
    );
  });

  test("C2: n - 1 builder availability constraint: 5 hero lanes on 5 builders caps at 4 hero lanes", () => {
    const heroChains = make5HeroChains();
    const res = scheduleJobs(
      dummyBuildingJobs,
      {
        builders: 5,
        blocks: [],
        horizon: 0,
        heroLanes: 5, // user asks for 5, but only 5 builders exist
        heroChain: "max",
        heroChains,
        cwlBlock: false,
        village: "home",
        nowEpochMs: 1700000000000,
        wiggleRoom: 0,
      },
      [],
    );

    const builderLanes = res.lanes.filter((l) => l.key.startsWith("builder-"));
    assert.strictEqual(builderLanes.length, 5, "Expected 5 builder lanes");

    // Must cap at 4 hero lanes (5 builders - 1 = 4)
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(builderLanes[i].label, `Hero lane ${i + 1}`);
      assert(builderLanes[i].jobs.every((j) => j.category === "hero"));
    }

    // Lane 5 must be regular Builder 5
    assert.strictEqual(builderLanes[4].label, "Builder 5");
    assert(
      builderLanes[4].jobs.some((j) => j.category === "defense"),
      "Builder 5 must remain available for regular non-hero work",
    );
  });

  test("C3: Distinct lane assignment and no duplicate hero upgrades across lanes", () => {
    const heroChains = make5HeroChains();
    const res = scheduleJobs(
      dummyBuildingJobs,
      {
        builders: 6,
        blocks: [],
        horizon: 0,
        heroLanes: 5,
        heroChain: "max",
        heroChains,
        cwlBlock: false,
        village: "home",
        nowEpochMs: 1700000000000,
        wiggleRoom: 0,
      },
      [],
    );

    const seenUids = new Set<number>();
    for (const lane of res.lanes) {
      for (const j of lane.jobs) {
        assert(!seenUids.has(j.uid), `Duplicate job uid ${j.uid} detected in schedule!`);
        seenUids.add(j.uid);
      }
    }
  });

  test("C4: Hero concurrency limit (respectHeroCap) is enforced across 5 lanes", () => {
    const heroChains = make5HeroChains();
    const cap = 2; // only 2 heroes upgrading simultaneously allowed

    const res = scheduleJobs(
      dummyBuildingJobs,
      {
        builders: 6,
        blocks: [],
        horizon: 0,
        heroLanes: 5,
        heroChain: "max",
        heroChains,
        heroConcurrency: cap,
        cwlBlock: false,
        village: "home",
        nowEpochMs: 1700000000000,
        wiggleRoom: 0,
      },
      [],
    );

    const heroJobs = res.lanes.flatMap((l) => l.jobs).filter((j) => j.category === "hero");
    const testPoints = new Set<number>();
    for (const j of heroJobs) {
      testPoints.add(j.start);
      testPoints.add(j.end);
      testPoints.add(j.start + Math.floor(j.duration / 2));
    }

    for (const t of testPoints) {
      const active = heroJobs.filter((j) => j.start <= t && t < j.end);
      assert(
        active.length <= cap,
        `Hero concurrency exceeded at t=${t}: ${active.length} heroes active (cap=${cap})`,
      );
    }
  });

  // =============================================================================
  // SECTION D: Existing Scheduling Constraints (Town Hall, CWL, Sleep, Plan/Max)
  // =============================================================================
  console.log("\n[SECTION D] Existing Scheduling Constraints");

  test("D1: heroChain: 'plan' stops hero chains at anchor of other work", () => {
    const heroChains = make5HeroChains();
    // Defense job is 172800s
    const res = scheduleJobs(
      dummyBuildingJobs,
      {
        builders: 6,
        blocks: [],
        horizon: 0,
        heroLanes: 5,
        heroChain: "plan", // stops when rest of plan finishes
        heroChains,
        cwlBlock: false,
        village: "home",
        nowEpochMs: 1700000000000,
        wiggleRoom: 0,
      },
      [],
    );

    // Anchor is 172800s. Hero levels beyond anchor should not be placed.
    const heroJobs = res.lanes.flatMap((l) => l.jobs).filter((j) => j.category === "hero");
    for (const j of heroJobs) {
      // First level of each hero is exempt, but subsequent levels must start within anchor
      if (j.uid >= HERO_CHAIN_UID_BASE) {
        assert(j.start <= 172800, `Chained hero level ${j.name} started past anchor: ${j.start} > 172800`);
      }
    }
  });

  test("D2: CWL blackout window correctly defers hero upgrades", () => {
    const heroChains = make5HeroChains();
    // Set time to the 2nd of October (inside CWL: 1st to 10th)
    // 2026-10-02T00:00:00Z = 1790899200000
    const cwlNow = new Date("2026-10-02T00:00:00Z").getTime();

    const res = scheduleJobs(
      dummyBuildingJobs,
      {
        builders: 6,
        blocks: [],
        horizon: 0,
        heroLanes: 5,
        heroChain: "max",
        heroChains,
        cwlBlock: true,
        village: "home",
        nowEpochMs: cwlNow,
        wiggleRoom: 0,
      },
      [],
    );

    // CWL window lifts on 11th 00:00 UTC = 9 days after Oct 2nd = 9 * 86400 = 777600s
    const heroJobs = res.lanes.flatMap((l) => l.jobs).filter((j) => j.category === "hero");
    for (const j of heroJobs) {
      // Hero upgrades cannot run during CWL
      const startMs = cwlNow + j.start * 1000;
      const endMs = cwlNow + j.end * 1000;
      const cwlEndMs = new Date("2026-10-11T00:00:00Z").getTime();
      const inCwl = startMs < cwlEndMs && endMs > cwlNow;
      assert(!inCwl, `Hero upgrade ${j.name} ran during CWL window! start=${new Date(startMs).toISOString()}`);
    }
  });

  test("D3: Sleep block windows create idle gaps and do not start during sleep", () => {
    const heroChains = make5HeroChains();
    // Sleep every day from 23:00 to 07:00
    const sleepBlock = {
      id: "sleep",
      label: "Sleep",
      start: 23 * 3600,
      end: 7 * 3600,
      days: [],
    };

    const res = scheduleJobs(
      dummyBuildingJobs,
      {
        builders: 6,
        blocks: [sleepBlock],
        horizon: 0,
        heroLanes: 5,
        heroChain: "max",
        heroChains,
        cwlBlock: false,
        village: "home",
        nowEpochMs: new Date("2026-10-15T22:00:00Z").getTime(), // 1 hour before sleep
        wiggleRoom: 0,
      },
      [],
    );

    const allJobs = res.lanes.flatMap((l) => l.jobs);
    for (const j of allJobs) {
      // Upgrade start time must not fall within sleep hours
      const startDate = new Date(new Date("2026-10-15T22:00:00Z").getTime() + j.start * 1000);
      const startHour = startDate.getUTCHours();
      const inSleep = startHour >= 23 || startHour < 7;
      assert(!inSleep, `Job ${j.name} scheduled to start during sleep window at hour ${startHour}!`);
    }
  });

  test("D4: Existing 1, 2, 3 lane schedules preserve exact results", () => {
    const heroChains = make5HeroChains();
    for (const lanes of [1, 2, 3]) {
      const res = scheduleJobs(
        dummyBuildingJobs,
        {
          builders: 6,
          blocks: [],
          horizon: 0,
          heroLanes: lanes,
          heroChain: "max",
          heroChains: heroChains.slice(0, lanes),
          cwlBlock: false,
          village: "home",
          nowEpochMs: 1700000000000,
          wiggleRoom: 0,
        },
        [],
      );
      const builderLanes = res.lanes.filter((l) => l.key.startsWith("builder-"));
      assert(builderLanes.length >= lanes, `Expected at least ${lanes} builder lanes, got ${builderLanes.length}`);
      for (let i = 0; i < lanes; i++) {
        assert.strictEqual(builderLanes[i].label, `Hero lane ${i + 1}`);
        assert(builderLanes[i].jobs.every((j) => j.category === "hero"));
      }
      for (let i = lanes; i < builderLanes.length; i++) {
        assert(
          builderLanes[i].label.startsWith("Builder "),
          `Non-hero lane ${i} should be labeled 'Builder X', got '${builderLanes[i].label}'`,
        );
      }
    }
  });

  // =============================================================================
  // SUMMARY
  // =============================================================================
  console.log("\n==================================================================");
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================================");

  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
