import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { computeUpgrades, inFlightOption } from "../src/lib/upgrade";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { GEAR_UPS, gearUpInFlight } from "../src/lib/bbRush";
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

  const res = scheduleBobGoal({
    data, entries: parsed.entries, settings,
    inProgress: [], builders: 3, defenseId: 1000048,
    nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
  });

  // The BB timeline is built from: schedule.options (bbGoal) + planDetails (catalogue)
  // Let's see what ALL Archer rows are, across both
  const allJobs = res.lanes.flatMap(l => l.jobs);
  const archerJobs = allJobs.filter(j => j.entityId === 1000048);
  console.log("=== bbGoal jobs for BB Archer (1000048) ===");
  for (const j of archerJobs) console.log(`  "${j.name}" ${j.levelFrom ?? ""}→${j.levelTo ?? ""} start=${j.start} Δ=${j.end - j.start}s`);

  console.log("\n=== bbGoal options (the detail rows) for BB Archer ===");
  for (const o of res.options ?? []) if (o.id === 1000048)
    console.log(`  uid=${o.uid} "${o.name}" ${o.currentLevel}→${o.nextLevel} time=${o.time}s`);

  // inFlightOption: what in-flight bars exist in the BB village?
  const archerBB = parsed.entries.filter(e => e.id === 1000048 && e.village === "builderBase");
  console.log("\n=== in-flight BB Archer bars (from export timers) ===");
  for (const e of archerBB) {
    if (e.timer != null && e.timer > 0) {
      const o = inFlightOption(e, data);
      console.log(`  ${e.level} timer=${e.timer}s → ${o ? `"${o.name}" ${o.currentLevel}→${o.nextLevel}` : "(none)"}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
