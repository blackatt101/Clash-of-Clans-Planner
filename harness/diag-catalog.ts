import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { computeUpgrades } from "../src/lib/upgrade";
import { GEAR_UPS, gearUpInFlight, hideGearUpHomeRow } from "../src/lib/bbRush";
import { readFileSync } from "fs";

async function main() {
  const data = new GameData() as any;
  data.byId = new Map();
  for (const f of ["buildings","troops","heroes","spells","pets","equipment","traps","helpers"]) {
    const j = JSON.parse(readFileSync(`/root/coc-planner/public/data/${f}.json`, "utf8"));
    for (const item of j.items) if (!data.byId.has(item._id)) data.byId.set(item._id, item);
  }
  const raw = JSON.parse(readFileSync("/tmp/user-export.json", "utf8"));
  const parsed = parseExport(raw, data);
  const settings = { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any;

  const all = computeUpgrades(parsed, data);
  const archerHv = all.filter((o) => o.id === 1000009 && o.village === "home");
  console.log("=== HH Archer (1000009) catalogue rows ===");
  for (const o of archerHv) {
    const hidden = hideGearUpHomeRow(o, parsed.entries, settings);
    const gearUpInFlight_ = GEAR_UPS.some((g) => g.hvId === 1000009 && gearUpInFlight(parsed.entries, g));
    console.log(`  uid=${o.uid} ${o.currentLevel}→${o.nextLevel} timer=${o.inProgress ?? "-"}s available=${o.available} hideHome=${hidden} (inFlight=${gearUpInFlight_})`);
  }
  // Which rows would be visible in HH planner (activeOptions)?
  const visible = archerHv.filter((o) => !hideGearUpHomeRow(o, parsed.entries, settings));
  console.log(`\nHH Archer rows visible in planner: ${visible.length}`);
  for (const o of visible) console.log(`  "${o.name}" ${o.currentLevel}→${o.nextLevel} (inProgress ${o.inProgress ?? 0}s)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
