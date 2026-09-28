import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { GEAR_UPS, GEAR_UP_SECONDS } from "../src/lib/bbRush";
import { readFileSync } from "fs";

async function main() {
  const data = new GameData() as any;
  data.byId = new Map();
  for (const f of ["buildings","troops","heroes","spells","pets","equipment","traps","helpers"]) {
    const j = JSON.parse(readFileSync(`/root/coc-planner/public/data/${f}.json`, "utf8"));
    for (const item of j.items) if (!data.byId.has(item._id)) data.byId.set(item._id, item);
  }
  const raw = JSON.parse(readFileSync("/root/coc-planner/test-export.json", "utf8"));
  const parsed = parseExport(raw, data);
  // User's case: HV Archer=13 (flag not set → level signal in-flight), BB Archer=5
  const entries = parsed.entries.map((e) => e.id === 1000009 ? { ...e, level: 13, gearUp: undefined } : e);

  const res = scheduleBobGoal({
    data, entries, settings: { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any,
    inProgress: [], builders: 2, defenseId: 1000048,
    nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
  });

  for (const g of GEAR_UPS) {
    const tripDur = GEAR_UP_SECONDS[g.key];
    const jobs = res.lanes.flatMap((l) => l.jobs).filter((j) => j.entityId === g.bbId && (j.end - j.start) === tripDur);
    for (const j of jobs) {
      const lane = res.lanes.find((l) => l.jobs.includes(j))?.label;
      console.log(`${g.key}: lane=[${lane}] start=${j.start} end=${j.end} Δ=${j.end-j.start}s (${j.end-j.start}/86400=${((j.end-j.start)/86400).toFixed(1)}d) kind=${j.kind} pinned=0? family=${(j as any).family}`);
    }
  }
  console.log(`\nAll "Archer Tower" jobs:`);
  for (const l of res.lanes) for (const j of l.jobs) if (j.entityId === 1000048)
    console.log(`  [${l.label}] "${j.name}" ${j.levelFrom}→${j.levelTo} start=${j.start} Δ=${j.end-j.start}s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
