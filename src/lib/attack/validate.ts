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
 *  - candidate strategies -> resolved against the canonical
 *    strategy catalog (naming variants collapse onto one
 *    entry, unknown ids kept as free-form), gated by the
 *    ATTACKER's Town Hall, capped at 6; exactly one
 *    selected — the candidate matching strategy.type wins
 *    (the plan serves it) — and warned when the fit scores
 *    don't back the pick
 *  - army / siege / CC entries -> carry an optional purpose
 *  - base analysis -> structural traits, key defenses and
 *    pathing notes parsed with the same slice/cap policy
 *  - selection audit -> deterministic cross-checks of the
 *    picked strategy's tags against the reported base
 *    (air-defense threat vs a ground-only pick, blimp vs
 *    high-threat Air Defenses, hero-led pick with no hero
 *    deployed)
 */
import {
  heroBattlefieldLimit,
  resolveEntity,
  resolveSlug,
  capacitiesForTH,
  isCcEligible,
} from "./catalog";
import { HEROES } from "./catalog.generated";
import {
  normalizeStrategyId,
  resolveStrategyId,
  strategyById,
  strategyMinTH,
} from "./strategies";
import type {
  ArmyConstraints,
  AttackStrategy,
  CandidateStrategy,
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
 * True when a defense type string names an Air Defense
 * ("air_defense", "Air Defense", "airdef"…).
 */
function isAirDefenseType(type: string): boolean {
  const n = type.toLowerCase().replace(/[^a-z0-9]/g, "");
  return n === "airdefense" || n === "airdef" || n.includes("airdefense");
}

/**
 * Deterministic second opinion on the selection: cross-checks
 * the picked strategy's capability tags against the base
 * analysis the model itself reported. Findings are warnings —
 * the plan stays valid, but the user sees where the pick and
 * the base disagree (the model's own evidence contradicts it).
 */
function auditSelection(strategy: AttackStrategy, warnings: string[]): void {
  const def = strategyById(strategy.strategy.type ?? "");
  if (!def) return;
  const ba = strategy.base_analysis ?? {};
  const threats: Array<{ type: string; level?: string }> = [
    ...(ba.keyDefenses ?? []).map((d) => ({ type: d.type, level: d.threat })),
    ...(ba.importantTargets ?? []).map((t) => ({
      type: t.type,
      level: t.priority,
    })),
  ];
  const airThreat = threats.some(
    (d) => isAirDefenseType(d.type) && (d.level === "high" || d.level === "medium"),
  );
  const airThreatHigh = threats.some(
    (d) => isAirDefenseType(d.type) && d.level === "high",
  );
  // A ground-only army cannot damage Air Defenses at all: they
  // fire on it all attack long, so a base where they are a key
  // threat needs an air wing (or a blimp) in the plan.
  const hasAir = def.tags.some((t) => t === "air" || t === "hybrid" || t === "blimp");
  if (airThreat && !hasAir) {
    warnings.push(
      `Selection audit: Air Defenses are among this base's key threats, but ${def.name} is a ground-only attack — they will fire on the army all attack long.`,
    );
  }
  if (def.tags.includes("blimp") && airThreatHigh) {
    warnings.push(
      `Selection audit: an Air Defense is a high threat and ${def.name} depends on a Battle Blimp — the troops inside it may not survive to fire.`,
    );
  }
  if (
    def.tags.includes("hero-led") &&
    (strategy.heroes ?? []).filter((h) => h.use).length === 0
  ) {
    warnings.push(
      `Selection audit: ${def.name} is a hero-led attack, but no hero is deployed — the charge that anchors it is missing.`,
    );
  }
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

  // ---- candidate strategies (the comparison behind the pick) ----
  // Ids resolve against the canonical strategy catalog so naming
  // variants ("GoWiPe", "go wi pe") collapse onto one entry;
  // unknown ids pass through as free-form (flagged). Candidates
  // the attacker's Town Hall cannot field are dropped, exactly
  // like units. Exactly one entry may be selected; a list
  // without a pick marks the first as the chosen one so the UI
  // always has a selection to highlight.
  const candidates: CandidateStrategy[] = [];
  const seenCand = new Set<string>();
  for (const c of asArray(rawObj.candidate_strategies)) {
    const rawId = String(c?.id ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60);
    if (!rawId) continue;
    const canonical = resolveStrategyId(rawId);
    const id = canonical ?? rawId;
    if (seenCand.has(id)) continue;
    seenCand.add(id);
    if (!canonical) {
      warnings.push(
        `Strategy candidate "${rawId}" is not a known attack; kept as a free-form entry.`,
      );
    }
    // Catalog strategies are gated by Town Hall like units: a
    // TH8 army cannot field a Super Archer Blimp.
    const minTH = strategyMinTH(id);
    if (minTH != null && minTH > constraints.townHall) {
      warnings.push(
        `Strategy "${id}" needs TH${minTH}+ and is not available at TH${constraints.townHall}; dropped.`,
      );
      continue;
    }
    candidates.push({
      id,
      name: String(c?.name ?? "").trim().slice(0, 60) || id,
      fit_score: isNum(c?.fit_score) ? Math.min(1, Math.max(0, c.fit_score)) : undefined,
      strengths: asArray(c?.strengths)
        .map((s) => String(s ?? "").trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, 4),
      weaknesses: asArray(c?.weaknesses)
        .map((s) => String(s ?? "").trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, 4),
      selected: c?.selected === true,
      rejected_reason:
        c?.selected === true || !c?.rejected_reason
          ? undefined
          : String(c.rejected_reason).trim().slice(0, 300),
    });
  }
  if (candidates.length > 6) {
    warnings.push(
      `${candidates.length - 6} extra candidate strategy/strategies dropped (cap 6).`,
    );
    candidates.length = 6;
  }
  if (candidates.length === 1) {
    warnings.push(
      "Only 1 candidate strategy was compared — a real selection weighs at least two options.",
    );
  }
  const firstSelected = candidates.findIndex((c) => c.selected);
  if (candidates.length && firstSelected === -1) {
    candidates[0].selected = true;
    warnings.push(
      "No candidate strategy was marked selected; the first is treated as the pick.",
    );
  } else if (firstSelected >= 0) {
    const extras = candidates.filter((c, i) => c.selected && i !== firstSelected).length;
    if (extras > 0) {
      candidates.forEach((c, i) => {
        if (c.selected && i !== firstSelected) c.selected = false;
      });
      warnings.push(
        `${extras + 1} candidate strategies were marked selected; only the first counts.`,
      );
    }
  }
  // The plan's army, deployment and paths all serve
  // strategy.type, so when a candidate matches strategy.type
  // that candidate IS the pick — re-mark it selected when the
  // model flagged a different entry, so the comparison and
  // the plan cannot disagree.
  if (strategy.type && candidates.length) {
    const stratId = normalizeStrategyId(strategy.type);
    const typeIdx = candidates.findIndex((c) => {
      const cid = normalizeStrategyId(c.id);
      return (
        cid === stratId ||
        (cid.length >= 4 &&
          stratId.length >= 4 &&
          (cid.includes(stratId) || stratId.includes(cid)))
      );
    });
    if (typeIdx >= 0 && !candidates[typeIdx].selected) {
      candidates.forEach((c) => {
        c.selected = false;
      });
      candidates[typeIdx].selected = true;
      warnings.push(
        `The plan serves strategy.type "${strategy.type}", so candidate "${candidates[typeIdx].id}" is the selected one (the model marked a different entry).`,
      );
    }
  }
  for (const c of candidates) {
    if (!c.selected && !c.rejected_reason) {
      c.rejected_reason = "Not the strongest fit for this base.";
    }
  }
  // The selected candidate should be the strategy that was picked.
  const picked = candidates.find((c) => c.selected);
  if (picked) {
    if (!strategy.type) {
      // The model omitted strategy.type: the selected candidate IS the
      // pick, so its id is the type — keeps the output self-consistent
      // with the prompt's contract (selected id === strategy.type).
      strategy.type = picked.id;
      warnings.push(
        `strategy.type was missing; backfilled from the selected candidate ("${picked.id}").`,
      );
    } else {
      const candId = picked.id;
      const stratId = normalizeStrategyId(strategy.type);
      if (
        candId !== stratId &&
        !candId.includes(stratId) &&
        !stratId.includes(candId)
      ) {
        warnings.push(
          `Selected candidate "${candId}" does not match strategy.type "${strategy.type}".`,
        );
      }
    }
    // fit_score is the verdict of the comparison: the selected
    // candidate should be the highest-scoring one. When it isn't,
    // the scores don't back the pick — the plan itself stays (it
    // serves strategy.type), but the user is told the comparison
    // is internally inconsistent.
    const scored = candidates.filter((c) => typeof c.fit_score === "number");
    if (scored.length >= 2 && typeof picked.fit_score === "number") {
      const top = scored.reduce((a, b) =>
        (b.fit_score ?? 0) > (a.fit_score ?? 0) ? b : a,
      );
      if (top !== picked) {
        warnings.push(
          `Selection audit: "${picked.id}" was selected with fit ${picked.fit_score}, but "${top.id}" scores ${top.fit_score} — the comparison does not back the pick.`,
        );
      }
    }
  }

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
    troops.push({
      id: slug,
      count: n,
      ...(t?.purpose ? { purpose: String(t.purpose).trim().slice(0, 200) } : {}),
    });
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
    spells.push({
      id: slug,
      count: n,
      ...(s?.purpose ? { purpose: String(s.purpose).trim().slice(0, 200) } : {}),
    });
  }

  let siege: { id: string; purpose?: string } | undefined;
  const siegeRaw = rawObj.army?.siege_machine;
  if (siegeRaw?.id) {
    const slug = resolveSlug(siegeRaw.id);
    if (slug && resolveEntity(slug)?.kind === "siege" && thAvailable(slug, constraints.townHall)) {
      siege = {
        id: slug,
        ...(siegeRaw.purpose
          ? { purpose: String(siegeRaw.purpose).trim().slice(0, 200) }
          : {}),
      };
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

  const deployment_plan: DeploymentStep[] = merged.map((s, i) => {
    const base: DeploymentStep = {
      step: i + 1,
      phase: s.phase,
      unit: s.unit,
      count: s.count,
      position: s.position,
      ...(s.target ? { target: s.target } : {}),
      ...(s.purpose ? { purpose: s.purpose } : {}),
      ...(s.deployments ? { deployments: s.deployments } : {}),
    };
    // Enhanced fields from raw input
    const raw = asArray(rawObj.deployment_plan)[i];
    if (raw) {
      if (raw.deploymentType === "line" || raw.deploymentType === "area" || raw.deploymentType === "point") {
        base.deploymentType = raw.deploymentType;
      }
      if (raw.deploymentEnd) {
        base.deploymentEnd = clampPoint(raw.deploymentEnd);
      }
      if (asArray(raw.primaryTargets).length) {
        base.primaryTargets = asArray(raw.primaryTargets)
          .map((id) => String(id ?? "").trim())
          .filter(Boolean)
          .slice(0, 8);
      }
      if (asArray(raw.secondaryTargets).length) {
        base.secondaryTargets = asArray(raw.secondaryTargets)
          .map((id) => String(id ?? "").trim())
          .filter(Boolean)
          .slice(0, 6);
      }
      if (raw.finalObjective) {
        base.finalObjective = String(raw.finalObjective).trim().slice(0, 60);
      }
    }
    return base;
  });
  if (deployment_plan.length === 0) {
    errors.push("Deployment plan is empty — at least one deployment is required.");
  }
  // Cause-and-effect deployments carry a purpose; flag plans that
  // don't (diagnostic only — the prompt demands purposes).
  const stepsWithoutPurpose = deployment_plan.filter((s) => !s.purpose).length;
  if (stepsWithoutPurpose > 0) {
    warnings.push(
      `${stepsWithoutPurpose} deployment step(s) without a purpose.`,
    );
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
      targetIds: asArray(p?.targetIds)
        .map((id) => String(id ?? "").trim())
        .filter(Boolean)
        .slice(0, 8),
      confidence: isNum(p?.confidence) ? Math.min(1, Math.max(0, p.confidence)) : undefined,
      reason: p?.reason ? String(p.reason).trim().slice(0, 240) : undefined,
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
  // Check for major troop groups without paths (heroes, siege, main army)
  const pathUnits = new Set(paths.map((p) => p.unit.toLowerCase()));
  for (const step of deployment_plan) {
    const slug = step.unit;
    const entity = resolveEntity(slug);
    const isHero = entity?.kind === "hero";
    const isSiege = entity?.kind === "siege";
    const isMajorTroop = step.count >= 8; // Main army groups typically 8+
    if ((isHero || isSiege || isMajorTroop) && !pathUnits.has(slug.toLowerCase())) {
      warnings.push(
        `Major deployment "${slug}" (step ${step.step}) has no movement path — the renderer cannot show where this group moves.`,
      );
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
      targetGroup: s?.targetGroup ? String(s.targetGroup).trim().slice(0, 60) : undefined,
      nearbyDefenses: asArray(s?.nearbyDefenses)
        .map((id) => String(id ?? "").trim())
        .filter(Boolean)
        .slice(0, 8),
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
      position: h?.position ? clampPoint(h.position) : undefined,
      step: stepRef(h?.step),
      supportsGroup: h?.supportsGroup ? String(h.supportsGroup).trim().slice(0, 60) : undefined,
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
    townHallConfidence: isNum(ba.townHallConfidence)
      ? Math.min(1, Math.max(0, ba.townHallConfidence))
      : undefined,
    townHallWeapon: ba.townHallWeapon ? String(ba.townHallWeapon).slice(0, 40) : undefined,
    clanCastlePosition: ba.clanCastlePosition ? clampPoint(ba.clanCastlePosition) : undefined,
    clanCastleConfidence: isNum(ba.clanCastleConfidence)
      ? Math.min(1, Math.max(0, ba.clanCastleConfidence))
      : undefined,
    baseShape: ba.baseShape ? String(ba.baseShape).slice(0, 60) : undefined,
    structuralTraits: asArray(ba.structuralTraits)
      .map((s) => String(s ?? "").trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 8),
    defenseInventory: (asArray(ba.defenseInventory) as Raw[])
      .map((d) => ({
        id: String(d?.id ?? "").trim().slice(0, 40),
        type: String(d?.type ?? "unknown_defense").trim().slice(0, 40),
        position: clampPoint(d?.position),
        confidence: isNum(d?.confidence) ? Math.min(1, Math.max(0, d.confidence)) : 0.5,
        notes: d?.notes ? String(d.notes).trim().slice(0, 120) : undefined,
      }))
      .filter((d) => d.id && d.type)
      .slice(0, 50),
    keyDefenses: (asArray(ba.keyDefenses) as Raw[])
      .map((k) => ({
        type: String(k?.type ?? "unknown_defense"),
        position: clampPoint(k?.position),
        threat: (["high", "medium", "low"] as const).includes(k?.threat)
          ? k.threat
          : "medium",
      }))
      .filter((k) => k.type)
      .slice(0, 12),
    enemyHeroes: (asArray(ba.enemyHeroes) as Raw[])
      .map((h) => ({
        type: String(h?.type ?? "").trim().slice(0, 40),
        position: clampPoint(h?.position),
        confidence: isNum(h?.confidence) ? Math.min(1, Math.max(0, h.confidence)) : 0.5,
      }))
      .filter((h) => h.type)
      .slice(0, 6),
    pathingNotes: ba.pathingNotes
      ? String(ba.pathingNotes).trim().slice(0, 800)
      : undefined,
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
      reason: e?.reason ? String(e.reason).slice(0, 240) : undefined,
      reachableDefenses: e?.reachableDefenses
        ? String(e.reachableDefenses).trim().slice(0, 160)
        : undefined,
      heroAccess: e?.heroAccess
        ? String(e.heroAccess).trim().slice(0, 160)
        : undefined,
      risk: e?.risk ? String(e.risk).trim().slice(0, 160) : undefined,
    })),
    funnels: (asArray(ba.funnels) as Raw[]).map((f) => ({
      position: clampPoint(f?.position),
      purpose: f?.purpose ? String(f.purpose).slice(0, 160) : undefined,
    })),
  };

  // ---- confidence ----
  // The original three keep their 0.7 default for backward
  // compatibility; the newer sub-scores stay ABSENT when the model
  // did not assess them (an absent score is honest, a fake 70%
  // is not).
  const conf = asRaw(rawObj.confidence);
  const confidence = {
    base_analysis: isNum(conf.base_analysis) ? Math.min(1, Math.max(0, conf.base_analysis)) : 0.7,
    strategy: isNum(conf.strategy) ? Math.min(1, Math.max(0, conf.strategy)) : 0.7,
    deployment: isNum(conf.deployment) ? Math.min(1, Math.max(0, conf.deployment)) : 0.7,
    strategy_selection: isNum(conf.strategy_selection)
      ? Math.min(1, Math.max(0, conf.strategy_selection))
      : undefined,
    army_composition: isNum(conf.army_composition)
      ? Math.min(1, Math.max(0, conf.army_composition))
      : undefined,
  };

  const strategyOut: AttackStrategy = {
    strategy,
    army: { troops, spells, ...(siege ? { siege_machine: siege } : {}), ...(ccTroops.length ? { clan_castle: ccTroops } : {}) },
    base_analysis,
    ...(candidates.length ? { candidate_strategies: candidates } : {}),
    deployment_plan,
    heroes: heroes.length ? heroes : undefined,
    paths: paths.length ? paths : undefined,
    spell_actions: spell_actions.length ? spell_actions : undefined,
    hero_abilities: hero_abilities.length ? hero_abilities : undefined,
    attack_phases,
    confidence,
  };

  // ---- selection audit ----
  // Cross-checks the picked strategy against the base analysis
  // the model itself reported (see auditSelection).
  auditSelection(strategyOut, warnings);

  const ok = errors.length === 0;
  return {
    ok,
    errors,
    warnings,
    strategy: ok ? strategyOut : (strategyOut as AttackStrategy),
  };
}
