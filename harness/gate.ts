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
  const raw = {
    buildings: [],
    buildings2: [
      { data: 1000034, lvl: 5, timer: 300000 },  // live: finishing 5->6
      { data: 1000038, lvl: 4, cnt: 2 },
      { data: 1000036, lvl: 4, cnt: 2 },
    ],
    timestamp: 1789646143,
  };
  const parsed = parseExport(raw, data);
  const res = scheduleBobGoal({
    data, entries: parsed.entries, settings: DEFAULT_SETTINGS, inProgress: [],
    builders: 2, defenseId: 1000033, nowEpochMs: raw.timestamp * 1000, wiggleRoom: 0,
  });
  const labJobs = res.lanes.flatMap(l => l.jobs).filter(j => j.name === "Star Laboratory");
  console.log("live BH 5->6 (finishes at 300000). Star Lab jobs:");
  for (const j of labJobs) console.log(`  ${j.levelFrom}→${j.levelTo} [${j.start}..${j.end}]`);
  // Game rule: Star Lab 2 requires Builder Hall 2... but its LEVEL 4 (th=4), LEVEL 5 (th=5),
  // LEVEL 6 (th=6) require a live 6: Lab 4 OK at gate 4; Lab 5 requires BH5 (held since t=0, fine);
  // Lab 6 requires BH6 -> earliest legal start = 300000.
  const lab6 = labJobs.find(j => j.levelTo === 6);
  console.log("Star Lab 6 earliest legal start = 300000; plan says", lab6?.start,
    lab6 && lab6.start < 300000 ? "  << VIOLATES the live-timer gate" : "  ok");
}
main().catch(e => { console.error(e); process.exit(1); });
