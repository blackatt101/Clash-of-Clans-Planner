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
 *   7. the overlay stays an annotation layer: small markers, small
 *      translucent spell areas, a route weight hierarchy, and one
 *      colour per attack group (marker, label and route agree)
 *   8. the step-by-step and army-composition panels carry the
 *      instructions off the map
 *
 * Run: npx tsx scripts/attack-render-check.mts
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as OverlayNS from "../src/components/attack/AttackOverlay";
import * as StepsNS from "../src/components/attack/AttackStepsPanel";
import * as ArmyNS from "../src/components/attack/AttackArmyPanel";
import { validateStrategy } from "../src/lib/attack/validate";
import { resolveStrategyId } from "../src/lib/attack/strategies";
import { resolveEntity, totalHousing, totalSpellHousing } from "../src/lib/attack/catalog";
import { pathStepIndex, spellStepIndex } from "../src/lib/attack/steps";
import {
  BADGE_R,
  MARKER_R,
  PATH_WEIGHTS,
  SPELL_DEFAULT_RADIUS,
  SPELL_FILL_OPACITY,
  SPELL_RADIUS,
  pathRole,
  phaseColor,
  phaseIndexOf,
  targetGlyph,
} from "../src/lib/attack/visuals";
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

function markerCircle(markup: string, i: number): { cx: number; cy: number; r: number; stroke: string } | null {
  const start = markup.indexOf(`<g id="m-${i}"`);
  if (start < 0) return null;
  const end = markup.indexOf("</g>", start);
  const seg = markup.slice(start, end);
  const m = seg.match(/<circle[^>]*fill="rgba\(8,12,18,0\.85\)"[^>]*/);
  if (!m) return null;
  const cx = Number(m[0].match(/cx="([\d.]+)"/)?.[1]);
  const cy = Number(m[0].match(/cy="([\d.]+)"/)?.[1]);
  const r = Number(m[0].match(/r="([\d.]+)"/)?.[1]);
  const stroke = m[0].match(/stroke="([^"]+)"/)?.[1] ?? "";
  return { cx, cy, r, stroke };
}

/** The markup segment of <g id="..."> up to its first closing tag. */
function segment(markup: string, id: string): string {
  const start = markup.indexOf(`<g id="${id}"`);
  return start < 0 ? "" : markup.slice(start, markup.indexOf("</g>", start));
}

/** Every <circle> in a group: radius and stroke colour. */
function circlesIn(markup: string, id: string): { r: number; stroke: string }[] {
  return [...segment(markup, id).matchAll(/<circle\b[^>]*>/g)].map((m) => ({
    r: Number(m[0].match(/r="([\d.]+)"/)?.[1] ?? "0"),
    stroke: m[0].match(/stroke="([^"]+)"/)?.[1] ?? "",
  }));
}

/**
 * The route line of path `pi` (the thinner of the two strokes —
 * the halo is always the wider one), with its colour.
 */
function corePath(markup: string, pi: number): { width: number; stroke: string } | null {
  const paths = [...segment(markup, `ovl-path-${pi}`).matchAll(/<path\b[^>]*>/g)].map((m) => m[0]);
  if (paths.length === 0) return null;
  const widths = paths.map((p) => Number(p.match(/stroke-width="([\d.]+)"/)?.[1] ?? "0"));
  const min = Math.min(...widths);
  const core = paths[widths.indexOf(min)];
  return { width: min, stroke: core.match(/stroke="([^"]+)"/)?.[1] ?? "" };
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

// ---------------------------------------------------------------------------
// 4) The tactical-guide redesign: the overlay is an annotation layer
//    on top of the base — small primitives, a route hierarchy, one
//    colour per attack group, and the instructions off the map.
// ---------------------------------------------------------------------------

// -- markers: one small badge per troop group, not a giant icon --
for (let i = 0; i < steps.length; i++) {
  const c = markerCircle(overview, i);
  t(`marker ${i + 1} is compact`, !!c && c.r <= MARKER_R * vb.w + 0.5, `r=${c?.r}`);
  const badge = circlesIn(overview, `m-${i}`).find((x) => c && x.r < c.r && x.r > 0);
  t(`marker ${i + 1} carries a compact step badge`,
    !!badge && badge.r <= BADGE_R * vb.w + 0.5, `r=${badge?.r}`);
}

// -- spell areas: small, translucent hints, sized per spell --
for (let i = 0; i < (strategy.spell_actions ?? []).length; i++) {
  const sp = strategy.spell_actions![i];
  const area = circlesIn(overview, `ovl-spell-${i}`)[0];
  const expected = (SPELL_RADIUS[sp.spell] ?? SPELL_DEFAULT_RADIUS) * vb.w;
  t(`spell ${i + 1} (${sp.spell}) area is small`, !!area && area.r <= expected + 0.5, `r=${area?.r} vs ${expected}`);
  const fo = Number(segment(overview, `ovl-spell-${i}`).match(/fill-opacity="([\d.]+)"/)?.[1] ?? "1");
  t(`spell ${i + 1} area is translucent`, fo <= SPELL_FILL_OPACITY + 0.005, `got ${fo}`);
}

// -- route hierarchy: the push is the thick line, funnels/cleanup quieter --
const widthsByRole = new Map<string, number>();
for (let pi = 0; pi < (strategy.paths ?? []).length; pi++) {
  const p = strategy.paths![pi];
  const role = pathRole(p.style);
  const expected = PATH_WEIGHTS[role].core * vb.w;
  const core = corePath(overview, pi);
  t(`route ${pi + 1} (${p.style ?? "attack"}) draws at its ${role} weight`,
    !!core && Math.abs(core.width - expected) < 0.5, `w=${core?.width} vs ${expected}`);
  widthsByRole.set(role, core?.width ?? 0);
}
{
  const wp = widthsByRole.get("primary");
  const ws = widthsByRole.get("secondary");
  const wt = widthsByRole.get("support");
  t("route hierarchy: primary > secondary > support",
    wp != null && ws != null && wt != null && wp > ws && ws > wt,
    [...widthsByRole.entries()].map(([k, v]) => `${k}=${v.toFixed(1)}`).join(" "));
}

// -- one colour per attack group: marker, label and route agree --
for (let i = 0; i < steps.length; i++) {
  const color = phaseColor(phaseIndexOf(steps[i].phase, strategy.attack_phases ?? []));
  const mb = markerCircle(overview, i);
  t(`marker ${i + 1} painted in its group colour`, !!mb && mb.stroke === color, `${mb?.stroke} vs ${color}`);
  const lbl = segment(overview, `lbl-m-${i}`).match(/<rect[^>]*stroke="([^"]+)"/)?.[1];
  t(`label ${i + 1} painted in its group colour`, lbl === color, `${lbl} vs ${color}`);
}
// the overlay's own attribution (0-based) — the raw 1-based `step`
// refs are renumbered when the validator merges deployment steps.
const attributed = (strategy.paths ?? []).map((p) => pathStepIndex(p, steps));
for (let pi = 0; pi < (strategy.paths ?? []).length; pi++) {
  const si = attributed[pi];
  if (si == null) continue;
  const color = phaseColor(phaseIndexOf(steps[si].phase, strategy.attack_phases ?? []));
  const core = corePath(overview, pi);
  t(`route ${pi + 1} painted in its group colour`, !!core && core.stroke === color, `${core?.stroke} vs ${color}`);
}

// -- priority targets: compact glyphs, never big labels --
t("target glyphs are compact",
  targetGlyph("town_hall") === "TH" && targetGlyph("eagle_artillery") === "Eagle" &&
  targetGlyph("air_defense") === "Air Def" && targetGlyph("clan_castle") === "CC");
t("target glyph keeps an explicit label", targetGlyph("unknown_defense", "Town Hall") === "Town Hall");
const targetGlyphs = (strategy.base_analysis?.importantTargets ?? []).map((tg) => targetGlyph(tg.type, tg.label));
t("priority targets render as compact glyphs",
  targetGlyphs.every((g) => overview.includes(`>${g}<`)), JSON.stringify(targetGlyphs));

// -- the instruction panels carry the plan OFF the map --
const stepsPanel = renderToStaticMarkup(
  createElement(StepsNS.AttackStepsPanel, {
    strategy, activeStep: 1, onSelect: noop, images: {},
  }),
);
t("steps panel: every step listed", steps.every((s) => stepsPanel.includes(`>${s.step}<`)));
t("steps panel: every unit named",
  steps.every((s) => stepsPanel.includes(resolveEntity(s.unit)?.ref.name ?? s.unit)));
t("steps panel: the current step is highlighted", stepsPanel.includes("border-gold/60"));
t("steps panel: completed steps are subdued", stepsPanel.includes("opacity-45"));
t("steps panel: future steps stay neutral", stepsPanel.includes("bg-surface-2/20"));

const armyPanel = renderToStaticMarkup(
  createElement(ArmyNS.AttackArmyPanel, { strategy, images: {} }),
);
t("army panel: composition header", armyPanel.includes("Army composition"));
t("army panel: every troop group listed",
  strategy.army.troops.every((g) => armyPanel.includes(resolveEntity(g.id)?.ref.name ?? g.id)));
t("army panel: every spell group listed",
  strategy.army.spells.every((g) => armyPanel.includes(resolveEntity(g.id)?.ref.name ?? g.id)));
t("army panel: deployed heroes listed",
  (strategy.heroes ?? []).filter((h) => h.use).every((h) => armyPanel.includes(resolveEntity(h.id)?.ref.name ?? h.id)));
t("army panel: siege machine listed",
  !strategy.army.siege_machine ||
  armyPanel.includes(resolveEntity(strategy.army.siege_machine.id)?.ref.name ?? ""));

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

// -- strategy selection: candidates compared, purposes everywhere --
const cands = strategy.candidate_strategies ?? [];
t("strategy selection: multiple candidates compared",
  cands.length >= 2, JSON.stringify(cands.map((c) => c.id)));
t("strategy selection: candidate ids are canonical catalog slugs",
  cands.every((c) => resolveStrategyId(c.id) === c.id),
  JSON.stringify(cands.map((c) => c.id)));
t("strategy selection: exactly one candidate selected",
  cands.filter((c) => c.selected === true).length === 1);
t("strategy selection: selected candidate matches strategy.type",
  cands.some((c) => c.selected === true && c.id === strategy.strategy.type));
t("strategy selection: rejected candidates explain why",
  cands.filter((c) => !c.selected).every((c) => (c.rejected_reason ?? "").length > 0));
t("strategy selection: candidates carry a 0..1 fit score",
  cands.every((c) => typeof c.fit_score === "number" && c.fit_score >= 0 && c.fit_score <= 1));
t("army: every troop group has a purpose",
  strategy.army.troops.every((tr) => (tr.purpose ?? "").length > 0));
t("army: every spell group has a purpose",
  strategy.army.spells.every((sp) => (sp.purpose ?? "").length > 0));
t("army: the siege machine explains itself",
  (strategy.army.siege_machine?.purpose ?? "").length > 0);
t("analysis: structural traits identified",
  (strategy.base_analysis?.structuralTraits?.length ?? 0) >= 3);
t("analysis: key defenses listed with threat levels",
  (strategy.base_analysis?.keyDefenses?.length ?? 0) >= 4 &&
    strategy.base_analysis!.keyDefenses!.every((k) => k.threat != null));
t("analysis: pathing reasoning recorded",
  (strategy.base_analysis?.pathingNotes?.length ?? 0) > 40);
t("analysis: entry points evaluated",
  (strategy.base_analysis?.entryPoints?.[0]?.reachableDefenses ?? "").length > 0);
t("confidence: selection and army sub-scores present",
  typeof strategy.confidence?.strategy_selection === "number" &&
    typeof strategy.confidence?.army_composition === "number");

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
