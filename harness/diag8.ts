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
  // User's REAL state: BB Archer max=6, HV Archer=13, gear-up belum pernah (flag stripped)
  const entries = parsed.entries.map((e) =>
    e.id === 1000048 && e.village === "builderBase" ? { ...e, level: 6 } :
    e.id === 1000009 && e.village === "home" ? { ...e, level: 13, gearUp: undefined } : e);

  const res = scheduleBobGoal({
    data, entries, settings: { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any,
    inProgress: [], builders: 2, defenseId: 1000048,
    nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
  });
  for (const l of res.lanes) {
    const archer = l.jobs.filter((j) => j.entityId === 1000048);
    for (const j of archer)
      console.log(`[${l.label}] "${j.name}" ${j.levelFrom ?? ""}→${j.levelTo ?? ""} start=${j.start} Δ=${j.end - j.start}s`);
  }
  const trip = res.lanes.flatMap((l) => l.jobs).find((j) => j.entityId === 1000048 && (j.end - j.start) === GEAR_UP_SECONDS.archerTower);
  console.log(`\nArcher trip (Δ7d): ${trip ? `booked at t=${trip.start}, lane "${res.lanes.find((l) => l.jobs.includes(trip))?.label}"` : "MISSING"}`);
  // Also show all gear-up trips
  for (const [k, dur] of Object.entries(GEAR_UP_SECONDS)) {
    const t = res.lanes.flatMap((l) => l.jobs).find((j) => (j.end - j.start) === Number(dur));
    console.log(`  ${k} trip (Δ${Number(dur) / 86400}d): ${t ? `t=${t.start} [${res.lanes.find((l) => l.jobs.includes(t))?.label}]` : "none"}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
