/**
 * The visual theme of the attack overlay — the rendering-layer
 * decisions that must stay identical between the map overlay, the
 * step panel and the legend:
 *
 *   - which colour an attack GROUP paints itself with. A group is
 *     a phase of the plan ("Queen Charge", "King Funnel", …): every
 *     marker, label and route belonging to that phase shares one
 *     colour, so the eye can follow a group across the base;
 *   - how prominently a route draws itself (primary / secondary /
 *     support hierarchy);
 *   - how big the annotation primitives are. They are deliberately
 *     small: the base stays the primary visual element and the
 *     overlay is an annotation layer on top of it.
 *
 * Pure data + pure functions — no React, no DOM — so the render
 * check can import the same constants and assert the overlay
 * actually applies them; the tested theme and the rendered theme
 * cannot drift apart.
 */

/* ------------------------------------------------------------------------ */
/* Group colours (one per plan phase, in phase order)                        */
/* ------------------------------------------------------------------------ */

/**
 * The limited, consistent palette an attack group may use. Phases
 * cycle through it deterministically, so a plan with more phases
 * than colours still gets a stable identity per phase index.
 */
export const PHASE_PALETTE: readonly string[] = [
  "#199e70", // green  — the opening group (e.g. Queen Charge)
  "#d95926", // red    — the second wave (e.g. King funnel)
  "#3987e5", // blue   — the main push (e.g. the Hybrid)
  "#f2b53a", // gold   — siege / support wave
  "#a05cd5", // purple — fifth group
  "#4fc3f7", // cyan   — sixth group
];

/** Colour of attack group `phaseIndex` (deterministic, cycling). */
export function phaseColor(phaseIndex: number): string {
  const n = PHASE_PALETTE.length;
  return PHASE_PALETTE[((phaseIndex % n) + n) % n];
}

/** 0-based index of a phase name in the plan's phase order. */
export function phaseIndexOf(
  phaseName: string,
  phases: readonly { name: string }[],
): number {
  const want = phaseName.trim().toLowerCase();
  const i = phases.findIndex((p) => p.name.trim().toLowerCase() === want);
  return i < 0 ? 0 : i;
}

/* ------------------------------------------------------------------------ */
/* Path hierarchy                                                            */
/* ------------------------------------------------------------------------ */

/** How prominently a route draws itself. */
export type PathRole = "primary" | "secondary" | "support";

/**
 * A route's role, from its rendering hint. The main push is the
 * only thick line on the map; funnels and cleanup routes are
 * thinner so the eye is never split between competing arrows.
 */
export function pathRole(style?: string): PathRole {
  if (style === "funnel") return "secondary";
  if (style === "cleanup") return "support";
  return "primary"; // "attack" — and unset routes carry the push
}

/** Stroke geometry of a route (multiples of the viewBox width). */
export interface PathWeight {
  /** Soft halo under the line. */
  glow: number;
  glowOpacity: number;
  /** The line itself. */
  core: number;
  dashed: boolean;
  coreOpacity: number;
  /** Arrowhead size. */
  arrow: number;
  /** Waypoint dot radius. */
  dot: number;
}

export const PATH_WEIGHTS: Record<PathRole, PathWeight> = {
  primary: {
    glow: 0.01,
    glowOpacity: 0.3,
    core: 0.0045,
    dashed: false,
    coreOpacity: 0.95,
    arrow: 0.042,
    dot: 0.012,
  },
  secondary: {
    glow: 0.007,
    glowOpacity: 0.2,
    core: 0.003,
    dashed: true,
    coreOpacity: 0.8,
    arrow: 0.034,
    dot: 0.01,
  },
  support: {
    glow: 0.004,
    glowOpacity: 0.12,
    core: 0.002,
    dashed: true,
    coreOpacity: 0.5,
    arrow: 0.027,
    dot: 0.008,
  },
};

/* ------------------------------------------------------------------------ */
/* Primitive sizes — small on purpose (the base is the main element)         */
/* ------------------------------------------------------------------------ */

/** Deployment marker radius (× viewBox width). One marker = one troop group. */
export const MARKER_R = 0.034;
/** Split-deployment sub-marker radius. */
export const SUBMARKER_R = 0.022;
/** Step-number badge radius. */
export const BADGE_R = 0.019;
/** Clearance a label must keep around a main marker + its badge. */
export const MARKER_CLEARANCE = 0.05;
/** Clearance around a sub-marker. */
export const SUBMARKER_CLEARANCE = 0.031;

/** Spell area radii by spell (× viewBox width) — planning hints, kept subtle. */
export const SPELL_RADIUS: Record<string, number> = {
  "healing-spell": 0.062,
  "rage-spell": 0.068,
  "freeze-spell": 0.08,
  "poison-spell": 0.056,
  "lightning-spell": 0.038,
  "haste-spell": 0.05,
  "jump-spell": 0.044,
};
export const SPELL_DEFAULT_RADIUS = 0.06;
/** Spell icon badge radius (the labelled point, not the whole area). */
export const SPELL_BADGE_R = 0.026;
/** Opacity of a spell area fill — a whisper, not a wash. */
export const SPELL_FILL_OPACITY = 0.08;

/** Priority-target glyph radius. */
export const TARGET_R = 0.02;
/** Funnel ring radius. */
export const FUNNEL_R = 0.038;
/** Entry-point glyph size. */
export const ENTRY_S = 0.024;

/* ------------------------------------------------------------------------ */
/* Compact target glyphs                                                     */
/* ------------------------------------------------------------------------ */

/** Short glyph for a target type, so a target never needs a big label. */
const TARGET_GLYPHS: Record<string, string> = {
  town_hall: "TH",
  eagle_artillery: "Eagle",
  inferno: "Inferno",
  scattershot: "Scatter",
  x_bow: "X-Bow",
  monolith: "Monolith",
  spell_tower: "Spell",
  air_defense: "Air Def",
  clan_castle: "CC",
  enemy_hero: "Hero",
  unknown_defense: "Def",
};

/** The compact label for a priority target ("Town Hall" -> "TH"). */
export function targetGlyph(type: string, label?: string): string {
  if (label) return label;
  return TARGET_GLYPHS[type] ?? type.replace(/_/g, " ").slice(0, 10);
}
