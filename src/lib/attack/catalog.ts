/**
 * Entity catalog: resolves canonical slugs ("miner", "archer-queen",
 * "healing-spell") to Supercell numeric IDs, from which the app's existing
 * icon system (public/data/images.json -> public/icons/*.webp) provides the
 * images. The AI returns slugs; this module is the only place that maps
 * slugs -> icons. No new icon assets are ever generated.
 */
import {
  CAPACITIES,
  CC_ELIGIBLE,
  HEROES,
  SIEGE,
  SLUG_ALIASES,
  SPELLS,
  TROOPS,
} from "./catalog.generated";

import type { EntityRef } from "./types";

export type { EntityRef };

export type EntityKind = "troop" | "hero" | "spell" | "siege" | "unknown";

/** Fold a slug to its canonical shape: lowercase, hyphen-separated. */
function normSlug(s: string): string {
  // Underscores are the spec's own id form ("archer_queen") and a
  // common model output, so they fold to the canonical hyphen.
  return s.toLowerCase().replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Alias table re-keyed by normalized slug, so "battle_blmp" and
 *  "battle-blmp" hit the same entry. */
const ALIASES: Record<string, string> = {};
for (const [k, v] of Object.entries(SLUG_ALIASES)) {
  const nk = normSlug(k);
  if (nk) ALIASES[nk] = v;
}

/** Normalize an AI/unit slug to the canonical form, or null if unknown. */
export function resolveSlug(input: string): string | null {
  const raw = normSlug(String(input ?? "").trim());
  if (!raw) return null;
  // Exact canonical match in any table.
  if (TROOPS[raw] || SPELLS[raw] || SIEGE[raw] || HEROES[raw]) return raw;
  // Alias table (task-spec names like "queen", misspellings such as
  // "battle_blmp", plus spell suffix stripping).
  return ALIASES[raw] ?? null;
}

/**
 * Battlefield hero slots by Town Hall: the first slot opens
 * at TH7 and another opens every two Town Halls (TH9: 2,
 * TH11: 3, TH13: 4, TH15: 5, TH17: 6 — all six heroes).
 * The AI chooses which heroes fill the slots; the validator
 * enforces the count.
 */
export function heroBattlefieldLimit(th: number): number {
  if (th < 7) return 0;
  return Math.min(1 + Math.floor((th - 7) / 2), 6);
}

/** Full entity lookup by slug or alias; unknown ids return null. */
export function resolveEntity(input: string): { kind: EntityKind; ref: EntityRef } | null {
  const slug = resolveSlug(input);
  if (!slug) return null;
  if (TROOPS[slug]) return { kind: "troop", ref: TROOPS[slug] };
  if (SPELLS[slug]) return { kind: "spell", ref: SPELLS[slug] };
  if (SIEGE[slug]) return { kind: "siege", ref: SIEGE[slug] };
  if (HEROES[slug]) return { kind: "hero", ref: HEROES[slug] };
  return null;
}

/**
 * Hero deployment units use the same "unit" field as troops — "queen" is
 * shorthand for archer-queen. Returns the hero slug when the unit is a hero.
 */
export function heroOfUnit(input: string): EntityRef | null {
  const r = resolveEntity(input);
  return r?.kind === "hero" ? r.ref : null;
}

export function isCcEligible(slug: string): boolean {
  return CC_ELIGIBLE.has(slug);
}

/**
 * Capacities for a given Town Hall. Tables are TH1..18; out-of-range TH is
 * clamped so the validator still has sane numbers.
 */
export function capacitiesForTH(th: number) {
  const t = Math.min(18, Math.max(1, Math.round(th)));
  const ccLevel = (CAPACITIES.ccLevelForTH as Record<string, number>)[String(t)] ?? 0;
  const idx = ccLevel - 1; // CC L1..L14, L1 requires TH3
  return {
    th: t,
    armyHousing: CAPACITIES.armyHousing[t - 1],
    spellHousing: CAPACITIES.spellHousing[t - 1],
    ccTroopCapacity: idx >= 0 ? CAPACITIES.ccTroop[idx] : 0,
    ccSpellCapacity: idx >= 0 ? CAPACITIES.ccSpell[idx] : 0,
    ccSiegeCapacity: idx >= 0 ? CAPACITIES.ccSiege[idx] : 0,
  };
}

export function totalHousing(entries: { id: string; count: number }[]): number {
  return entries.reduce((sum, e) => {
    const r = resolveEntity(e.id);
    const h = r?.ref.housing ?? 0;
    return sum + h * Math.max(0, e.count);
  }, 0);
}

export function totalSpellHousing(entries: { id: string; count: number }[]): number {
  return entries.reduce((sum, e) => {
    const r = resolveEntity(e.id);
    const h = r?.ref.housing ?? 0;
    return sum + h * Math.max(0, e.count);
  }, 0);
}
