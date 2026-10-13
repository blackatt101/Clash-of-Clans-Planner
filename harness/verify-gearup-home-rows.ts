/**
 * Scenario tests for the gear-up Home Village rule:
 *
 *  - rush6th + gear-up outstanding  → the building's home rows are hidden
 *    (the Builder Base plan carries the gear-up: checklist row + the
 *    Master Builder's trip)
 *  - rush6th + gear-up settled      → rows return (the building is a
 *    normal defence again)
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

/** Deep-copy the test export with the gear_up flags rewritten per scenario. */
function exportWith(flags: Record<string, number>) {
  const raw = JSON.parse(readFileSync(`${ROOT}/test-export.json`, "utf8"));
  for (const b of raw.buildings) {
    for (const [id, v] of Object.entries(flags)) {
      if (b.data === Number(id)) b.gear_up = v;
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

  // Scenario 1: rush6th, all three gear-ups outstanding (gear_up=0).
  {
    const parsed = parseExport(exportWith({ 1000008: 0, 1000009: 0, 1000013: 0 }), data);
    const home = computeUpgrades(parsed, data, rush).filter((o) => o.village === "home");
    for (const g of GEAR_UPS) {
      check(
        `rush+outstanding: no home row for ${g.hvName}`,
        home.filter((o) => o.id === g.hvId).length,
        0,
      );
      const row = { id: g.hvId, village: "home" as const, currentLevel: g.hvTarget };
      check(`rush+outstanding: hideGearUpHomeRow(${g.hvName})`, hideGearUpHomeRow(row as any, parsed.entries, rush), true);
    }
  }

  // Scenario 2: rush6th, all three gear-ups settled (gear_up=1).
  {
    const parsed = parseExport(exportWith({ 1000008: 1, 1000009: 1, 1000013: 1 }), data);
    const home = computeUpgrades(parsed, data, rush).filter((o) => o.village === "home");
    for (const g of GEAR_UPS) {
      check(
        `rush+settled: home rows return for ${g.hvName}`,
        home.filter((o) => o.id === g.hvId).length > 0,
        true,
      );
      const row = { id: g.hvId, village: "home" as const, currentLevel: g.hvTarget };
      check(`rush+settled: hideGearUpHomeRow(${g.hvName})`, hideGearUpHomeRow(row as any, parsed.entries, rush), false);
    }
  }

  // Scenario 3: general mode — gear-up buildings are ordinary defences.
  {
    const parsed = parseExport(exportWith({ 1000008: 0, 1000009: 0, 1000013: 0 }), data);
    const home = computeUpgrades(parsed, data, general).filter((o) => o.village === "home");
    for (const g of GEAR_UPS) {
      check(
        `general: home rows show for ${g.hvName}`,
        home.filter((o) => o.id === g.hvId).length > 0,
        true,
      );
      const row = { id: g.hvId, village: "home" as const, currentLevel: g.hvTarget };
      check(`general: hideGearUpHomeRow(${g.hvName})`, hideGearUpHomeRow(row as any, parsed.entries, general), false);
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
