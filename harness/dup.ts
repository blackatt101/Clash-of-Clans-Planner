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
  // BH4: hall holds 150k gold + 150k elixir. Two storages: one lvl2 (150k each) and one lvl1 (70k).
  // Gold ceiling now = 150k + 150k + 70k = 370k. Elixir = 150k + 150k + 70k = 370k.
  const b2 = [
    { data: 1000034, lvl: 4 },
    { data: 1000038, lvl: 2 },   // gold storage copy A
    { data: 1000038, lvl: 1 },   // gold storage copy B (mixed levels!)
    { data: 1000036, lvl: 2 },
    { data: 1000036, lvl: 1 },
    { data: 1000046, lvl: 1 },
  ];
  const raw = { buildings: [], buildings2: b2, timestamp: 1789646143 };
  const parsed = parseExport(raw, data);
  const res = scheduleBobGoal({
    data, entries: parsed.entries, settings: DEFAULT_SETTINGS, inProgress: [],
    builders: 1, defenseId: 1000033, nowEpochMs: raw.timestamp * 1000, wiggleRoom: 0,
  });
  console.log("mixed-level storages");
  for (const l of res.lanes) for (const j of l.jobs)
    if (j.name.includes("Storage")) console.log(`  ${l.label}: ${j.name} ${j.levelFrom}→${j.levelTo} [${j.start}..${j.end}]`);
  console.log("makespan", res.makespan, "resources:", JSON.stringify(res.resources, null, 1));
}
main().catch(e => { console.error(e); process.exit(1); });
