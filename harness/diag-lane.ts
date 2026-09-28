import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { GEAR_UP_SECONDS, detectBbBuilders } from "../src/lib/bbRush";
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

  // Simulate with inProgress empty first, then with the BB in-flight jobs
  const bbInFlight = parsed.entries
    .filter((e) => e.village === "builderBase" && e.timer && e.timer > 0)
    .map((e) => ({
      uid: 100000 + e.uid, name: e.name, duration: e.timer as number,
      category: e.category, kind: "builder" as const, levelFrom: e.level, levelTo: e.level + 1,
      count: e.count, entityId: e.id, family: "buildings",
    }));
  console.log(`BB in-flight from export: ${bbInFlight.map(j => `${j.name} ${j.levelFrom}->${j.levelTo} ${j.duration}s`).join(", ")}`);

  const res = scheduleBobGoal({
    data, entries: parsed.entries, settings: { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any,
    inProgress: bbInFlight, builders, defenseId: 1000048,
    nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
  });
  console.log(`builders=${builders}`);
  for (const l of res.lanes) {
    for (const j of l.jobs) {
      const isTrip = (j.end - j.start) === GEAR_UP_SECONDS.archerTower && j.name.includes("Gear");
      const isInProg = j.inProgress;
      console.log(`[${l.label}] "${j.name}" ${j.levelFrom ?? ""}→${j.levelTo ?? ""} start=${j.start} Δ=${j.end - j.start}s ${isTrip ? "←TRIP" : ""} ${isInProg ? "←IN-PROGRESS" : ""}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
