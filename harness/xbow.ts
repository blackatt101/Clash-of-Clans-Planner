import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { bbDefenseTarget, detectBbBuilders } from "../src/lib/bbRush";

async function main() {
  const fs = await import("fs");
  const data = new GameData() as any;
  data.byId = new Map();
  for (const f of ["buildings","troops","heroes","spells","pets","equipment","traps","helpers"]) {
    const j = JSON.parse(fs.readFileSync(`/root/coc-planner/public/data/${f}.json`, "utf8"));
    for (const item of j.items) if (!data.byId.has(item._id)) data.byId.set(item._id, item);
  }
  // 11 BB buildings all at lvl 1. Star Lab 10, so troops are lab-gated up high.
  const raw = {
    buildings: [],
    buildings2: [
      { data: 1000034, lvl: 5 },
      { data: 1000035, lvl: 1, cnt: 4 },
      { data: 1000036, lvl: 5, cnt: 2 },
      { data: 1000037, lvl: 1, cnt: 4 },
      { data: 1000038, lvl: 5, cnt: 2 },
      { data: 1000041, lvl: 4 },
      { data: 1000043, lvl: 3 },
      { data: 1000044, lvl: 4, cnt: 2 },
      { data: 1000045, lvl: 8 },
      { data: 1000046, lvl: 10 },
      { data: 1000048, lvl: 6 },
      { data: 4000041, lvl: 20 },
    ],
    timestamp: 1789646143,
  };
  const parsed = parseExport(raw, data);
  console.log("detected builders:", detectBbBuilders(parsed.entries));
  const defId = bbDefenseTarget(parsed.entries, null, data);
  console.log("auto defense:", defId, data.byId.get(defId)?.name, "(X-Bow capped at 5; others cap at 10)");
  const res = scheduleBobGoal({
    data, entries: parsed.entries, settings: DEFAULT_SETTINGS, inProgress: [],
    builders: detectBbBuilders(parsed.entries).total, defenseId: defId,
    nowEpochMs: raw.timestamp * 1000, wiggleRoom: 0,
  });
  console.log("makespan", res.makespan, "options", res.options.length);
  console.log("blockers", JSON.stringify(res.blockers, null, 1));
}
main().catch(e => { console.error(e); process.exit(1); });
