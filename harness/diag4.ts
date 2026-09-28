import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { GEAR_UP_SECONDS } from "../src/lib/bbRush";
import { readFileSync } from "fs";

async function main() {
  const data = new GameData() as any;
  data.byId = new Map();
  for (const f of ["buildings","troops","heroes","spells","pets","equipment","traps","helpers"]) {
    const j = JSON.parse(readFileSync(`/root/coc-planner/public/data/${f}.json`, "utf8"));
    for (const item of j.items) if (!data.byId.has(item._id)) data.byId.set(item._id, item);
  }
  const raw = JSON.parse(readFileSync("/root/coc-planner/test-export.json", "utf8"));
  const parsed = parseExport(raw, data);
  // test-export: BB Archer copies at levels 1,3,5 (max=5); user has max=6
  const entries = parsed.entries.map((e) =>
    e.id === 1000048 && e.village === "builderBase" ? { ...e, level: 6 } :
    e.id === 1000009 && e.village === "home" ? { ...e, level: 13, gearUp: undefined } : e);

  const res = scheduleBobGoal({
    data, entries, settings: { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any,
    inProgress: [], builders: 2, defenseId: 1000048,
    nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
  });
  console.log("=== ALL Archer jobs (user state: BB=6, HV=13, defense=archer) ===");
  for (const l of res.lanes) for (const j of l.jobs) if (j.entityId === 1000048)
    console.log(`  [${l.label}] "${j.name}" ${j.levelFrom}→${j.levelTo} start=${j.start} Δ=${j.end - j.start}s (${((j.end - j.start) / 86400).toFixed(1)}d) kind=${j.kind}`);
  const trip = res.lanes.flatMap((l) => l.jobs).find((j) => j.entityId === 1000048 && (j.end - j.start) === GEAR_UP_SECONDS.archerTower);
  console.log(`\nTrip (Δ7d): ${trip ? `booked at t=${trip.start} on lane "${res.lanes.find(l => l.jobs.includes(trip))?.label}"` : "MISSING"}`);
  // What does the trip option say?
  const opt = res.options?.find((o) => o.uid === trip?.uid);
  if (opt) console.log(`Trip option: name="${opt.name}" uid=${opt.uid} currentLevel=${opt.currentLevel} nextLevel=${opt.nextLevel}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
