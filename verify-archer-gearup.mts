import { parseExport } from "./src/lib/parse.ts";
import { GameData } from "./src/lib/staticData.ts";
import { scheduleBobGoal } from "./src/lib/bbGoal.ts";
import { detectBbBuilders, GEAR_UP_SECONDS } from "./src/lib/bbRush.ts";
import { readFileSync } from "node:fs";

const data = new GameData() as any;
data.byId = new Map();
for (const f of ["buildings", "troops", "heroes", "spells", "pets", "equipment", "traps", "helpers"]) {
  const j = JSON.parse(readFileSync(`/root/coc-planner/public/data/${f}.json`, "utf8"));
  for (const item of j.items) if (!data.byId.has(item._id)) data.byId.set(item._id, item);
}
const raw = JSON.parse(readFileSync("/root/coc-planner/test-export.json", "utf8"));
const pv = await parseExport(raw, data);

const settings = {
  builders: 6,
  bbBuilders: "auto",
  blocks: [],
  horizon: 0,
  heroLanes: 1,
  heroChain: "plan",
  strategy: "general",
  offenseBeforeTh: 0,
  offenseWeights: {},
  upgradeOrder: [],
  heroOrder: [],
  petOrder: [],
  labOrder: [],
  goldPass: 0,
  builderBoost: 0,
  researchBoost: 0,
  wiggleRoom: 0,
  heroSchedule: "all",
  cwlBlock: false,
  labPriority: "general",
  includeTh: true,
  bbMaxTroop: 4000041,
} as any;

// Base state: cannon HV at 7 (done), archer HV at 5 (NOT done), mortar HV at 8 (done).
// BB: Double Cannon at 4 (bbTarget met), Archer Tower at 5 (NOT met, target 6), Multi Mortar at 5 (NOT met, target 8).
// So: cannon gear-up should be scheduled; archer + mortar gear-ups should be blocked.
const clean = pv.entries.map((e) => ({ ...e, gearUp: undefined }));

function run(label: string, entries: any[]) {
  const builders = detectBbBuilders(entries);
  const res = scheduleBobGoal({
    data,
    entries,
    settings,
    inProgress: [],
    builders: builders.total,
    defenseId: 1000041,
    nowEpochMs: Date.now(),
    wiggleRoom: 0,
  });
  console.log(`\n=== ${label} ===`);
  for (const b of res.blockers) console.log("blocker:", b);
  const gear = (res as any).lanes.flatMap((ln: any) =>
    ln.jobs.filter((j: any) => j.name && j.name.startsWith("Gear Up"))
  );
  for (const j of gear) {
    const lane = (res as any).lanes.find((ln: any) => ln.jobs.includes(j));
    console.log(
      `  gear job: "${j.name}" lane="${lane?.label}" start=${j.start}s end=${j.end}s entityId=${j.entityId}`
    );
  }
  const lane0 = (res as any).lanes[0];
  console.log(
    "  lane0 jobs:",
    lane0?.jobs.map((j: any) => j.name + " (" + j.start + "-" + j.end + ")").join(", ")
  );
}

run("Base state (archer HV=5, NOT done)", clean);

const archerHv10 = clean.map((e: any) => (e.id === 1000009 ? { ...e, level: 10 } : e));
run("Archer HV=10 (done)", archerHv10);
