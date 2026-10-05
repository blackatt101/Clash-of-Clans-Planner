/**
 * A realistic TH15 queen-charge-hybrid plan used by the render
 * verification scripts. The miner group is split into two consecutive
 * steps on purpose: the validator must merge it into one "Miner ×15"
 * marker, and the path/spell step references must survive the remap.
 * Exported raw (pre-validation) — feed it through validateStrategy.
 */
export const fixture = {
  strategy: {
    name: "Queen Charge Hybrid (Lalo)",
    type: "queen-charge-hybrid",
    difficulty: "medium",
    summary: "Queen walk west, blimp+balloon core with hybrid cleanup.",
    reason:
      "Eagle faces east and the CC is pulled west, so the queen charges the western compartment before the air main.",
  },
  army: {
    troops: [
      { id: "miner", count: 15 },
      { id: "hog-rider", count: 10 },
      { id: "balloon", count: 6 },
      { id: "healer", count: 8 },
    ],
    spells: [
      { id: "healing-spell", count: 3 },
      { id: "rage-spell", count: 2 },
      { id: "poison-spell", count: 1 },
    ],
    siege_machine: { id: "siege-barracks" },
    clan_castle: [{ id: "miner", count: 8 }],
  },
  base_analysis: {
    townHallLevel: 15,
    townHallPosition: { x: 0.5, y: 0.42 },
    clanCastlePosition: { x: 0.42, y: 0.5 },
    baseShape: "ring",
    importantTargets: [
      { type: "eagle_artillery", position: { x: 0.55, y: 0.45 }, priority: "high", confidence: 0.9 },
      { type: "inferno", position: { x: 0.45, y: 0.38 }, priority: "high", confidence: 0.85 },
      { type: "scattershot", position: { x: 0.6, y: 0.55 }, priority: "medium", confidence: 0.8 },
      { type: "x_bow", position: { x: 0.35, y: 0.6 }, priority: "medium", confidence: 0.7 },
      { type: "air_defense", position: { x: 0.7, y: 0.4 }, priority: "high", confidence: 0.9 },
      { type: "clan_castle", position: { x: 0.42, y: 0.5 }, priority: "medium", confidence: 0.95 },
    ],
    entryPoints: [{ position: { x: 0.2, y: 0.82 }, reason: "wide gap south-west" }],
    funnels: [{ position: { x: 0.27, y: 0.73 }, purpose: "miner funnel west" }],
  },
  deployment_plan: [
    { step: 1, phase: "queen-charge", unit: "archer-queen", count: 1, position: { x: 0.18, y: 0.8 }, target: "western compartment", purpose: "Walk the queen along the west edge and take the CC pull." },
    { step: 2, phase: "funnel", unit: "miner", count: 5, position: { x: 0.25, y: 0.72 }, target: "south-west funnel", purpose: "Funnel the west compartment toward the core." },
    { step: 3, phase: "funnel", unit: "miner", count: 10, position: { x: 0.28, y: 0.75 }, target: "south-west funnel", purpose: "Finish the funnel from the south." },
    { step: 4, phase: "main-entry", unit: "hog-rider", count: 10, position: { x: 0.5, y: 0.92 }, target: "southern defenses", purpose: "Smash the south ring into the core." },
    { step: 5, phase: "main-entry", unit: "balloon", count: 6, position: { x: 0.55, y: 0.9 }, target: "air defenses", purpose: "Air main targeting the air defenses." },
    { step: 6, phase: "core", unit: "healer", count: 8, position: { x: 0.6, y: 0.92 }, target: "core", purpose: "Sustain the air main into the core." },
    { step: 7, phase: "cleanup", unit: "royal-champion", count: 1, position: { x: 0.4, y: 0.3 }, target: "north-east leftovers", purpose: "Clean up the north-east and hunt enemy heroes." },
  ],
  heroes: [
    { id: "archer-queen", use: true, role: "queen-charge", reason: "Charges the western compartment and takes the CC pull before the air main enters." },
    { id: "royal-champion", use: true, role: "cleanup", reason: "Hunts the north-east leftovers and enemy heroes once the core collapses." },
    { id: "barbarian-king", use: false, role: null, reason: "The miner funnel already seals the west compartment; the king would only duplicate the queen's funnel value." },
    { id: "grand-warden", use: false, role: null, reason: "The air main is sustained by 8 healers through the core; the warden's aura would protect troops that are already covered." },
    { id: "minion-prince", use: false, role: null, reason: "No single air compartment to storm — the air defenses are spread, so the prince's charge adds little over the balloon screen." },
    { id: "dragon-duke", use: false, role: null, reason: "The air main already counts on the warden's support and the balloon screen; a second air hero adds little without a second air compartment to storm." },
  ],
  paths: [
    { step: 1, unit: "archer-queen", points: [{ x: 0.18, y: 0.8 }, { x: 0.2, y: 0.62 }, { x: 0.3, y: 0.55 }], style: "attack" },
    { step: 3, unit: "miner", points: [{ x: 0.28, y: 0.75 }, { x: 0.35, y: 0.65 }], style: "funnel" },
    { step: 4, unit: "hog-rider", points: [{ x: 0.5, y: 0.92 }, { x: 0.5, y: 0.7 }, { x: 0.5, y: 0.5 }], style: "attack" },
    { step: 5, unit: "balloon", points: [{ x: 0.55, y: 0.9 }, { x: 0.6, y: 0.65 }, { x: 0.7, y: 0.42 }], style: "attack" },
    { step: 7, unit: "royal-champion", points: [{ x: 0.4, y: 0.3 }, { x: 0.6, y: 0.25 }], style: "cleanup" },
  ],
  spell_actions: [
    { step: 5, spell: "rage-spell", position: { x: 0.62, y: 0.6 }, trigger: "When the balloons pass the air defense", purpose: "Speed the air main through the core." },
    { step: 6, spell: "healing-spell", position: { x: 0.55, y: 0.5 }, trigger: "When the hybrid reaches the core", purpose: "Keep the balloons alive under the scattershot." },
    { step: 7, spell: "poison-spell", position: { x: 0.42, y: 0.5 }, trigger: "When the CC troops latch on", purpose: "Kill the clan castle lure." },
  ],
  hero_abilities: [
    { hero: "archer-queen", trigger: "When the Queen reaches the compartment with the eagle", purpose: "Burst through the western kill zone." },
    { hero: "royal-champion", trigger: "When the champion is surrounded in the north-east", purpose: "Clean up and hunt enemy heroes." },
  ],
  attack_phases: [
    { name: "queen-charge", description: "Queen walks the west edge." },
    { name: "funnel", description: "Miners seal the west compartment." },
    { name: "main-entry", description: "Hogs and balloons enter from the south." },
    { name: "core", description: "Air main collapses into the core." },
    { name: "cleanup", description: "Champion mops up the north-east." },
  ],
  confidence: { base_analysis: 0.9, strategy: 0.85, deployment: 0.8 },
};
