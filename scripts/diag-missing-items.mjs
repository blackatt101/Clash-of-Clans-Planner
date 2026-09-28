#!/usr/bin/env node
// Diagnostic: compare every group the parser consumes against the slim static
// data, and report which entities from an export would be invisible to the
// planner (no rulebook row) or only in some files.
// Usage: node scripts/diag-missing-items.mjs test-export.json
import fs from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const FILES = ["buildings", "troops", "heroes", "spells", "pets", "equipment", "traps", "helpers"];

const have = {};
const names = {};
for (const f of FILES) {
  const items = JSON.parse(fs.readFileSync(`${root}public/data/${f}.json`, "utf8")).items;
  have[f] = new Set(items.map((e) => e._id));
  for (const e of items) names[e._id] = e.name;
}
const anyHave = new Set(Object.values(have).flatMap((s) => [...s]));

// The exact groups parse.ts consumes (export key -> slim file).
const GROUPS = {
  buildings: "buildings",
  traps: "traps",
  units: "troops",
  siege_machines: "troops",
  heroes: "heroes",
  spells: "spells",
  pets: "pets",
  equipment: "equipment",
  helpers: "helpers",
  buildings2: "buildings",
  traps2: "traps",
  units2: "troops",
  heroes2: "heroes",
};

const expFile = process.argv[2];
if (!expFile) {
  console.log("usage: node scripts/diag-missing-items.mjs <export.json>");
  process.exit(2);
}
const exp = JSON.parse(fs.readFileSync(expFile, "utf8"));

let total = 0;
for (const [g, slimFile] of Object.entries(GROUPS)) {
  const arr = exp[g];
  if (!Array.isArray(arr)) continue;
  const missing = [...new Set(arr.filter((e) => e && typeof e.data === "number" && !anyHave.has(e.data)).map((e) => e.data))];
  if (!missing.length) continue;
  for (const id of missing) {
    total++;
    const lvl = arr.filter((e) => e.data === id).map((e) => e.lvl ?? "?").join("/");
    console.log(
      `MISSING: ${g} #${id} (lvl ${lvl}) — no ${slimFile} entity; would show as "Unknown #${id}" and be skipped by computeUpgrades`
    );
  }
}

// Entities that have an icon (so they exist in-game) but no rulebook row.
const img = JSON.parse(fs.readFileSync(`${root}public/data/images.json`, "utf8"));
function fileFor(id) {
  const s = String(id);
  if (s.startsWith("1000")) return "buildings";
  if (s.startsWith("4000")) return "troops";
  if (s.startsWith("1200")) return "traps";
  if (s.startsWith("2600")) return "spells";
  if (s.startsWith("2800")) return "heroes";
  if (s.startsWith("7300")) return "pets";
  if (s.startsWith("9000")) return "equipment";
  if (s.startsWith("9300")) return "helpers";
  return null;
}
console.log(`\n--- icons with no rulebook row (hidden from the whole catalogue, not just this export) ---`);
const orphanIcons = Object.keys(img)
  .filter((id) => {
    const f = fileFor(Number(id));
    return f && !have[f].has(Number(id));
  })
  .map((id) => `${fileFor(Number(id))} #${id}`);
if (orphanIcons.length) console.log(orphanIcons.join("\n"));
else console.log("(none)");

console.log(`\n${total} missing reference(s) in ${expFile} (parser groups only).`);
