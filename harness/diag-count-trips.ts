import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { GEAR_UPS, GEAR_UP_SECONDS, detectBbBuilders } from "../src/lib/bbRush";
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
  const builders = detectBbBuilders(parsed.entries).total;

  const res = scheduleBobGoal({
    data, entries: parsed.entries, settings: { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any,
    inProgress: [], builders, defenseId: 1000048,
    nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
  });

  console.log("=== All trip jobs in final bbGoal ===");
  for (const g of GEAR_UPS) {
    const trips = res.lanes.flatMap(l => l.jobs).filter(j => j.name === g.label);
    for (const j of trips) {
      const lane = res.lanes.find(l => l.jobs.includes(j))?.label;
      console.log(`  "${j.name}" [${lane}] start=${j.start} Δ=${j.end - j.start}s (${j.end - j.start}) inProgress=${j.inProgress}`);
    }
    if (trips.length === 0) console.log(`  "${g.label}": NOT BOOKED`);
  }
  console.log("\n=== All Archer 1000048 jobs ===");
  for (const l of res.lanes) for (const j of l.jobs) if (j.entityId === 1000048)
    console.log(`  [${l.label}] "${j.name}" ${j.levelFrom ?? ""}→${j.levelTo ?? ""} start=${j.start} Δ=${j.end - j.start}s`);
}
main().catch(e => { console.error(e); process.exit(1); });
