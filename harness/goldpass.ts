import { SAMPLE_EXPORT } from "../src/lib/sample";
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
  const raw = JSON.parse(SAMPLE_EXPORT);
  const parsed = parseExport(raw, data);
  const mk = (gp: number, bb: number, rb: number) => ({
    ...DEFAULT_SETTINGS, goldPass: gp, builderBoost: bb, researchBoost: rb,
  });
  for (const s of [mk(0,0,0), mk(20,10,10), mk(100,0,0)]) {
    const res = scheduleBobGoal({
      data, entries: parsed.entries, settings: s, inProgress: [],
      builders: 2, defenseId: 1000033, nowEpochMs: raw.timestamp*1000, wiggleRoom: 0,
    });
    const jobs = res.lanes.flatMap(l => l.jobs);
    const bh8 = jobs.find(j => j.name.includes("Builder Hall") && j.levelTo === 8);
    const wall9 = jobs.filter(j => j.name === "Wall").map(j => `${j.levelTo}`);
    console.log(`gp${s.goldPass}/bb${s.builderBoost}/rb${s.researchBoost}: makespan ${res.makespan}s, options ${res.options.length}, BH8 [${bh8?.start}..${bh8?.end}] duration ${bh8?.duration}, walls ${wall9.length}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
