import type { JobKind } from "./schedule";
import { jobKind } from "./strategy";
import type { Family, Village } from "./types";

export type { Family };
export { familyOf } from "./priorityOrder";

/* -------------------------------------------------------------------------- */
/* Family colour — what a bar is (defence, army, resource, …)                  */
/* -------------------------------------------------------------------------- */

/**
 * Seven families, seven hues — solid and saturated, on a dark chart.
 *
 * These were computed rather than picked by eye, because a Gantt puts any two
 * bars side by side and the honest test for bar colour is therefore all-pairs,
 * not adjacent. The search walks OKLCH lightness and chroma for each family and
 * keeps the set that is as deep and as saturated as the gates allow
 * (scripts/preview_palette.py renders the result and re-checks every number
 * below; it exits non-zero if any of them regress).
 *
 * This set replaced a brighter one (mean OKLCH L 0.749) that read as pastel.
 * What to know before anyone "adjusts" a hex:
 *   · Hue still carries association — green = resource, blue = defence, red =
 *     heroes — so the chart is readable at a glance. The search was free to move
 *     each hue a little, not to invent one. Two moved further than the rest:
 *     trap toward vermilion (#e63b00) and army toward indigo (#556eff), and
 *     those moves are what pays for the separation below, not sloppiness.
 *   · Every hue is now a solid, saturated colour: mean L 0.646 against the
 *     previous 0.749, with chroma held at or above 0.145. Deepening is not free
 *     — see the ink note — so this is the frontier, not a starting point.
 *   · The worst all-pairs pair is defence↔army (#00aafb ↔ #556eff) at ΔE 15.2
 *     for normal vision, and spell↔defence (#e200c8 ↔ #00aafb) at 8.4 under
 *     simulated protanopia/deuteranopia. Both clear their gates (15 hard, 8
 *     target), which seven hues normally cannot do.
 *   · Do NOT copy clashmax.org's own hexes, however tempting "make it look like
 *     clashmax" is: measured, theirs fails both gates — army↔defence ΔE 0.9
 *     (protan/deutan) and spell↔hero ΔE 8.3 for NORMAL vision, i.e. two of their
 *     bars are hard to tell apart even with full colour vision. What is worth
 *     copying is the impression of solid, saturated colour, and that is what
 *     this set buys.
 *   · The bar label ink is near-black (#0d1017) and must stay that way. White
 *     would be worse on every one of the seven (2.6–4.2:1); near-black clears
 *     4.5:1 on all of them, which is the AA floor for the 11px name. The margin
 *     is thinner than it was, so the bar's secondary text is set in the solid
 *     ink rather than a 70% tint — a tint would fall to 3.2–4.4:1.
 *   · Every bar also carries its game icon and name, so identity never rests on
 *     colour alone — which is what makes a colour-only system defensible here.
 */
export const FAMILY_COLORS: Record<Family, string> = {
  hero: "#ff5b98", // red — the marquee upgrades
  trap: "#e63b00", // vermilion — bombs and spring traps
  buildings: "#cc9500", // amber — walls, Town Hall, huts
  resource: "#00904e", // green — collectors and storages
  defense: "#00aafb", // azure — cannons, infernos, …
  army: "#556eff", // indigo — troops, sieges, camps, pets
  spell: "#e200c8", // magenta — spells
};

export const FAMILY_LABEL: Record<Family, string> = {
  hero: "Heroes",
  trap: "Traps",
  buildings: "Buildings & walls",
  resource: "Resource",
  defense: "Defences",
  army: "Army & pets",
  spell: "Spells",
};

/**
 * Display order for the legend and the filter. The two pairs that are closest
 * in hue — defence/army (both blue) and hero/spell (both pink) — are kept apart
 * here, so the legend never shows two near-siblings side by side. The bars can
 * land next to anything on the timeline; this is only about the row of swatches.
 */
export const FAMILIES: Family[] = [
  "defense",
  "hero",
  "resource",
  "army",
  "trap",
  "spell",
  "buildings",
];

/* -------------------------------------------------------------------------- */
/* Lane colour — which FACILITY a job occupies                                 */
/* -------------------------------------------------------------------------- */

/**
 * Lane colors label the three facilities (builders, the Laboratory, the Pet
 * House). They are deliberately NOT used for the bars — the bars carry the
 * upgrade family — but they still identify a lane in its label, its filter chip
 * and the upgrade list, where "which lane does this run in" is the question.
 *
 * Three hues is also the largest categorical set that clears the all-pairs CVD
 * gate on its own, which is exactly what a lane is: a small set of big, always
 * adjacent groups.
 */
export const LANE_COLORS: Record<JobKind, string> = {
  builder: "#3987e5", // blue
  lab: "#d95926", // orange
  pet: "#199e70", // aqua
};

const LANE_CLASSES: Record<JobKind, string> = {
  builder: "bg-lane-builder",
  lab: "bg-lane-lab",
  pet: "bg-lane-pet",
};

export function laneBarClass(kind: JobKind): string {
  return LANE_CLASSES[kind] ?? LANE_CLASSES.builder;
}

/** Bar color for an upgrade category, via the lane it will be scheduled in. */
export function categoryBarClass(category: string): string {
  return laneBarClass(jobKind(category));
}

export interface LegendItem {
  key: string;
  label: string;
  swatch: string; // tailwind bg class, for small inline dots
}

/** Legend for the three facilities, plus the two non-job states. */
export const LANE_LEGEND: LegendItem[] = [
  { key: "builder", label: "Builder", swatch: "bg-lane-builder" },
  { key: "lab", label: "Laboratory", swatch: "bg-lane-lab" },
  { key: "pet", label: "Pet House", swatch: "bg-lane-pet" },
];

/**
 * State legend. Swatches are CSS classes from globals.css rather than tailwind
 * utilities because each state needs a hatch or a dashed edge alongside its
 * colour — see the note at the top of that stylesheet.
 */
export const STATE_LEGEND: LegendItem[] = [
  { key: "running", label: "Currently upgrading", swatch: "tl-sw tl-sw-running" },
  { key: "unavailable", label: "Unavailable window", swatch: "tl-sw tl-sw-unavailable" },
  { key: "idle", label: "Idle", swatch: "tl-sw tl-sw-idle" },
  { key: "today", label: "Today", swatch: "tl-sw tl-sw-today" },
];

/**
 * Facility icons for the lane label. One tile per lane, so the reader knows
 * which facility a row is without reading the text.
 */
export const FACILITY_ICON: Record<JobKind, { home: number; builderBase: number }> = {
  builder: { home: 1000015, builderBase: 1000034 }, // Builder's Hut / Builder Hall
  lab: { home: 1000007, builderBase: 1000046 }, // Laboratory / Star Laboratory
  pet: { home: 1000068, builderBase: 1000068 }, // Pet House is home-village only
};

/** The facility icon for a lane, in the village currently being planned. */
export function facilityIconId(kind: JobKind, village: Village): number {
  return FACILITY_ICON[kind][village === "builderBase" ? "builderBase" : "home"];
}
