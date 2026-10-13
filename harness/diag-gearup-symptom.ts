/**
 * Reproduce the reported symptom: gear-up buildings showing in the Home
 * Village planner.
 *
 * Walks the same path the page does — parseExport → computeUpgrades(settings) →
 * the per-village filter — and prints every row the Home Village catalogue and
 * the Builder Base planner would show for the three gear-up HV buildings.
 */
import { readFileSync } from "fs";
import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { computeUpgrades } from "../src/lib/upgrade";
import {
  GEAR_UPS,
  gearUpSettled,
  gearUpInFlight,
  hasGearUpFlag,
  gearUpRemainingSeconds,
  hideGearUpHomeRow,
} from "../src/lib/bbRush";

const ROOT = "/home/ubuntu/coc-planner";

async function main() {
  const data = new GameData() as any;
  data.byId = new Map();
  for (const f of [
    "buildings", "troops", "heroes", "spells", "pets", "equipment", "traps", "helpers",
  ]) {
    const j = JSON.parse(readFileSync(`${ROOT}/public/data/${f}.json`, "utf8"));
    for (const item of j.items) if (!data.byId.has(item._id)) data.byId.set(item._id, item);
  }
  const raw = JSON.parse(readFileSync(`${ROOT}/test-export.json`, "utf8"));
  const parsed = parseExport(raw, data);
  const settings = { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" as const };

  console.log("=== export state ===");
  console.log(`hasGearUpFlag: ${hasGearUpFlag(parsed.entries)}`);
  for (const g of GEAR_UPS) {
    console.log(
      `${g.key}: hv=${g.hvId}(${g.hvName}) bb=${g.bbId} settled=${gearUpSettled(parsed.entries, g, hasGearUpFlag(parsed.entries))} inFlight=${gearUpInFlight(parsed.entries, g)} remaining=${gearUpRemainingSeconds(parsed.entries, g)}`,
    );
  }

  const withSettings = computeUpgrades(parsed, data, settings as any);
  const withoutSettings = computeUpgrades(parsed, data);

  console.log(`\n=== Home Village catalogue rows (page.tsx activeOptions) ===`);
  const homeRows = withSettings.filter((o) => o.village === "home");
  console.log(`total home rows: ${homeRows.length} (no-settings: ${withoutSettings.filter((o) => o.village === "home").length})`);
  for (const g of GEAR_UPS) {
    const rows = homeRows.filter((o) => o.id === g.hvId);
    console.log(`\n-- ${g.hvName} (${g.hvId}) — gear-up target L${g.hvTarget} --`);
    if (!rows.length) console.log("   (no row at all)");
    for (const o of rows) {
      console.log(
        `   uid=${o.uid} ${o.currentLevel}→${o.nextLevel} chain=${o.chain?.length ?? 0} avail=${o.available} hidden=${hideGearUpHomeRow(o, parsed.entries, settings)}`,
      );
    }
  }

  console.log(`\n=== Builder Base catalogue rows ===`);
  const bbRows = withSettings.filter((o) => o.village === "builderBase");
  for (const g of GEAR_UPS) {
    const rows = bbRows.filter((o) => o.id === g.bbId);
    console.log(`${g.key} bb building ${g.bbId}: ${rows.length} row(s)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});