/**
 * Validates (and repairs where safe) a raw AI strategy response against the
 * game's rules. The validator is the only code that decides whether the
 * frontend gets to render anything: raw model output never reaches it
 * unrepaired.
 *
 * Repair policy:
 *  - unknown unit slugs -> drop from army / deployment, record warning
 *  - out-of-range coordinates -> clamp to [0,1]
 *  - negative / non-integer counts -> floor to 0 and drop empties
 *  - housing/spell/CC capacity overflow -> trim counts to fit the capacity
 *    (greedy, highest-space species first; whole species only dropped when
 *    not even one fits), recorded as warnings. Plans always come out valid.
 *  - a troop group split into consecutive steps ("5 miners" then
 *    "10 miners") -> merged into ONE step, so the plan renders a single
 *    "Miner ×15" marker instead of a swarm of icons
 *  - paths / spell actions -> carry the 1-based deployment step they
 *    belong to (out-of-range references are dropped, not trusted)
 *  - hero decisions -> gated by the ATTACKER's Town Hall; every
 *    available hero the model skipped is backfilled into the
 *    decision list (never silently ignored); used heroes need a
 *    role, excluded heroes need a reason (repaired when missing);
 *    the battlefield hero slots (one opens every two Town Halls
 *    from TH7: TH9=2, TH11=3, TH13=4, TH15=5) are enforced —
 *    extras are excluded with the limit as their reason, and
 *    their deployment steps / paths / abilities are dropped
 */
import {
  heroBattlefieldLimit,
  resolveEntity,
  resolveSlug,
  capacitiesForTH,
  isCcEligible,
} from "./catalog";
import { HEROES } from "./catalog.generated";
import type {
  ArmyConstraints,
  AttackStrategy,
  DeploymentStep,
  HeroDecision,
  Point,
  ValidationResult,
} from "./types";

const CLAMP = { minX: 0, maxX: 1, minY: 0, maxY: 1 };

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function clampPoint(p: unknown): Point {
  const x = isNum((p as Point)?.x) ? (p as Point).x : 0.5;
  const y = isNum((p as Point)?.y) ? (p as Point).y : 0.5;
  return {
    x: Math.min(CLAMP.maxX, Math.max(CLAMP.minX, x)),
    y: Math.min(CLAMP.maxY, Math.max(CLAMP.minY, y)),
  };
}

function intCount(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function spaceOf(slug: string): number {
  return resolveEntity(slug)?.ref.housing ?? 0;
}

/**
 * Town Hall availability: units whose minTH is above the attacker's TH are
 * dropped (repair policy) so the rendered plan never names equipment the
 * player cannot have. `minTH === null` (no data) passes.
 */
function thAvailable(slug: string, th: number): boolean {
  const min = resolveEntity(slug)?.ref.minTH;
  return min == null || min <= th;
}

/**
 * Repair a capacity overflow by trimming counts in place (never throws —
 * returns void; callers check `totalHousing` afterward if they care).
 * Greedy: decrement the highest-space species first; when every species is
 * down to 1, drop the last entries until the loadout fits. Records one
 * warning per trimmed loadout and one per fully-dropped species.
 */
function fitToCapacity(
  entries: { id: string; count: number }[],
  cap: number,
  label: string,
  warnings: string[],
): void {
  const total = () => entries.reduce((s, e) => s + spaceOf(e.id) * e.count, 0);
  const before = total();
  if (before <= cap || entries.length === 0) return;
  let guard = 0;
  while (total() > cap && guard++ < 10_000) {
    const multi = entries.filter((e) => e.count > 1);
    if (multi.length) {
      multi.sort((a, b) => spaceOf(b.id) - spaceOf(a.id));
      multi[0].count -= 1;
    } else {
      const dropped = entries.pop()!;
      warnings.push(
        `${label} "${dropped.id}" dropped — not enough capacity for even one.`,
      );
    }
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].count <= 0) entries.splice(i, 1);
  }
  const after = total();
  if (after < before) {
    warnings.push(
      `${label} loadout trimmed to fit capacity (was ${before}, now ${after} of ${cap}).`,
    );
  }
}

// The validator intentionally accepts untrusted model JSON; `any` is scoped to
// this alias so every access still goes through the explicit helpers below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

function asRaw(v: unknown): Raw {
  return (v ?? {}) as Raw;
}

function asArray(v: unknown): Raw[] {
  return Array.isArray(v) ? (v as Raw[]) : [];
}

/**
 * @returns { strategy, repaired } where repaired lists the low-severity
 * fixes made. `strategy` is safe to render when `ok` is true.
 */
export function validateStrategy(
  raw: unknown,
  constraints: ArmyConstraints,
): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const rawObj = asRaw(raw);
  const caps = capacitiesForTH(constraints.townHall);
  const armyHousing = constraints.armyHousing ?? caps.armyHousing;
  const spellHousing = constraints.spellHousing ?? caps.spellHousing;
  const ccTroopCap = constraints.ccTroops ?? caps.ccTroopCapacity;

  // ---- strategy ----
  const strat = asRaw(rawObj.strategy);
  const strategy = {
    name: String(strat.name ?? "Unnamed Strategy").slice(0, 80) || "Unnamed Strategy",
    type: strat.type ? String(strat.type).slice(0, 60) : undefined,
    difficulty: (["easy", "medium", "hard"] as const).includes(strat.difficulty)
      ? strat.difficulty
      : undefined,
    summary: strat.summary ? String(strat.summary).slice(0, 400) : undefined,
    reason: String(strat.reason ?? strat.summary ?? "").slice(0, 1200),
  };
  if (!strategy.reason) warnings.push("Strategy is missing a rationale.");

  // ---- army troops / spells / siege / CC ----
  const troops: { id: string; count: number }[] = [];
  const seenTroop = new Set<string>();
  for (const t of asArray(rawObj.army?.troops)) {
    const slug = resolveSlug(t?.id);
    const n = intCount(t?.count);
    if (!slug) {
      warnings.push(`Unknown troop "${String(t?.id)}" dropped.`);
      continue;
    }
    const kind = resolveEntity(slug)?.kind;
    if (kind !== "troop") {
      warnings.push(`"${slug}" is not a troop; dropped from army.`);
      continue;
    }
    if (!thAvailable(slug, constraints.townHall)) {
      warnings.push(`"${slug}" is not available at TH${constraints.townHall}; dropped.`);
      continue;
    }
    if (n <= 0) continue;
    if (seenTroop.has(slug)) {
      troops.find((x) => x.id === slug)!.count += n;
      continue;
    }
    seenTroop.add(slug);
    troops.push({ id: slug, count: n });
  }

  const spells: { id: string; count: number }[] = [];
  const seenSpell = new Set<string>();
  for (const s of asArray(rawObj.army?.spells)) {
    const slug = resolveSlug(s?.id);
    const n = intCount(s?.count);
    if (!slug || resolveEntity(slug)?.kind !== "spell") {
      warnings.push(`Unknown spell "${String(s?.id)}" dropped.`);
      continue;
    }
    if (!thAvailable(slug, constraints.townHall)) {
      warnings.push(`Spell "${slug}" is not available at TH${constraints.townHall}; dropped.`);
      continue;
    }
    if (n <= 0) continue;
    if (seenSpell.has(slug)) {
      spells.find((x) => x.id === slug)!.count += n;
      continue;
    }
    seenSpell.add(slug);
    spells.push({ id: slug, count: n });
  }

  let siege: { id: string } | undefined;
  const siegeRaw = rawObj.army?.siege_machine;
  if (siegeRaw?.id) {
    const slug = resolveSlug(siegeRaw.id);
    if (slug && resolveEntity(slug)?.kind === "siege" && thAvailable(slug, constraints.townHall)) {
      siege = { id: slug };
    } else {
      warnings.push(`Unknown or TH-unavailable siege machine "${String(siegeRaw.id)}" dropped.`);
    }
  }

  const ccTroops: { id: string; count: number }[] = [];
  for (const t of asArray(rawObj.army?.clan_castle)) {
    const slug = resolveSlug(t?.id);
    const n = intCount(t?.count);
    if (!slug || n <= 0) continue;
    if (resolveEntity(slug)?.kind !== "troop") continue;
    if (!thAvailable(slug, constraints.townHall)) {
      warnings.push(`CC troop "${slug}" is not available at TH${constraints.townHall}; dropped.`);
      continue;
    }
    if (!isCcEligible(slug)) {
      warnings.push(`"${slug}" cannot be placed in the Clan Castle; dropped.`);
      continue;
    }
    ccTroops.push({ id: slug, count: n });
  }

  // Capacity checks: overfull loadouts are repaired (trimmed to fit) rather
  // than fatal — the model over-picks spells/troops often enough that a
  // hard reject would discard otherwise-good plans. Anything that still
  // cannot fit (whole species dropped) is recorded as a warning.
  fitToCapacity(troops, armyHousing, "Army", warnings);
  fitToCapacity(spells, spellHousing, "Spell", warnings);
  fitToCapacity(ccTroops, ccTroopCap, "Clan Castle", warnings);

  // ---- hero decisions ----
  // The model must consider EVERY hero available at the attacker's
  // Town Hall and decide use + role + reason per hero. Entries are
  // gated by the ATTACKER's TH (never the enemy's, which lives in
  // base_analysis). Heroes the model forgot are backfilled from the
  // catalog so an available hero can never silently disappear from
  // the decision list. Parsed before the deployment plan so the
  // final decisions can gate deployment steps, paths and abilities.
  const deployedHeroes = new Set<string>(
    asArray(rawObj.deployment_plan)
      .map((d) => resolveSlug(d?.unit))
      .filter((s): s is string => s != null && resolveEntity(s)?.kind === "hero"),
  );
  const abilityHeroes = new Set<string>(
    asArray(rawObj.hero_abilities)
      .map((h) => resolveSlug(h?.hero))
      .filter((s): s is string => s != null),
  );
  const heroes: HeroDecision[] = [];
  const seenHeroes = new Set<string>();
  for (const h of asArray(rawObj.heroes)) {
    const id = resolveSlug(h?.id);
    if (id == null || resolveEntity(id)?.kind !== "hero") {
      warnings.push(`Hero decision for "${String(h?.id ?? "")}" is not a known hero; dropped.`);
      continue;
    }
    if (!thAvailable(id, constraints.townHall)) {
      warnings.push(`Hero decision for "${id}" not available at TH${constraints.townHall}; dropped.`);
      continue;
    }
    if (seenHeroes.has(id)) continue; // first entry wins
    seenHeroes.add(id);
    const use = h?.use === true;
    let role = typeof h?.role === "string" ? h.role.trim().slice(0, 80) : "";
    let reason = typeof h?.reason === "string" ? h.reason.trim().slice(0, 240) : "";
    if (use && !role) {
      role = "support";
      warnings.push(`Hero "${id}" is used without a role; defaulted to "support".`);
    }
    if (!use && !reason) {
      reason = "Not selected for this attack.";
      warnings.push(`Hero "${id}" excluded without a reason; added a placeholder.`);
    }
    heroes.push({ id, use, role: use ? role : null, reason });
  }
  // Backfill every available hero the model did not evaluate. A hero
  // the model deployed anyway counts as selected; anything else is
  // listed as excluded — with the reason made explicit, so an
  // overlooked hero is visible instead of silent.
  for (const slug of Object.values(HEROES).map((h) => h.id)) {
    if (seenHeroes.has(slug) || !thAvailable(slug, constraints.townHall)) continue;
    const used = deployedHeroes.has(slug) || abilityHeroes.has(slug);
    warnings.push(
      `Hero "${slug}" is available at TH${constraints.townHall} but was not evaluated; listed as ${used ? "selected" : "not selected"}.`,
    );
    heroes.push(
      used
        ? { id: slug, use: true, role: "support", reason: "Selected by the deployment plan." }
        : { id: slug, use: false, role: null, reason: "Not considered by the planner." },
    );
  }
  // Battlefield rule: at most 3 heroes may be deployed per
  // attack up to TH12, and 4 from TH13. When the model selects
  // more, the first ones (its own priority order) stay and the
  // rest are excluded — the limit is the exclusion reason, and
  // their deployment steps, paths and abilities are dropped
  // below so the visual plan never shows a hero that is not
  // brought.
  const heroLimit = heroBattlefieldLimit(constraints.townHall);
  const selectedHeroes = heroes.filter((d) => d.use);
  if (selectedHeroes.length > heroLimit) {
    const kept = new Set(selectedHeroes.slice(0, heroLimit).map((d) => d.id));
    for (const d of heroes) {
      if (d.use && !kept.has(d.id)) {
        warnings.push(
          `Hero "${d.id}" exceeds the ${heroLimit}-hero battlefield limit; listed as not selected.`,
        );
        d.use = false;
        d.role = null;
        d.reason = `Battlefield limit: at most ${heroLimit} heroes can be deployed per attack.`;
      }
    }
  }
  /** True when the hero is available but not selected for this
   *  attack (excluded by the model or by the 3-hero limit). */
  const heroNotSelected = (slug: string): boolean => {
    const d = heroes.find((h) => h.id === slug);
    return d != null && !d.use;
  };
  // A used hero with neither a deployment step nor an ability entry
  // cannot be rendered — flag it (the plan stays valid; the prompt
  // demands deployment).
  for (const d of heroes) {
    if (d.use && !deployedHeroes.has(d.id) && !abilityHeroes.has(d.id)) {
      warnings.push(`Hero "${d.id}" is marked used but has no deployment step or ability.`);
    }
  }

  // ---- deployment plan ----
  const phaseNames = new Set(
    asArray(rawObj.attack_phases).map((p) => String(p?.name ?? "")).filter(Boolean),
  );
  interface RawStep {
    phase: string;
    unit: string;
    count: number;
    position: Point;
    target?: string;
    purpose?: string;
    deployments?: { count: number; position: Point; label?: string }[];
  }
  const rawSteps: RawStep[] = [];
  for (const d of asArray(rawObj.deployment_plan)) {
    const slug = resolveSlug(d?.unit);
    if (!slug) {
      warnings.push(`Deployment step for unknown unit "${String(d?.unit)}" dropped.`);
      continue;
    }
    if (!thAvailable(slug, constraints.townHall)) {
      warnings.push(`Deployment step for "${slug}" is not available at TH${constraints.townHall}; dropped.`);
      continue;
    }
    if (resolveEntity(slug)?.kind === "hero" && heroNotSelected(slug)) {
      warnings.push(`Deployment step for "${slug}" dropped: hero not selected for this attack.`);
      continue;
    }
    const count = intCount(d?.count ?? 1);
    const position = clampPoint(d?.position);
    const deployments = (asArray(d?.deployments) as Raw[])
      .map((s) => ({
        count: intCount(s?.count),
        position: clampPoint(s?.position ?? position),
        label: s?.label ? String(s.label).slice(0, 40) : undefined,
      }))
      .filter((s) => s.count > 0);
    // Phases are normalized (lowercase) so the same phase named
    // slightly differently still merges below.
    const phase = String(d?.phase ?? "").trim().toLowerCase().slice(0, 60) || "main";
    if (!phaseNames.has(phase)) phaseNames.add(phase);
    rawSteps.push({
      phase,
      unit: slug,
      count,
      position,
      target: d?.target ? String(d.target).slice(0, 80) : undefined,
      purpose: d?.purpose ? String(d.purpose).slice(0, 240) : undefined,
      deployments: deployments.length ? deployments : undefined,
    });
  }

  // One marker per troop GROUP: a group the model split into
  // consecutive steps ("5 miners" then "10 miners", same phase)
  // is merged — counts sum, split deployments concatenate, the
  // first step's position/target/purpose wins. Non-adjacent or
  // different-phase steps are never merged. `stepRemap` maps each
  // INPUT step number (1-based) to its OUTPUT step number, so paths
  // and spells that reference the model's numbering still land on
  // the right step after the merge.
  const merged: RawStep[] = [];
  const stepRemap: number[] = [];
  rawSteps.forEach((s, i) => {
    const prev = merged[merged.length - 1];
    if (prev && prev.unit === s.unit && prev.phase === s.phase) {
      prev.count += s.count;
      if (s.deployments?.length) {
        prev.deployments = [...(prev.deployments ?? []), ...s.deployments];
      }
      stepRemap[i + 1] = merged.length; // same output step as prev
      return;
    }
    merged.push({ ...s, deployments: s.deployments ? [...s.deployments] : undefined });
    stepRemap[i + 1] = merged.length;
  });
  if (merged.length < rawSteps.length) {
    warnings.push(
      `${rawSteps.length - merged.length} consecutive deployment step(s) merged into one marker.`,
    );
  }

  const deployment_plan: DeploymentStep[] = merged.map((s, i) => ({
    step: i + 1,
    ...s,
  }));
  if (deployment_plan.length === 0) {
    errors.push("Deployment plan is empty — at least one deployment is required.");
  }

  // Paths / spells reference the 1-based step they belong to, in the
  // MODEL's numbering — remapped through the merge above. Out-of-range
  // references are dropped (never trusted) — the overlay then falls
  // back to attribution by unit, or shows the element in "All steps"
  // only.
  const stepRef = (v: unknown): number | undefined => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 1 || n > rawSteps.length) return undefined;
    const mapped = stepRemap[n];
    return mapped >= 1 && mapped <= deployment_plan.length ? mapped : undefined;
  };

  // ---- paths ----
  const paths = asArray(rawObj.paths)
    .map((p) => ({
      unit: String(p?.unit ?? ""),
      points: (asArray(p?.points) as Raw[]).map((pt) => clampPoint(pt)),
      style: p?.style === "funnel" || p?.style === "cleanup" ? p.style : ("attack" as const),
      step: stepRef(p?.step),
    }))
    .filter((p) => {
      if (!p.unit || p.points.length < 2) return false;
      const slug = resolveSlug(p.unit);
      if (slug && resolveEntity(slug)?.kind === "hero" && heroNotSelected(slug)) {
        warnings.push(`Path for "${p.unit}" dropped: hero not selected for this attack.`);
        return false;
      }
      return true;
    });
  for (const p of asArray(rawObj.paths)) {
    if (!String(p?.unit ?? "") || asArray(p?.points).length < 2) {
      warnings.push(`Path for "${String(p?.unit)}" needs at least 2 points; dropped.`);
    }
  }

  // ---- spell actions ----
  const spell_actions = asArray(rawObj.spell_actions)
    .map((s) => ({
      spell: resolveSlug(s?.spell) ?? String(s?.spell ?? ""),
      position: clampPoint(s?.position),
      trigger: s?.trigger ? String(s.trigger).slice(0, 240) : undefined,
      purpose: s?.purpose ? String(s.purpose).slice(0, 240) : undefined,
      step: stepRef(s?.step),
    }))
    .filter((s) => {
      if (resolveSlug(s.spell) === null) return false;
      if (!thAvailable(s.spell, constraints.townHall)) {
        warnings.push(`Spell "${s.spell}" in spell_actions not available at TH${constraints.townHall}; dropped.`);
        return false;
      }
      return true;
    });
  for (const s of asArray(rawObj.spell_actions)) {
    if (!resolveSlug(s?.spell)) warnings.push(`Unknown spell "${String(s?.spell)}" in spell_actions dropped.`);
  }

  // ---- hero abilities ----
  const hero_abilities = asArray(rawObj.hero_abilities)
    .map((h) => ({
      hero: resolveSlug(h?.hero) ?? String(h?.hero ?? ""),
      trigger: String(h?.trigger ?? "").slice(0, 240),
      purpose: h?.purpose ? String(h.purpose).slice(0, 240) : undefined,
    }))
    .filter((h) => {
      if (resolveSlug(h.hero) === null) return false;
      if (!thAvailable(h.hero, constraints.townHall)) {
        warnings.push(`Hero ability for "${h.hero}" not available at TH${constraints.townHall}; dropped.`);
        return false;
      }
      if (resolveEntity(h.hero)?.kind === "hero" && heroNotSelected(h.hero)) {
        warnings.push(`Hero ability for "${h.hero}" dropped: hero not selected for this attack.`);
        return false;
      }
      return true;
    });

  // ---- hero decisions (see above: parsed before the deployment
  // plan so the final decisions gate steps, paths and abilities) ----

  // ---- phases ----
  let phaseNo = 0;
  const attack_phases = asArray(rawObj.attack_phases)
    .map((p) => {
      phaseNo += 1;
      return {
        phase: phaseNo,
        name: String(p?.name ?? `Phase ${phaseNo}`),
        description: p?.description ? String(p.description).slice(0, 300) : undefined,
      };
    });
  if (attack_phases.length === 0) {
    attack_phases.push({ phase: 1, name: "Attack", description: undefined });
  }

  // ---- base analysis ----
  const ba = asRaw(rawObj.base_analysis);
  const base_analysis = {
    townHallLevel: isNum(ba.townHallLevel) ? Math.round(ba.townHallLevel) : undefined,
    townHallPosition: ba.townHallPosition ? clampPoint(ba.townHallPosition) : undefined,
    townHallWeapon: ba.townHallWeapon ? String(ba.townHallWeapon).slice(0, 40) : undefined,
    clanCastlePosition: ba.clanCastlePosition ? clampPoint(ba.clanCastlePosition) : undefined,
    baseShape: ba.baseShape ? String(ba.baseShape).slice(0, 60) : undefined,
    layoutNotes: ba.layoutNotes ? String(ba.layoutNotes).slice(0, 500) : undefined,
    importantTargets: (asArray(ba.importantTargets) as Raw[])
      .map((t) => ({
        type: String(t?.type ?? "unknown_defense"),
        position: clampPoint(t?.position),
        priority: (["high", "medium", "low"] as const).includes(t?.priority) ? t.priority : "medium",
        confidence: isNum(t?.confidence) ? Math.min(1, Math.max(0, t.confidence)) : 0.5,
        label: t?.label ? String(t.label).slice(0, 40) : undefined,
      }))
      .filter((t) => t.type),
    entryPoints: (asArray(ba.entryPoints) as Raw[]).map((e) => ({
      position: clampPoint(e?.position),
      reason: e?.reason ? String(e.reason).slice(0, 160) : undefined,
    })),
    funnels: (asArray(ba.funnels) as Raw[]).map((f) => ({
      position: clampPoint(f?.position),
      purpose: f?.purpose ? String(f.purpose).slice(0, 160) : undefined,
    })),
  };

  // ---- confidence ----
  const conf = asRaw(rawObj.confidence);
  const confidence = {
    base_analysis: isNum(conf.base_analysis) ? Math.min(1, Math.max(0, conf.base_analysis)) : 0.7,
    strategy: isNum(conf.strategy) ? Math.min(1, Math.max(0, conf.strategy)) : 0.7,
    deployment: isNum(conf.deployment) ? Math.min(1, Math.max(0, conf.deployment)) : 0.7,
  };

  const strategyOut: AttackStrategy = {
    strategy,
    army: { troops, spells, ...(siege ? { siege_machine: siege } : {}), ...(ccTroops.length ? { clan_castle: ccTroops } : {}) },
    base_analysis,
    deployment_plan,
    heroes: heroes.length ? heroes : undefined,
    paths: paths.length ? paths : undefined,
    spell_actions: spell_actions.length ? spell_actions : undefined,
    hero_abilities: hero_abilities.length ? hero_abilities : undefined,
    attack_phases,
    confidence,
  };

  const ok = errors.length === 0;
  return {
    ok,
    errors,
    warnings,
    strategy: ok ? strategyOut : (strategyOut as AttackStrategy),
  };
}
