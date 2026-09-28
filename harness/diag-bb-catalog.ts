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
  for (const o of bbArcher) console.log(`  uid=${o.uid} ${o.currentLevel}→${o.nextLevel} time=${o.time}s count=${o.count} inProgress=${o.inProgress ?? 0}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
