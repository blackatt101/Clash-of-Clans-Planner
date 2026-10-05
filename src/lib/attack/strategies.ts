/**
 * Canonical attack-strategy catalog. The model names candidate
 * strategies in free text; this module is the shared vocabulary
 * that keeps the comparison auditable: candidate ids resolve to
 * canonical slugs (so "GoWiPe", "go-wi-pe" and "Golem Wizard"
 * style variants collapse onto one entry), and every catalog
 * entry carries the Town Hall it unlocks at plus the capability
 * tags the selection audit cross-checks against the base
 * analysis (air answer, hero-led, blimp…).
 *
 * The catalog is deliberately small and stable — it lists the
 * attacks a planner actually names, not every army combination.
 * Ids the model invents still pass through (free-form ids are
 * allowed); the validator just flags them as unknown.
 */

export type StrategyTag =
  | "air" // the attack's core is flying troops
  | "ground" // the attack's core is ground troops
  | "hybrid" // ground AND air wings in one push
  | "blimp" // built around a Battle Blimp
  | "spell-heavy" // spells decide the attack (zap, freeze…)
  | "hero-led"; // a hero charge anchors the attack

export interface AttackStrategyDef {
  /** Canonical slug used in candidate_strategies and strategy.type. */
  id: string;
  name: string;
  /** Earliest Town Hall that can field the attack. */
  minTH: number;
  tags: StrategyTag[];
  /** One-line description of the plan. */
  blurb: string;
}

export const STRATEGIES: AttackStrategyDef[] = [
  {
    id: "barch",
    name: "Barch",
    minTH: 3,
    tags: ["ground"],
    blurb: "Mass Barbarians and Archers behind Wall Breakers.",
  },
  {
    id: "zap-dragons",
    name: "Zap Dragons",
    minTH: 8,
    tags: ["air", "spell-heavy"],
    blurb: "Lightning spells take out the air defenses, then Dragons clean up.",
  },
  {
    id: "mass-dragons",
    name: "Mass Dragons",
    minTH: 8,
    tags: ["air"],
    blurb: "A big Dragon stack with rage support.",
  },
  {
    id: "gowipe",
    name: "GoWiPe",
    minTH: 8,
    tags: ["ground"],
    blurb: "Golem tank, Wizards for damage, Wall Breakers to open the base.",
  },
  {
    id: "valkyrie-based",
    name: "Valkyrie-based",
    minTH: 9,
    tags: ["ground"],
    blurb: "Valkyrie splash damage holds the funnel while the army pushes.",
  },
  {
    id: "queen-charge-hybrid",
    name: "Queen Charge Hybrid",
    minTH: 9,
    tags: ["hybrid", "hero-led"],
    blurb: "Queen + Healers take a side, then Balloons, Hogs and Healers push in.",
  },
  {
    id: "witch-smash",
    name: "Witch Smash",
    minTH: 9,
    tags: ["ground"],
    blurb: "Witches behind a tank summon Skeletons to soak and split defenses.",
  },
  {
    id: "lavaloon",
    name: "Lavaloon",
    minTH: 10,
    tags: ["air"],
    blurb: "Lava Hounds tank for Balloons that snipe the air defenses.",
  },
  {
    id: "queen-charge-lalo",
    name: "Queen Charge Lavaloon",
    minTH: 10,
    tags: ["hybrid", "air", "hero-led"],
    blurb: "Queen Charge opens a side, then Lava Hounds and Balloons fly in.",
  },
  {
    id: "gobowitch",
    name: "GoboWitch",
    minTH: 11,
    tags: ["ground"],
    blurb: "Golem tank, Bowlers for splash, Witches for summons.",
  },
  {
    id: "super-archer-blimp",
    name: "Super Archer Blimp",
    minTH: 12,
    tags: ["blimp"],
    blurb: "Battle Blimp delivers Super Archers past the walls to snipe the core.",
  },
  {
    id: "hydra",
    name: "Hydra",
    minTH: 12,
    tags: ["air"],
    blurb: "Super Dragons with Balloon support and Healers over the core.",
  },
  {
    id: "e-drag",
    name: "E-Drag",
    minTH: 12,
    tags: ["air", "spell-heavy"],
    blurb: "Electro Dragons with Balloons; lightning opens the air defenses.",
  },
  {
    id: "super-dragon",
    name: "Super Dragon",
    minTH: 12,
    tags: ["air"],
    blurb: "Super Dragons with rage, guided by their fireball splash.",
  },
  {
    id: "root-rider",
    name: "Root Rider",
    minTH: 16,
    tags: ["ground"],
    blurb: "Root Riders tunnel under walls straight into the compartments.",
  },
];

const BY_ID: Record<string, AttackStrategyDef> = Object.fromEntries(
  STRATEGIES.map((s) => [s.id, s]),
);

/**
 * Community nicknames containment can't see — the letters
 * aren't consecutive in the full name ("lalo" comes from
 * "Lava loon", "qch" from "Queen Charge Hybrid"). Checked
 * before containment so a nickname lands on the attack
 * players mean by it.
 */
const NICKNAMES: Record<string, string> = {
  lalo: "lavaloon",
  qch: "queen-charge-hybrid",
  qcl: "queen-charge-lalo",
  sab: "super-archer-blimp",
  zap: "zap-dragons",
};

/** Fold a strategy name/id to its canonical slug shape. */
export function normalizeStrategyId(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Resolve a model-written strategy id to a catalog slug, or null
 * when it names no known strategy. Exact match first, then the
 * hyphen-stripped forms (so "GoWiPe", "go wi pe" and "GoWiPe"
 * variants all land on "gowipe"), then containment on the
 * stripped forms. Among containment matches the SHORTEST
 * catalog id wins, so a nickname like "lalo" lands on the
 * base attack ("lavaloon") rather than a compound one
 * ("queen-charge-lalo") that merely contains it.
 */
export function resolveStrategyId(input: string): string | null {
  const n = normalizeStrategyId(input);
  if (!n) return null;
  if (BY_ID[n]) return n;
  if (NICKNAMES[n]) return NICKNAMES[n];
  const flat = n.replace(/-/g, "");
  if (flat.length < 4) return null;
  let best: string | null = null;
  for (const def of STRATEGIES) {
    const defFlat = def.id.replace(/-/g, "");
    if (flat === defFlat) return def.id;
    if (defFlat.includes(flat) || flat.includes(defFlat)) {
      if (!best || def.id.length < best.length) best = def.id;
    }
  }
  return best;
}

/** Catalog entry for a strategy slug, or null when unknown/free-form. */
export function strategyById(id: string): AttackStrategyDef | null {
  const resolved = resolveStrategyId(id);
  return resolved ? BY_ID[resolved] ?? null : null;
}

/** Earliest Town Hall a strategy needs, or null when unknown. */
export function strategyMinTH(id: string): number | null {
  return strategyById(id)?.minTH ?? null;
}
