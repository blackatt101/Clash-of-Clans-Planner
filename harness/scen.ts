import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";

const HALL_CAP = [0,50000,75000,100000,150000,900000,900000,1100000,1300000,1500000,1500000];
const STO_CAP = [0,70000,150000,250000,350000,600000,800000,1200000,1600000,2000000,2500000];

async function main() {
  const fs = await import("fs");
  const data = new GameData() as any;
  data.byId = new Map();
  for (const f of ["buildings","troops","heroes","spells","pets","equipment","traps","helpers"]) {
    const j = JSON.parse(fs.readFileSync(`/root/coc-planner/public/data/${f}.json`, "utf8"));
    for (const item of j.items) if (!data.byId.has(item._id)) data.byId.set(item._id, item);
  }

  const run = (label: string, bh: number, storages: [number, number],
    o: { starLab?: number; dragon?: number; heroes?: [number, number]; hv?: Record<number, { lvl: number; gear?: number }> } = {}) => {
    const b2: any[] = [{ data: 1000034, lvl: bh }];
    if (bh >= 6) b2.push({ data: 1000078, lvl: 1 });
    b2.push({ data: 1000038, lvl: storages[0] }, { data: 1000038, lvl: storages[0] });
    b2.push({ data: 1000036, lvl: storages[1] }, { data: 1000036, lvl: storages[1] });
    if (o.starLab != null) b2.push({ data: 1000046, lvl: o.starLab });
    b2.push({ data: 1000041, lvl: (o as any).bbCannon ?? 4 });
    b2.push({ data: 1000048, lvl: (o as any).bbArcher ?? 6 });
    b2.push({ data: 1000045, lvl: (o as any).bbMortar ?? 8 });
    if (o.dragon != null) b2.push({ data: 4000041, lvl: o.dragon });
    const h: any[] = [];
    for (const [id, v] of Object.entries(o.hv ?? {})) h.push({ data: Number(id), lvl: v.lvl, gear_up: v.gear ?? 0 });
    const heroes2: any[] = [];
    if (o.heroes) {
      heroes2.push({ data: 28000003, lvl: o.heroes[0] });
      if (o.heroes[1] > 0) heroes2.push({ data: 28000005, lvl: o.heroes[1] });
    }
    const raw = { buildings: h, buildings2: b2, heroes2, timestamp: 1789646143 };
    const parsed = parseExport(raw, data);
    const res = scheduleBobGoal({
      data, entries: parsed.entries, settings: DEFAULT_SETTINGS, inProgress: [],
      builders: 2, defenseId: 1000033, nowEpochMs: raw.timestamp * 1000, wiggleRoom: 0,
    });
    const gears = res.options.filter(oo => oo.name.startsWith("Gear"));
    const gearTimes = gears.map(g => g.name).join(", ") || "(none)";
    const lanes = (res as any).lanes.map((l: any) => l.jobs.map((j: any) => j.name.startsWith("Gear") ? `${j.name}[${j.start}-${j.end}]` : null).filter(Boolean));
    console.log(`\n=== ${label}`);
    console.log(`  makespan ${(res.makespan/86400).toFixed(1)}d · blockers ${res.blockers.length}: ${JSON.stringify(res.blockers).slice(0, 300)}`);
    console.log(`  gear-ups in options: ${gearTimes}`);
    lanes.forEach((s, i) => s.length && console.log(`  lane ${i}: ${s.join(" | ")}`));
    return res;
  };

  const hvAll = { 1000008: { lvl: 7 }, 1000009: { lvl: 10 }, 1000013: { lvl: 8 } };

  // 1) everything met, no gear flags, BH9 base, starlab9, dragon18, heroes 20+20 -> no gear trips
  run("all met, no flags", 9, [8, 8], { starLab: 9, dragon: 18, heroes: [20, 20], hv: hvAll });

  // 2) cannon not flagged, others flagged -> only the cannon trip should fire
  run("only cannon outstanding", 9, [8, 8], {
    starLab: 9, dragon: 18, heroes: [20, 20],
    hv: { 1000008: { lvl: 7 }, 1000009: { lvl: 10, gear: 1 }, 1000013: { lvl: 8, gear: 1 } },
  });

  // 3) HV cannon missing -> gear blocked, all others done
  run("cannon HV half missing", 9, [8, 8], {
    starLab: 9, dragon: 18, heroes: [20, 20],
    hv: { 1000008: { lvl: 6 }, 1000009: { lvl: 10, gear: 1 }, 1000013: { lvl: 8, gear: 1 } }, bbCannon: 2,
  });

  // 4) BB cannon only at 2 -> BB half missing (target 4)
  run("BB Double Cannon stuck at 2", 9, [8, 8], {
    starLab: 9, dragon: 18, heroes: [20, 20],
    hv: { 1000008: { lvl: 7 }, 1000009: { lvl: 10, gear: 1 }, 1000013: { lvl: 8, gear: 1 } },
  } as any);
}
main().catch(e => { console.error(e); process.exit(1); });
