import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { GEAR_UPS, GEAR_UP_SECONDS, detectBbBuilders, gearUpInFlight, gearUpSettled, hasGearUpFlag } from "../src/lib/bbRush";
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
  const builders = detectBbBuilders(parsed.entries).total;
  const flagKnown = hasGearUpFlag(parsed.entries);
  console.log(`flagKnown=${flagKnown}`);

  console.log("\n=== per-gear-up classification ===");
  for (const g of GEAR_UPS) {
    const inFlight = gearUpInFlight(parsed.entries, g);
    const settled = gearUpSettled(parsed.entries, g, flagKnown);
    const hvLvl = parsed.entries.find((e) => e.id === g.hvId)?.level ?? 0;
    const bbLvl = parsed.entries.find((e) => e.id === g.bbId)?.level ?? 0;
    const flag = parsed.entries.find((e) => e.id === g.hvId)?.gearUp;
    console.log(`  ${g.key}: hv=${hvLvl}(need ${g.hvTarget}) bb=${bbLvl}(need ${g.bbTarget}) flag=${flag ?? "absent"} → inFlight=${inFlight} settled=${settled}`);
  }

  const res = scheduleBobGoal({
    data, entries: parsed.entries, settings: { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any,
    inProgress: [], builders, defenseId: 1000048,
    nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
  });
  const trips = res.lanes.flatMap((l) => l.jobs).filter((j) => GEAR_UPS.some((g) => j.name === g.label));
  console.log(`\n=== trip jobs in plan (${trips.length}) ===`);
  for (const j of trips) {
    const lane = res.lanes.find((l) => l.jobs.includes(j))?.label;
    console.log(`  [${lane}] "${j.name}" start=${j.start} Δ=${j.end - j.start}s inProgress=${j.inProgress}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
