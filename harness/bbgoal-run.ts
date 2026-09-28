import { SAMPLE_EXPORT } from "../src/lib/sample";
import { parseExport } from "../src/lib/parse";
import { GameData } from "../src/lib/staticData";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { scheduleBobGoal } from "../src/lib/bbGoal";
import { detectBbBuilders, bbDefenseTarget } from "../src/lib/bbRush";

async function main() {
  // Load data from the same place the app does
  const loadAll = async () => {
    const files = ["buildings","troops","heroes","spells","pets","equipment","traps","helpers"] as const;
    const data = new GameData() as any; data.byId = new Map();
    for (const f of files) {
      const res = await fetch(`http://localhost:3000/data/${f}.json`).catch(() => null);
      if (!res || !res.ok) return null;
      const j = await res.json();
      for (const item of j.items) if (!data.byId.has(item._id)) data.byId.set(item._id, item);
    }
    return data;
  };
  let gd = await loadAll();
  if (!gd) {
    // fallback: build directly from files on disk
    const fs = await import("fs");
    const data = new GameData() as any; data.byId = new Map();
    for (const f of ["buildings","troops","heroes","spells","pets","equipment","traps","helpers"]) {
      const j = JSON.parse(fs.readFileSync(`/root/coc-planner/public/data/${f}.json`, "utf8"));
      for (const item of j.items) if (!data.byId.has(item._id)) data.byId.set(item._id, item);
    }
    gd = data;
  }
  const data = new GameData() as any;
  data.byId = gd.byId;

  const raw = JSON.parse(SAMPLE_EXPORT);
  const parsed = parseExport(raw, data);
  console.log("bbBuilders:", detectBbBuilders(parsed.entries));
  const defId = bbDefenseTarget(parsed.entries, DEFAULT_SETTINGS.bbDefense, data);
  console.log("defenseId:", defId);
  const res = scheduleBobGoal({
    data,
    entries: parsed.entries,
    settings: DEFAULT_SETTINGS,
    inProgress: [],
    builders: detectBbBuilders(parsed.entries).total,
    defenseId: defId,
    nowEpochMs: raw.timestamp * 1000,
    wiggleRoom: 0,
  });
  console.log("makespan s:", res.makespan, "=", res.makespan/86400, "days");
  console.log("blockers:", JSON.stringify(res.blockers, null, 1));
  console.log("options:", res.options.length);
  for (const l of res.lanes) {
    const jobs = l.jobs.map(j => `${j.name} ${j.levelFrom}→${j.levelTo} [${j.start}..${j.end}]`).join(" | ");
    console.log(`-- ${l.label}: ${jobs || "(idle)"}`);
  }
  console.log("resources:", JSON.stringify(res.resources, null, 1));
}
main().catch(e => { console.error(e); process.exit(1); });
