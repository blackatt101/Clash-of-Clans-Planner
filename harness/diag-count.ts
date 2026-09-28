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
  console.log(`builders detected: ${builders.total}`);

  for (const dd of [1000048, 1000045, 1000041]) {
    const res = scheduleBobGoal({
      data, entries: parsed.entries, settings: { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any,
      inProgress: [], builders: builders.total, defenseId: dd,
      nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
    });
    const archer = res.lanes.flatMap(l => l.jobs).filter(j => j.entityId === 1000048);
    const trip = archer.filter(j => (j.end - j.start) === GEAR_UP_SECONDS.archerTower);
    console.log(`defenseId=${dd}: Archer jobs=${archer.length}, trips=${trip.length} ${trip.map(t => `[${res.lanes.find(l => l.jobs.includes(t))?.label}]`).join(" ")}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
