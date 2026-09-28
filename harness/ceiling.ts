import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";

async function main() {
  const fs = await import("fs");
  const data = new GameData() as any;
  data.byId = new Map();
  for (const f of ["buildings","troops","heroes","spells","pets","equipment","traps","helpers"]) {
    const j = JSON.parse(fs.readFileSync(`/root/coc-planner/public/data/${f}.json`, "utf8"));
    for (const item of j.items) if (!data.byId.has(item._id)) data.byId.set(item._id, item);
  }
  const run = (label: string, raw: any, defId: number, builders = 2) => {
    const parsed = parseExport(raw, data);
    const res = scheduleBobGoal({
      data, entries: parsed.entries, settings: DEFAULT_SETTINGS, inProgress: [],
      builders, defenseId: defId, nowEpochMs: raw.timestamp * 1000, wiggleRoom: 0,
    });
    const hallNow = parsed.entries.find(e => e.village === "builderBase" && e.id === 1000034)?.level ?? 0;
    const HALL_CAP = [0,50000,75000,100000,150000,900000,900000,1100000,1300000,1500000,1500000];
    const STO_CAP = [0,70000,150000,250000,350000,600000,800000,1200000,1600000,2000000,2500000];
    let g = HALL_CAP[hallNow], e = HALL_CAP[hallNow];
    for (const ent of parsed.entries) if (ent.village === "builderBase") {
      if (ent.id === 1000038) g += STO_CAP[ent.level];
      if (ent.id === 1000036) e += STO_CAP[ent.level];
    }
    const hallJobs = res.lanes.flatMap(l => l.jobs).filter(j => j.name === "Builder Hall").map(j => `${j.levelTo}@${j.start}`);
    console.log(`${label}: gold ${g} elix ${e} | hall: ${hallJobs.join(", ")} | blockers: ${JSON.stringify(res.blockers).slice(0,200)}`);
  };
  const rawA = {
    buildings: [],
    buildings2: [
      { data: 1000034, lvl: 5 }, { data: 1000078, lvl: 1 },
      { data: 1000038, lvl: 4, cnt: 2 }, { data: 1000036, lvl: 4, cnt: 2 },
      { data: 1000046, lvl: 1 },
    ],
    timestamp: 1789646143,
  };
  const rawB = JSON.parse(JSON.stringify(rawA));
  delete (rawB.buildings2 as any[]).find(x => x.data === 1000038)!; // no Gold Storage listed
  run("BH5, gold stor 4x2 + elix 4x2, lab1", rawA, 1000033);
  run("BH5, gold stor MISSING, elix 4x2", rawB, 1000033);
}
main().catch(e => { console.error(e); process.exit(1); });
