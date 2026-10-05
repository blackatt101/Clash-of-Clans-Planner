/**
 * Attack-strategy unit tests (no test framework needed): npx tsx scripts/attack-tests.mts
 * Covers slug resolution, per-TH capacities, coordinate clamping, and the
 * validator's reject/repair rules (task §39 validation tests).
 */
import { resolveEntity, resolveSlug, capacitiesForTH, totalHousing, isCcEligible } from "../src/lib/attack/catalog";
import { validateStrategy, clampPoint } from "../src/lib/attack/validate";
import { resolveStrategyId, strategyById, strategyMinTH, STRATEGIES } from "../src/lib/attack/strategies";
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
thHero.hero_abilities = [{hero:'grand-warden', trigger:'x'}, {hero:'archer-queen', trigger:'x'}]; // GW minTH11
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

// --- hero decisions -------------------------------------------------------
// TH11: the four legal heroes are Archer Queen, Barbarian King,
// Grand Warden and Minion Prince. The ENEMY base is TH15 — hero
// availability must follow the ATTACKER's TH, never the enemy's.
const th11 = JSON.parse(JSON.stringify(base));
th11.base_analysis = { townHallLevel: 15 };
th11.heroes = [
  { id: 'archer_queen', use: true, role: 'queen-charge', reason: 'Charges the west compartment.' },
  { id: 'barbarian-king', use: false, role: null, reason: 'Funnel value already covered by the army composition.' },
  { id: 'grand-warden', use: true, role: 'main-army-support', reason: 'Warden aura sustains the main push.' },
  { id: 'minion-prince', use: false, role: null, reason: 'Air defenses are spread; no single compartment to storm.' },
  { id: 'miner', use: true, role: 'cleanup', reason: 'Not a hero — must be dropped.' },
  { id: 'royal-champion', use: true, role: 'cleanup', reason: 'TH13 hero — must be dropped at TH11.' },
  { id: 'dragon-duke', use: true, role: 'air-support', reason: 'TH15 hero — must be dropped at TH11.' },
];
const rHero = validateStrategy(th11, { townHall: 11 });
t('TH11: exactly the four legal heroes kept',
  rHero.strategy.heroes?.length === 4 &&
    rHero.strategy.heroes?.every((h) =>
      h.id === 'archer-queen' || h.id === 'barbarian-king' ||
      h.id === 'grand-warden' || h.id === 'minion-prince') === true,
  JSON.stringify(rHero.strategy.heroes?.map((h) => h.id)));
t('TH11: Grand Warden legal (unlocks at TH11)',
  rHero.strategy.heroes?.some((h) => h.id === 'grand-warden') === true);
t('TH11: Minion Prince legal (unlocks at TH9)',
  rHero.strategy.heroes?.some((h) => h.id === 'minion-prince') === true);
t('TH11: Royal Champion dropped (TH13 hero — attacker TH gates, not enemy TH)',
  rHero.strategy.heroes?.some((h) => h.id === 'royal-champion') !== true);
t('TH11: hero slug alias resolves', rHero.strategy.heroes?.[0]?.id === 'archer-queen');
t('TH11: selected hero keeps role', rHero.strategy.heroes?.[0]?.role === 'queen-charge');
t('TH11: excluded hero keeps its explanation',
  rHero.strategy.heroes?.[1]?.reason === 'Funnel value already covered by the army composition.');
t('TH11: two of the four legal heroes selected',
  (rHero.strategy.heroes?.filter((h) => h.use).length ?? 0) === 2);

// TH15: six heroes available, three strategically useful.
const th15 = JSON.parse(JSON.stringify(base));
th15.heroes = [
  { id: 'archer-queen', use: true, role: 'queen-charge', reason: 'Queen charge opens the west.' },
  { id: 'barbarian-king', use: true, role: 'funnel', reason: 'King funnels the south entry.' },
  { id: 'grand-warden', use: true, role: 'main-army-support', reason: 'Warden aura sustains the main push.' },
  { id: 'royal-champion', use: false, role: null, reason: 'Cleanup is covered by the CC troops.' },
  { id: 'minion-prince', use: false, role: null, reason: 'No single air compartment to storm.' },
  { id: 'dragon-duke', use: false, role: null, reason: 'The air main is already covered by the balloon screen.' },
];
const rHero15 = validateStrategy(th15, { townHall: 15 });
t('TH15: all six available heroes evaluated', rHero15.strategy.heroes?.length === 6);
t('TH15: three heroes selected (no 2-hero default)',
  (rHero15.strategy.heroes?.filter((h) => h.use).length ?? 0) === 3);
t('TH15: Grand Warden not ignored',
  rHero15.strategy.heroes?.some((h) => h.id === 'grand-warden' && h.use === true) === true);
t('TH15: every excluded hero has a reason',
  rHero15.strategy.heroes?.filter((h) => !h.use).every((h) => (h.reason ?? '').length > 0) === true);

// Hero unlock Town Halls, gated by the ATTACKER's TH:
// King TH7, Queen TH8, Minion Prince TH9, Warden TH11,
// Champion TH13, Dragon Duke TH15.
const unlocks = JSON.parse(JSON.stringify(base));
unlocks.heroes = [
  { id: 'barbarian-king', use: false, role: null, reason: 'King.' },
  { id: 'archer-queen', use: false, role: null, reason: 'Queen.' },
  { id: 'minion-prince', use: false, role: null, reason: 'Prince.' },
  { id: 'grand-warden', use: false, role: null, reason: 'Warden.' },
  { id: 'royal-champion', use: false, role: null, reason: 'Champion.' },
  { id: 'dragon-duke', use: false, role: null, reason: 'Duke.' },
];
const unlockIds = (th: number): string[] =>
  (validateStrategy(JSON.parse(JSON.stringify(unlocks)), { townHall: th }).strategy.heroes ?? []).map((h) => h.id);
t('unlock: TH7 -> Barbarian King only',
  JSON.stringify(unlockIds(7)) === '["barbarian-king"]', JSON.stringify(unlockIds(7)));
t('unlock: TH8 -> + Archer Queen',
  JSON.stringify(unlockIds(8)) === '["barbarian-king","archer-queen"]', JSON.stringify(unlockIds(8)));
t('unlock: TH9 -> + Minion Prince',
  JSON.stringify(unlockIds(9)) === '["barbarian-king","archer-queen","minion-prince"]', JSON.stringify(unlockIds(9)));
t('unlock: TH11 -> + Grand Warden',
  JSON.stringify(unlockIds(11)) === '["barbarian-king","archer-queen","minion-prince","grand-warden"]', JSON.stringify(unlockIds(11)));
t('unlock: TH13 -> + Royal Champion',
  JSON.stringify(unlockIds(13)) === '["barbarian-king","archer-queen","minion-prince","grand-warden","royal-champion"]', JSON.stringify(unlockIds(13)));
t('unlock: TH15 -> + Dragon Duke (all six)',
  JSON.stringify(unlockIds(15)) === '["barbarian-king","archer-queen","minion-prince","grand-warden","royal-champion","dragon-duke"]', JSON.stringify(unlockIds(15)));

// Battlefield slots (game rule): one opens every two
// Town Halls from TH7 (TH9: 2, TH11: 3, TH13: 4,
// TH15: 5). At TH15 the model selected all six — the
// sixth is excluded with the limit as its reason, and
// its deployment step, path and ability are dropped so
// the visual plan never shows a hero that is not brought.
const cap = JSON.parse(JSON.stringify(base));
cap.heroes = [
  { id: 'archer-queen', use: true, role: 'queen-charge', reason: 'Queen charge opens the west.' },
  { id: 'barbarian-king', use: true, role: 'funnel', reason: 'King funnels the south entry.' },
  { id: 'grand-warden', use: true, role: 'main-army-support', reason: 'Warden aura sustains the push.' },
  { id: 'minion-prince', use: true, role: 'air-support', reason: 'Prince storms the air compartment.' },
  { id: 'royal-champion', use: true, role: 'cleanup', reason: 'Champion cleans the north-east.' },
  { id: 'dragon-duke', use: true, role: 'air-support', reason: 'Duke soars over the core.' },
];
cap.deployment_plan.push({ step: 3, phase: 'air', unit: 'dragon-duke', count: 1, position: { x: 0.6, y: 0.4 } });
cap.paths.push({ step: 3, unit: 'dragon-duke', points: [{ x: 0.6, y: 0.4 }, { x: 0.7, y: 0.35 }], style: 'attack' });
cap.hero_abilities = [{ hero: 'dragon-duke', trigger: 'When the duke reaches the core', purpose: 'Soar over the core.' }];
const rCap = validateStrategy(cap, { townHall: 15 });
t('cap: TH15 keeps the first five selected heroes',
  (rCap.strategy.heroes?.filter((h) => h.use).length ?? 0) === 5);
t('cap: sixth hero excluded with the limit as its reason',
  rCap.strategy.heroes?.find((h) => h.id === 'dragon-duke')?.reason
    === 'Battlefield limit: at most 5 heroes can be deployed per attack.');
t('cap: excluded hero has no role',
  rCap.strategy.heroes?.find((h) => h.id === 'dragon-duke')?.role === null);
t('cap: warning records the limit',
  rCap.warnings.some((w) => /exceeds the 5-hero battlefield limit/.test(w)));
t('cap: over-limit hero deployment step dropped',
  rCap.strategy.deployment_plan.every((s) => s.unit !== 'dragon-duke'));
t('cap: over-limit hero path dropped',
  (rCap.strategy.paths ?? []).every((p) => p.unit !== 'dragon-duke'));
t('cap: over-limit hero ability dropped',
  (rCap.strategy.hero_abilities ?? []).every((a) => a.hero !== 'dragon-duke'));

// The 2-slot tier: at TH9 only two heroes fit the
// battlefield, so the third selected hero is excluded.
const cap9 = JSON.parse(JSON.stringify(base));
cap9.heroes = [
  { id: 'barbarian-king', use: true, role: 'funnel', reason: 'King funnels.' },
  { id: 'archer-queen', use: true, role: 'queen-charge', reason: 'Queen charges.' },
  { id: 'minion-prince', use: true, role: 'air-support', reason: 'Prince storms.' },
];
cap9.deployment_plan.push({ step: 3, phase: 'air', unit: 'minion-prince', count: 1, position: { x: 0.6, y: 0.4 } });
const rCap9 = validateStrategy(cap9, { townHall: 9 });
t('cap: TH9 keeps the first two selected heroes',
  (rCap9.strategy.heroes?.filter((h) => h.use).length ?? 0) === 2);
t('cap: TH9 third hero excluded with the 2-hero reason',
  rCap9.strategy.heroes?.find((h) => h.id === 'minion-prince')?.reason
    === 'Battlefield limit: at most 2 heroes can be deployed per attack.');

// The same rule at TH11: three slots, so the fourth
// selected hero is excluded with the three-hero reason.

// The same rule at TH11: the limit is three, so the fourth
// selected hero is excluded with the three-hero reason.
const cap11 = JSON.parse(JSON.stringify(base));
cap11.heroes = [
  { id: 'archer-queen', use: true, role: 'queen-charge', reason: 'Queen charge opens the west.' },
  { id: 'barbarian-king', use: true, role: 'funnel', reason: 'King funnels the south entry.' },
  { id: 'grand-warden', use: true, role: 'main-army-support', reason: 'Warden aura sustains the push.' },
  { id: 'minion-prince', use: true, role: 'air-support', reason: 'Prince storms the air compartment.' },
];
cap11.deployment_plan.push({ step: 3, phase: 'air', unit: 'minion-prince', count: 1, position: { x: 0.6, y: 0.4 } });
const rCap11 = validateStrategy(cap11, { townHall: 11 });
t('cap: TH11 keeps the first three selected heroes',
  (rCap11.strategy.heroes?.filter((h) => h.use).length ?? 0) === 3);
t('cap: TH11 fourth hero excluded with the 3-hero reason',
  rCap11.strategy.heroes?.find((h) => h.id === 'minion-prince')?.reason
    === 'Battlefield limit: at most 3 heroes can be deployed per attack.');
t('cap: TH11 over-limit hero deployment step dropped',
  rCap11.strategy.deployment_plan.every((s) => s.unit !== 'minion-prince'));

// Boundary: the fourth battlefield slot opens at TH13.
// Five heroes are legal at TH13 (Champion included), but
// only four fit — the fifth selected hero is excluded.
const cap13 = JSON.parse(JSON.stringify(base));
cap13.heroes = [
  { id: 'archer-queen', use: true, role: 'queen-charge', reason: 'Queen charge.' },
  { id: 'barbarian-king', use: true, role: 'funnel', reason: 'King funnels.' },
  { id: 'grand-warden', use: true, role: 'main-army-support', reason: 'Warden aura.' },
  { id: 'minion-prince', use: true, role: 'air-support', reason: 'Prince storms.' },
  { id: 'royal-champion', use: true, role: 'cleanup', reason: 'Champion cleans up.' },
];
const rCap13 = validateStrategy(cap13, { townHall: 13 });
t('cap: TH13 boundary keeps four of five selected heroes',
  (rCap13.strategy.heroes?.filter((h) => h.use).length ?? 0) === 4);
t('cap: TH13 fifth hero excluded with the 4-hero reason',
  rCap13.strategy.heroes?.find((h) => h.id === 'royal-champion')?.reason
    === 'Battlefield limit: at most 4 heroes can be deployed per attack.');

// Backfill: the model evaluated only two of the six TH15 heroes.
const forgot = JSON.parse(JSON.stringify(base));
forgot.heroes = [
  { id: 'archer-queen', use: true, role: 'queen-charge', reason: 'Queen charge opens the west.' },
  { id: 'barbarian-king', use: false, role: null, reason: 'Funnel covered.' },
];
const rForgot = validateStrategy(forgot, { townHall: 15 });
t('backfill: unevaluated heroes still listed', rForgot.strategy.heroes?.length === 6);
t('backfill: skipped hero is visibly "not considered"',
  rForgot.strategy.heroes?.find((h) => h.id === 'grand-warden')?.reason === 'Not considered by the planner.');

// Backfill: a hero the model deployed but forgot to decide.
const deployed = JSON.parse(JSON.stringify(base));
deployed.deployment_plan.push({
  step: 3, phase: 'core', unit: 'grand-warden', count: 1, position: { x: 0.5, y: 0.5 },
});
deployed.heroes = [{ id: 'archer-queen', use: true, role: 'queen-charge', reason: 'Queen charge.' }];
const rDep = validateStrategy(deployed, { townHall: 15 });
t('backfill: deployed hero listed as selected',
  rDep.strategy.heroes?.find((h) => h.id === 'grand-warden')?.use === true);

// Repairs for missing fields.
const rep = JSON.parse(JSON.stringify(base));
rep.heroes = [
  { id: 'archer-queen', use: true },
  { id: 'barbarian-king', use: false },
];
const rRep = validateStrategy(rep, { townHall: 15 });
t('repair: used hero without role defaults to support',
  rRep.strategy.heroes?.find((h) => h.id === 'archer-queen')?.role === 'support');
t('repair: excluded hero without reason gets one',
  (rRep.strategy.heroes?.find((h) => h.id === 'barbarian-king')?.reason ?? '').length > 0);

// A used hero that is never deployed cannot render — warned.
const noDep = JSON.parse(JSON.stringify(base));
noDep.heroes = [{ id: 'grand-warden', use: true, role: 'main-army-support', reason: 'Aura support.' }];
const rNoDep = validateStrategy(noDep, { townHall: 15 });
t('warning: used hero with no deployment or ability',
  rNoDep.warnings.some((w) => /marked used but has no deployment/.test(w)));

// ---------------------------------------------------------------------------
// Strategy-selection quality (§6–§20): candidate comparison, base
// analysis depth, army/siege purposes, confidence sub-scores.
// ---------------------------------------------------------------------------
const strat = JSON.parse(JSON.stringify(base));
strat.candidate_strategies = [
  { id: 'queen-charge-hybrid', name: 'Queen Charge Hybrid', fit_score: 0.86,
    strengths: ['West side is open.', 'Eagle is on the air path.'],
    weaknesses: ['Inferno can snipe the Queen.'], selected: true },
  { id: 'lavaloon', name: 'Lavaloon', fit_score: 0.52,
    strengths: ['Air defenses reachable.'],
    weaknesses: ['Air sweeper covers the Lalo path.'],
    selected: false, rejected_reason: 'Pathing too unpredictable.' },
];
const rCand = validateStrategy(strat, { townHall: 15 });
t('candidates: parsed with fit scores',
  rCand.strategy.candidate_strategies?.length === 2 &&
    rCand.strategy.candidate_strategies?.[0].fit_score === 0.86,
  JSON.stringify(rCand.strategy.candidate_strategies));
t('candidates: exactly one selected',
  rCand.strategy.candidate_strategies?.filter((c) => c.selected).length === 1);
t('candidates: rejected entry keeps its reason',
  rCand.strategy.candidate_strategies?.[1].rejected_reason === 'Pathing too unpredictable.');

// Missing strategy.type -> backfilled from the selected candidate so the
// output stays self-consistent (selected id === strategy.type).
const stratNoType = JSON.parse(JSON.stringify(strat));
delete stratNoType.strategy.type;
const rNoType = validateStrategy(stratNoType, { townHall: 15 });
t('candidates: missing strategy.type backfilled from the pick',
  rNoType.strategy.strategy.type === 'queen-charge-hybrid' &&
    rNoType.warnings.some((w) => /backfilled from the selected candidate/.test(w)),
  `type=${rNoType.strategy.strategy.type}`);
// Present but mismatched type -> kept, only warned (never silently overridden).
const stratBadType = JSON.parse(JSON.stringify(strat));
stratBadType.strategy.type = 'hydra';
const rBadType = validateStrategy(stratBadType, { townHall: 15 });
t('candidates: mismatched type is warned, not overridden',
  rBadType.strategy.strategy.type === 'hydra' &&
    rBadType.warnings.some((w) => /does not match strategy\.type/.test(w)),
  `type=${rBadType.strategy.strategy.type}`);

// No candidate marked selected -> the first becomes the pick.
const stratNoPick = JSON.parse(JSON.stringify(strat));
delete stratNoPick.candidate_strategies[0].selected;
delete stratNoPick.candidate_strategies[1].selected;
const rNoPick = validateStrategy(stratNoPick, { townHall: 15 });
t('candidates: first becomes the pick when none is selected',
  rNoPick.strategy.candidate_strategies?.[0].selected === true &&
    rNoPick.warnings.some((w) => /marked selected; the first/.test(w)));

// Several marked selected -> only the first counts.
const stratMulti = JSON.parse(JSON.stringify(strat));
stratMulti.candidate_strategies[1].selected = true;
const rMulti = validateStrategy(stratMulti, { townHall: 15 });
t('candidates: only the first selected entry counts',
  rMulti.strategy.candidate_strategies?.filter((c) => c.selected).length === 1 &&
    rMulti.warnings.some((w) => /only the first counts/.test(w)));

// Dedupe + cap: 8 unique entries -> capped at 6, first-selected wins.
const stratCap = JSON.parse(JSON.stringify(strat));
stratCap.candidate_strategies = Array.from({ length: 8 }, (_, i) => ({
  id: i === 5 ? 'lavaloon' : `strategy-${i}`,
  name: `Strategy ${i}`,
  selected: i === 4,
}));
const rCandCap = validateStrategy(stratCap, { townHall: 15 });
t('candidates: deduped and capped at 6',
  rCandCap.strategy.candidate_strategies?.length === 6,
  String(rCandCap.strategy.candidate_strategies?.length));
t('candidates: cap warning recorded',
  rCandCap.warnings.some((w) => /extra candidate strategy/.test(w)));

// Selected candidate vs strategy.type mismatch -> warned.
const stratMismatch = JSON.parse(JSON.stringify(strat));
stratMismatch.strategy.type = 'queen-charge-hybrid';
stratMismatch.candidate_strategies = [
  { id: 'witch-smash', name: 'Witch Smash', selected: true },
];
const rMismatch = validateStrategy(stratMismatch, { townHall: 15 });
t('candidates: mismatch with strategy.type is warned',
  rMismatch.warnings.some((w) => /does not match strategy\.type/.test(w)),
  JSON.stringify(rMismatch.warnings));

// ---------------------------------------------------------------------------
// Strategy catalog + selection hardening: canonical ids, TH gating,
// selection repair, fit-score consistency, deterministic audit.
// ---------------------------------------------------------------------------
t('catalog: naming variants resolve to one canonical id',
  resolveStrategyId('GoWiPe') === 'gowipe' &&
    resolveStrategyId('go wi pe') === 'gowipe' &&
    resolveStrategyId('Queen Charge Hybrid') === 'queen-charge-hybrid' &&
    resolveStrategyId('lalo') === 'lavaloon',
  `${resolveStrategyId('GoWiPe')} ${resolveStrategyId('go wi pe')} ${resolveStrategyId('Queen Charge Hybrid')} ${resolveStrategyId('lalo')}`);
t('catalog: unknown id stays free-form', resolveStrategyId('my-cool-attack') === null);
t('catalog: every strategy has a minTH and capability tags',
  STRATEGIES.every((s) => s.minTH >= 3 && s.tags.length > 0));
t('catalog: strategyById round-trips',
  strategyById('lavaloon')?.name === 'Lavaloon' && strategyMinTH('super-archer-blimp') === 12);

// Naming variants collapse onto the canonical slug in the output.
const stratCanon = JSON.parse(JSON.stringify(strat));
stratCanon.strategy.type = 'gowipe';
stratCanon.candidate_strategies = [
  { id: 'GoWiPe', name: 'GoWiPe', fit_score: 0.7, selected: true },
  { id: 'Lavaloon', name: 'Lavaloon', fit_score: 0.4, selected: false },
];
const rCanon = validateStrategy(stratCanon, { townHall: 15 });
t('catalog: variant ids are canonicalized in the output',
  rCanon.strategy.candidate_strategies?.[0].id === 'gowipe' &&
    rCanon.strategy.candidate_strategies?.[1].id === 'lavaloon',
  JSON.stringify(rCanon.strategy.candidate_strategies?.map((c) => c.id)));

// TH gating: a TH8 army cannot field TH12+ strategies — the
// candidate is dropped exactly like a TH-unavailable unit.
const stratTH8 = JSON.parse(JSON.stringify(strat));
stratTH8.strategy.type = 'gowipe';
stratTH8.candidate_strategies = [
  { id: 'super-archer-blimp', name: 'Super Archer Blimp', fit_score: 0.9, selected: true },
  { id: 'gowipe', name: 'GoWiPe', fit_score: 0.5, selected: false },
];
const rTH8 = validateStrategy(stratTH8, { townHall: 8 });
t('catalog: TH-unavailable strategy is dropped',
  rTH8.strategy.candidate_strategies?.length === 1 &&
    rTH8.strategy.candidate_strategies?.[0].id === 'gowipe' &&
    rTH8.warnings.some((w) => /needs TH12\+/.test(w)),
  JSON.stringify(rTH8.warnings));

// The plan serves strategy.type, so the candidate matching it is
// re-marked selected when the model flagged a different entry.
const stratRepair = JSON.parse(JSON.stringify(strat));
stratRepair.strategy.type = 'lavaloon';
stratRepair.candidate_strategies = [
  { id: 'queen-charge-hybrid', name: 'QCH', fit_score: 0.9, selected: true },
  { id: 'lavaloon', name: 'Lavaloon', fit_score: 0.6, selected: false },
];
const rRepair = validateStrategy(stratRepair, { townHall: 15 });
t('selection: candidate matching strategy.type is re-marked',
  rRepair.strategy.candidate_strategies?.[1].selected === true &&
    rRepair.strategy.candidate_strategies?.[0].selected === false &&
    rRepair.warnings.some((w) => /serves strategy\.type/.test(w)),
  JSON.stringify(rRepair.warnings));

// Fit scores that contradict the pick -> flagged, plan kept
// (the army serves strategy.type, so the selection stays).
const stratScore = JSON.parse(JSON.stringify(strat));
stratScore.strategy.type = 'queen-charge-hybrid';
stratScore.candidate_strategies = [
  { id: 'queen-charge-hybrid', name: 'QCH', fit_score: 0.4, selected: true },
  { id: 'lavaloon', name: 'Lavaloon', fit_score: 0.9, selected: false },
];
const rScore = validateStrategy(stratScore, { townHall: 15 });
t('selection: scores that contradict the pick are flagged',
  rScore.warnings.some((w) => /does not back the pick/.test(w)) &&
    rScore.strategy.candidate_strategies?.[0].selected === true,
  JSON.stringify(rScore.warnings));

// A single-candidate comparison is not a comparison.
const stratOne = JSON.parse(JSON.stringify(strat));
stratOne.strategy.type = 'queen-charge-hybrid';
stratOne.candidate_strategies = [
  { id: 'queen-charge-hybrid', name: 'QCH', fit_score: 0.9, selected: true },
];
const rOne = validateStrategy(stratOne, { townHall: 15 });
t('selection: a single-candidate comparison is flagged',
  rOne.warnings.some((w) => /Only 1 candidate strategy/.test(w)));

// Audit: a ground-only pick against a base whose Air Defenses
// are a key threat (ground troops cannot hit them at all).
const stratAir = JSON.parse(JSON.stringify(strat));
stratAir.strategy.type = 'gowipe';
stratAir.candidate_strategies = [
  { id: 'gowipe', name: 'GoWiPe', fit_score: 0.8, selected: true },
  { id: 'lavaloon', name: 'Lavaloon', fit_score: 0.5, selected: false },
];
stratAir.base_analysis = {
  keyDefenses: [
    { type: 'air_defense', position: { x: 0.5, y: 0.5 }, threat: 'high' },
  ],
};
const rAir = validateStrategy(stratAir, { townHall: 15 });
t('audit: ground-only pick against an air-defense threat',
  rAir.warnings.some((w) => /ground-only attack/.test(w)),
  JSON.stringify(rAir.warnings));

// Audit: a Battle Blimp against a high-threat Air Defense.
const stratBlimp = JSON.parse(JSON.stringify(stratAir));
stratBlimp.strategy.type = 'super-archer-blimp';
stratBlimp.candidate_strategies = [
  { id: 'super-archer-blimp', name: 'Super Archer Blimp', fit_score: 0.8, selected: true },
];
const rBlimp = validateStrategy(stratBlimp, { townHall: 15 });
t('audit: blimp against a high-threat Air Defense',
  rBlimp.warnings.some((w) => /Battle Blimp/.test(w)),
  JSON.stringify(rBlimp.warnings));

// Audit: a hero-led pick with no hero deployed.
const stratHero = JSON.parse(JSON.stringify(strat));
stratHero.strategy.type = 'queen-charge-hybrid';
stratHero.heroes = [
  { id: 'archer-queen', use: false, role: null, reason: 'Not used.' },
];
const rHeroLed = validateStrategy(stratHero, { townHall: 15 });
t('audit: hero-led pick with no hero deployed',
  rHeroLed.warnings.some((w) => /hero-led attack, but no hero is deployed/.test(w)),
  JSON.stringify(rHeroLed.warnings));

// Armies carry purposes; the siege machine explains itself.
const stratPurp = JSON.parse(JSON.stringify(base));
stratPurp.army.troops = [
  { id: 'miner', count: 15, purpose: 'Main ground pressure' },
  { id: 'hog-rider', count: 10, purpose: 'Follow the miners in.' },
];
stratPurp.army.spells = [{ id: 'healing-spell', count: 3, purpose: 'Keep the hybrid alive.' }];
stratPurp.army.siege_machine = { id: 'siege-barracks', purpose: 'Opens the west funnel.' };
const rPurp = validateStrategy(stratPurp, { townHall: 15 });
t('purposes: troop purpose preserved',
  rPurp.strategy.army.troops[0].purpose === 'Main ground pressure');
t('purposes: spell purpose preserved',
  rPurp.strategy.army.spells[0].purpose === 'Keep the hybrid alive.');
t('purposes: siege purpose preserved',
  rPurp.strategy.army.siege_machine?.purpose === 'Opens the west funnel.');

// Base analysis depth: traits, key defenses, pathing notes, entry evaluation.
const stratDeep = JSON.parse(JSON.stringify(base));
stratDeep.base_analysis = {
  ...stratDeep.base_analysis,
  structuralTraits: ['ring base', 'offset Town Hall', 'exposed eagle artillery'],
  keyDefenses: [
    { type: 'eagle_artillery', position: { x: 0.4, y: 0.4 }, threat: 'high' },
    { type: 'air_defense', position: { x: 0.7, y: 0.4 }, threat: 'medium' },
  ],
  pathingNotes: 'Deploy west → funnel → entry → core → cleanup.',
  entryPoints: [
    {
      position: { x: 0.2, y: 0.8 },
      reason: 'Widest gap.',
      reachableDefenses: 'West cannons',
      heroAccess: 'Queen reaches the CC.',
      risk: 'Low.',
    },
  ],
};
const rDeep = validateStrategy(stratDeep, { townHall: 15 });
t('analysis: structural traits preserved',
  JSON.stringify(rDeep.strategy.base_analysis?.structuralTraits)
    === '["ring base","offset Town Hall","exposed eagle artillery"]');
t('analysis: key defenses with threat levels',
  rDeep.strategy.base_analysis?.keyDefenses?.[0].threat === 'high' &&
    rDeep.strategy.base_analysis?.keyDefenses?.length === 2);
t('analysis: pathing notes preserved',
  rDeep.strategy.base_analysis?.pathingNotes?.startsWith('Deploy west') === true);
t('analysis: entry point evaluation fields',
  rDeep.strategy.base_analysis?.entryPoints?.[0].reachableDefenses === 'West cannons' &&
    rDeep.strategy.base_analysis?.entryPoints?.[0].heroAccess === 'Queen reaches the CC.' &&
    rDeep.strategy.base_analysis?.entryPoints?.[0].risk === 'Low.');

// Confidence sub-scores: kept when given, absent (not faked) when not.
const stratConf = JSON.parse(JSON.stringify(base));
stratConf.confidence = {
  base_analysis: 0.91, strategy: 0.85, deployment: 0.8,
  strategy_selection: 0.87, army_composition: 0.84,
};
const rConf = validateStrategy(stratConf, { townHall: 15 });
t('confidence: sub-scores kept',
  rConf.strategy.confidence?.strategy_selection === 0.87 &&
    rConf.strategy.confidence?.army_composition === 0.84);
t('confidence: sub-scores absent when unassessed',
  r1.strategy.confidence?.strategy_selection === undefined &&
    r1.strategy.confidence?.army_composition === undefined);

// Deployments without purposes are flagged (cause-and-effect check).
const stratNoPurp = JSON.parse(JSON.stringify(base));
delete stratNoPurp.deployment_plan[0].purpose;
const rNoPurp = validateStrategy(stratNoPurp, { townHall: 15 });
t('warning: deployment step without a purpose',
  rNoPurp.warnings.some((w) => /deployment step\(s\) without a purpose/.test(w)));

// The full fixture (realistic model output) carries the new fields end-to-end.
const { fixture } = await import('./attack-fixture.mts');
const rFix = validateStrategy(fixture, { townHall: 15 });
t('fixture: candidates survive validation',
  rFix.ok && (rFix.strategy.candidate_strategies?.length ?? 0) === 3 &&
    (rFix.strategy.candidate_strategies?.some((c) => c.selected === true && c.id === 'queen-charge-hybrid') ?? false),
  JSON.stringify(rFix.errors));
t('fixture: army purposes survive validation',
  rFix.strategy.army.troops.every((tr) => (tr.purpose ?? '').length > 0) &&
    rFix.strategy.army.spells.every((sp) => (sp.purpose ?? '').length > 0));
t('fixture: siege machine has its purpose',
  (rFix.strategy.army.siege_machine?.purpose ?? '').length > 0);
t('fixture: analysis depth survives validation',
  (rFix.strategy.base_analysis?.structuralTraits?.length ?? 0) >= 3 &&
    (rFix.strategy.base_analysis?.keyDefenses?.length ?? 0) >= 4 &&
    (rFix.strategy.base_analysis?.pathingNotes?.length ?? 0) > 40);
t('fixture: entry points carry the evaluation',
  (rFix.strategy.base_analysis?.entryPoints?.[0].reachableDefenses ?? '').length > 0);
t('fixture: a coherent plan raises no selection audit',
  !rFix.warnings.some((w) => /Selection audit/.test(w)) &&
    !rFix.warnings.some((w) => /does not back the pick/.test(w)),
  JSON.stringify(rFix.warnings));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
