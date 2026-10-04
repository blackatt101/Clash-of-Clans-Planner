// One-off generator: CDT slug data -> src/lib/attack/catalog.generated.ts
import fs from 'node:fs';
const base = '/home/ubuntu/coc-data-test/data/home';
function load(sub, f) {
  const p = `${base}/${sub}/${f}`;
  if (!fs.existsSync(p)) return null;
  let d = JSON.parse(fs.readFileSync(p, 'utf8'));
  return Array.isArray(d) ? d[0] : d;
}
function minTH(it) {
  if (!it?.levels) return null;
  const t = it.levels.map(l => l.townHallRequired ?? null).filter(v => v != null);
  return t.length ? Math.min(...t) : null;
}
const catalog = { troops: {}, heroes: {}, spells: {}, siege: {} };

const troopFiles = fs.readdirSync(`${base}/troops`).filter(f => f.endsWith('.json'));
for (const f of troopFiles) {
  const it = load('troops', f); if (!it) continue;
  catalog.troops[it.id] = { id: it.id, dataId: it.dataId, name: it.name, housing: it.housingSpace ?? null, minTH: minTH(it), flying: !!it.flying };
}
for (const f of fs.readdirSync(`${base}/heroes`).filter(f => f.endsWith('.json'))) {
  const it = load('heroes', f); if (!it) continue;
  // hero level rows have no townHallRequired in CDT; use game knowledge
  const thMap = { 'barbarian-king': 7, 'archer-queen': 7, 'grand-warden': 14, 'royal-champion': 15, 'minion-prince': 15, 'dragon-duke': 18 };
  catalog.heroes[it.id] = { id: it.id, dataId: it.dataId, name: it.name, minTH: thMap[it.id] ?? minTH(it) };
}
for (const f of fs.readdirSync(`${base}/spells`).filter(f => f.endsWith('.json'))) {
  const it = load('spells', f); if (!it) continue;
  catalog.spells[it.id] = { id: it.id, dataId: it.dataId, name: it.name, housing: it.housingSpace ?? null, minTH: minTH(it) };
}
for (const f of fs.readdirSync(`${base}/siege-machines`).filter(f => f.endsWith('.json'))) {
  const it = load('siege-machines', f); if (!it) continue;
  catalog.siege[it.id] = { id: it.id, dataId: it.dataId, name: it.name, minTH: minTH(it) };
}

// aliases: task-spec slugs + friendly variants -> canonical CDT slug
const alias = {
  queen: 'archer-queen', king: 'barbarian-king', grand_warden: 'grand-warden', royal_champion: 'royal-champion',
  hog_rider: 'hog-rider', wall_breaker: 'wall-breaker', wall_wrecker: 'wall-wrecker', wall_wrecker_: 'wall-wrecker',
  battle_blmp: 'battle-blimp', blimp: 'battle-blimp', battle_blmp_: 'battle-blimp',
  heal: 'healing-spell', healing: 'healing-spell', freeze: 'freeze-spell', freeze_spell: 'freeze-spell',
  rage: 'rage-spell', rage_spell: 'rage-spell', poison: 'poison-spell', lightning: 'lightning-spell',
  haste: 'haste-spell', jump: 'jump-spell',
  pekka: 'pekka', sparky: 'pekka',
  super_barbarian: 'super-barbarian', super_archer: 'super-archer', super_wizard: 'super-wizard',
  super_giant: 'super-giant', super_wb: 'super-wall-breaker', super_wall_breaker: 'super-wall-breaker',
  baby_dragon: 'baby-dragon', electro_dragon: 'electro-dragon', dragon_rider: 'dragon-rider',
  root_rider: 'root-rider', ice_golem: 'ice-golem', meteor_golem: 'meteor-golem', electro_titan: 'electro-titan',
  ruin_witch: 'ruin-witch', headhunter: 'headhunter', yeti: 'yeti',
  siege_barracks: 'siege-barracks', log_launcher: 'log-launcher', battle_drill: 'battle-drill',
  flame_flinger: 'flame-flinger', stone_slammer: 'stone-slammer', sky_wagon: 'sky-wagon', troop_launcher: 'troop-launcher',
  angry_spell: 'angry-spell', bat_spell: 'bat-spell', clone_spell: 'clone-spell', earthquake_spell: 'earthquake-spell',
  ice_block_spell: 'ice-block-spell', invisibility_spell: 'invisibility-spell', overgrowth_spell: 'overgrowth-spell',
  recall_spell: 'recall-spell', revive_spell: 'revive-spell', skeleton_spell: 'skeleton-spell', totem_spell: 'totem-spell',
  thrower: 'thrower', druid: 'druid', furnace: 'furnace', apprentice_warden: 'apprentice-warden',
  'dragon-duke': 'dragon-duke', 'minion-prince': 'minion-prince',
};
// canonical spell/troop/siege slugs without -spell suffix for spells
for (const k of Object.keys(catalog.spells)) alias[k.replace('-spell', '')] = k;
for (const k of Object.keys(catalog.troops)) { alias[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]; } // pascal variants not needed
// also allow "wall_breaker" style (underscore) for all troop slugs
for (const k of Object.keys(catalog.troops)) alias[k.replace(/-/g, '_')] = k;
for (const k of Object.keys(catalog.spells)) alias[k.replace(/-/g, '_')] = k;
for (const k of Object.keys(catalog.siege)) alias[k.replace(/-/g, '_')] = k;

// CC eligibility — Supercell rules use ALLOW lists, not a blanket exclude:
// only these regular troops fit in the enemy CC, plus CC-only units.
const ccEligible = [
  "barbarian","archer","giant","wizard","healer","hog-rider","witch","lava-hound","miner",
  // CC-only units (deployable to the CC only)
  "skeleton","giant-skeleton","giant-witch","skeleton-dragon","royal-ghost","mini-pony",
  "dopplebreaker","minion-prince","dragon-duke",
];
const ccExcluded = null; // replaced by allow list

// heroes/pets/guardians are structurally CC-excluded (separate categories)

// per-TH capacities (game constants)
const capacities = {
  armyHousing: [16, 18, 20, 22, 25, 30, 35, 40, 45, 50, 55, 58, 60, 62, 65, 70, 75, 80],        // TH1..18
  spellHousing: [1, 2, 2, 2, 2, 3, 4, 4, 4, 4, 4, 5, 6, 6, 7, 7, 8, 8],                          // TH1..18
  ccTroop:      [10, 15, 20, 25, 30, 35, 35, 40, 45, 45, 50, 50, 55, 55],                         // CC L1..14 (TH3..18)
  ccSpell:      [0, 0, 0, 0, 0, 1, 2, 2, 2, 3, 3, 3, 3, 4],
  ccSiege:      [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2],
  ccLevelForTH: { 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, 10: 8, 11: 9, 12: 10, 13: 11, 14: 12, 15: 13, 16: 13, 17: 14, 18: 14 },
};

const out = `// GENERATED from coc-data-test (CDT) home-village catalog — do not hand-edit.
// Regenerate: node scripts/gen_attack_catalog.mjs
import type { EntityRef } from "./types";

export const TROOPS: Record<string, EntityRef> = ${JSON.stringify(catalog.troops, null, 2)};
export const HEROES: Record<string, EntityRef> = ${JSON.stringify(catalog.heroes, null, 2)};
export const SPELLS: Record<string, EntityRef> = ${JSON.stringify(catalog.spells, null, 2)};
export const SIEGE: Record<string, EntityRef> = ${JSON.stringify(catalog.siege, null, 2)};

/** AI output slugs / aliases -> canonical CDT slug. */
export const SLUG_ALIASES: Record<string, string> = ${JSON.stringify(alias, null, 2)};

/** Troop slugs that cannot be placed in the Clan Castle. */
/** Troop slugs that CAN be placed in the enemy Clan Castle (Supercell rule: allow list). */
export const CC_ELIGIBLE = new Set<string>(${JSON.stringify([...new Set(ccEligible)], null, 2)});

export const CAPACITIES = ${JSON.stringify(capacities, null, 2)};
`;
fs.mkdirSync('/home/ubuntu/coc-planner/src/lib/attack', { recursive: true });
fs.writeFileSync('/home/ubuntu/coc-planner/src/lib/attack/catalog.generated.ts', out);
console.log('troops', Object.keys(catalog.troops).length, 'heroes', Object.keys(catalog.heroes).length, 'spells', Object.keys(catalog.spells).length, 'siege', Object.keys(catalog.siege).length, 'aliases', Object.keys(alias).length);
