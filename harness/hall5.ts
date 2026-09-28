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
  const mk = (storages: [number, number]) => ({
    buildings: [],
    buildings2: [
      { data: 1000034, lvl: 5 }, { data: 1000078, lvl: 1 },
      { data: 1000038, lvl: storages[0], cnt: 2 },
      { data: 1000036, lvl: storages[1], cnt: 2 },
      { data: 1000046, lvl: 5 },
    ],
    timestamp: 1789646143,
  });
  for (const s of [[4,4],[3,3],[5,5],[2,5],[5,2],[1,4]] as [number, number][]) {
    const raw = mk(s);
    const parsed = parseExport(raw, data);
    const res = scheduleBobGoal({
      data, entries: parsed.entries, settings: DEFAULT_SETTINGS, inProgress: [],
      builders: 2, defenseId: 1000033, nowEpochMs: raw.timestamp*1000, wiggleRoom: 0,
    });
    const jobs = res.lanes.flatMap(l => l.jobs);
    const bh = jobs.filter(j => j.name === "Builder Hall").map(j => `BH${j.levelTo}@[${j.start}..${j.end}]`);
    const st = jobs.filter(j => j.name.includes("Storage")).length;
    console.log(`st ${s}: ${bh.join(" ")} | storage jobs: ${st} | makespan ${(res.makespan/86400).toFixed(1)}d`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
