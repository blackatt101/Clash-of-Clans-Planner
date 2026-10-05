/**
 * Step-by-step reveal logic for the attack plan — the pure rules
 * behind "what should be visible at step N". Shared by the
 * overlay (rendering) and the tests (verification), so the
 * rendered state and the tested state can never drift apart.
 *
 * Three visual states per deployment step:
 *  - current:  fully visible, highlighted ring
 *  - done:     still visible, subdued (opacity 0.35)
 *  - future:   hidden
 * "All steps" (activeStep = -1) shows everything at full opacity.
 *
 * Paths and spell actions are attached to a step (their `step`
 * field, 1-based) and follow the same reveal. The model does not
 * always emit those references, so attribution falls back
 * deterministically — never randomly:
 *  - paths:    explicit step -> same-unit step nearest the path
 *              start -> nearest step to the path start (a route
 *              begins where its group deploys);
 *  - spells:   explicit step -> the step whose unit the trigger
 *              names -> the step whose route passes nearest the
 *              spell -> the nearest deployment marker.
 * Only an empty deployment plan leaves an element unattributed;
 * it is then shown in "All steps" only — an action of unknown
 * timing is never shown as if it were current.
 */
import { resolveEntity, resolveSlug } from "./catalog";
import type {
  DeploymentStep,
  Point,
  SpellAction,
  TroopPath,
} from "./types";

export type StepVis = "all" | "current" | "done" | "future";

/** Visibility state of deployment step `i` (0-based) at `activeStep`. */
export function stepVis(i: number, activeStep: number): StepVis {
  if (activeStep < 0) return "all";
  if (i < activeStep) return "done";
  if (i === activeStep) return "current";
  return "future";
}

/** Render opacity per state. Future steps are not rendered at all. */
export const VIS_OPACITY: Record<StepVis, number> = {
  all: 1,
  current: 1,
  done: 0.35,
  future: 0,
};

/** Should an element in this state be rendered? */
export function isRendered(vis: StepVis): boolean {
  return vis !== "future";
}

/** 0-based index of the step a `step` reference (1-based) points to. */
function stepIndexFrom(step: number | undefined, count: number): number | null {
  if (typeof step !== "number" || !Number.isFinite(step)) return null;
  const i = Math.round(step) - 1;
  return i >= 0 && i < count ? i : null;
}

function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Distance from `p` to the segment `a`–`b` (normalized units). */
function pointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Deployment steps whose unit a free-text trigger/purpose names.
 * Matches the full slug ("root rider" inside "Root Riders"),
 * the display name, then single slug tokens ("queen" for
 * archer-queen). Full matches win over token matches.
 */
function stepsMentioned(text: string, steps: DeploymentStep[]): number[] {
  if (!text) return [];
  const hay = text.toLowerCase();
  const full: number[] = [];
  const token: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    const slug = resolveSlug(steps[i].unit);
    if (!slug) continue;
    const name = (resolveEntity(slug)?.ref.name ?? "").toLowerCase();
    const flat = slug.replace(/-/g, " ");
    if (hay.includes(flat) || (name !== "" && hay.includes(name))) {
      full.push(i);
    } else if (slug.split("-").some((tk) => tk.length > 2 && hay.includes(tk))) {
      token.push(i);
    }
  }
  return full.length > 0 ? full : token;
}

/**
 * Deployment step a path belongs to. Prefers the explicit `step`
 * field; then the same-unit step nearest the path's start; then
 * (named groups such as "hydra", or unknown units) the step
 * nearest the path's start — a route begins where its group
 * deploys. Returns null only for an empty plan.
 */
export function pathStepIndex(
  path: TroopPath,
  steps: DeploymentStep[],
): number | null {
  const explicit = stepIndexFrom(path.step, steps.length);
  if (explicit != null) return explicit;
  if (steps.length === 0 || path.points.length === 0) return null;
  const slug = resolveSlug(path.unit);
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = 0; i < steps.length; i++) {
    if (slug != null && resolveSlug(steps[i].unit) !== slug) continue;
    const d = dist2(steps[i].position, path.points[0]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best != null) return best;
  // No same-unit step: the nearest step to the start point owns
  // the route (it deploys from there).
  for (let i = 0; i < steps.length; i++) {
    const d = dist2(steps[i].position, path.points[0]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Deployment step a spell action belongs to:
 *   1. its explicit `step` field;
 *   2. the earliest step whose unit the trigger/purpose names;
 *   3. the step whose attributed route passes nearest the spell
 *      (spells are cast where the fighting happens);
 *   4. the nearest deployment marker.
 * Returns null only for an empty plan.
 */
export function spellStepIndex(
  spell: SpellAction,
  steps: DeploymentStep[],
  paths: TroopPath[] = [],
): number | null {
  const explicit = stepIndexFrom(spell.step, steps.length);
  if (explicit != null) return explicit;
  if (steps.length === 0) return null;

  // The trigger names the troops the spell supports.
  const text = `${spell.trigger ?? ""} ${spell.purpose ?? ""}`;
  const mentioned = stepsMentioned(text, steps);
  if (mentioned.length > 0) return Math.min(...mentioned);

  // Cast where a route fights: the nearest attributed path.
  let best: number | null = null;
  let bestD = Infinity;
  for (const p of paths) {
    const si = pathStepIndex(p, steps);
    if (si == null || p.points.length === 0) continue;
    for (let i = 0; i < p.points.length - 1; i++) {
      const d = pointToSegment(spell.position, p.points[i], p.points[i + 1]);
      if (d < bestD) {
        bestD = d;
        best = si;
      }
    }
  }
  // Last resort: the nearest deployment marker.
  for (let i = 0; i < steps.length; i++) {
    const d = Math.hypot(
      steps[i].position.x - spell.position.x,
      steps[i].position.y - spell.position.y,
    );
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** "Miner ×15" — the grouped marker label for a deployment step. */
export function stepLabel(step: DeploymentStep, name: string): string {
  return step.count > 1 ? `${name} ×${step.count}` : name;
}
