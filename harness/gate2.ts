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
  const raw = {
    buildings: [],
    buildings2: [
      { data: 1000034, lvl: 5, timer: 300000 },
      { data: 1000038, lvl: 4, cnt: 2 },
      { data: 1000036, lvl: 4, cnt: 2 },
    ],
    timestamp: 1789646143,
  };
  // The page's inProgress builder marks the live BH job as "occupies a lane until
  // start + timer" (bbGoal.ts:341). Reconstruct it the way page.tsx does:
  const parsed = parseExport(raw, data);
  const inProgress: ScheduleJob[] = [
    { uid: 1_000_001, name: "Builder Hall", duration: 300000, category: "building", kind: "builder", levelFrom: 5, levelTo: 6, entityId: 1000034 },
  ];
  const res = scheduleBobGoal({
    data, entries: parsed.entries, settings: DEFAULT_SETTINGS, inProgress,
    builders: 2, defenseId: 1000033, nowEpochMs: raw.timestamp * 1000, wiggleRoom: 0,
  });
  const lab = res.lanes.flatMap(l => l.jobs).filter(j => j.name === "Star Laboratory").map(j => `${j.levelTo}@${j.start}`);
  const inProgBars = res.lanes.flatMap(l => l.jobs).filter(j => j.inProgress).map(j => `${j.name}[${j.start}..${j.end}]`);
  console.log("with page-style inProgress:", lab.join(" "));
  console.log("in-progress bars:", inProgBars.join(", "));
}
main().catch(e => { console.error(e); process.exit(1); });
