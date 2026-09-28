import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { GEAR_UPS, detectBbBuilders } from "../src/lib/bbRush";
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

  // Reproduce what page.tsx passes: inProgress = BB entries with timer>0 (gear-up in-flight HH dropped, but that's HH not BB)
  const inProgress = parsed.entries
    .filter((e) => e.village === "builderBase" && e.timer && e.timer > 0)
    .map((e, i) => ({
      uid: 1000000 + i, name: e.name, duration: e.timer as number,
      category: e.category, kind: "builder",
      levelFrom: e.level, levelTo: e.level + 1,
      count: 1, entityId: e.id, family: "buildings",
    }));

  const res = scheduleBobGoal({
    data, entries: parsed.entries, settings: { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any,
    inProgress, builders, defenseId: 1000048,
    nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
  });

  for (const g of GEAR_UPS) {
    const trips = res.lanes.flatMap(l => l.jobs).filter(j => j.name === g.label);
    console.log(`${g.label}: ${trips.length} trip jobs`);
    for (const j of trips) {
      const lane = res.lanes.find(l => l.jobs.includes(j))?.label;
      console.log(`   [${lane}] uid=${j.uid} start=${j.start} Δ=${j.end - j.start}s inProgress=${j.inProgress}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
