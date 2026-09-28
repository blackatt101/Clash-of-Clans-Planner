import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import type { ScheduleJob } from "../src/lib/schedule";

async function main() {
  const fs = await import("fs");
  const data = new GameData() as any;
  data.byId = new Map();
  for (const f of ["buildings","troops","heroes","spells","pets","equipment","traps","helpers"]) {
    const j = JSON.parse(fs.readFileSync(`/root/coc-planner/public/data/${f}.json`, "utf8"));
    for (const item of j.items) if (!data.byId.has(item._id)) data.byId.set(item._id, item);
  }
  const mk = () => ({
    buildings: [],
    buildings2: [
      { data: 1000034, lvl: 5 }, { data: 1000038, lvl: 4, cnt: 2 }, { data: 1000036, lvl: 4, cnt: 2 },
    ],
    timestamp: 1789646143,
  });
  const ip1: ScheduleJob[] = [
    { uid: 1_000_001, name: "Builder Hall", duration: 200000, category: "building", kind: "builder", levelFrom: 5, levelTo: 6, entityId: 1000034 },
  ];
  const parsed = parseExport(mk(), data);
  const res = scheduleBobGoal({
    data, entries: parsed.entries, settings: DEFAULT_SETTINGS, inProgress: ip1,
    builders: 2, defenseId: 1000033, nowEpochMs: 1789646143000, wiggleRoom: 0,
  });
  const jobs = res.lanes.flatMap(l => l.jobs).filter(j => j.name === "Builder Hall");
  console.log("inProgress BH running [0..200000] → next Builder Hall job:", JSON.stringify(jobs, null, 1));
  for (const l of res.lanes) console.log(l.label, l.jobs.map(j => `${j.name}${j.inProgress?"(inProg)":""}[${j.start}..${j.end}]`).join(" | "));
}
main().catch(e => { console.error(e); process.exit(1); });
