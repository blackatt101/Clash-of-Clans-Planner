import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { detectBbBuilders } from "../src/lib/bbRush";
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

  const inProgress = parsed.entries
    .filter((e) => e.village === "builderBase" && e.timer && e.timer > 0)
    .map((e, i) => ({
      uid: 1000000 + i, name: e.name, duration: e.timer as number,
      category: e.category, kind: "builder",
      levelFrom: e.level, levelTo: e.level + 1,
      count: 1, entityId: e.id, family: "buildings",
    }));

  const res = scheduleBobGoal({
    data, entries: parsed.entries, settings: { ...DEFAULT_SETTINGS, builderBaseStrategy: "rush6th" } as any,
    inProgress, builders, defenseId: 1000048,
    nowEpochMs: parsed.timestamp! * 1000, wiggleRoom: 0,
  });
  for (const l of res.lanes) {
    console.log(`\n[${l.label}]`);
    for (const j of l.jobs) {
      const lvl = j.levelFrom != null ? ` ${j.levelFrom}→${j.levelTo}` : "";
      console.log(`  ${String(j.start).padStart(9)} ${String(j.end).padStart(9)} "${j.name}"${lvl} Δ=${j.end - j.start}s inProgress=${j.inProgress}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
