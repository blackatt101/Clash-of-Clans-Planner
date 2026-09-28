import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { GEAR_UP_SECONDS } from "../src/lib/bbRush";
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
  const entries = parsed.entries.map((e) =>
    e.id === 1000048 && e.village === "builderBase" ? { ...e, level: 6 } :
    e.id === 1000009 && e.village === "home" ? { ...e, level: 13, gearUp: undefined } : e);

  const res = scheduleBobGoal({
    data, entries, settings: { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any,
    inProgress: [], builders: 2, defenseId: 1000048,
    nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
  });
  console.log("Builder 1 (Master) lane, full order:");
  for (const j of res.lanes.find((l) => l.label === "Builder 1")!.jobs)
    console.log(`  ${j.start.toString().padStart(9)} ${j.end.toString().padStart(9)} "${j.name}" ${j.levelFrom ?? ""}→${j.levelTo ?? ""} Δ=${j.end - j.start}s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
