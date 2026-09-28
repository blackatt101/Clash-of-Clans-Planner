import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { GEAR_UP_SECONDS, bobCriticalTargets } from "../src/lib/bbRush";
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

  const targets = bobCriticalTargets(parsed.entries, DEFAULT_SETTINGS, 1000048);
  console.log("=== bobCriticalTargets (defenseId=Archer 1000048) ===");
  for (const t of targets)
    console.log(`  id=${t.id} target=${t.target} label="${t.label}" category=${t.category} gearUp=${t.gearUp ? t.gearUp.key : "none"}`);

  const res = scheduleBobGoal({
    data, entries: parsed.entries, settings: { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any,
    inProgress: [], builders: 3, defenseId: 1000048,
    nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
  });
  console.log("\n=== ALL Archer Tower jobs (1000048) ===");
  for (const l of res.lanes) for (const j of l.jobs) if (j.entityId === 1000048)
    console.log(`  [${l.label}] "${j.name}" ${j.levelFrom ?? ""}→${j.levelTo ?? ""} start=${j.start} Δ=${j.end - j.start}s (${((j.end - j.start) / 86400).toFixed(1)}d)`);
  console.log("\n=== options with Archer ===");
  for (const o of res.options ?? []) if (o.id === 1000048)
    console.log(`  uid=${o.uid} name="${o.name}" currentLevel=${o.currentLevel} nextLevel=${o.nextLevel} time=${o.time}s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
