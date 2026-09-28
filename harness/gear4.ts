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
  const mk = (hvMortar: number) => ({
    buildings: [
      { data: 1000008, lvl: 7, gear_up: 1 },
      { data: 1000009, lvl: 10, gear_up: 1 },
      { data: 1000013, lvl: hvMortar },
    ],
    buildings2: [
      { data: 1000034, lvl: 9 }, { data: 1000078, lvl: 1 },
      { data: 1000038, lvl: 8, cnt: 2 }, { data: 1000036, lvl: 8, cnt: 2 },
      { data: 1000046, lvl: 9 }, { data: 4000041, lvl: 18 },
      { data: 1000041, lvl: 4 }, { data: 1000048, lvl: 6 }, { data: 1000045, lvl: 8 },
      { data: 1000033, lvl: 9, cnt: 100 },
    ],
    heroes2: [{ data: 28000003, lvl: 20 }, { data: 28000005, lvl: 20 }],
    timestamp: 1789646143,
  });
  for (const mm of [7, 8]) {
    const parsed = parseExport(mk(mm), data);
    const res = scheduleBobGoal({
      data, entries: parsed.entries, settings: DEFAULT_SETTINGS, inProgress: [],
      builders: 2, defenseId: 1000033, nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
    });
    const gears = res.lanes.flatMap(l => l.jobs).filter(j => j.name.startsWith("Gear"));
    console.log(`HV mortar ${mm} (needs 8): makespan ${res.makespan}s (${(res.makespan/86400).toFixed(1)}d) · gear jobs: ${gears.length} ${gears.map(g => g.name).join(",") || "-"} · blockers: ${JSON.stringify(res.blockers)}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
