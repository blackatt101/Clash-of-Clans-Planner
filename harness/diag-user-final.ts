import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { GEAR_UPS, detectBbBuilders, gearUpInFlight, gearUpSettled, gearUpRemainingSeconds, hasGearUpFlag } from "../src/lib/bbRush";
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

  console.log(`=== per-gear-up classification (user JSON, flagKnown=${flagKnown}) ===`);
  for (const g of GEAR_UPS) {
    const inFlight = gearUpInFlight(parsed.entries, g);
    const settled = gearUpSettled(parsed.entries, g, flagKnown);
    const remaining = gearUpRemainingSeconds(parsed.entries, g);
    const hvLvl = parsed.entries.find((e) => e.id === g.hvId)?.level ?? 0;
    const bbLvl = parsed.entries.find((e) => e.id === g.bbId)?.level ?? 0;
    const ownFlag = parsed.entries.find((e) => e.id === g.hvId)?.gearUp;
    console.log(`  ${g.key}: hv=${hvLvl}(need ${g.hvTarget}) bb=${bbLvl}(need ${g.bbTarget}) ownFlag=${ownFlag ?? "absent"} → inFlight=${inFlight} settled=${settled} remaining=${remaining != null ? (remaining/86400).toFixed(1)+"d" : "n/a"}`);
  }

  // inProgress as page.tsx would build it (BB entries with timer>0, gear-up in-flight dropped)
  const gearUpHvIds = new Set(GEAR_UPS.map(g => g.hvId));
  const inProgress = parsed.entries
    .filter((e) => e.village === "builderBase" && e.timer && e.timer > 0)
    .map((e, i) => ({
      uid: 1000000 + i, name: e.name, duration: e.timer as number,
      category: e.category, kind: "builder" as const,
      levelFrom: e.level, levelTo: e.level + 1,
      count: 1, entityId: e.id, family: "buildings",
    }));

  const res = scheduleBobGoal({
    data, entries: parsed.entries, settings: { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any,
    inProgress, builders, defenseId: 1000048,
    nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
  });

  console.log(`\n=== trips in plan ===`);
  for (const g of GEAR_UPS) {
    const trips = res.lanes.flatMap(l => l.jobs).filter(j => j.name === g.label);
    for (const j of trips) {
      const lane = res.lanes.find(l => l.jobs.includes(j))?.label;
      console.log(`  "${j.name}" [${lane}] start=${j.start} Δ=${j.end - j.start}s (${((j.end - j.start)/86400).toFixed(1)}d) inProgress=${j.inProgress}`);
    }
    if (trips.length === 0) console.log(`  "${g.label}": NOT BOOKED`);
  }
  console.log(`\n=== Archer 1000048 jobs ===`);
  for (const l of res.lanes) for (const j of l.jobs) if (j.entityId === 1000048)
    console.log(`  [${l.label}] "${j.name}" ${j.levelFrom ?? ""}→${j.levelTo ?? ""} Δ=${j.end - j.start}s`);
  console.log(`Blockers: ${JSON.stringify(res.blockers)}`);
}
main().catch(e => { console.error(e); process.exit(1); });
