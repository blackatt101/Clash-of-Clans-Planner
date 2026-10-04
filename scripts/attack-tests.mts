/**
 * Attack-strategy unit tests (no test framework needed): npx tsx scripts/attack-tests.mts
 * Covers slug resolution, per-TH capacities, coordinate clamping, and the
 * validator's reject/repair rules (task §39 validation tests).
 */
import { resolveEntity, resolveSlug, capacitiesForTH, totalHousing, isCcEligible } from "../src/lib/attack/catalog";
import { validateStrategy, clampPoint } from "../src/lib/attack/validate";
import { pathD, arrowHead, toVb } from "../src/lib/attack/geometry";

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
t('TH15 army housing', c15.armyHousing === 65, String(c15.armyHousing));
t('TH15 spell housing', c15.spellHousing === 7, String(c15.spellHousing));
t('TH15 CC troops', c15.ccTroopCapacity === 55, String(c15.ccTroopCapacity));
t('TH10 army housing', capacitiesForTH(10).armyHousing === 50);
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
overflow.army.troops = [{id:'dragon',count:50}]; // 50*20=1000 > 65
const r4 = validateStrategy(overflow, {townHall: 15});
// Capacity overflow is now REPAIRED (trimmed to fit), not fatal:
// 50 dragons -> 3 dragons (60 housing) fits the 65 cap; one warning recorded.
t('housing overflow repaired (trimmed to fit)',
  r4.ok && r4.strategy.army.troops.length === 1
    && r4.strategy.army.troops[0].count === 3
    && totalHousing(r4.strategy.army.troops) === 60
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

// CC capacity: 15 miners = 90 > 55 CC capacity at TH15 -> repaired to 9 (54)
const ccBad = JSON.parse(JSON.stringify(base));
ccBad.army.clan_castle = [{id:'miner', count: 15}];
const r8 = validateStrategy(ccBad, {townHall: 15});
t('CC capacity overflow repaired (trimmed to fit)',
  r8.ok && (r8.strategy.army.clan_castle ?? []).length === 1
    && r8.strategy.army.clan_castle![0].count === 9
    && totalHousing(r8.strategy.army.clan_castle!) === 54,
  JSON.stringify({ok:r8.ok, cc:r8.strategy.army.clan_castle, warnings:r8.warnings}));

// CC exclusion: balloons never allowed
const ccBalloon = JSON.parse(JSON.stringify(base));
ccBalloon.army.clan_castle = [{id:'balloon', count: 3}];
const r9 = validateStrategy(ccBalloon, {townHall: 15});
t('CC balloons excluded & dropped', r9.ok && (r9.strategy.army.clan_castle ?? []).length === 0, JSON.stringify(r9.errors));

// CC valid: 10 miners = 60 > 55 should fail; 8 miners = 48 fits
const ccOk = JSON.parse(JSON.stringify(base));
ccOk.army.clan_castle = [{id:'miner', count: 8}];
const r10 = validateStrategy(ccOk, {townHall: 15});
t('CC valid loadout passes', r10.ok && r10.strategy.army.clan_castle!.length === 1, JSON.stringify(r10.errors));

// --- geometry (§2/§9) ---
const vb = {w: 1000, h: 1000};
t('toVb', JSON.stringify(toVb({x:0.25,y:0.7}, vb)) === '{"x":250,"y":700}');
t('pathD', pathD([{x:0,y:0},{x:0.5,y:0.5}], vb) === 'M 0.0 0.0 L 500.0 500.0');
t('arrowHead has 4 points', arrowHead([{x:0.5,y:0.9},{x:0.5,y:0.3}], vb, 35).split(' ').length === 4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
