import type { OffenseWeights } from "./settings";

/**
 * Weight from the Offense Percentages modal, as a scheduling boost.
 *
 * Returns a signed value centred on the 50% default, so raising a group above 50
 * pulls it earlier and lowering it pushes it later — rather than only ever
 * rewarding whichever group the slider was dragged up first.
 */
export function weightBoost(weights: OffenseWeights, group: string): number {
  const w = weights[group] ?? 50;
  return (w - 50) * 2;
}

/** True when every group still sits at the 50% default. */
export function weightsAreNeutral(weights: OffenseWeights): boolean {
  return Object.values(weights).every((w) => w === 50);
}
