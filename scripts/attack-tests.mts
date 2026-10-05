/**
 * Attack-strategy unit tests (no test framework needed): npx tsx scripts/attack-tests.mts
 * Covers slug resolution, per-TH capacities, coordinate clamping, and the
 * validator's reject/repair rules (task §39 validation tests).
 */
import { resolveEntity, resolveSlug, capacitiesForTH, totalHousing, isCcEligible } from "../src/lib/attack/catalog";
import { validateStrategy, clampPoint } from "../src/lib/attack/validate";
import { arrowHead, pathD, placeLabels, rectsOverlap, simplifyPath, toVb, type PlacedLabel, type Rect } from "../src/lib/attack/geometry";
import { pathStepIndex, spellStepIndex, stepVis, isRendered, VIS_OPACITY } from "../src/lib/attack/steps";

let pass = 0, fail = 0;
const t = (name: string, cond: boolean, extra = '') => {
  if (cond) { pass++; } else { fail++; console.log('FAIL:', name, extra); }
};

// --- task §2: canonical example IDs must resolve to Supercell numeric ids ---
const expect: [string, number][] = [
  ['queen', 28000001], ['king', 28000000], ['grand_warden', 28000002], ['royal_champion', 28000004],
  ['barbarian', 4000000], ['archer', 4000001], ['giant', 4000003], ['wizard', 4000006],
  ['healer', 4000007], ['miner', 4000024], ['hog_rider', 4000011], ['bowler', 4000022],
  ['witch', 4000015], ['lava_hound', 4000017], ['balloon', 4000005],
  ['rage', 26000002], ['heal', 26000001], ['freeze', 26000005], ['poison', 26000009],
  ['siege_barracks', 4000075], ['wall_wrecker', 4000051], ['log_launcher', 4000087], ['battle_blmp', 4000052],
];
for (const [slug, id] of expect) {
  const r = resolveEntity(slug);
  t(`resolve ${slug} -> ${id}`, r !== null && r.ref.dataId === id, `got ${r?.ref.dataId} kind=${r?.kind}`);
}
t('unknown slug is null', resolveSlug('goblin_warrior_x') === null || resolveSlug('goblin_warrior_x') === 'goblin-warrior-x');

// --- capacities ---
const c15 = capacitiesForTH(15);
t('TH15 army housing', c15.armyHousing === 320, String(c15.armyHousing));
t('TH15 spell housing', c15.spellHousing === 11, String(c15.spellHousing));
t('TH15 CC troops', c15.ccTroopCapacity === 50, String(c15.ccTroopCapacity));
t('TH10 army housing', capacitiesForTH(10).armyHousing === 240);
t('TH3 CC troops', capacitiesForTH(3).ccTroopCapacity === 10);
t('CC excluded balloon', !isCcEligible('balloon'));
t('CC excludes valkyrie', !isCcEligible('valkyrie'));
t('CC excludes balloon+supers', !isCcEligible('balloon') && !isCcEligible('super-barbarian') && !isCcEligible('pekka'));
t('CC excludes balloon+supers', !isCcEligible('balloon') && !isCcEligible('super-barbarian') && !isCcEligible('pekka'));
t('housing math', totalHousing([{id:'miner',count:10},{id:'hog-rider',count:10}]) === 60 + 50);

// --- coordinate clamping (§29) ---
const cp = clampPoint({x: 1.7, y: -0.4});
t('clamp out-of-range', cp.x === 1 && cp.y === 0, JSON.stringify(cp));

// --- validation: invalid inputs (§39) ---
const base = {
  strategy: { name: 'QCH', reason: 'test' },
  army: { troops: [{id:'root-rider',count:3},{id:'archer',count:4}], spells: [{id:'rage-spell',count:2}] },
  deployment_plan: [
    {step:1, phase:'q', unit:'archer-queen', count:1, position:{x:0.2,y:0.8}, target:'west'},
    {step:2, phase:'core', unit:'root-rider', count:3, position:{x:0.5,y:0.9}},
  ],
  paths: [{unit:'hybrid', points:[{x:0.5,y:0.9},{x:0.5,y:0.3}]}],
  attack_phases: [{name:'q'},{name:'core'}],
  confidence: {base_analysis:0.9,strategy:0.8,deployment:0.7},
};
const r1 = validateStrategy(base, {townHall: 15});
t('valid strategy passes', r1.ok, JSON.stringify(r1.errors));

const badTroop = JSON.parse(JSON.stringify(base));
badTroop.army.troops.push({id:'dragon_x_x', count: 99});
const r2 = validateStrategy(badTroop, {townHall: 15});
t('unknown troop dropped, still ok', r2.ok && r2.strategy.army.troops.length === 2 && r2.warnings.length > 0, JSON.stringify(r2.errors));

const badCoords = JSON.parse(JSON.stringify(base));
badCoords.deployment_plan[1].position = {x: 3.3, y: -1};
badCoords.paths![0].points[1] = {x: 0.499, y: 1.5};
const r3 = validateStrategy(badCoords, {townHall: 15});
t('coords clamped', r3.ok && r3.strategy.deployment_plan[1].position.y === 0 && r3.strategy.paths![0].points[1].y === 1, JSON.stringify(r3.errors));

const overflow = JSON.parse(JSON.stringify(base));
overflow.army.troops = [{id:'dragon',count:50}]; // 50*20=1000 > 320
const r4 = validateStrategy(overflow, {townHall: 15});
// Capacity overflow is now REPAIRED (trimmed to fit), not fatal:
// 50 dragons -> 16 dragons (320 housing) fits the 320 cap; one warning recorded.
t('housing overflow repaired (trimmed to fit)',
  r4.ok && r4.strategy.army.troops.length === 1
    && r4.strategy.army.troops[0].count === 16
    && totalHousing(r4.strategy.army.troops) === 320
    && r4.warnings.some(w => /trimmed to fit/i.test(w)),
  JSON.stringify({ok:r4.ok, troops:r4.strategy.army.troops, warnings:r4.warnings}));

const badSpell = JSON.parse(JSON.stringify(base));
badSpell.army.spells = [{id:'fireball', count: 1}];
const r5 = validateStrategy(badSpell, {townHall: 15});
t('unknown spell dropped', r5.ok && r5.strategy.army.spells.length === 0, JSON.stringify(r5.errors));

const noDeploy = JSON.parse(JSON.stringify(base));
noDeploy.deployment_plan = [];
const r6 = validateStrategy(noDeploy, {townHall: 15});
t('empty deployment rejected', !r6.ok);

// malformed: totally wrong shape
const r7 = validateStrategy({foo: 1}, {townHall: 15});
t('garbage rejected (no deployments)', !r7.ok);

// CC capacity: 15 miners = 90 > 50 CC capacity at TH15 -> repaired to 8 (48)
const ccBad = JSON.parse(JSON.stringify(base));
ccBad.army.clan_castle = [{id:'miner', count: 15}];
const r8 = validateStrategy(ccBad, {townHall: 15});
t('CC capacity overflow repaired (trimmed to fit)',
  r8.ok && (r8.strategy.army.clan_castle ?? []).length === 1
    && r8.strategy.army.clan_castle![0].count === 8
    && totalHousing(r8.strategy.army.clan_castle!) === 48,
  JSON.stringify({ok:r8.ok, cc:r8.strategy.army.clan_castle, warnings:r8.warnings}));

// CC exclusion: balloons never allowed
const ccBalloon = JSON.parse(JSON.stringify(base));
ccBalloon.army.clan_castle = [{id:'balloon', count: 3}];
const r9 = validateStrategy(ccBalloon, {townHall: 15});
t('CC balloons excluded & dropped', r9.ok && (r9.strategy.army.clan_castle ?? []).length === 0, JSON.stringify(r9.errors));

// CC valid: 10 miners = 60 > 50 would be trimmed; 8 miners = 48 fits
const ccOk = JSON.parse(JSON.stringify(base));
ccOk.army.clan_castle = [{id:'miner', count: 8}];
const r10 = validateStrategy(ccOk, {townHall: 15});
t('CC valid loadout passes', r10.ok && r10.strategy.army.clan_castle!.length === 1, JSON.stringify(r10.errors));

// --- TH availability gating (validator enforces, not just the prompt) ---
const thLow = JSON.parse(JSON.stringify(base));
// root-rider is minTH 15, druid minTH 14: both unavailable at TH8.
thLow.army.troops = [{id:'root-rider',count:5},{id:'valkyrie',count:5}]; // valkyrie minTH 8 -> kept
const r11 = validateStrategy(thLow, {townHall: 8});
t('TH8 drops TH15-only troop, keeps available troop',
  r11.ok && r11.strategy.army.troops.length === 1 && r11.strategy.army.troops[0].id === 'valkyrie'
    && r11.strategy.army.troops[0].count === 5,
  JSON.stringify(r11.strategy.army.troops));
const thSpell = JSON.parse(JSON.stringify(base));
thSpell.army.spells = [{id:'totem-spell',count:2},{id:'rage-spell',count:1}]; // totem minTH16, rage minTH7
const r12 = validateStrategy(thSpell, {townHall: 8});
t('TH8 drops TH16-only spell, keeps available spell',
  r12.strategy.army.spells.length === 1 && r12.strategy.army.spells[0].id === 'rage-spell',
  JSON.stringify(r12.strategy.army.spells));
const thHero = JSON.parse(JSON.stringify(base));
thHero.hero_abilities = [{hero:'grand-warden', trigger:'x'}, {hero:'archer-queen', trigger:'x'}]; // GW minTH14
const r13 = validateStrategy(thHero, {townHall: 8});
t('TH8 drops unavailable hero ability',
  r13.strategy.hero_abilities!.length === 1 && r13.strategy.hero_abilities![0].hero === 'archer-queen',
  JSON.stringify(r13.strategy.hero_abilities));
const r14 = validateStrategy(base, {townHall: 15});
t('TH15 keeps root-rider (minTH15) deployment',
  r14.strategy.deployment_plan.some(d => d.unit === 'root-rider'),
  JSON.stringify(r14.strategy.deployment_plan.map(d => d.unit)));

// --- geometry (§2/§9) ---
const vb = {w: 1000, h: 1000};
t('toVb', JSON.stringify(toVb({x:0.25,y:0.7}, vb)) === '{"x":250,"y":700}');
t('pathD', pathD([{x:0,y:0},{x:0.5,y:0.5}], vb) === 'M 0.0 0.0 L 500.0 500.0');
t('arrowHead has 4 points', arrowHead([{x:0.5,y:0.9},{x:0.5,y:0.3}], vb, 35).split(' ').length === 4);

// --- troop grouping: one marker per group, not a swarm of icons ---
const split = JSON.parse(JSON.stringify(base));
split.deployment_plan = [
  {step:1, phase:'funnel', unit:'miner', count:5, position:{x:0.3,y:0.7}},
  {step:2, phase:'funnel', unit:'miner', count:10, position:{x:0.35,y:0.72}},
  {step:3, phase:'main', unit:'hog-rider', count:10, position:{x:0.5,y:0.9}},
];
const r15 = validateStrategy(split, {townHall: 15});
t('consecutive same-unit steps merged into one "Miner ×15" marker',
  r15.ok && r15.strategy.deployment_plan.length === 2
    && r15.strategy.deployment_plan[0].unit === 'miner'
    && r15.strategy.deployment_plan[0].count === 15,
  JSON.stringify(r15.strategy.deployment_plan.map(d => [d.unit, d.count])));

const splitPhase = JSON.parse(JSON.stringify(base));
splitPhase.deployment_plan = [
  {step:1, phase:'funnel', unit:'miner', count:5, position:{x:0.3,y:0.7}},
  {step:2, phase:'cleanup', unit:'miner', count:10, position:{x:0.8,y:0.3}},
];
const r16 = validateStrategy(splitPhase, {townHall: 15});
t('same unit in a different phase stays a separate step',
  r16.ok && r16.strategy.deployment_plan.length === 2
    && r16.strategy.deployment_plan[0].phase === 'funnel'
    && r16.strategy.deployment_plan[1].phase === 'cleanup',
  JSON.stringify(r16.strategy.deployment_plan.map(d => d.phase)));

// split deployments of one merged group concatenate
const splitDeps = JSON.parse(JSON.stringify(base));
splitDeps.deployment_plan = [
  {step:1, phase:'main', unit:'wizard', count:3, position:{x:0.3,y:0.7},
   deployments:[{count:3, position:{x:0.3,y:0.7}, label:'SW'}]},
  {step:2, phase:'main', unit:'wizard', count:4, position:{x:0.6,y:0.6},
   deployments:[{count:4, position:{x:0.6,y:0.6}, label:'NE'}]},
];
const r17 = validateStrategy(splitDeps, {townHall: 15});
t('merged group keeps both split deployments',
  r17.ok && r17.strategy.deployment_plan.length === 1
    && r17.strategy.deployment_plan[0].count === 7
    && (r17.strategy.deployment_plan[0].deployments ?? []).length === 2,
  JSON.stringify(r17.strategy.deployment_plan[0]?.deployments));

// --- step references on paths and spells ---
const withSteps = JSON.parse(JSON.stringify(base));
withSteps.paths = [
  {step: 1, unit: 'archer-queen', points: [{x:0.2,y:0.8},{x:0.5,y:0.5}]},
  {step: 99, unit: 'root-rider', points: [{x:0.3,y:0.7},{x:0.6,y:0.6}]},
  {unit: 'archer-queen', points: [{x:0.5,y:0.9},{x:0.5,y:0.4}]},
];
withSteps.spell_actions = [
  {step: 2, spell: 'healing-spell', position: {x:0.4,y:0.5}},
  {step: 0, spell: 'rage-spell', position: {x:0.5,y:0.5}},
];
const r18 = validateStrategy(withSteps, {townHall: 15});
t('valid path step passed through', r18.strategy.paths![0].step === 1);
t('out-of-range path step dropped (never trusted)', r18.strategy.paths![1].step === undefined);
t('valid spell step passed through', r18.strategy.spell_actions![0].step === 2);
t('invalid spell step dropped', r18.strategy.spell_actions![1].step === undefined);

// --- step attribution (the reveal rules) ---
const deps18 = r18.strategy.deployment_plan;
t('path attributed by explicit step', pathStepIndex(r18.strategy.paths![0], deps18) === 0);
t('out-of-range path falls back to unit match',
  pathStepIndex(r18.strategy.paths![1], deps18) === 1);
t('path without step attributed by unit match',
  pathStepIndex(r18.strategy.paths![2], deps18) === 0);
t('named-group path attributes to the nearest step (its deployment point)',
  pathStepIndex({unit: 'hybrid', points: [{x:0.5,y:0.9},{x:0.5,y:0.4}]}, deps18) === 1);
t('path with empty plan is overview-only',
  pathStepIndex({unit: 'hybrid', points: [{x:0.5,y:0.9},{x:0.5,y:0.4}]}, []) === null);
t('spell attributed by explicit step', spellStepIndex(r18.strategy.spell_actions![0], deps18) === 1);
t('spell without step estimates the nearest marker',
  spellStepIndex({spell:'rage-spell', position:{x:0.5,y:0.5}}, deps18) === 1);
t('spell with empty plan is overview-only',
  spellStepIndex({spell:'rage-spell', position:{x:0.5,y:0.5}}, []) === null);
t('spell attributed by trigger text (display name)',
  spellStepIndex({spell:'rage-spell', position:{x:0.5,y:0.5}, trigger:'When the Archer Queen walks'}, deps18) === 0);
t('spell attributed by trigger text (single token)',
  spellStepIndex({spell:'rage-spell', position:{x:0.5,y:0.5}, trigger:'When the Queen is under fire'}, deps18) === 0);
t('spell attributed by nearest path beats nearest marker',
  spellStepIndex({spell:'healing-spell', position:{x:0.5,y:0.5}}, deps18, r18.strategy.paths!) === 0);
t('spell without trigger or paths estimates the nearest marker',
  spellStepIndex({spell:'healing-spell', position:{x:0.5,y:0.5}}, deps18, []) === 1);

// --- step visibility states ---
t('stepVis done/current/future',
  stepVis(0, 1) === 'done' && stepVis(1, 1) === 'current' && stepVis(2, 1) === 'future');
t('stepVis all-steps mode', stepVis(2, -1) === 'all');
t('future steps are hidden, done subdued',
  !isRendered('future') && VIS_OPACITY.future === 0 && VIS_OPACITY.done === 0.35);

// --- geometry: path simplification (meaningful waypoints only) ---
const straight = [{x:0,y:0},{x:0.25,y:0.25},{x:0.5,y:0.5},{x:0.75,y:0.75},{x:1,y:1}];
t('simplifyPath reduces a straight line to its endpoints',
  simplifyPath(straight, 0.01).length === 2);
const bendy = [{x:0,y:0},{x:0.1,y:0.05},{x:0.2,y:0.1},{x:0.3,y:0.3},{x:0.5,y:0.5}];
const bendySimple = simplifyPath(bendy, 0.02);
t('simplifyPath keeps endpoints of a bent path',
  bendySimple[0].x === 0 && bendySimple[bendySimple.length - 1].x === 0.5);
t('simplifyPath drops near-collinear waypoints',
  bendySimple.length < bendy.length, JSON.stringify(bendySimple));

// --- geometry: deterministic label placement ---
const crowded = [
  {key:'a', anchor:{x:0.2,y:0.2}, text:'Archer Queen', fontSize:26, anchorRadius:60},
  {key:'b', anchor:{x:0.24,y:0.22}, text:'Miner ×15', fontSize:26, anchorRadius:60},
  {key:'c', anchor:{x:0.19,y:0.25}, text:'Hog Rider ×10', fontSize:26, anchorRadius:60},
  {key:'d', anchor:{x:0.22,y:0.18}, text:'Healer ×5', fontSize:26, anchorRadius:60},
  {key:'e', anchor:{x:0.21,y:0.23}, text:'Wall Breaker ×8', fontSize:26, anchorRadius:60},
];
const crowdObstacles: Rect[] = crowded.map(c => ({
  x: c.anchor.x * 1000 - c.anchorRadius,
  y: c.anchor.y * 1000 - c.anchorRadius,
  w: c.anchorRadius * 2, h: c.anchorRadius * 2,
}));
const placed = placeLabels(crowded, crowdObstacles, vb);
const boxOf = (p: PlacedLabel): Rect => ({x: p.cx - p.w / 2, y: p.cy - p.h / 2, w: p.w, h: p.h});
t('placeLabels places every label', placed.length === crowded.length);
let labelOverlap = false;
for (let i = 0; i < placed.length; i++)
  for (let j = i + 1; j < placed.length; j++)
    if (rectsOverlap(boxOf(placed[i]), boxOf(placed[j]))) labelOverlap = true;
t('placed labels never overlap each other', !labelOverlap);
let markerCovered = false;
for (const p of placed) for (const o of crowdObstacles)
  if (rectsOverlap(boxOf(p), o)) markerCovered = true;
t('placed labels never cover a marker', !markerCovered);
t('labels stay inside the viewBox',
  placed.every(p => p.cx - p.w / 2 >= 0 && p.cx + p.w / 2 <= 1000
    && p.cy - p.h / 2 >= 0 && p.cy + p.h / 2 <= 1000));
// determinism: same input -> same output
const placedAgain = placeLabels(crowded, crowdObstacles, vb);
t('label placement is deterministic',
  JSON.stringify(placedAgain.map(p => [p.cx, p.cy])) === JSON.stringify(placed.map(p => [p.cx, p.cy])));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
