import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { GEAR_UP_SECONDS, detectBbBuilders } from "../src/lib/bbRush";
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
  const builders = detectBbBuilders(parsed.entries);
  console.log(`builders: ${builders.total}`);

  const res = scheduleBobGoal({
    data, entries: parsed.entries, settings: { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any,
    inProgress: [], builders: builders.total, defenseId: 1000048,
    nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
  });
  for (const l of res.lanes) {
    console.log(`\n[${l.label}] ${l.jobs.length} jobs:`);
    for (const j of l.jobs) {
      const marker = (j.end - j.start) === GEAR_UP_SECONDS.archerTower ? " ← GEAR-UP TRIP" :
                     (j.end - j.start) === GEAR_UP_SECONDS.mortar ? " ← MORTAR TRIP" :
                     (j.end - j.start) === GEAR_UP_SECONDS.cannon ? " ← CANNON TRIP" : "";
      console.log(`  ${String(j.start).padStart(9)} ${String(j.end).padStart(9)} "${j.name}" ${j.levelFrom ?? ""}→${j.levelTo ?? ""} Δ=${j.end - j.start}s${marker}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
