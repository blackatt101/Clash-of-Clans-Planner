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

  // inProgress as page.tsx would build it for BB: entries with timer>0, gear-up in-flight dropped
  const gearUpHvIds = new Set([1000008, 1000009, 1000013]);
  const inProgress = parsed.entries
    .filter((e) => e.village === "builderBase" && e.timer && e.timer > 0)
    .map((e) => ({
      uid: 1000000 + e.uid, name: e.name, duration: e.timer as number,
      category: e.category, kind: "builder" as const,
      levelFrom: e.level, levelTo: e.level + 1,
      count: e.count, entityId: e.id,
    }));
  console.log(`inProgress jobs: ${inProgress.map(j => `${j.name} ${j.levelFrom}->${j.levelTo}`).join(", ")}`);

  const res = scheduleBobGoal({
    data, entries: parsed.entries, settings: { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any,
    inProgress, builders, defenseId: 1000048,
    nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
  });

  // Show only trips + Archer, on all lanes, with inProgress flag
  for (const l of res.lanes) {
    const trips = l.jobs.filter(j => ["Gear Up: Archer Tower","Gear Up: Multi Mortar","Gear Up: Double Cannon"].includes(j.name));
    const archers = l.jobs.filter(j => j.entityId === 1000048);
    for (const j of [...trips, ...archers.filter(a => !trips.includes(a))]) {
      console.log(`[${l.label}] "${j.name}" start=${j.start} Δ=${j.end - j.start}s inProgress=${j.inProgress}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
