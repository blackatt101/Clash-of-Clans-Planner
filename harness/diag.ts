import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { gearUpInFlight, gearUpSettled, GEAR_UPS, GEAR_UP_SECONDS } from "../src/lib/bbRush";
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
  const clean = parsed.entries.map((e) => ({ ...e, gearUp: undefined }));
  const archerG = GEAR_UPS.find((g) => g.key === "archerTower")!;

  // User's real case: HV Archer at 13, BB Archer at 5 (from test-export buildings2)
  const entries = clean.map((e) => (e.id === 1000009 ? { ...e, level: 13 } : e));
  const inFlight = gearUpInFlight(entries, archerG);
  const settled = gearUpSettled(entries, archerG, false);
  console.log(`HV Archer=13, BB Archer=5 (from test-export):`);
  console.log(`  inFlight=${inFlight}  settled=${settled}`);

  const res = scheduleBobGoal({
    data, entries, settings: { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any,
    inProgress: [], builders: 2, defenseId: 1000048,
    nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
  });

  // Find ANY Archer job on Builder 1 lane
  const lane1 = res.lanes.find((l) => l.label === "Builder 1");
  const archerJobs = (lane1?.jobs ?? []).filter((j) => j.entityId === 1000048);
  console.log(`  Archer jobs on Builder 1 lane: ${archerJobs.length}`);
  for (const j of archerJobs) {
    console.log(`    "${j.name}" start=${j.start} end=${j.end} Δ=${j.end - j.start}s kind=${j.kind}`);
  }
  const archerTrip = archerJobs.find((j) => (j.end - j.start) === GEAR_UP_SECONDS.archerTower);
  console.log(`  Archer TRIP (Δ7d) booked? ${archerTrip ? `YES at t=${archerTrip.start}` : "NO"}`);
  console.log(`  Blockers:`, JSON.stringify(res.blockers, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
