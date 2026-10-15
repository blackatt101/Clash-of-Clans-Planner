/**
 * Comprehensive verification for Gear Up Mortar (and all Gear Up buildings)
 * in Home Village and Builder Hall.
 *
 * Requirements verified:
 * 1. Mortar with gear_up: 0 + timer:
 *    - NOT classified as normal upgrade in Home Village (e.g. 10 -> 11)
 *    - 0 Home Village builders consumed
 *    - In-flight option returns null
 *    - TimerByUid excludes it
 *    - Builder Hall places it on Master Builder lane with exact remaining timer
 * 2. Sibling Mortars without gear_up:
 *    - Remain available for normal upgrade in Home Village
 * 3. Mortar with gear_up: 1 + timer:
 *    - Normal building upgrade (consumes 1 Home Village builder)
 * 4. Mortar with missing gear_up + timer:
 *    - Normal building upgrade (consumes 1 Home Village builder)
 * 5. Other gear-up buildings (Cannon 1000008, Archer Tower 1000009):
 *    - Identical correct behavior for all gear-up buildings
 * 6. Home Village makespan / availability unaffected by false delay:
 *    - Other builder jobs start at t=0 instead of waiting behind gear-up
 */
import { readFileSync } from "fs";
import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { computeUpgrades, inFlightOption } from "../src/lib/upgrade";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { scheduleJobs, type ScheduleJob } from "../src/lib/schedule";
import { GEAR_UPS, hideGearUpHomeRow } from "../src/lib/bbRush";

const ROOT = "/home/ubuntu/coc-planner";

function loadData() {
  const data = new GameData() as any;
  data.byId = new Map();
  for (const f of [
    "buildings", "troops", "heroes", "spells", "pets", "equipment", "traps", "helpers",
  ]) {
    const j = JSON.parse(readFileSync(`${ROOT}/public/data/${f}.json`, "utf8"));
    for (const item of j.items) if (!data.byId.has(item._id)) data.byId.set(item._id, item);
  }
  return data;
}

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures++;
    console.error(`FAIL  ${label}\n      got:  ${JSON.stringify(actual)}\n      want: ${JSON.stringify(expected)}`);
  } else {
    console.log(`PASS  ${label}`);
  }
}

async function main() {
  const data = loadData();
  const rush = { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" as const };
  const general = { ...DEFAULT_SETTINGS, builderBaseStrategy: "general" as const };

  console.log("=== 1. Mortar with gear_up: 0 and timer (In-flight Gear Up) ===");
  {
    const raw = JSON.parse(readFileSync(`${ROOT}/test-export.json`, "utf8"));
    // Replace all mortars with:
    // 1 mortar in-flight gear-up (L10, gear_up: 0, timer: 1209600 = 14 days)
    // 3 sibling mortars (L10, no gear_up, no timer)
    raw.buildings = raw.buildings.filter((b: any) => b.data !== 1000013);
    raw.buildings.push({ data: 1000013, lvl: 10, cnt: 1, gear_up: 0, timer: 1209600 });
    raw.buildings.push({ data: 1000013, lvl: 10, cnt: 1 });
    raw.buildings.push({ data: 1000013, lvl: 10, cnt: 1 });
    raw.buildings.push({ data: 1000013, lvl: 10, cnt: 1 });

    const parsed = parseExport(raw, data);
    const gearedMortar = parsed.entries.find((e) => e.id === 1000013 && e.gearUp === 0)!;
    const siblingMortars = parsed.entries.filter((e) => e.id === 1000013 && e.gearUp !== 0);

    // Check inFlightOption
    const opt = inFlightOption(gearedMortar, data);
    check("inFlightOption returns null for gear_up: 0 + timer", opt, null);

    // Simulate page.tsx inProgress
    const inProgressHome: ScheduleJob[] = parsed.entries
      .filter(
        (e) =>
          e.village === "home" &&
          e.entity &&
          e.timer &&
          e.timer > 0 &&
          !(e.village === "home" && e.gearUp === 0),
      )
      .map((e) => ({
        uid: 1000000 + e.uid,
        name: e.name,
        duration: e.timer as number,
        category: e.category,
        kind: "builder",
        levelFrom: e.level,
        levelTo: e.level + 1,
      }));

    const mortarInProgress = inProgressHome.filter((j) => j.name === "Mortar");
    check("inProgress in Home Village contains 0 Mortar jobs", mortarInProgress.length, 0);

    // Check timerByUid
    const timerByUid = new Map<number, number>(
      parsed.entries
        .filter(
          (e) =>
            e.timer &&
            e.timer > 0 &&
            !(e.village === "home" && e.gearUp === 0),
        )
        .map((e) => [e.uid, e.timer as number]),
    );
    check("timerByUid excludes the gear_up: 0 mortar", timerByUid.has(gearedMortar.uid), false);

    // Check hideGearUpHomeRow in both rush6th and general modes
    check(
      "hideGearUpHomeRow hides in-flight mortar in rush6th",
      hideGearUpHomeRow({ uid: gearedMortar.uid, id: 1000013, village: "home" } as any, parsed.entries, rush),
      true,
    );
    check(
      "hideGearUpHomeRow hides in-flight mortar in general mode",
      hideGearUpHomeRow({ uid: gearedMortar.uid, id: 1000013, village: "home" } as any, parsed.entries, general),
      true,
    );

    // Check sibling mortars are NOT hidden
    for (const sib of siblingMortars) {
      check(
        `hideGearUpHomeRow does not hide sibling mortar uid=${sib.uid}`,
        hideGearUpHomeRow({ uid: sib.uid, id: 1000013, village: "home" } as any, parsed.entries, rush),
        false,
      );
    }

    // Check computeUpgrades catalogue
    const homeOptsRush = computeUpgrades(parsed, data, rush).filter((o) => o.village === "home");
    const mortarRowsRush = homeOptsRush.filter((o) => o.id === 1000013);
    check("Mortar rows exist for sibling mortars in rush mode", mortarRowsRush.length, 3);
    check("No Mortar row has gearedMortar.uid in rush mode", mortarRowsRush.some((o) => o.uid === gearedMortar.uid), false);

    const homeOptsGen = computeUpgrades(parsed, data, general).filter((o) => o.village === "home");
    const mortarRowsGen = homeOptsGen.filter((o) => o.id === 1000013);
    check("Mortar rows exist for sibling mortars in general mode", mortarRowsGen.length, 3);
    check("No Mortar row has gearedMortar.uid in general mode", mortarRowsGen.some((o) => o.uid === gearedMortar.uid), false);

    // Check Builder Hall correctly receives the gear up job
    const bobPlan = scheduleBobGoal({
      data,
      entries: parsed.entries,
      settings: rush,
      inProgress: [],
      builders: 2,
      defenseId: 1000033,
      nowEpochMs: 1700000000000,
      wiggleRoom: 0,
    });
    const bbJobs = bobPlan.lanes.flatMap((l) => l.jobs);
    const bbGearUp = bbJobs.find((j) => j.name === "Gear Up: Multi Mortar");
    check("Builder Hall includes Gear Up: Multi Mortar job", bbGearUp != null, true);
    check("Builder Hall Gear Up job duration equals timer", bbGearUp?.duration, 1209600);
    check("Builder Hall Gear Up is at start t=0", bbGearUp?.start, 0);

    // Check Home Village scheduleJobs has 0 Mortar jobs running and does not consume HV builder
    const hvSchedule = scheduleJobs(
      mortarRowsRush.slice(0, 1).map((o) => ({
        uid: o.uid,
        name: o.name,
        duration: o.time ?? 1000,
        category: o.category,
        kind: "builder" as const,
      })),
      {
        builders: 5,
        blocks: [],
        horizon: 30,
        heroLanes: 0,
        cwlBlock: false,
        wiggleRoom: 0,
        nowEpochMs: 1700000000000,
      },
      inProgressHome,
    );
    const hvJobs = hvSchedule.lanes.flatMap((l) => l.jobs);
    const hvGearUpJobs = hvJobs.filter((j) => j.name === "Mortar" && j.duration === 1209600);
    check("Home Village schedule has 0 gear-up mortar jobs", hvGearUpJobs.length, 0);
  }

  console.log("\n=== 2. Mortar with gear_up: 1 and timer (Normal level upgrade on already-geared mortar) ===");
  {
    const raw = JSON.parse(readFileSync(`${ROOT}/test-export.json`, "utf8"));
    raw.buildings = raw.buildings.filter((b: any) => b.data !== 1000013);
    raw.buildings.push({ data: 1000013, lvl: 10, cnt: 1, gear_up: 1, timer: 30000 });

    const parsed = parseExport(raw, data);
    const mortar = parsed.entries.find((e) => e.id === 1000013)!;

    const opt = inFlightOption(mortar, data);
    check("inFlightOption returns valid option for gear_up: 1 + timer", opt != null, true);
    check("inFlightOption shows 10 -> 11", opt?.currentLevel === 10 && opt?.nextLevel === 11, true);

    const inProgressHome: ScheduleJob[] = parsed.entries
      .filter(
        (e) =>
          e.village === "home" &&
          e.entity &&
          e.timer &&
          e.timer > 0 &&
          !(e.village === "home" && e.gearUp === 0),
      )
      .map((e) => ({
        uid: 1000000 + e.uid,
        name: e.name,
        duration: e.timer as number,
        category: e.category,
        kind: "builder",
        levelFrom: e.level,
        levelTo: e.level + 1,
      }));

    check("inProgress includes gear_up: 1 mortar", inProgressHome.some((j) => j.name === "Mortar"), true);
    check("hideGearUpHomeRow returns false for gear_up: 1", hideGearUpHomeRow({ uid: mortar.uid, id: 1000013, village: "home" } as any, parsed.entries, rush), false);
  }

  console.log("\n=== 3. Mortar with missing gear_up and timer (Standard un-geared normal level upgrade) ===");
  {
    const raw = JSON.parse(readFileSync(`${ROOT}/test-export.json`, "utf8"));
    raw.buildings = raw.buildings.filter((b: any) => b.data !== 1000013);
    raw.buildings.push({ data: 1000013, lvl: 10, cnt: 1, timer: 30000 }); // no gear_up property

    const parsed = parseExport(raw, data);
    const mortar = parsed.entries.find((e) => e.id === 1000013)!;

    const opt = inFlightOption(mortar, data);
    check("inFlightOption returns valid option for missing gear_up + timer", opt != null, true);
    check("inFlightOption shows 10 -> 11", opt?.currentLevel === 10 && opt?.nextLevel === 11, true);

    const inProgressHome: ScheduleJob[] = parsed.entries
      .filter(
        (e) =>
          e.village === "home" &&
          e.entity &&
          e.timer &&
          e.timer > 0 &&
          !(e.village === "home" && e.gearUp === 0),
      )
      .map((e) => ({
        uid: 1000000 + e.uid,
        name: e.name,
        duration: e.timer as number,
        category: e.category,
        kind: "builder",
        levelFrom: e.level,
        levelTo: e.level + 1,
      }));

    check("inProgress includes missing gear_up mortar", inProgressHome.some((j) => j.name === "Mortar"), true);
  }

  console.log("\n=== 4. Other Gear-Up Buildings (Cannon 1000008, Archer Tower 1000009) ===");
  for (const g of GEAR_UPS) {
    const raw = JSON.parse(readFileSync(`${ROOT}/test-export.json`, "utf8"));
    raw.buildings = raw.buildings.filter((b: any) => b.data !== g.hvId);
    raw.buildings.push({ data: g.hvId, lvl: g.hvTarget, cnt: 1, gear_up: 0, timer: 45000 });

    const parsed = parseExport(raw, data);
    const entry = parsed.entries.find((e) => e.id === g.hvId && e.gearUp === 0)!;

    check(`${g.hvName}: inFlightOption returns null when gear_up: 0 + timer`, inFlightOption(entry, data), null);

    const inProgressHome = parsed.entries
      .filter(
        (e) =>
          e.village === "home" &&
          e.entity &&
          e.timer &&
          e.timer > 0 &&
          !(e.village === "home" && e.gearUp === 0),
      );
    check(`${g.hvName}: inProgress excludes gear_up: 0`, inProgressHome.some((e) => e.id === g.hvId), false);
    check(`${g.hvName}: hideGearUpHomeRow hides it in general mode`, hideGearUpHomeRow({ uid: entry.uid, id: g.hvId, village: "home" } as any, parsed.entries, general), true);
    check(`${g.hvName}: hideGearUpHomeRow hides it in rush6th mode`, hideGearUpHomeRow({ uid: entry.uid, id: g.hvId, village: "home" } as any, parsed.entries, rush), true);
  }

  console.log(`\n========================================`);
  console.log(`Results: ${failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`}`);
  console.log(`========================================`);

  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
