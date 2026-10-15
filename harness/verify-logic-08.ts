import { readFileSync } from "node:fs";
import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { BB_DEFENSE_OPTIONS, GEAR_UPS } from "../src/lib/bbRush";
import assert from "node:assert";

const data = new GameData();
const raw = JSON.parse(readFileSync("./test-export.json", "utf8"));
const pv = parseExport(raw, data);

const settings = {
  ...DEFAULT_SETTINGS,
  builderBaseStrategy: "rush6th" as const,
};

console.log("=== LOGIC-08 Verification Harness ===");

// Test 1: Planned Gear-Up Trips carry gearUp metadata on UpgradeOption
{
  const testEntries = pv.entries.map((e) => {
    if (e.id === 1000008) return { ...e, level: 10, gearUp: 0, timer: 0 };
    if (e.id === 1000009) return { ...e, level: 10, gearUp: 0, timer: 0 };
    if (e.id === 1000013) return { ...e, level: 10, gearUp: 0, timer: 0 };
    return e;
  });

  const res = scheduleBobGoal({
    data,
    entries: testEntries,
    settings,
    inProgress: [],
    builders: 2,
    defenseId: BB_DEFENSE_OPTIONS[0].id,
    nowEpochMs: Date.now(),
    wiggleRoom: 0,
  });

  const gearJobs = res.lanes.flatMap((l) => l.jobs).filter((j) => j.name?.startsWith("Gear Up"));
  assert(gearJobs.length > 0, "Expected at least one planned gear up job");
  
  for (const j of gearJobs) {
    const opt = res.options.find((o) => o.uid === j.uid);
    assert(opt, `Option missing for planned gear up job ${j.uid}`);
    assert(opt.gearUp, `gearUp metadata missing on option ${j.uid}`);
    assert(opt.gearUp.label === j.name, `gearUp label mismatch: ${opt.gearUp.label} vs ${j.name}`);
    console.log(`PASS: Planned job uid=${j.uid} ("${j.name}") has gearUp badge metadata (${opt.gearUp.key})`);
  }
}

// Test 2: In-Flight Gear-Up Trips carry gearUp metadata on UpgradeOption
{
  const testEntries = pv.entries.map((e) => {
    if (e.id === 1000013 && e.village === "home") {
      return { ...e, level: 8, gearUp: 0, timer: 36000 };
    }
    return e;
  });

  const res = scheduleBobGoal({
    data,
    entries: testEntries,
    settings,
    inProgress: [],
    builders: 2,
    defenseId: BB_DEFENSE_OPTIONS[0].id,
    nowEpochMs: Date.now(),
    wiggleRoom: 0,
  });

  const inFlightGearJobs = res.lanes.flatMap((l) => l.jobs).filter((j) => j.name?.startsWith("Gear Up"));
  assert(inFlightGearJobs.length > 0, "Expected in-flight gear up job");

  for (const j of inFlightGearJobs) {
    const opt = res.options.find((o) => o.uid === j.uid);
    assert(opt, `Option missing for in-flight gear up job ${j.uid}`);
    assert(opt.gearUp, `gearUp metadata missing on in-flight option ${j.uid}`);
    assert(opt.gearUp.key === "mortar", `Expected mortar gear-up, got ${opt.gearUp.key}`);
    console.log(`PASS: In-flight job uid=${j.uid} ("${j.name}") has gearUp badge metadata (${opt.gearUp.key})`);
  }
}

console.log("\nALL LOGIC-08 ASSERTIONS PASSED!");
