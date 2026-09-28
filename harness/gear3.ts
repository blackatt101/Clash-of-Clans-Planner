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
  const b2 = [
    { data: 1000034, lvl: 9 }, { data: 1000078, lvl: 1 },
    { data: 1000038, lvl: 8 }, { data: 1000038, lvl: 8 },
    { data: 1000036, lvl: 8 }, { data: 1000036, lvl: 8 },
    { data: 1000046, lvl: 9 }, { data: 4000041, lvl: 18 },
    { data: 1000041, lvl: 4 }, { data: 1000048, lvl: 6 }, { data: 1000045, lvl: 8 },
    { data: 1000033, lvl: 9, cnt: 100 },
  ];
  const h = [
    { data: 1000008, lvl: 7, gear_up: 0 },
    { data: 1000009, lvl: 10, gear_up: 1 },
    { data: 1000013, lvl: 8, gear_up: 1 },
  ];
  const heroes2 = [{ data: 28000003, lvl: 20 }, { data: 28000005, lvl: 20 }];
  const raw = { buildings: h, buildings2: b2, heroes2, timestamp: 1789646143 };
  const parsed = parseExport(raw, data);
  const res = scheduleBobGoal({
    data, entries: parsed.entries, settings: DEFAULT_SETTINGS, inProgress: [],
    builders: 2, defenseId: 1000033, nowEpochMs: raw.timestamp * 1000, wiggleRoom: 0,
  });
  for (const l of res.lanes) {
    for (const j of l.jobs) console.log(`${l.label}: ${j.name} ${j.levelFrom}→${j.levelTo} [${j.start}..${j.end}]`);
  }
  console.log("---- options ----");
  for (const o of res.options) console.log(o.name, o.currentLevel, "→", o.nextLevel, "cost", o.cost);
  console.log("makespan", res.makespan, "blockers", JSON.stringify(res.blockers));
}
main().catch(e => { console.error(e); process.exit(1); });
