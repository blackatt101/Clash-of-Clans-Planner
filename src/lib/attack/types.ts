/**
 * Attack-strategy types. The strategy JSON is the single source of truth: the
 * visual renderer draws exactly what is in here, and the validator guarantees
 * what lands in here is consistent.
 *
 * Coordinates are normalized to [0,1] (x: left→right, y: top→bottom). The
 * renderer converts to percentages — never to pixels — so the same plan works
 * on any screenshot resolution.
 */

export interface Point {
  x: number;
  y: number;
}

/** A known entity resolved from a slug: canonical id + Supercell numeric id. */
export interface EntityRef {
  id: string;
  dataId: number;
  name: string;
  /** Housing space (troops/spells) or null. */
  housing?: number | null;
  /** Minimum Town Hall to research (troops/spells/siege) or null. */
  minTH?: number | null;
  /** Troops only. */
  flying?: boolean;
}

/** A troop/spell group in the army, by canonical slug (e.g. "miner", "healing-spell"). */
export interface ArmyEntry {
  id: string;
  count: number;
}

export interface DeploymentStep {
  step: number;
  /** Phase name this step belongs to (must match an attackPhases entry). */
  phase: string;
  /** Canonical unit slug: troop, hero, or siege machine ("queen" = archer-queen). */
  unit: string;
  count: number;
  position: Point;
  /** Where this group is heading / what it is clearing. */
  target?: string;
  /** One-sentence purpose shown in step-by-step mode. */
  purpose?: string;
  /**
   * Optional split deployment (e.g. 2 wizards SW + 2 NE). When present the
   * single `position` is a fallback for the visual's group marker and the
   * spreads are drawn as separate sub-markers on the same step.
   */
  deployments?: { count: number; position: Point; label?: string }[];
}

export interface TroopPath {
  /** Canonical unit slug, or a named group such as "hybrid". */
  unit: string;
  points: Point[];
  /** Rendering hint; defaults to a solid arrow. */
  style?: "attack" | "funnel" | "cleanup";
  /**
   * 1-based deployment_plan step this route belongs to. Drives the
   * step-by-step reveal: the path is hidden until its step is current.
   * Optional for backward compatibility (older plans fall back to
   * unit matching; unmatched paths show in "All steps" only).
   */
  step?: number;
}

export interface SpellAction {
  spell: string;
  position: Point;
  /** Event-based trigger, e.g. "When the Hybrid reaches the core." */
  trigger?: string;
  purpose?: string;
  /**
   * 1-based deployment_plan step at which this spell is cast. The spell
   * circle is hidden until that step is current. Optional for backward
   * compatibility (older plans show spells in "All steps" only).
   */
  step?: number;
}

export interface HeroAbility {
  hero: string;
  trigger: string;
  purpose?: string;
}

export interface AttackPhase {
  phase: number;
  name: string;
  description?: string;
}

export interface Funnel {
  position: Point;
  purpose?: string;
}

export type TargetType =
  | "town_hall"
  | "eagle_artillery"
  | "inferno"
  | "scattershot"
  | "x_bow"
  | "monolith"
  | "spell_tower"
  | "air_defense"
  | "clan_castle"
  | "enemy_hero"
  | "unknown_defense"
  | string;

export interface BaseTarget {
  type: TargetType;
  position: Point;
  priority?: "high" | "medium" | "low";
  /** 0..1 identification confidence. */
  confidence?: number;
  label?: string;
}

export interface EntryPoint {
  position: Point;
  reason?: string;
}

export interface BaseAnalysis {
  townHallLevel?: number;
  townHallPosition?: Point;
  townHallWeapon?: string;
  clanCastlePosition?: Point;
  baseShape?: string;
  layoutNotes?: string;
  importantTargets?: BaseTarget[];
  entryPoints?: EntryPoint[];
  funnels?: Funnel[];
}

export interface StrategyInfo {
  name: string;
  type?: string;
  difficulty?: "easy" | "medium" | "hard";
  summary?: string;
  /** Base-specific rationale — the "why". */
  reason: string;
}

export interface AttackStrategy {
  strategy: StrategyInfo;
  /** Set true when the model could not confidently read a CoC home-village base
   *  in the screenshot. The route rejects the plan on this. */
  not_coc_base?: boolean;
  army: {
    troops: ArmyEntry[];
    spells: ArmyEntry[];
    /** Optional: a single siege machine. */
    siege_machine?: { id: string };
    /** Optional: troops placed in the enemy Clan Castle. */
    clan_castle?: ArmyEntry[];
  };
  base_analysis?: BaseAnalysis;
  deployment_plan: DeploymentStep[];
  paths?: TroopPath[];
  spell_actions?: SpellAction[];
  hero_abilities?: HeroAbility[];
  attack_phases: AttackPhase[];
  confidence?: {
    base_analysis?: number;
    strategy?: number;
    deployment?: number;
  };
}

/**
 * Validation result. `repaired` holds issues the validator fixed
 * (clamped coordinates, dropped unknown units); `errors` are fatal and the
 * response is rejected.
 */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Strategy with repairs applied (valid, ready to render). */
  strategy: AttackStrategy;
}

export interface ArmyConstraints {
  /** Town Hall level (1-18). Drives capacities + what is available. */
  townHall: number;
  /** Army housing capacity in the attacker's camp (default 100 = 2 camps). */
  armyHousing?: number;
  /** Spell storage capacity (default TH table). */
  spellHousing?: number;
  /** CC troop capacity (defaults from townHall table; 0 = no CC troops). */
  ccTroops?: number;
  ccSpells?: number;
  ccSiege?: number;
}

export interface AttackRequest {
  /** Town Hall the player attacks from (available troops/spells/siege scale). */
  townHall: number;
  /** base64 (or data URL) of the enemy base screenshot. */
  screenshot: string;
  /** Optional user context. */
  heroLevels?: Record<string, number>;
  preferredStyle?: string;
  ccTroops?: string[];
  ccSpells?: string[];
}
