/**
 * Sanity-check fallback attribution on a REAL generated plan
 * whose paths/spells lack `step` references (model flakiness).
 * Prints what each element attributes to, so the estimates can
 * be eyeballed against the plan's narrative.
 * Run: npx tsx scripts/check-attribution.mts /tmp/strategy.json
 */
import { readFileSync } from "node:fs";
import { validateStrategy } from "../src/lib/attack/validate";
import { pathStepIndex, spellStepIndex } from "../src/lib/attack/steps";
import { resolveEntity } from "../src/lib/attack/catalog";

const raw = JSON.parse(readFileSync(process.argv[2] ?? "/tmp/strategy.json", "utf8"));
const v = validateStrategy(raw.strategy ?? raw, { townHall: 15 });
if (!v.ok) {
  console.log("validation failed:", v.errors);
  process.exit(1);
}
const s = v.strategy;
const steps = s.deployment_plan;
const paths = s.paths ?? [];
const spells = s.spell_actions ?? [];

console.log("steps:");
for (const st of steps)
  console.log(`  ${st.step}: ${st.unit} x${st.count} @ (${st.position.x}, ${st.position.y})`);

console.log("\npath attribution (no step refs — fallback):");
for (const p of paths) {
  const si = pathStepIndex({ ...p, step: undefined }, steps);
  const owner = si != null ? `${steps[si].step}:${steps[si].unit}` : "overview-only";
  console.log(`  ${p.unit} (${p.points[0].x},${p.points[0].y})->(${p.points[p.points.length-1].x},${p.points[p.points.length-1].y}) => step ${owner}`);
}

console.log("\nspell attribution (no step refs — fallback):");
for (const sp of spells) {
  const si = spellStepIndex({ ...sp, step: undefined }, steps, paths);
  const owner = si != null ? `${steps[si].step}:${steps[si].unit}` : "overview-only";
  console.log(`  ${sp.spell} @ (${sp.position.x},${sp.position.y}) "${(sp.trigger ?? "").slice(0, 55)}" => step ${owner}`);
}

// How many elements relied on the fallback?
const explicit = spells.filter((x) => x.step != null).length;
console.log(`\n${explicit}/${spells.length} spells had explicit step refs in this generation`);
