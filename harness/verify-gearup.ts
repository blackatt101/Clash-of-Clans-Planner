// Gear-up trip verification — run with: node --experimental-strip-types harness/verify-gearup.ts
import { parseExport } from "../src/lib/parse.ts";
import { GameData } from "../src/lib/staticData.ts";
import { scheduleBobGoal } from "../src/lib/bbGoal.ts";
import { detectBbBuilders, GEAR_UP_SECONDS, GEAR_UPS, gearUpInFlight, levelOf, gearUpPerformed } from "../src/lib/bbRush.ts";
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

// Clean: strip gearUp flags so we test the level-signal path.
const clean = pv.entries.map((e) => ({ ...e, gearUp: undefined }));

// Test cases:
// 1. Archer HV=13 (≥ hvTarget=10), no timer → level signal should fire
// 2. Archer HV=5  (< hvTarget=10), no timer → level signal should NOT fire
// 3. Cannon HV=13 (≥ hvTarget=7), timer=186147s (< 2*86400/2 = 86400) → timer NOT in-flight, level IS
// 4. Cannon HV=13, timer=90000 (> 86400) → timer in-flight

const setLevel = (entries: any[], id: number, level: number, timer?: number) =>
  entries.map((e: any) => e.id === id ? { ...e, level, timer: timer ?? e.timer } : e);

function check(label: string, entries: any[]) {
  const inFlight: Record<string, boolean> = {};
  const performed: Record<string, boolean> = {};
  for (const g of GEAR_UPS) {
    inFlight[g.key] = gearUpInFlight(entries, g);
    performed[g.key] = gearUpPerformed(entries, g);
    const hvLvl = levelOf(entries, g.hvId);
    console.log(
      `  ${g.label.padEnd(30)} hvLvl=${hvLvl} (target ${g.hvTarget})  inFlight=${inFlight[g.key]}  performed=${performed[g.key]}`
    );
  }
  const res = scheduleBobGoal({
    data,
    entries,
    settings,
    inProgress: [],
    builders: detectBbBuilders(entries).total,
    defenseId: 1000041,
    nowEpochMs: Date.now(),
    wiggleRoom: 0,
  });
  const gearJobs = (res as any).lanes.flatMap((ln: any) =>
    ln.jobs.filter((j: any) => j.name && j.name.startsWith("Gear Up"))
  );
  console.log(`  gear-up jobs booked: ${gearJobs.length}`);
  for (const j of gearJobs) {
    const lane = (res as any).lanes.find((ln: any) => ln.jobs.includes(j));
    const secs = Math.round((j.end - j.start) / 3600);
    console.log(`    "${j.name}" lane=${lane?.label} start=${j.start}s end=${j.end}s dur≈${secs}h`);
  }
  console.log(`  blockers: ${res.blockers.length ? res.blockers.join(" | ") : "(none)"}`);
}

console.log("\n=== Case 1: Archer HV=13, no timer (level signal) ===");
check("archer-hv13", setLevel(clean, 1000009, 13, 0));

console.log("\n=== Case 2: Archer HV=5, no timer (below target, no level signal) ===");
check("archer-hv5", setLevel(clean, 1000009, 5, 0));

console.log("\n=== Case 3: Cannon HV=13, short timer=186147s (< 86400 threshold, level signal) ===");
check("cannon-short-timer", setLevel(clean, 1000008, 13, 186147));

console.log("\n=== Case 4: Cannon HV=13, long timer=90000s (> 86400 threshold, timer signal) ===");
check("cannon-long-timer", setLevel(clean, 1000008, 13, 90000));
