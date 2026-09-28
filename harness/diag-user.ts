import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { gearUpInFlight, gearUpSettled, GEAR_UPS, GEAR_UP_SECONDS, hasGearUpFlag, detectBbBuilders } from "../src/lib/bbRush";
import { readFileSync } from "fs";

async function main() {
  const data = new GameData() as any;
  data.byId = new Map();
  for (const f of ["buildings","troops","heroes","spells","pets","equipment","traps","helpers"]) {
    const j = JSON.parse(readFileSync(`/root/coc-planner/public/data/${f}.json`, "utf8"));
    for (const item of j.items) if (!data.byId.has(item._id)) data.byId.set(item._id, item);
  }
  const raw = JSON.parse(readFileSync("/tmp/user-export.json", "utf8"));
  const parsed = parseExport(raw, data);

  // How did parse handle the two 1000009 entries?
  const archerHv = parsed.entries.filter((e) => e.id === 1000009);
  console.log("=== Parsed HV Archer entries ===");
  for (const e of archerHv) console.log(`  lvl=${e.level} timer=${e.timer ?? "-"} gearUp=${e.gearUp} village=${e.village} uid=${e.uid} cnt=${e.count}`);
  const cannonHv = parsed.entries.filter((e) => e.id === 1000008);
  console.log("=== Parsed HV Cannon entries ===");
  for (const e of cannonHv) console.log(`  lvl=${e.level} timer=${e.timer ?? "-"} gearUp=${e.gearUp} village=${e.village}`);

  console.log(`\nflagKnown=${hasGearUpFlag(parsed.entries)}`);
  const archG = GEAR_UPS.find((g) => g.key === "archerTower")!;
  const canG = GEAR_UPS.find((g) => g.key === "cannon")!;
  const morG = GEAR_UPS.find((g) => g.key === "mortar")!;
  console.log(`Archer inFlight=${gearUpInFlight(parsed.entries, archG)} settled=${gearUpSettled(parsed.entries, archG, true)}`);
  console.log(`Cannon inFlight=${gearUpInFlight(parsed.entries, canG)} settled=${gearUpSettled(parsed.entries, canG, true)}`);
  console.log(`Mortar inFlight=${gearUpInFlight(parsed.entries, morG)} settled=${gearUpSettled(parsed.entries, morG, true)}`);

  const builders = detectBbBuilders(parsed.entries);
  console.log(`\nBB builders detected: total=${builders.total} outpost=${builders.outpostOwned} boto=${builders.botoOwned}`);

  const res = scheduleBobGoal({
    data, entries: parsed.entries, settings: { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any,
    inProgress: [], builders: builders.total, defenseId: 1000048,
    nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
  });
  console.log(`\n=== BB Archer jobs ===`);
  for (const l of res.lanes) for (const j of l.jobs) if (j.entityId === 1000048)
    console.log(`  [${l.label}] "${j.name}" ${j.levelFrom ?? ""}→${j.levelTo ?? ""} start=${j.start} Δ=${j.end - j.start}s`);
  const archTrip = res.lanes.flatMap((l) => l.jobs).find((j) => j.entityId === 1000048 && (j.end - j.start) === GEAR_UP_SECONDS.archerTower);
  console.log(`Archer trip (Δ7d): ${archTrip ? `t=${archTrip.start} [${res.lanes.find((l) => l.jobs.includes(archTrip))?.label}]` : "MISSING"}`);
  console.log(`\nBlockers: ${JSON.stringify(res.blockers, null, 2)}`);
  console.log(`Makespan: ${(res.makespan / 86400).toFixed(1)}d`);
}
main().catch((e) => { console.error(e); process.exit(1); });
