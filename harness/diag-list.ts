import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { computeUpgrades } from "../src/lib/upgrade";
import { scheduleJobs } from "../src/lib/schedule";
import { bbRushBoost, detectBbBuilders, bbHeroTotal } from "../src/lib/bbRush";
import { jobKind } from "../src/lib/strategy";
import { familyOf } from "../src/lib/priorityOrder";
import { effectiveTime, effectiveCost } from "../src/lib/discounts";
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
  const settings = { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any;
  const builders = detectBbBuilders(parsed.entries).total;

  const all = computeUpgrades(parsed, data);
  const bbArcher = all.filter((o) => o.id === 1000048 && o.village === "builderBase" && o.available && (o.time ?? 0) > 0);
  console.log(`Schedulable BB Archer: ${bbArcher.map(o => `${o.currentLevel}→${o.nextLevel}`).join(", ")}`);

  // Simulate listSchedule: one ScheduleJob per row, run through scheduleJobs
  const jobs = bbArcher.map((o) => ({
    uid: o.uid,
    name: o.name,
    duration: effectiveTime(o, settings) ?? 0,
    category: o.category,
    kind: jobKind(o.category),
    count: 1,
    family: "buildings",
    priority: bbRushBoost(o, settings, bbHeroTotal(parsed.entries), 1000048),
    after: o.inFlightSeconds,
  }));
  const res = scheduleJobs(jobs, { builders, blocks: settings.blocks, village: "builderBase", nowEpochMs: 0 }, []);
  console.log(`\nlistSchedule: ${builders} builders, Archer jobs:`);
  for (const l of res.lanes) for (const j of l.jobs)
    console.log(`  [${l.label}] start=${j.start} Δ=${j.duration}s (${(j.duration/86400).toFixed(1)}d)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
