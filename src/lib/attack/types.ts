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
  /** Why this group is in the army — main pressure, funnel, support, cleanup… */
  purpose?: string;
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
  /**
   * Deployment type for rendering. "point" = single position (heroes, siege),
   * "line" = spread along a line (hybrid, main army), "area" = distributed.
   */
  deploymentType?: "point" | "line" | "area";
  /**
   * For line deployments: end point of the deployment line.
   * The main `position` is the start.
   */
  deploymentEnd?: Point;
  /**
   * Primary building IDs this group targets (from defenseInventory).
   * Allows renderer to draw connections from path to actual buildings.
   */
  primaryTargets?: string[];
  /**
   * Secondary targets (fallback objectives).
   */
  secondaryTargets?: string[];
  /**
   * Final objective for this group (e.g. "town_hall").
   */
  finalObjective?: string;
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
  /**
   * Building IDs this path is intended to reach/destroy (from defenseInventory).
   * Links the movement to actual recognized buildings.
   */
  targetIds?: string[];
  /**
   * Path confidence (0-1). Lower confidence when base structure makes
   * troop movement unpredictable.
   */
  confidence?: number;
  /**
   * Tactical reason for this specific path route.
   */
  reason?: string;
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
  /**
   * Which troop group this spell supports (unit slug from deployment_plan).
   * Allows renderer to visually link spell to its beneficiary.
   */
  targetGroup?: string;
  /**
   * Building IDs near this spell location (for tactical context).
   */
  nearbyDefenses?: string[];
}

export interface HeroAbility {
  hero: string;
  trigger: string;
  purpose?: string;
  /**
   * Position where the ability should be activated (normalized coords).
   */
  position?: Point;
  /**
   * 1-based step when this ability fires.
   */
  step?: number;
  /**
   * Which troop group this ability supports.
   */
  supportsGroup?: string;
}

/**
 * The planner's per-hero decision. Covers EVERY hero available
 * at the attacker's Town Hall — selected heroes carry a role,
 * excluded heroes carry the reason they were left out. The
 * decision is the model's (strategy + base + role value), not
 * a fixed count: two, three or all heroes may be right.
 */
export interface HeroDecision {
  /** Canonical hero slug (e.g. "archer-queen"). */
  id: string;
  /** Whether the hero is deployed for this attack. */
  use: boolean;
  /** Role the hero fills (null when not used). */
  role: string | null;
  /** Why the hero is used — or, when excluded, why not. */
  reason: string;
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
  /** Defenses this entry can reach first. */
  reachableDefenses?: string;
  /** Whether the Queen/King can reach valuable targets from here. */
  heroAccess?: string;
  /** Pathing risk: troop splits, compartments to cross, threats. */
  risk?: string;
}

/** A defense that determines the attack strategy (§2 of the planner spec). */
export interface KeyDefense {
  type: string;
  position: Point;
  /** How much this defense shapes the plan. */
  threat?: "high" | "medium" | "low";
}

/**
 * A single identified defense from the base recognition phase.
 * Every defense must have a position and confidence score.
 */
export interface IdentifiedDefense {
  /** Unique ID for this defense instance (e.g. "inferno_1", "xbow_2"). */
  id: string;
  /** Defense type (eagle_artillery, inferno_tower, x_bow, air_defense, etc). */
  type: string;
  /** Normalized position where this defense was identified. */
  position: Point;
  /** Identification confidence (0-1). */
  confidence: number;
  /** Optional notes about this specific defense. */
  notes?: string;
}

export interface BaseAnalysis {
  townHallLevel?: number;
  townHallPosition?: Point;
  /** Confidence in Town Hall identification (0-1). */
  townHallConfidence?: number;
  townHallWeapon?: string;
  clanCastlePosition?: Point;
  /** Confidence in Clan Castle identification (0-1). */
  clanCastleConfidence?: number;
  baseShape?: string;
  /**
   * Structural traits the screenshot actually evidences (ring base,
   * offset Town Hall, exposed Eagle, spread defenses…). Only traits
   * with visible evidence should be claimed.
   */
  structuralTraits?: string[];
  /**
   * Complete inventory of identified defenses from the systematic scan.
   * Each defense has a position and confidence score.
   */
  defenseInventory?: IdentifiedDefense[];
  /** The defenses that determine the strategy, with threat level. */
  keyDefenses?: KeyDefense[];
  /**
   * Identified enemy heroes (not attacker heroes). Each has position and confidence.
   */
  enemyHeroes?: Array<{
    type: string;
    position: Point;
    confidence: number;
  }>;
  /** The deployment → funnel → entry → … → cleanup pathing reasoning. */
  pathingNotes?: string;
  layoutNotes?: string;
  importantTargets?: BaseTarget[];
  entryPoints?: EntryPoint[];
  funnels?: Funnel[];
}

/**
 * One candidate strategy considered before the final pick. The
 * comparison is part of the output so the selection is auditable:
 * each candidate is judged against THIS base, and the rejected
 * ones say why they lost.
 */
export interface CandidateStrategy {
  /** Strategy slug (e.g. "queen-charge-hybrid"). */
  id: string;
  name: string;
  /** 0..1 fit score for this base. */
  fit_score?: number;
  /** Why it fits this base. */
  strengths?: string[];
  /** Why it could fail here (pathing, threats, funnel…). */
  weaknesses?: string[];
  /** True for the strategy that was selected. */
  selected?: boolean;
  /** Required when not selected: why it lost to the winner. */
  rejected_reason?: string;
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
    /** Optional: a single siege machine, with why it fits. */
    siege_machine?: { id: string; purpose?: string };
    /** Optional: troops placed in the enemy Clan Castle. */
    clan_castle?: ArmyEntry[];
  };
  base_analysis?: BaseAnalysis;
  /** The candidate strategies compared before the final pick. */
  candidate_strategies?: CandidateStrategy[];
  deployment_plan: DeploymentStep[];
  /** Per-hero decisions for every hero available at the attacker's TH. */
  heroes?: HeroDecision[];
  paths?: TroopPath[];
  spell_actions?: SpellAction[];
  hero_abilities?: HeroAbility[];
  attack_phases: AttackPhase[];
  confidence?: {
    base_analysis?: number;
    strategy?: number;
    deployment?: number;
    /** Confidence in the strategy-vs-base match. Absent = unassessed. */
    strategy_selection?: number;
    /** Confidence in the army composition. Absent = unassessed. */
    army_composition?: number;
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
