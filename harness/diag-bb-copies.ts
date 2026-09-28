import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { computeUpgrades } from "../src/lib/upgrade";
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
  const all = computeUpgrades(parsed, data);
  const bbArcher = all.filter((o) => o.id === 1000048 && o.village === "builderBase");
  console.log(`BB Archer catalogue rows: ${bbArcher.length}`);
  for (const o of bbArcher) console.log(`  uid=${o.uid} ${o.currentLevel}→${o.nextLevel} count=${o.count} inFlight=${o.inFlightSeconds ?? 0} available=${o.available}`);

  // What does the UI's `schedulable` filter keep? It keeps u.available && u.time > 0
  const schedulable = bbArcher.filter((o) => o.available && (o.time ?? 0) > 0);
  console.log(`\nSchedulable BB Archer rows: ${schedulable.length}`);
  for (const o of schedulable) console.log(`  "${o.name}" ${o.currentLevel}→${o.nextLevel} count=${o.count}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
