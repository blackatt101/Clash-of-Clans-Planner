import type { Cost } from "./types";
import type { PlannerSettings } from "./settings";
import type { UpgradeOption } from "./upgrade";
import { jobKind } from "./strategy";

/** Apply a percent discount to a resource cost. Ore costs are never discounted. */
export function discountCost(cost: Cost | null, pct: number): Cost | null {
  if (cost == null) return null;
  if (typeof cost === "number") return Math.max(0, Math.round(cost * (1 - pct / 100)));
  return cost;
}

/** Discounted duration. Exported for the B.O.B goal planner, which times levels
 *  that have no `UpgradeOption` yet (the plan chains levels ahead of the one the
 *  list offers). */
export function discountTime(time: number | null, pct: number): number | null {
  if (time == null) return null;
  return Math.max(0, Math.round(time * (1 - pct / 100)));
}

/** Effective discounted cost for an upgrade (Gold Pass only). */
export function effectiveCost(o: UpgradeOption, s: PlannerSettings): Cost | null {
  return discountCost(o.cost, s.goldPass);
}

/**
 * Effective discounted duration for an upgrade: Gold Pass applies everywhere,
 * and the lane-specific boost (builder / research) applies on top.
 */
export function effectiveTime(o: UpgradeOption, s: PlannerSettings): number | null {
  // The lane decides which boost applies, so Builder Base heroes — which take a
  // builder — get the builder boost rather than the research one.
  const kind = jobKind(o.category);
  const extra = kind === "lab" ? s.researchBoost : kind === "builder" ? s.builderBoost : 0;
  const pct = Math.min(100, s.goldPass + extra);
  return discountTime(o.time, pct);
}
