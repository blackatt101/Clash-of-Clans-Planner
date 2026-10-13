/**
 * Scenario tests for the gear-up home row rule:
 *
 *  - rush6th + gear-up outstanding  → only the flagged building instance is hidden;
 *    other buildings of the same type stay visible (the Builder Base plan
 *    carries the gear-up: checklist row + the Master Builder's trip)
 *  - rush6th + gear-up settled      → flagged row returns (building is a defence again)
 *  - general mode                   → rows always show (no gear-up plan)
 */
import { readFileSync } from "fs";
import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { computeUpgrades } from "../src/lib/upgrade";
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

/** Deep-copy the test export and set gear_up on specific building entries by data ID. */
function exportWith(flags: Record<string, number | null>) {
  const raw = JSON.parse(readFileSync(`${ROOT}/test-export.json`, "utf8"));
  for (const b of raw.buildings) {
    for (const [id, v] of Object.entries(flags)) {
      if (b.data === Number(id)) {
        if (v === null) delete b.gear_up;
        else b.gear_up = v;
      }
    }
  }
  return raw;
}

/**
 * Like exportWith but only sets the flag on the first N entries matching a given
 * data ID, leaving the rest untouched. This lets us test per-instance behavior
 * when a building type has multiple instances (e.g. 5 Cannons, one geared up).
 */
function exportWithFirstN(flags: Record<string, { value: number | null; count: number }>) {
  const raw = JSON.parse(readFileSync(`${ROOT}/test-export.json`, "utf8"));
  for (const [idStr, { value, count }] of Object.entries(flags)) {
    const id = Number(idStr);
    let set = 0;
    for (const b of raw.buildings) {
      if (b.data === id) {
        if (set < count) {
          if (value === null) delete b.gear_up;
          else b.gear_up = value;
          set++;
        } else {
          delete b.gear_up; // ensure the rest have no flag
        }
      }
    }
  }
  return raw;
}

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

async function main() {
  const data = loadData();
  const rush = { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" as const };
  const general = { ...DEFAULT_SETTINGS, builderBaseStrategy: "general" as const };

  // The test export has Cannon (1000008) with 2 entries — one normally flagged
  // gear_up:1, one without. We rewrite flags per scenario below.

  // Scenario 1: rush6th, gear-up outstanding on the first Cannon entry only.
  // Only the flagged instance should be hidden; the other Cannon entry stays.
  {
    const parsed = parseExport(exportWithFirstN({
      1000008: { value: 0, count: 1 }, // flag only the first cannon
      1000009: { value: 0, count: 1 }, // flag the only Archer Tower
      1000013: { value: 0, count: 1 }, // flag the only Mortar
    }), data);
    const home = computeUpgrades(parsed, data, rush).filter((o) => o.village === "home");

    // Cannon: 2 entries in the export. The flagged one (gear_up:0) should be
    // hidden by computeUpgrades, so it won't appear in the home catalogue at all.
    // The unflagged one should be visible.
    const cannonRows = home.filter((o) => o.id === 1000008);
    check("rush+outstanding: Cannon rows exist (>= 1)", cannonRows.length > 0, true);

    const flaggedEntry = parsed.entries.find((e) => e.village === "home" && e.id === 1000008 && e.gearUp === 0);
    const unflaggedEntry = parsed.entries.find((e) => e.village === "home" && e.id === 1000008 && e.gearUp == null);
    check("rush+outstanding: flagged Cannon entry exists in export", !!flaggedEntry, true);
    check("rush+outstanding: unflagged Cannon entry exists in export", !!unflaggedEntry, true);

    // The flagged entry's row should be filtered out by computeUpgrades (hidden).
    if (flaggedEntry) {
      const flaggedRow = cannonRows.find((o) => o.uid === flaggedEntry.uid);
      check("rush+outstanding: flagged Cannon row removed from catalogue", !flaggedRow, true);
    }
    // The unflagged entry's row should be present (not hidden).
    if (unflaggedEntry) {
      const unflaggedRow = cannonRows.find((o) => o.uid === unflaggedEntry.uid);
      check("rush+outstanding: unflagged Cannon row present in catalogue", !!unflaggedRow, true);
      check("rush+outstanding: unflagged Cannon row is visible",
        unflaggedRow ? hideGearUpHomeRow(unflaggedRow, parsed.entries, rush) : null, false);
    }

    // Archer Tower and Mortar: single entries each, both flagged → hidden.
    // Compute without settings to get the raw rows, then verify they'd be hidden.
    const rawHome = computeUpgrades(parsed, data).filter((o) => o.village === "home");
    for (const g of GEAR_UPS.filter((g) => g.hvId !== 1000008)) {
      const rows = rawHome.filter((o) => o.id === g.hvId);
      check(
        `rush+outstanding: ${g.hvName} rows exist without settings`,
        rows.length > 0,
        true,
      );
      check(
        `rush+outstanding: ${g.hvName} rows hidden (flagged instance)`,
        rows.filter((o) => hideGearUpHomeRow(o, parsed.entries, rush)).length,
        rows.length,
      );
      // And they should NOT appear in the with-settings catalogue.
      check(
        `rush+outstanding: ${g.hvName} not in with-settings catalogue`,
        home.filter((o) => o.id === g.hvId).length,
        0,
      );
    }
  }

  // Scenario 2: rush6th, gear-up settled (gear_up=1) on all Gear-Up buildings.
  // All rows should be visible.
  {
    const parsed = parseExport(exportWith({ 1000008: 1, 1000009: 1, 1000013: 1 }), data);
    const home = computeUpgrades(parsed, data, rush).filter((o) => o.village === "home");
    for (const g of GEAR_UPS) {
      const rows = home.filter((o) => o.id === g.hvId);
      check(
        `rush+settled: all ${g.hvName} rows visible`,
        rows.filter((o) => hideGearUpHomeRow(o, parsed.entries, rush)).length,
        0,
      );
    }
  }

  // Scenario 3: general mode — gear-up buildings are ordinary defences.
  {
    const parsed = parseExport(exportWith({ 1000008: 0, 1000009: 0, 1000013: 0 }), data);
    const home = computeUpgrades(parsed, data, general).filter((o) => o.village === "home");
    for (const g of GEAR_UPS) {
      const rows = home.filter((o) => o.id === g.hvId);
      check(
        `general: ${g.hvName} rows show (not hidden)`,
        rows.filter((o) => hideGearUpHomeRow(o, parsed.entries, general)).length,
        0,
      );
    }
  }

  // Scenario 4: rush6th, outstanding gear-up, BB catalogue untouched.
  {
    const parsed = parseExport(exportWith({ 1000008: 0, 1000009: 0, 1000013: 0 }), data);
    const bb = computeUpgrades(parsed, data, rush).filter((o) => o.village === "builderBase");
    for (const g of GEAR_UPS) {
      check(
        `rush+outstanding: BB rows kept for ${g.label}`,
        bb.filter((o) => o.id === g.bbId).length > 0,
        true,
      );
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll gear-up home-row scenarios pass");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
