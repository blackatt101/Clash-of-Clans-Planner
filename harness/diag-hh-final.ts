import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { computeUpgrades } from "../src/lib/upgrade";
import { GEAR_UPS, gearUpInFlight, gearUpSettled, hasGearUpFlag, hideGearUpHomeRow } from "../src/lib/bbRush";
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

  const hhArcher = all.filter((o) => o.id === 1000009 && o.village === "home");
  console.log(`HH Archer catalogue rows: ${hhArcher.length}`);
  for (const o of hhArcher) {
    const hidden = hideGearUpHomeRow(o, parsed.entries, settings);
    console.log(`  uid=${o.uid} ${o.currentLevel}→${o.nextLevel} available=${o.available} inFlight=${o.inFlightSeconds ?? 0}s hidden=${hidden}`);
  }
  const visible = hhArcher.filter((o) => !hideGearUpHomeRow(o, parsed.entries, settings));
  console.log(`\nHH Archer visible rows: ${visible.length}`);
  for (const o of visible) console.log(`  "${o.name}" ${o.currentLevel}→${o.nextLevel}`);

  // What in-flight bars does the HH timeline show for Archer?
  const inFlightBars = parsed.entries.filter((e) => e.village === "home" && e.id === 1000009 && e.timer && e.timer > 0);
  console.log(`\nHH Archer in-flight bars (from export timers): ${inFlightBars.length}`);
  for (const e of inFlightBars) console.log(`  uid=${e.uid} level=${e.level} timer=${e.timer}s extra=${e.extra ? "yes" : "no"}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
