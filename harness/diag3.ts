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

  // User's REAL state: BB Archer=6 (target met), BB Double Cannon=4 (target met), HV Archer=13
  // test-export has BB Archer copies at 1,3,5 and Double Cannon at 2,4
  const mk = (o: { bbArcher?: number; hvArcher?: number }) =>
    parsed.entries.map((e) => {
      let x = { ...e };
      if (o.bbArcher != null && e.id === 1000048 && e.village === "builderBase") x.level = o.bbArcher;
      if (o.hvArcher != null && e.id === 1000009 && e.village === "home") x.level = o.hvArcher;
      return x;
    });

  const runs: [string, any][] = [
    ["BB Archer=6, HV Archer=13 (your state, defense=archer)", mk({ bbArcher: 6, hvArcher: 13 })],
    ["BB Archer=5, HV Archer=13 (test-export as-is)", mk({ hvArcher: 13 })],
  ];

  for (const [label, entries] of runs) {
    const archG = GEAR_UPS.find((g) => g.key === "archerTower")!;
    const res = scheduleBobGoal({
      data, entries, settings: { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any,
      inProgress: [], builders: 2, defenseId: 1000048,
      nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
    });
    console.log(`\n=== ${label} ===`);
    console.log(`  inFlight=${gearUpInFlight(entries, archG)} settled=${gearUpSettled(entries, archG, false)}`);
    for (const l of res.lanes) {
      const arch = l.jobs.filter((j) => j.entityId === 1000048);
      for (const j of arch) console.log(`  [${l.label}] "Archer ${j.levelFrom}→${j.levelTo}" start=${j.start} Δ=${j.end - j.start}s (${((j.end - j.start) / 86400).toFixed(1)}d)`);
    }
    const trip = res.lanes.flatMap((l) => l.jobs).find((j) => j.entityId === 1000048 && (j.end - j.start) === GEAR_UP_SECONDS.archerTower);
    console.log(`  Archer TRIP (7d) booked? ${trip ? "YES" : "NO"} · blockers: ${JSON.stringify(res.blockers)}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
