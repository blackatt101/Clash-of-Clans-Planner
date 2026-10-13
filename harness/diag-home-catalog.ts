import { readFileSync } from "fs";
import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { computeUpgrades } from "../src/lib/upgrade";

const ROOT = "/home/ubuntu/coc-planner";
async function main() {
  const data = new GameData() as any;
  data.byId = new Map();
  for (const f of ["buildings","troops","heroes","spells","pets","equipment","traps","helpers"]) {
    const j = JSON.parse(readFileSync(`${ROOT}/public/data/${f}.json`, "utf8"));
    for (const item of j.items) if (!data.byId.has(item._id)) data.byId.set(item._id, item);
  }
  const raw = JSON.parse(readFileSync(`${ROOT}/test-export.json`, "utf8"));
  const parsed = parseExport(raw, data);
  const settings = { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" as const };
  const all = computeUpgrades(parsed, data, settings as any);
  for (const v of ["home","builderBase"]) {
    const rows = all.filter(o => o.village === v);
    console.log(`\n===== ${v}: ${rows.length} rows =====`);
    for (const o of rows) {
      console.log(`  uid=${String(o.uid).padStart(3)} id=${String(o.id).padStart(8)} ${o.name.padEnd(22)} ${String(o.category).padEnd(10)} ${o.currentLevel}->${o.nextLevel} chain=${o.chain?.length ?? 0} avail=${o.available} count=${o.count}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
