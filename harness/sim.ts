import { SAMPLE_EXPORT } from "../src/lib/sample";
import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { bbDefenseTarget } from "../src/lib/bbRush";

const HALL_CAP = [0,50000,75000,100000,150000,900000,900000,1100000,1300000,1500000,1500000];
const STO_CAP = [0,70000,150000,250000,350000,600000,800000,1200000,1600000,2000000,2500000];
const poolOf = (id: number) => id === 1000038 ? "Builder Gold" : id === 1000036 ? "Builder Elixir" : null;

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
  const res = scheduleBobGoal({
    data, entries: parsed.entries, settings: DEFAULT_SETTINGS, inProgress: [],
    builders: 2, defenseId: bbDefenseTarget(parsed.entries, null, data),
    nowEpochMs: raw.timestamp * 1000, wiggleRoom: 0,
  });

  const jobs: any[] = [];
  for (const l of res.lanes) for (const j of l.jobs) jobs.push({ ...j, lane: l.key });
  jobs.sort((a, b) => a.start - b.start || a.end - b.end);

  // reached[id][lvl] = earliest time the entity holds that level
  const reached: Record<number, Record<number, number>> = {};
  const note = (id: number, lvl: number, at: number) => {
    reached[id] = reached[id] ?? {};
    if (reached[id][lvl] == null || at < reached[id][lvl]) reached[id][lvl] = at;
  };
  for (const e of parsed.entries) if (e.village === "builderBase") {
    for (let l = 1; l <= e.level; l++) note(e.id, l, 0);
    if (e.timer && e.timer > 0) note(e.id, e.level + 1, e.timer);
  }

  // storage copy level at time t, from the export + committed storage jobs
  const storageLevelAt = (id: number, t: number) => {
    let lvl = 0;
    for (const e of parsed.entries) if (e.village === "builderBase" && e.id === id)
      lvl = Math.max(lvl, e.timer && e.timer <= t ? e.level + 1 : e.level);
    for (const sj of jobs) if (sj.name.includes("Storage") && (sj as any).entityId === id && sj.end <= t)
      lvl = Math.max(lvl, sj.levelTo);
    return lvl;
  };
  const ceilingAt = (pays: string, t: number) => {
    let cap = 0;
    const hallLvl = (Object.keys(reached[1000034] ?? {}) as unknown as number[])
      .filter((l) => reached[1000034][l] <= t).length; // seeded 1..7 => 7
    cap = HALL_CAP[Math.min(10, hallLvl)];
    for (const id of [1000038, 1000036]) if (poolOf(id) === pays) cap += STO_CAP[storageLevelAt(id, t)];
    return cap;
  };

  const violations: string[] = [];
  for (const j of jobs) {
    const id = (j as any).entityId;
    if (id == null) { violations.push(`job "${j.name}" missing entityId`); continue; }
    const prior = reached[id]?.[j.levelTo - 1];
    if (prior != null && j.start < prior)
      violations.push(`ORDER ${j.name} ${j.levelTo}: starts ${j.start} before level ${j.levelTo - 1} finished ${prior}`);
    const row = data.byId.get(id)!.levels.find((l: any) => l.l === j.levelTo);
    if (!row) { violations.push(`NODATA ${j.name} ${j.levelTo}`); continue; }
    const hallOk = (row.th ?? 0) <= 0 || (reached[1000034]?.[row.th ?? 0] ?? Infinity) <= j.start;
    const labOk = (row.lab ?? 0) <= 0 || (reached[1000046]?.[row.lab ?? 0] ?? Infinity) <= j.start;
    if (!hallOk) violations.push(`GATE ${j.name} ${j.levelTo}: starts ${j.start} before BH${row.th}`);
    if (!labOk) violations.push(`GATE ${j.name} ${j.levelTo}: starts ${j.start} before Lab${row.lab}`);
    if (typeof row.cost === "number" && row.cost > 0 && !j.name.startsWith("Gear")) {
      const pays = data.byId.get(id)!.resource === "Builder Elixir" ? "Builder Elixir" : "Builder Gold";
      const cap = ceilingAt(pays, j.start);
      if (row.cost > cap) violations.push(`CAP ${j.name} ${j.levelTo}: needs ${row.cost} ${pays} at ${j.start}, ceiling ${cap}`);
    }
    note(id, j.levelTo, j.end);
  }
  const byLane: Record<string, any[]> = {};
  for (const j of jobs) (byLane[j.lane] = byLane[j.lane] ?? []).push(j);
  for (const [k, arr] of Object.entries(byLane)) {
    arr.sort((a, b) => a.start - b.start);
    for (let i = 1; i < arr.length; i++)
      if (arr[i].start < arr[i - 1].end)
        violations.push(`OVERLAP lane ${k}: ${arr[i - 1].name} [${arr[i - 1].start}..${arr[i - 1].end}] vs ${arr[i].name} [${arr[i].start}..]`);
  }
  console.log("BH9@", reached[1000034]?.[9], "Lab9@", reached[1000046]?.[9], "Dragon18@", reached[4000041]?.[18],
    "DM@", reached[1000041]?.[9], "MT@", reached[1000045]?.[9], "AT@", reached[1000048]?.[9]);
  console.log("BM20@", reached[28000003]?.[20], "BC20@", reached[28000005]?.[20]);
  console.log("makespan", res.makespan, "violations:", violations.length);
  for (const v of violations) console.log(" ", v);
}
main().catch((e) => { console.error(e); process.exit(1); });
