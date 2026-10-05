/**
 * Dump the RAW model output for the synthetic base so we can see
 * exactly which fields the model omits (step refs, triggers, …).
 * Run: npx tsx scripts/dump-raw.mts /tmp/base_b64.txt
 */
import { readFileSync } from "node:fs";
import { generateStrategy } from "../src/lib/attack/ai";
import { validateStrategy } from "../src/lib/attack/validate";

const b64 = readFileSync(process.argv[2] ?? "/tmp/base_b64.txt", "utf8").trim();
const result = await generateStrategy(
  {
    screenshot: `data:image/png;base64,${b64}`,
    townHall: 15,
  },
  validateStrategy,
);
console.log("valid:", result.valid, "| attempts:", result.attempts);
if (result.errors.length) console.log("errors:", result.errors);
const raw = result.raw as Record<string, any>;
console.log("--- raw paths ---");
for (const p of raw.paths ?? []) console.log(JSON.stringify(p));
console.log("--- raw spell_actions ---");
for (const s of raw.spell_actions ?? []) console.log(JSON.stringify(s));
console.log("--- raw hero_abilities ---");
for (const h of raw.hero_abilities ?? []) console.log(JSON.stringify(h));
console.log("--- deployment steps (unit/phase) ---");
for (const d of raw.deployment_plan ?? []) console.log(d.step, d.unit, d.phase);
