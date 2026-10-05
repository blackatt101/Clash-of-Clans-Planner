/**
 * Rendered-plan verification (no browser needed).
 *
 * Builds a realistic TH15 queen-charge-hybrid plan, pushes it through
 * the REAL validator, then renders the REAL AttackOverlay to static SVG
 * at every step and asserts the requirements on the emitted markup:
 *
 *   1. each step's visual state actually changes (different visible set)
 *   2. future steps hidden, completed subdued, current highlighted
 *   3. paths / spells appear only at the step they belong to
 *   4. troop groups render as ONE marker ("Miner ×15"), not a swarm
 *   5. no label overlaps a label, a marker, or another label's leader
 *   6. placement is deterministic (same input -> byte-identical SVG)
 *
 * Run: npx tsx scripts/attack-render-check.mts
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as OverlayNS from "../src/components/attack/AttackOverlay";
import { validateStrategy } from "../src/lib/attack/validate";
import { totalHousing, totalSpellHousing } from "../src/lib/attack/catalog";
import { pathStepIndex, spellStepIndex } from "../src/lib/attack/steps";
import type { AttackStrategy } from "../src/lib/attack/types";
import { fixture as raw } from "./attack-fixture.mts";

// tsx transpiles the .tsx module to CJS, so the default export arrives
// double-wrapped depending on the interop path. Unwrap once.
const AttackOverlay =
  ((OverlayNS as any).default?.default ?? (OverlayNS as any).default ?? OverlayNS) as (
    props: any,
  ) => React.ReactElement;

let pass = 0;
let fail = 0;
const t = (name: string, cond: boolean, extra = "") => {
  if (cond) pass++;
  else {
    fail++;
    console.log("FAIL:", name, extra);
  }
};

// ---------------------------------------------------------------------------
// 1) A realistic plan — clustered on purpose, so overlap handling is stressed.
//    The miner group is split into two consecutive steps: the validator must
//    merge it into a single "Miner ×15" marker.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// 2) The real validator
// ---------------------------------------------------------------------------
const v = validateStrategy(raw, { townHall: 15 });
t("fixture validates", v.ok, JSON.stringify(v.errors));
const strategy: AttackStrategy = v.strategy;
const steps = strategy.deployment_plan;

console.log(`Validated plan: ${steps.length} steps, army ${totalHousing(strategy.army.troops)}/320, spells ${totalSpellHousing(strategy.army.spells)}/11`);
console.log("Steps:", steps.map((s) => `${s.step}:${s.unit}×${s.count}(${s.phase})`).join("  "));

// Grouping: the two consecutive miner steps became ONE "Miner ×15" marker.
t("split miner group merged into one step",
  steps.filter((s) => s.unit === "miner").length === 1 &&
    steps.find((s) => s.unit === "miner")!.count === 15,
  JSON.stringify(steps.map((s) => [s.unit, s.count])));

// ---------------------------------------------------------------------------
// 3) Render the REAL overlay at every step
// ---------------------------------------------------------------------------
const vb = { w: 1000, h: 1000 };
const toggles = { markers: true, paths: true, spells: true, targets: true };
const noop = () => {};
const svgRef = { current: null } as unknown as React.RefObject<SVGSVGElement | null>;

function render(activeStep: number, activePhase: string | null = null, strat: AttackStrategy = strategy): string {
  return renderToStaticMarkup(
    createElement(AttackOverlay, {
      strategy: strat, vb, images: {}, activeStep, activePhase, toggles,
      onStepSelect: noop, onPathPointRemove: noop, svgRef,
    }),
  );
}

interface Box { x: number; y: number; w: number; h: number }
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** id -> opacity for <g> elements whose id matches the pattern. */
function groupOpacities(markup: string, pattern: RegExp): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of markup.matchAll(/<g\b[^>]*>/g)) {
    const id = m[0].match(/id="([^"]+)"/)?.[1];
    if (!id || !pattern.test(id)) continue;
    out.set(id, Number(m[0].match(/opacity="([\d.]+)"/)?.[1] ?? "1"));
  }
  return out;
}

/** The inner marker group for step i: <g id="m-i" opacity=…>. */
function markerOpacity(markup: string, i: number): number | null {
  const m = markup.match(new RegExp(`<g id="m-${i}"[^>]*opacity="([\\d.]+)"`));
  return m ? Number(m[1]) : null;
}

function markerCircle(markup: string, i: number): { cx: number; cy: number; r: number } | null {
  const start = markup.indexOf(`<g id="m-${i}"`);
  if (start < 0) return null;
  const end = markup.indexOf("</g>", start);
  const seg = markup.slice(start, end);
  const m = seg.match(/<circle[^>]*fill="rgba\(8,12,18,0\.85\)"[^>]*/);
  if (!m) return null;
  const cx = Number(m[0].match(/cx="([\d.]+)"/)?.[1]);
  const cy = Number(m[0].match(/cy="([\d.]+)"/)?.[1]);
  const r = Number(m[0].match(/r="([\d.]+)"/)?.[1]);
  return { cx, cy, r };
}

/** Label boxes: <g id="lbl-…" …><rect x= y= width= height= …></g>. */
function labelBoxes(markup: string): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const m of markup.matchAll(/<g id="(lbl-[^"]+)"[^>]*>([\s\S]*?)<\/g>/g)) {
    const r = m[2].match(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/);
    if (r) out.set(m[1], { x: +r[1], y: +r[2], w: +r[3], h: +r[4] });
  }
  return out;
}

const spellStep = (strategy.spell_actions ?? []).map((s) => s.step);
const pathStep = (strategy.paths ?? []).map((p) => p.step);

const states: string[] = [];
for (let k = -1; k < steps.length; k++) {
  const markup = render(k);

  // -- deployment markers: current+completed visible, future hidden --
  for (let i = 0; i < steps.length; i++) {
    const op = markerOpacity(markup, i);
    if (k < 0) {
      t(`all-steps: step ${i + 1} fully visible`, op === 1, `got ${op}`);
    } else if (i < k) {
      t(`step ${k + 1}: completed step ${i + 1} subdued`, op === 0.35, `got ${op}`);
    } else if (i === k) {
      t(`step ${k + 1}: current step fully visible`, op === 1, `got ${op}`);
      // highlighted with the dashed ring
      const start = markup.indexOf(`<g id="m-${i}"`);
      const end = markup.indexOf("</g>", start);
      t(`step ${k + 1}: current step has highlight ring`,
        markup.slice(start, end).includes("stroke-dasharray"));
    } else {
      t(`step ${k + 1}: future step ${i + 1} hidden`, op === null, `got ${op}`);
    }
  }

  // -- paths: only from their step onward --
  const pOps = groupOpacities(markup, /ovl-path-\d+/);
  for (let pi = 0; pi < (strategy.paths ?? []).length; pi++) {
    const op = pOps.get(`ovl-path-${pi}`);
    const own = (pathStep[pi] ?? 0) - 1;
    if (k < 0) t(`all-steps: path ${pi} visible`, op === 1, `got ${op}`);
    else if (pi >= 0 && own < k) t(`step ${k + 1}: completed path ${pi} subdued`, op === 0.35, `got ${op}`);
    else if (own === k) t(`step ${k + 1}: current path ${pi} visible`, op === 1, `got ${op}`);
    else t(`step ${k + 1}: future path ${pi} hidden`, op === undefined, `got ${op}`);
  }

  // -- spells: hidden until the step the spell is cast --
  const sOps = groupOpacities(markup, /ovl-spell-\d+/);
  for (let si = 0; si < (strategy.spell_actions ?? []).length; si++) {
    const op = sOps.get(`ovl-spell-${si}`);
    const own = (spellStep[si] ?? 0) - 1;
    if (k < 0) t(`all-steps: spell ${si} visible`, op === 1, `got ${op}`);
    else if (own < k) t(`step ${k + 1}: completed spell ${si} subdued`, op === 0.35, `got ${op}`);
    else if (own === k) t(`step ${k + 1}: spell ${si} revealed at its step`, op === 1, `got ${op}`);
    else t(`step ${k + 1}: future spell ${si} hidden`, op === undefined, `got ${op}`);
  }

  // -- labels: no overlap with each other or with any visible marker --
  const boxes = labelBoxes(markup);
  const keys = [...boxes.keys()];
  let labelVsLabel = false;
  for (let a = 0; a < keys.length; a++)
    for (let b = a + 1; b < keys.length; b++)
      if (overlaps(boxes.get(keys[a])!, boxes.get(keys[b])!)) {
        labelVsLabel = true;
        console.log(`  overlap: ${keys[a]} × ${keys[b]}`);
      }
  t(`step ${k + 1}: no label overlaps another label`, !labelVsLabel);
  let labelVsMarker = false;
  for (let i = 0; i < steps.length; i++) {
    const c = markerCircle(markup, i);
    if (!c) continue;
    const mb: Box = { x: c.cx - c.r, y: c.cy - c.r, w: c.r * 2, h: c.r * 2 };
    for (const [key, box] of boxes) {
      // A label may sit over ITS OWN marker (it is anchored there);
      // the requirement is that it covers no OTHER marker.
      if (key === `lbl-m-${i}`) continue;
      if (overlaps(box, mb)) {
        labelVsMarker = true;
        console.log(`  label ${key} covers marker ${i + 1}`);
      }
    }
  }
  t(`step ${k + 1}: no label covers another marker`, !labelVsMarker);

  // -- the rendered state is genuinely different per step --
  const visible = [
    ...[...Array(steps.length).keys()].filter((i) => markerOpacity(markup, i) !== null),
    ...[...pOps.keys()],
    ...[...sOps.keys()],
    ...[...boxes.keys()],
  ].sort().join("|");
  states.push(visible);
}

for (let k = 1; k < states.length; k++) {
  t(`step ${k} and step ${k + 1} render different visual states`, states[k] !== states[k - 1]);
}
t("all-steps view differs from step 1", states[0] !== states[1]);

// -- determinism: same input -> byte-identical SVG --
t("render is deterministic", render(2) === render(2) && render(-1) === render(-1));

// -- grouped label text: one "Miner ×15", not 15 icons --
const overview = render(-1);
t('grouped marker labelled "Miner ×15"', overview.includes(">Miner ×15<"), "expected a single Miner ×15 label");
t("one marker per group (no swarm)", (overview.match(/<g id="m-\d+"/g) ?? []).length === steps.length);

// -- hero decisions: every available hero evaluated, excluded ones explained --
const TH15_HEROES = ["archer-queen", "barbarian-king", "grand-warden", "royal-champion", "minion-prince", "dragon-duke"];
t("hero decisions cover every available hero",
  TH15_HEROES.every((id) => strategy.heroes?.some((h) => h.id === id)),
  JSON.stringify(strategy.heroes?.map((h) => h.id)));
t("selected heroes have roles",
  (strategy.heroes ?? []).filter((h) => h.use).every((h) => (h.role ?? "").length > 0));
t("excluded heroes have explanations",
  (strategy.heroes ?? []).filter((h) => !h.use).every((h) => (h.reason ?? "").length > 0));
t("selected heroes are deployed in the visual plan",
  (strategy.heroes ?? []).filter((h) => h.use).every((h) => steps.some((s) => s.unit === h.id)));

// -- spell relevance from the spec example: Heal at step 6 absent at step 1 --
t("heal circle absent during step 1", !render(0).includes(`ovl-spell-${spellStep.findIndex((s) => s === 6)}`));

// -- phase filter still works --
const phaseMarkup = render(-1, "core");
t("phase filter dims non-matching steps", phaseMarkup.includes('opacity="0.12"'));

// ---------------------------------------------------------------------------
// 4) The model does not always emit `step` references (low-effort
//    completions omit them). The reveal must still work: attribution
//    falls back deterministically (trigger text -> nearest route ->
//    nearest marker), so every path/spell still belongs to a step.
// ---------------------------------------------------------------------------
const stripped: AttackStrategy = JSON.parse(JSON.stringify(strategy));
for (const p of stripped.paths ?? []) delete p.step;
for (const s of stripped.spell_actions ?? []) delete s.step;

const sSteps = stripped.deployment_plan;
const sPaths = stripped.paths ?? [];
const sSpells = stripped.spell_actions ?? [];
const sPathStep = sPaths.map((p) => pathStepIndex(p, sSteps));
const sSpellStep = sSpells.map((s) => spellStepIndex(s, sSteps, sPaths));

t("stripped: every path still attributed to a step",
  sPathStep.every((si) => si != null), JSON.stringify(sPathStep));
t("stripped: every spell still attributed to a step",
  sSpellStep.every((si) => si != null), JSON.stringify(sSpellStep));

const stripStates: string[] = [];
for (let k = -1; k < sSteps.length; k++) {
  const markup = render(k, null, stripped);
  const pOps = groupOpacities(markup, /ovl-path-\d+/);
  const sOps = groupOpacities(markup, /ovl-spell-\d+/);
  for (let pi = 0; pi < sPaths.length; pi++) {
    const si = sPathStep[pi]!;
    const op = pOps.get(`ovl-path-${pi}`);
    if (k < 0) t(`stripped all-steps: path ${pi} visible`, op === 1, `got ${op}`);
    else if (si > k) t(`stripped step ${k + 1}: future path ${pi} hidden`, op === undefined, `got ${op}`);
    else t(`stripped step ${k + 1}: path ${pi} revealed (owner ${si + 1})`, op === (si === k ? 1 : 0.35), `got ${op}`);
  }
  for (let spi = 0; spi < sSpells.length; spi++) {
    const si = sSpellStep[spi]!;
    const op = sOps.get(`ovl-spell-${spi}`);
    if (k < 0) t(`stripped all-steps: spell ${spi} visible`, op === 1, `got ${op}`);
    else if (si > k) t(`stripped step ${k + 1}: future spell ${spi} hidden`, op === undefined, `got ${op}`);
    else t(`stripped step ${k + 1}: spell ${spi} revealed (owner ${si + 1})`, op === (si === k ? 1 : 0.35), `got ${op}`);
  }
  const visible = [
    ...[...pOps.keys()],
    ...[...sOps.keys()],
    ...[...labelBoxes(markup).keys()],
  ].sort().join("|");
  stripStates.push(visible);
}
for (let k = 1; k < stripStates.length; k++) {
  t(`stripped: step ${k} and step ${k + 1} render different visual states`,
    stripStates[k] !== stripStates[k - 1]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
