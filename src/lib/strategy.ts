import type { JobKind } from "./schedule";

export type Strategy = "offenseFirst" | "fastestMaxTh" | "maxBeforeTh" | "hybrid";

export const STRATEGIES: { value: Strategy; label: string; hint: string }[] = [
  {
    value: "offenseFirst",
    label: "Offense First Rush",
    hint: "Prioritize army (lab, heroes, pets) before defenses; TH position set by the slider.",
  },
  {
    value: "fastestMaxTh",
    label: "Fastest Max TH",
    hint: "Always upgrade the Town Hall and its required buildings first.",
  },
  {
    value: "maxBeforeTh",
    label: "Max Before TH",
    hint: "Finish all buildings, traps, and army before moving the Town Hall.",
  },
  {
    value: "hybrid",
    label: "Hybrid",
    hint: "Balance offense, defense, and Town Hall progress evenly.",
  },
];

const OFFENSE = new Set(["troop", "spell", "siege", "hero", "equipment", "pet"]);

/** Which scheduling lane a category belongs to. */
export function jobKind(category: string): JobKind {
  if (category === "troop" || category === "spell" || category === "siege")
    return "lab";
  if (category === "pet") return "pet";
  // Heroes take a builder in both villages. The Builder Base has a Star Lab,
  // but it researches troops — the Battle Machine and Battle Copter are built,
  // so they belong on a builder lane even there.
  return "builder";
}

/** Relative priority for an upgrade (higher = scheduled earlier). */
export function priorityFor(
  strategy: Strategy,
  category: string,
  isTownHall: boolean,
  offenseBeforeTh: number, // 0 = TH first, 100 = offense first
): number {
  const off = Math.min(100, Math.max(0, offenseBeforeTh));
  switch (strategy) {
    case "offenseFirst":
      if (isTownHall) return 100 - off;
      return OFFENSE.has(category) ? off : 0;
    case "fastestMaxTh":
      if (isTownHall) return 1000;
      if (category === "building") return 80;
      return OFFENSE.has(category) ? 40 : 0;
    case "maxBeforeTh":
      if (isTownHall) return -1000;
      return 100;
    case "hybrid":
      if (isTownHall) return 50;
      return OFFENSE.has(category) ? 60 : 30;
  }
}
