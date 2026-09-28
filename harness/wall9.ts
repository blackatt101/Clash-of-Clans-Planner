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
  // BH4, no Star Lab in the export (the "level-18 troop on a base with no Star
  // Lab yet" case). Troop 4000041 at lvl 1. Everything else: walls present.
  const mk = (walls: number, wallsCnt: number) => ({
    buildings: [
      { data: 1000008, lvl: 7 }, { data: 1000009, lvl: 10 }, { data: 1000013, lvl: 8 },
    ],
    buildings2: [
      { data: 1000034, lvl: 4 },
      { data: 1000038, lvl: 4, cnt: 2 },
      { data: 1000036, lvl: 4, cnt: 2 },
      { data: 4000041, lvl: 1 },
      { data: 1000033, lvl: walls, cnt: wallsCnt },
    ],
    heroes2: [{ data: 28000003, lvl: 1 }, { data: 28000005, lvl: 1 }],
    timestamp: 1789646143,
  });
  for (const [w, c] of [[0, 60], [4, 60], [9, 60]] as [number, number][]) {
    const parsed = parseExport(mk(w, c), data);
    const res = scheduleBobGoal({
      data, entries: parsed.entries, settings: DEFAULT_SETTINGS, inProgress: [],
      builders: 2, defenseId: 1000033, nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
    });
    const wallRows = res.options.filter(o => o.id === 1000033).length;
    const wallJobs = res.lanes.flatMap(l => l.jobs).filter(j => j.name === "Wall").length;
    console.log(`walls ${w} (cnt ${c}): makespan ${(res.makespan/86400).toFixed(1)}d · wall option rows ${wallRows} · wall lane jobs ${wallJobs} · blockers ${JSON.stringify(res.blockers).slice(0, 160)}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
