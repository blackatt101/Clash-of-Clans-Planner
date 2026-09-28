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
  // All BB requirements met, HV cannon done with a gear flag but mortar archer not,
  // so gear-up TRIPS are outstanding but BB+HV levels are at target.
  const mk = (flags: { cannon: number; archer: number; mortar: number }) => {
    const b2 = [
      { data: 1000034, lvl: 9 }, { data: 1000078, lvl: 1 },
      { data: 1000038, lvl: 8 }, { data: 1000038, lvl: 8 },
      { data: 1000036, lvl: 8 }, { data: 1000036, lvl: 8 },
      { data: 1000046, lvl: 9 }, { data: 4000041, lvl: 18 },
      { data: 1000041, lvl: 4 }, { data: 1000048, lvl: 6 }, { data: 1000045, lvl: 8 },
      { data: 1000033, lvl: 9, cnt: 100 },
    ];
    const h = [
      { data: 1000008, lvl: 7, gear_up: flags.cannon },
      { data: 1000009, lvl: 10, gear_up: flags.archer },
      { data: 1000013, lvl: 8, gear_up: flags.mortar },
    ];
    const heroes2 = [{ data: 28000003, lvl: 20 }, { data: 28000005, lvl: 20 }];
    const raw = { buildings: h, buildings2: b2, heroes2, timestamp: 1789646143 };
    const parsed = parseExport(raw, data);
    const res = scheduleBobGoal({
      data, entries: parsed.entries, settings: DEFAULT_SETTINGS, inProgress: [],
      builders: 2, defenseId: 1000033, nowEpochMs: raw.timestamp * 1000, wiggleRoom: 0,
    });
    const gears = (res as any).lanes.flatMap((l: any) => l.jobs).filter((j: any) => j.name.startsWith("Gear"));
    console.log(`flags ${JSON.stringify(flags)}: makespan ${res.makespan}s (${(res.makespan/86400).toFixed(1)}d), options ${res.options.length}, gear jobs ${gears.length}, blockers ${res.blockers.length}`);
    for (const g of gears) console.log(`    ${g.name} [${g.start}..${g.end}]`);
  };
  mk({ cannon: 0, archer: 1, mortar: 1 }); // only cannon trip outstanding
  mk({ cannon: 0, archer: 0, mortar: 0 }); // all three trips
  mk({ cannon: 1, archer: 1, mortar: 1 }); // all done -> ETA should be 0
}
main().catch(e => { console.error(e); process.exit(1); });
