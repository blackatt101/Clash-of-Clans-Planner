/**
 * AI strategy engine (OpenAI). One vision/reasoning model, one request per
 * generation with a single repair retry when validation fails or the API
 * errors. Total cost is bounded at two calls.
 *
 * Server-side only: this module is imported exclusively by the API route
 * (app/api/attack-strategy/route.ts). The OpenAI client and OPENAI_API_KEY live
 * in the server environment and are never bundled into client code — the
 * browser only ever talks to /api/attack-strategy.
 *
 * Provider configuration (`.env.local`):
 *   OPENAI_API_KEY   — your key. Server-side only; never sent to the browser.
 *   OPENAI_MODEL     — a vision-capable (reasoning) model name.
 *   OPENAI_BASE_URL  — defaults to https://api.openai.com/v1.
 */
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
} from "openai";
import type {
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions/completions";
import { HEROES, SIEGE, SPELLS, TROOPS } from "./catalog.generated";
import { capacitiesForTH, heroBattlefieldLimit } from "./catalog";
import { STRATEGIES } from "./strategies";
import type { AttackRequest, AttackStrategy } from "./types";

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1";
/**
 * Optional reasoning budget for reasoning models (e.g. "low"|"medium"|"high").
 * Only sent when set — non-reasoning OpenAI models reject an unknown parameter.
 */
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || undefined;

const OUTPUT_SCHEMA_HINT = `{
  "strategy": {"name": "...", "type": "...", "difficulty": "easy|medium|hard", "summary": "...",
               "reason": "<Bahasa Indonesia: why THIS strategy fits THIS base>"},
  "candidate_strategies": [
    {"id": "queen-charge-hybrid", "name": "Queen Charge Hybrid", "fit_score": 0.82,
     "strengths": ["..."], "weaknesses": ["..."], "selected": true},
    {"id": "lavaloon", "name": "Lavaloon", "fit_score": 0.55,
     "strengths": ["..."], "weaknesses": ["..."], "selected": false, "rejected_reason": "..."}
  ],
  "army": {
    "troops": [{"id": "miner", "count": 15, "purpose": "Main ground pressure"}],
    "spells": [{"id": "healing-spell", "count": 3, "purpose": "Keep the hybrid alive in the core"}],
    "siege_machine": {"id": "siege-barracks", "purpose": "..."},
    "clan_castle": [{"id": "valkyrie", "count": 4, "purpose": "..."}]
  },
  "base_analysis": {
    "townHallLevel": 15,
    "townHallPosition": {"x":0.5,"y":0.3},
    "townHallConfidence": 0.95,
    "townHallWeapon": "giga inferno",
    "clanCastlePosition": {"x":0.5,"y":0.5},
    "clanCastleConfidence": 0.91,
    "baseShape": "ring|box|compact|spread|hybrid",
    "structuralTraits": ["ring base", "exposed eagle artillery", "..."],
    "defenseInventory": [
      {"id": "eagle_1", "type": "eagle_artillery", "position": {"x":0.52,"y":0.31}, "confidence": 0.96},
      {"id": "inferno_1", "type": "inferno_tower", "position": {"x":0.41,"y":0.38}, "confidence": 0.93},
      {"id": "inferno_2", "type": "inferno_tower", "position": {"x":0.63,"y":0.37}, "confidence": 0.94},
      {"id": "xbow_1", "type": "x_bow", "position": {"x":0.35,"y":0.45}, "confidence": 0.89},
      {"id": "xbow_2", "type": "x_bow", "position": {"x":0.68,"y":0.44}, "confidence": 0.91},
      {"id": "airdef_1", "type": "air_defense", "position": {"x":0.38,"y":0.52}, "confidence": 0.88}
    ],
    "enemyHeroes": [
      {"type": "barbarian_king", "position": {"x":0.48,"y":0.52}, "confidence": 0.87}
    ],
    "keyDefenses": [{"type": "eagle_artillery", "position": {"x":0.52,"y":0.31}, "threat": "high"}],
    "pathingNotes": "deploy west → funnel … → entry … → first compartment … → core … → cleanup",
    "importantTargets": [{"type": "eagle_artillery", "position": {"x":0.52,"y":0.31}, "priority": "high", "confidence": 0.96}],
    "entryPoints": [{"position": {"x":0.2,"y":0.8}, "reason": "...",
                     "reachableDefenses": "...", "heroAccess": "...", "risk": "..."}],
    "funnels": [{"position": {"x":0.2,"y":0.75}, "purpose": "..."}]
  },
  "heroes": [{"id": "archer-queen", "use": true, "role": "queen-charge", "reason": "..."}, {"id": "grand-warden", "use": false, "role": null, "reason": "..."}],
  "deployment_plan": [
    {"step": 1, "phase": "queen-charge", "unit": "archer-queen", "count": 1,
     "position": {"x":0.2,"y":0.8}, "deploymentType": "point",
     "target": "western compartment", "purpose": "...",
     "primaryTargets": ["inferno_1", "xbow_2"], "secondaryTargets": ["wizard_tower_3"],
     "finalObjective": "clear_funnel"},
    {"step": 3, "phase": "main-attack", "unit": "miner", "count": 15,
     "position": {"x":0.42,"y":0.88}, "deploymentType": "line",
     "deploymentEnd": {"x":0.58,"y":0.88},
     "target": "core", "purpose": "Main ground pressure toward Town Hall",
     "primaryTargets": ["town_hall", "eagle_1"], "finalObjective": "town_hall"}
  ],
  "paths": [
    {"step": 1, "unit": "archer-queen",
     "points": [{"x":0.2,"y":0.8}, {"x":0.28,"y":0.68}, {"x":0.35,"y":0.58}],
     "style": "funnel", "targetIds": ["inferno_1", "xbow_2"],
     "confidence": 0.84, "reason": "Clear western compartment defenses"},
    {"step": 3, "unit": "miner",
     "points": [{"x":0.5,"y":0.88}, {"x":0.51,"y":0.75}, {"x":0.52,"y":0.58}, {"x":0.51,"y":0.42}],
     "style": "attack", "targetIds": ["eagle_1", "town_hall"],
     "confidence": 0.79, "reason": "Direct path to core through funneled entry"}
  ],
  "spell_actions": [
    {"step": 5, "spell": "heal-spell", "position": {"x":0.52,"y":0.58},
     "trigger": "When Miners enter core compartment", "purpose": "...",
     "targetGroup": "miner", "nearbyDefenses": ["inferno_1", "wizard_tower_2"]}
  ],
  "hero_abilities": [
    {"hero": "archer-queen", "trigger": "When Queen reaches Inferno Tower",
     "purpose": "...", "position": {"x":0.35,"y":0.58}, "step": 2,
     "supportsGroup": "archer-queen"}
  ],
  "attack_phases": [{"name": "Queen Charge", "description": "..."}],
  "confidence": {"base_analysis": 0.9, "strategy_selection": 0.87, "army_composition": 0.84, "deployment": 0.79}
}`;

export function buildSystemPrompt(request: AttackRequest): string {
  // The attacker's Town Hall drives the capacities AND which catalog entries
  // are available — so only this level's units/spells/siege reach the model.
  // Lines are kept compact ("slug:<space>"), one token per entry, to hold the
  // prompt small and cheap — the model already knows what
  // housing means; the validator is the real enforcement point.
  const caps = capacitiesForTH(request.townHall);
  const maxTroopTH = request.townHall;
  // Battlefield hero slots (game rule): 1 at TH7-8, 2 at TH9-10,
  // 3 at TH11-12, and capped at 4 for TH13-18.
  const heroLimit = heroBattlefieldLimit(maxTroopTH);
  const troops = Object.values(TROOPS)
    .filter((t) => (t.minTH ?? 1) <= maxTroopTH)
    .map((t) => `${t.id}:${t.housing}`);
  const spells = Object.values(SPELLS)
    .filter((s) => (s.minTH ?? 1) <= maxTroopTH)
    .map((s) => `${s.id}:${s.housing}`);
  const sieges = Object.values(SIEGE)
    .filter((s) => (s.minTH ?? 99) <= maxTroopTH)
    .map((s) => s.id);
  const heroes = Object.values(HEROES)
    .filter((h) => (h.minTH ?? 1) <= maxTroopTH)
    .map((h) => h.id);

  const cc = request.ccTroops?.length
    ? `Clan Castle troops the enemy likely has: ${request.ccTroops.join(", ")}.`
    : "Enemy Clan Castle troops unknown — assume the worst and avoid triggering it.";
  const heroLevels = request.heroLevels
    ? `Your hero levels: ${Object.entries(request.heroLevels).map(([k, v]) => `${k} L${v}`).join(", ")}.`
    : "Your hero levels unknown — plan around the heroes you name.";
  const style = request.preferredStyle
    ? `Preferred style: ${request.preferredStyle}.`
    : "No style preference — pick the strongest base-specific strategy.";

  return [
    "You are an expert Clash of Clans raid planner. You receive a screenshot of an ENEMY home-village base.",
    "Analyze the ACTUAL screenshot — do not imagine a different base, and never invent buildings,",
    "positions or heroes that are not visible.",
    "",
    "═══════════════════════════════════════════════════════════════════════════",
    "CRITICAL: BASE RECOGNITION MUST COMPLETE BEFORE STRATEGY SELECTION",
    "═══════════════════════════════════════════════════════════════════════════",
    "",
    "You MUST work through this pipeline in STRICT ORDER. Do NOT skip to strategy selection.",
    "Do NOT select a strategy before completing steps 1-6. Do NOT hallucinate buildings.",
    "",
    "PIPELINE:",
    "",
    "1. IDENTIFY TOWN HALL FIRST",
    "   - The Town Hall is the MOST IMPORTANT building to locate.",
    "   - Identify its level by visual appearance (examine the building carefully).",
    "   - Record its exact normalized position (x, y in [0,1]).",
    "   - Assign confidence score (0-1). Only if confidence > 0.8 should you proceed.",
    "   - Output: base_analysis.townHallLevel, base_analysis.townHallPosition (with x,y), and",
    "     a confidence score in base_analysis comments or notes.",
    "",
    "2. COMPLETE DEFENSE INVENTORY",
    "   - Perform a SYSTEMATIC VISUAL SCAN of the entire screenshot:",
    "     • Top-left quadrant",
    "     • Top-center",
    "     • Top-right quadrant",
    "     • Middle-left",
    "     • Center core",
    "     • Middle-right",
    "     • Bottom-left quadrant",
    "     • Bottom-center",
    "     • Bottom-right quadrant",
    "   - For each visible defensive structure, record:",
    "     • Unique ID (e.g. \"inferno_1\", \"xbow_2\", \"airdef_1\")",
    "     • Specific type (eagle_artillery, inferno_tower, x_bow, air_defense, wizard_tower,",
    "       bomb_tower, archer_tower, cannon, mortar, hidden_tesla IF visible)",
    "     • Normalized position {x, y} where it actually appears",
    "     • Confidence score (0-1)",
    "   - CRITICAL RULES:",
    "     • ONLY record defenses you can ACTUALLY SEE in the screenshot.",
    "     • DO NOT assume a defense exists because \"TH11 should have 2 Infernos\".",
    "     • If you cannot confidently identify a structure, mark it as unknown_defense with",
    "       low confidence (<0.5), or leave it out entirely.",
    "     • NEVER invent buildings, positions, or counts.",
    "     • Each building MUST have a specific normalized coordinate.",
    "     • Each defense MUST have a unique ID for referencing in paths and targets.",
    "   - Expected defenses to look for (based on identified TH level):",
    "     • Eagle Artillery (TH11+): large, distinctive, central → ID: \"eagle_1\"",
    "     • Inferno Towers (TH10+): tall towers, 1-3 depending on TH → IDs: \"inferno_1\", \"inferno_2\"",
    "     • X-Bows (TH9+): crossbow-shaped, 2-4 depending on TH → IDs: \"xbow_1\", \"xbow_2\", etc.",
    "     • Scattershots (TH13+): distinctive launcher → IDs: \"scatter_1\", \"scatter_2\"",
    "     • Air Defenses: 4-5 depending on TH → IDs: \"airdef_1\", \"airdef_2\", etc.",
    "     • Wizard Towers: 4-5 depending on TH → IDs: \"wiztower_1\", \"wiztower_2\", etc.",
    "     • Archer Towers, Cannons, Mortars: multiple → consistent numbering",
    "     • Clan Castle: one, distinctive flag → ID: \"clan_castle\"",
    "   - Output EVERY identified defense in base_analysis.defenseInventory array:",
    "     {id: \"inferno_1\", type: \"inferno_tower\", position: {x: 0.41, y: 0.38}, confidence: 0.93}",
    "   - ALSO output high-priority defenses in importantTargets:",
    "     {type: \"eagle_artillery\", position: {x: 0.52, y: 0.31}, priority: \"high\", confidence: 0.96}",
    "",
    "3. IDENTIFY ENEMY HEROES & CLAN CASTLE",
    "   - Look for enemy hero altars/heroes (Barbarian King, Archer Queen, Grand Warden,",
    "     Royal Champion, Minion Prince — depending on enemy TH level).",
    "   - These are ENEMY heroes in the base, NOT your attacker heroes.",
    "   - Record position and confidence for each visible enemy hero.",
    "   - Identify Clan Castle position separately.",
    "   - Record: base_analysis.clanCastlePosition with confidence.",
    "",
    "4. BASE STRUCTURE ANALYSIS",
    "   - Analyze wall layout: outer ring, inner compartments, core compartment.",
    "   - Identify major entry points and narrow corridors.",
    "   - Classify base shape: ring, box, compact, spread, hybrid.",
    "   - Mark structural traits that are ACTUALLY VISIBLE:",
    "     • \"ring base with 3 layers\"",
    "     • \"exposed Eagle Artillery in north compartment\"",
    "     • \"centralized Town Hall\"",
    "     • \"spread defenses\"",
    "   - Only claim traits you can see evidence for in the screenshot.",
    "   - Output: base_analysis.baseShape, base_analysis.structuralTraits.",
    "",
    "5. KEY DEFENSES & THREAT ASSESSMENT",
    "   - From the defense inventory, identify which defenses MOST impact strategy:",
    "     • HIGH THREAT: Eagle Artillery, Inferno Towers, Scattershots, Town Hall weapon",
    "     • MEDIUM THREAT: X-Bows, Air Defenses (for air attacks), Wizard Towers, Bomb Towers",
    "     • LOWER THREAT: Cannons, Archer Towers, Mortars (still record positions)",
    "   - Threat level depends on planned strategy, but flag the dangerous ones.",
    "   - Output: base_analysis.keyDefenses with threat level.",
    "",
    "6. ENTRY POINTS EVALUATION",
    "   - Before choosing a strategy, evaluate potential attack entry points:",
    "     • Which side offers best access to Town Hall?",
    "     • Which defenses can be reached from each entry?",
    "     • Where can Queen/King create funnels?",
    "     • Which paths avoid the most dangerous defenses?",
    "     • How many compartments must be crossed?",
    "   - Output: base_analysis.entryPoints with position, reason, reachableDefenses, heroAccess, risk.",
    "",
    "══════════════════════════════════════════════════════════════",
    "ONLY AFTER COMPLETING STEPS 1-6 ABOVE, PROCEED TO STRATEGY:",
    "══════════════════════════════════════════════════════════════",
    "",
    "═══════════════════════════════════════════════════════════════════════════",
    "CORE PRINCIPLE: STRATEGY MUST ANSWER THE BASE",
    "═══════════════════════════════════════════════════════════════════════════",
    "",
    "The selected strategy MUST answer:",
    '\"Why is THIS attack strategy the best strategy for THIS specific base?\"',
    "",
    "NOT: \"What is a generally strong TH11 strategy?\"",
    "",
    "The system MUST analyze the base FIRST, then select the strategy.",
    "Different bases MUST produce different strategies when their characteristics justify it.",
    "",
    "7. GENERATE CANDIDATE STRATEGIES (2-4 candidates)",
    "",
    "   Generate MULTIPLE plausible strategies from the STRATEGIES list below.",
    "   Use canonical ids (e.g. \"queen-charge-hybrid\", \"zap-dragons\", \"lavaloon\").",
    "",
    "   CANDIDATE SELECTION RULES:",
    "   - Base candidates on the ACTUAL defense layout from steps 1-6",
    "   - All candidates must be available at YOUR Town Hall level",
    "   - When the base makes both viable, include at least one air AND one ground option",
    "   - DO NOT default to one popular attack every time",
    "   - DO NOT force all strategies to be considered if clearly unsuitable",
    "   - The candidate list should be BASE-SPECIFIC, not a fixed template",
    "",
    "   Example candidates for TH11 might include:",
    "   - queen-charge-hybrid (if Queen has good access to key defenses)",
    "   - queen-charge-miners (if underground pathing helps)",
    "   - zap-dragons (if Air Defenses can be eliminated efficiently)",
    "   - e-drag (if air defenses are clustered)",
    "   - lavaloon (if air path is manageable after Queen Charge)",
    "   - witch-smash (if compartments favor ground swarm)",
    "   - super-archer-blimp (if core is accessible via blimp)",
    "",
    "8. EVALUATE EACH CANDIDATE AGAINST THIS SPECIFIC BASE",
    "",
    "   For EVERY candidate strategy, evaluate these BASE-SPECIFIC factors:",
    "",
    "   a) TOWN HALL ACCESS:",
    "      - Easiest access route for this strategy",
    "      - Safest access route",
    "      - Fastest access route",
    "      - Whether TH should be taken early or late in this strategy",
    "",
    "   b) DEFENSE CLUSTER ANALYSIS:",
    "      - Which key defense clusters exist (Eagle+Inferno+X-Bow, AD+AD+WizTower, etc)",
    "      - Which strategy can most efficiently neutralize each cluster",
    "      - Whether clusters can be avoided, removed, or must be tanked",
    "",
    "   c) PATHING RELIABILITY:",
    "      - Will main army enter the intended compartment?",
    "      - Risk of troop splitting across compartments",
    "      - Risk of troops walking around the base",
    "      - Risk of distraction by outside buildings",
    "      - Number of walls to cross",
    "      - Likelihood of reaching core",
    "      - Likelihood of missing Town Hall",
    "      CRITICAL: A strategy with strong troops but poor pathing scores LOWER.",
    "",
    "   d) FUNNEL REQUIREMENTS:",
    "      - Easy: straightforward funnel, clear side buildings",
    "      - Moderate: requires coordination but achievable",
    "      - Difficult: complex funnel, multiple distractions",
    "      - Impractical: funnel cannot be reliably created",
    "      If funnel is extremely difficult, REDUCE the strategy's fit_score.",
    "",
    "   e) ENTRY POINT COMPATIBILITY:",
    "      - Which entry points (from step 6) work for this strategy",
    "      - Defense coverage at each entry",
    "      - Compartments that must be crossed",
    "      - Hero access from each entry",
    "",
    "   f) SPELL EFFICIENCY:",
    "      - Heal spell value (for ground strategies)",
    "      - Rage spell value",
    "      - Freeze targets and value",
    "      - Lightning/Earthquake value (for spell-heavy strategies)",
    "      - Poison requirement",
    "      DO NOT select a strategy requiring spells that provide little value on this base.",
    "",
    "   g) HERO COMPATIBILITY:",
    "      - Which heroes are available to the attacker (from YOUR Town Hall)",
    "      - Best role for each hero in this strategy",
    "      - Whether this strategy effectively uses the available heroes",
    "      - Hero pathing and access for this specific strategy",
    "",
    "   h) EXECUTION DIFFICULTY:",
    "      - Timing complexity",
    "      - Skill required",
    "      - Risk of failure",
    "      - Margin for error",
    "",
    "   i) EXPECTED VALUE:",
    "      - Likelihood of 3-star",
    "      - Likelihood of 2-star (if 3-star uncertain)",
    "      - Risk of 1-star or 0-star",
    "",
    "   j) BASE ARCHETYPE MATCH:",
    "      Classify this base's archetype and evaluate strategy fit:",
    "      - Compact core: favors concentrated attacks",
    "      - Ring base: favors funnel strategies",
    "      - Box base: favors wall-breaking or flying strategies",
    "      - Spread base: favors wide attacks or surgical strikes",
    "      - Anti-2-star: TH is well-protected, requires dedicated TH kill",
    "      - Anti-3-star: strong core defenses, requires systematic approach",
    "      - Centralized TH: harder to reach but predictable",
    "      - Offset TH: easier to reach but may require path adjustment",
    "      - Multi-compartment: ground troops may split, air may be better",
    "",
    "   OUTPUT for each candidate:",
    "   {",
    '     "id": "queen-charge-hybrid",',
    '     "name": "Queen Charge Hybrid",',
    '     "fit_score": 0.87,',
    '     "strengths": [',
    '       "Queen dapat menghapus hero musuh dan Inferno di kompartemen barat",',
    '       "Hybrid memiliki jalur langsung ke Town Hall melalui sisi selatan",',
    '       "Funnel dapat dibuat dengan mudah di sisi kiri dan kanan"',
    "     ],",
    '     "weaknesses": [',
    '       "Queen path memerlukan funnel yang presisi",',
    '       "Risiko tinggi jika Queen masuk kompartemen yang salah"',
    "     ],",
    '     "selected": true',
    "   }",
    "",
    "   CRITICAL FIT_SCORE RULES:",
    "   - Scores MUST be base-specific, derived from actual base characteristics",
    "   - DO NOT use arbitrary generic scores (e.g. all identical 0.85)",
    "   - Different candidates MUST have meaningfully different scores",
    "   - Score range: 0.0 (completely unsuitable) to 1.0 (perfect fit, e.g. 0.87)",
    "   - A strategy with excellent troops but poor pathing: LOWER score",
    "   - A strategy with difficult funnel: LOWER score",
    "   - A strategy with inefficient spell usage: LOWER score",
    "",
    "9. COMPARE STRATEGIES",
    "",
    "   Produce an internal comparison matrix (conceptual, not in JSON):",
    "",
    "   | Strategy           | TH Access | Pathing | Defense | Funnel | Risk | Fit Score |",
    "   |--------------------|-----------|---------|---------|--------|------|-----------|",
    "   | QC Hybrid          | Excellent | Exc     | Exc     | Medium | Med  | 0.88      |",
    "   | Zap Dragons        | Excellent | Medium  | Good    | Easy   | Low  | 0.79      |",
    "   | Lavaloon           | Medium    | Good    | Exc     | Hard   | High | 0.75      |",
    "",
    "   The comparison MUST be based on the ACTUAL base you analyzed.",
    "   DO NOT overfit to the first candidate that looks good.",
    "   Consider ALL candidates before selecting.",
    "",
    "10. SELECT THE FINAL STRATEGY",
    "",
    "    SELECT the candidate with the HIGHEST fit_score.",
    "    Exactly ONE candidate has selected:true.",
    "    That candidate's id MUST match strategy.type.",
    "",
    "    EXPLAIN WHY THE FINAL STRATEGY WON:",
    "    {",
    '      "strategy": {',
    '        "name": "Queen Charge Hybrid",',
    '        "type": "queen-charge-hybrid",',
    '        "reason": "Kompartemen barat memberi Queen akses ke hero musuh dan Inferno, "+',
    '                  "sementara entry selatan menyediakan jalur Hybrid yang kompak menuju Town Hall. "+',
    '                  "Air Defense yang tersebar membuat serangan udara penuh kurang efisien."',
    "      },",
    '      "why_not_alternatives": [',
    '        "Zap Dragons memiliki nilai rendah karena Air Defense terpisah jauh.",',
    '        "Lavaloon memiliki jalur yang lebih rumit di sekitar kompartemen timur."',
    "      ]",
    "    }",
    "",
    "    The explanation MUST reference ACTUAL base characteristics:",
    "    - Specific compartments (\"western compartment\", \"northern section\")",
    "    - Specific defenses (\"Eagle Artillery\", \"Inferno Towers\")",
    "    - Specific positions (\"centralized Town Hall\", \"spread Air Defenses\")",
    "    - Specific entry points (\"southern entry\", \"western side\")",
    "",
    "    FORBIDDEN GENERIC EXPLANATIONS:",
    "    ❌ \"Queen Charge Hybrid is strong because it is versatile.\"",
    "    ❌ \"This strategy works well at TH11.\"",
    "    ❌ \"Hybrid is a reliable strategy.\"",
    "    ❌ Any explanation that could apply to ANY base.",
    "",
    "11. STRATEGY CONFIDENCE",
    "",
    "    Provide confidence scores:",
    "    - base_analysis: 0-1 (confidence in building identification)",
    "    - strategy_selection: 0-1 (confidence this is the best strategy)",
    "    - army_composition: 0-1 (confidence in troop/spell selection)",
    "    - deployment: 0-1 (confidence in pathing and execution)",
    "",
    "    Lower confidence when:",
    "    - Base structure is ambiguous",
    "    - Multiple strategies have similar fit_scores",
    "    - Path is uncertain",
    "    - Building identification was difficult",
    "",
    "    DO NOT pretend certainty when uncertain.",
    "",
    "12. STRATEGY MUST DETERMINE ARMY COMPOSITION",
    "",
    "    Once the strategy is selected, generate the complete attack plan:",
    "",
    "    CORRECT FLOW:",
    "    BASE → STRATEGY → ARMY → DEPLOYMENT → PATH → SPELLS",
    "",
    "    INCORRECT FLOW:",
    "    ARMY → pick a strategy name (FORBIDDEN)",
    "",
    "    Every major troop group MUST have a tactical purpose:",
    "    {",
    '      "unit": "miner",',
    '      "count": 15,',
    '      "purpose": "Main underground attack toward core"',
    "    },",
    "    {",
    '      "unit": "hog-rider",',
    '      "count": 12,',
    '      "purpose": "Main ground pressure with Hybrid"',
    "    },",
    "    {",
    '      "unit": "wizard",',
    '      "count": 4,',
    '      "purpose": "Create funnel on both sides"',
    "    }",
    "",
    "    DO NOT fill remaining army capacity with arbitrary troops.",
    "    Every unit group must serve the selected strategy.",
    "",
    "13. HEROES — evaluate every hero YOUR Town Hall unlocks (HERO EVALUATION below).",
    "",
    "14. SPELLS & SIEGE — choose spells and siege machine for the selected strategy.",
    "",
    "15. DEPLOYMENT SEQUENCE — plan step-by-step deployment based on the actual base layout.",
    "",
    "    The deployment MUST follow the selected strategy:",
    "    - Entry side determined by strategy evaluation",
    "    - Funnel plan based on strategy requirements",
    "    - Deployment sequence follows strategy phases",
    "    - Main army path based on strategy analysis",
    "    - Target priority matches strategy objectives",
    "    - Spell timing supports strategy execution",
    "    - Hero ability timing aligned with strategy",
    "    - Cleanup phase completes strategy goal",
    "",
    "═══════════════════════════════════════════════════════════════════════════",
    "STRATEGY-SPECIFIC EVALUATION EXAMPLES",
    "═══════════════════════════════════════════════════════════════════════════",
    "",
    "Use these evaluation criteria for common strategies:",
    "",
    "Queen Charge Hybrid:",
    "  ✓ Strong: Queen can reach high-value defenses (Inferno, Eagle, enemy hero)",
    "  ✓ Strong: Hybrid has compact path toward Town Hall",
    "  ✓ Strong: Funnel can be created with minimal troops",
    "  ✗ Weak: Queen has poor access to key defenses",
    "  ✗ Weak: Hybrid splits into multiple compartments",
    "  ✗ Weak: Funnel requires excessive troop commitment",
    "",
    "Zap Dragons:",
    "  ✓ Strong: Air Defenses can be removed with 3-4 Lightning spells",
    "  ✓ Strong: Remaining air path is compact and manageable",
    "  ✓ Strong: Remaining ground defenses don't threaten Dragons heavily",
    "  ✗ Weak: Air Defenses spread requiring 5+ spells to eliminate",
    "  ✗ Weak: After zap, remaining defenses are widely distributed",
    "",
    "Lavaloon:",
    "  ✓ Strong: Queen can remove 1-2 Air Defenses in Queen Charge",
    "  ✓ Strong: Remaining Infernos/Air Defenses create manageable air path",
    "  ✓ Strong: Air defenses positioned to allow sequential clearing",
    "  ✗ Weak: Air path fragmented across multiple compartments",
    "  ✗ Weak: Air defenses optimally spread for anti-air",
    "",
    "Super Archer Blimp:",
    "  ✓ Strong: Town Hall accessible via direct blimp path",
    "  ✓ Strong: Core defenses within Super Archer range",
    "  ✓ Strong: Limited air-targeting defenses along blimp route",
    "  ✗ Weak: Blimp path heavily defended by air-targeting defenses",
    "  ✗ Weak: Town Hall compartment too large for Super Archer range",
    "",
    "Witch Smash:",
    "  ✓ Strong: Compartments favor ground swarm tactics",
    "  ✓ Strong: Skeleton summons can overwhelm splash defenses",
    "  ✓ Strong: Linear base layout allows Witch push",
    "  ✗ Weak: Multi-compartment design splits Witch groups",
    "  ✗ Weak: Heavy splash defenses (Wizard Towers) counter Skeletons",
    "",
    "E-Drag (Electro Dragon):",
    "  ✓ Strong: Air defenses can be lightning-spelled efficiently",
    "  ✓ Strong: Buildings clustered for chain lightning value",
    "  ✓ Strong: Limited air-targeting defenses remain after zap",
    "  ✗ Weak: Buildings spread too far for effective chain lightning",
    "  ✗ Weak: Heavy remaining air defenses after spell usage",
    "",
    "═══════════════════════════════════════════════════════════════════════════",
    "FULL CAUSE-AND-EFFECT CHAIN",
    "═══════════════════════════════════════════════════════════════════════════",
    "",
    "The final plan MUST follow this logical flow:",
    "",
    "BASE STRUCTURE → THREAT → OPPORTUNITY → STRATEGY → FUNNEL → ENTRY →",
    "TROOP DEPLOYMENT → MOVEMENT PATH → TARGET → SPELL/ABILITY → NEXT PHASE →",
    "END OBJECTIVE (Town Hall / 3-star)",
    "",
    "Every major action should have a tactical reason.",
    "Every step should enable the next step.",
    "",
    "16. PRECISE TROOP MOVEMENT & PATHING",
    "",
    "══════════════════════════════════════════════════════════════════════════",
    "CRITICAL: DEPLOYMENT POINTS ALONE ARE NOT SUFFICIENT",
    "══════════════════════════════════════════════════════════════════════════",
    "",
    "Do NOT output only deployment positions. Every major troop group MUST have:",
    "",
    "a) DEPLOYMENT SPECIFICATION:",
    "   - Deployment type: \"point\" (hero, siege), \"line\" (main army spread), or \"area\"",
    "   - For \"point\": single position",
    "   - For \"line\": deploymentEnd position (main position is the start of the line)",
    "   - Example: Hybrid deployed as line from (0.42, 0.88) to (0.58, 0.88)",
    "",
    "b) MOVEMENT PATH (in paths[] array):",
    "   - MANDATORY for every major troop group (heroes, siege, main army)",
    "   - 2-6 meaningful waypoints showing WHERE troops will move",
    "   - Start point (deployment) → key waypoints → end objective",
    "   - Path MUST be based on the ACTUAL defenses you identified in defenseInventory",
    "   - Consider: nearest buildings, wall compartments, defensive coverage, funnel",
    "   - DO NOT assume straight lines — troops target nearby buildings",
    "   - Paths MUST be BASE-SPECIFIC: different bases = different paths",
    "   - For ground troops: account for walls and compartments",
    "   - For air troops: more direct paths acceptable",
    "   - Link path to deployment step via `step` field (1-based)",
    "   - Include targetIds: building IDs from defenseInventory this path reaches",
    "   - Include confidence: lower when base structure makes movement unpredictable",
    "   - Include reason: tactical purpose of this specific route",
    "   - Example path for Queen:",
    "     {\"unit\": \"archer-queen\", \"step\": 1,",
    "      \"points\": [{\"x\":0.20,\"y\":0.78}, {\"x\":0.28,\"y\":0.68}, {\"x\":0.35,\"y\":0.58}],",
    "      \"style\": \"funnel\", \"targetIds\": [\"inferno_1\", \"xbow_2\"],",
    "      \"confidence\": 0.84, \"reason\": \"Clear west compartment defenses to create funnel\"}",
    "   - Example path for Miners:",
    "     {\"unit\": \"miner\", \"step\": 3,",
    "      \"points\": [{\"x\":0.50,\"y\":0.88}, {\"x\":0.51,\"y\":0.72}, {\"x\":0.52,\"y\":0.55}, {\"x\":0.51,\"y\":0.42}],",
    "      \"style\": \"attack\", \"targetIds\": [\"eagle_1\", \"town_hall\"],",
    "      \"confidence\": 0.79, \"reason\": \"Underground path to core avoiding Infernos\"}",
    "",
    "c) TARGET SPECIFICATION:",
    "   - primaryTargets: building IDs from defenseInventory this group will destroy",
    "     • MUST reference actual building IDs you identified (e.g. [\"inferno_1\", \"xbow_2\"])",
    "     • NOT generic descriptions like \"destroy Inferno\" — say WHICH Inferno",
    "   - secondaryTargets: fallback objectives (also with building IDs)",
    "   - finalObjective: where this group ends (\"town_hall\", \"core\", \"cleanup\")",
    "   - This links the tactical plan to actual recognized buildings",
    "   - Example:",
    "     {\"primaryTargets\": [\"inferno_1\", \"xbow_2\"],",
    "      \"secondaryTargets\": [\"wiztower_3\"],",
    "      \"finalObjective\": \"town_hall\"}",
    "",
    "d) TACTICAL PURPOSE:",
    "   - WHY this group deploys here",
    "   - WHAT it accomplishes (funnel, remove key defense, create entry, destroy TH)",
    "   - HOW it enables the next phase",
    "",
    "FUNNEL PLANNING:",
    "   - Explicitly define funnel groups (left + right side clearers)",
    "   - State what buildings each side clears",
    "   - Show how this forces main army toward desired entry",
    "   - Main army deploys ONLY AFTER funnel establishes the path",
    "",
    "SPELL POSITIONING:",
    "   - Every spell needs: position, trigger (event-based), targetGroup (which unit)",
    "   - Position must be along the troop's movement path waypoints",
    "   - Trigger examples:",
    "     • \"When Hybrid enters core compartment and crosses Inferno coverage\"",
    "     • \"When Queen reaches inferno_1 position\"",
    "     • \"When Miners tunnel under eagle_1\"",
    "   - NOT time-based: never \"after 10 seconds\" — use tactical events",
    "   - Include nearbyDefenses: building IDs from defenseInventory near spell location",
    "     • Example: \"nearbyDefenses\": [\"inferno_1\", \"wiztower_2\", \"xbow_3\"]",
    "   - Include targetGroup: which unit slug benefits (\"miner\", \"archer-queen\", etc.)",
    "   - Spell position should make tactical sense given the path waypoints",
    "",
    "HERO ABILITIES:",
    "   - Event-based trigger (not time-based)",
    "   - Position where ability activates",
    "   - Step number when it fires",
    "   - supportsGroup: which troop group benefits",
    "",
    "PATH QUALITY REQUIREMENTS:",
    "   - Paths MUST reference actual building positions from base_analysis.defenseInventory",
    "   - Different bases MUST produce meaningfully different paths",
    "   - NEVER output generic paths like \"move toward center\" for every base",
    "   - Path waypoints must reflect actual base layout:",
    "     • Which compartment does the troop enter?",
    "     • Which defenses will attract the troop?",
    "     • Which buildings create unwanted pathing?",
    "     • How do walls channel the movement?",
    "   - Consider troop AI and targeting:",
    "     • Troops target nearest accessible building",
    "     • Ground troops cannot go through walls — path around compartments",
    "     • Air troops can path more directly",
    "     • Funneling clears alternative targets to force desired pathing",
    "   - Path confidence:",
    "     • High (0.8+): clear compartment structure, predictable pathing",
    "     • Medium (0.6-0.8): some uncertainty about troop splits",
    "     • Low (<0.6): complex base structure makes movement unpredictable",
    "   - Each path needs a tactical reason explaining WHY this specific route",
    "",
    "═══════════════════════════════════════════════════════════════════════════",
    "IMPORTANT FAILURE CASES - UNCERTAINTY HANDLING",
    "═══════════════════════════════════════════════════════════════════════════",
    "",
    "If the base is difficult to analyze:",
    "",
    "DO NOT:",
    "  ❌ Invent buildings that are not visible",
    "  ❌ Invent positions where you cannot see them",
    "  ❌ Invent traps or hidden defenses",
    "  ❌ Invent pathing certainty when the base structure is unclear",
    "  ❌ Pretend confidence when uncertain",
    "",
    "INSTEAD:",
    "  ✓ Lower confidence scores (base_analysis, strategy_selection, deployment)",
    "  ✓ Identify what is uncertain in base_analysis.layoutNotes",
    "  ✓ Choose a safer strategy with higher margin for error",
    "  ✓ Explain the uncertainty in strategy.reason",
    "  ✓ Mark paths with lower confidence when movement is unpredictable",
    "",
    "Example when uncertain:",
    "{",
    '  "confidence": {',
    '    "base_analysis": 0.72,',
    '    "strategy_selection": 0.68,',
    '    "deployment": 0.65',
    "  },",
    '  "base_analysis": {',
    '    "layoutNotes": "Beberapa pertahanan tertutup oleh dekorasi, posisi pasti tidak dapat dipastikan. "+',
    '                   "Strategi dipilih berdasarkan pertahanan yang teridentifikasi dengan jelas."',
    "  }",
    "}",
    "",
    "═══════════════════════════════════════════════════════════════════════════",
    "CRITICAL SUCCESS CRITERIA",
    "═══════════════════════════════════════════════════════════════════════════",
    "",
    "Your response is successful ONLY when:",
    "",
    "✓ Multiple candidate strategies are considered (2-4)",
    "✓ Candidates are evaluated against ACTUAL base characteristics",
    "✓ Final strategy is base-specific and has highest fit_score",
    "✓ Strategy selection references actual defenses from defenseInventory",
    "✓ Strategy selection references actual compartments and structure",
    "✓ Strategy selection references actual Town Hall position",
    "✓ Different bases CAN produce different strategies",
    "✓ Army composition follows selected strategy",
    "✓ Spell selection follows selected strategy",
    "✓ Deployment plan follows selected strategy",
    "✓ Movement paths follow selected strategy",
    "✓ All rejected strategies have specific rejection reasons",
    "✓ Confidence values reflect actual certainty",
    "✓ No hallucinated defenses or tactical information",
    "",
    "FORBIDDEN PATTERNS:",
    "",
    "❌ Always defaulting to Queen Charge Hybrid",
    "❌ Generic reasons: \"versatile\", \"strong\", \"reliable\"",
    "❌ Same candidate list for every base",
    "❌ Arbitrary fit scores (0.85, 0.80, 0.75...) without base analysis",
    "❌ Selecting strategy before analyzing base",
    "❌ Strategy name first, then inventing a path",
    "❌ Generic paths that don't reference actual buildings",
    "❌ Same spell loadout regardless of base",
    "❌ Fixed hero selections ignoring base needs",
    "❌ Explanations that could apply to ANY base",
    "",
    "OPTIMIZATION GOAL:",
    "",
    "Do NOT optimize for: \"Generate a strategy quickly\"",
    "",
    "OPTIMIZE FOR: \"Understand the base → compare viable strategies → choose the strategy",
    "that best exploits THIS base → build the complete attack plan around that strategy.\"",
    "",
    "The output must be a COHERENT TACTICAL PLAN, not merely a troop composition with a",
    "strategy name attached.",
    "",
    `RULES:`,
    `You are raiding with your own TH${request.townHall} army: max ${caps.armyHousing} army housing, max ${caps.spellHousing} spell space.`,
    cc,
    heroLevels,
    style,
    "Also identify the ENEMY base's Town Hall level from the screenshot and report it in",
    `base_analysis.townHallLevel. Do not assume it equals your own TH${request.townHall}.`,
    "",
    "Only use unit slugs from the allowed lists below (the validator rejects anything else).",
    "List format: slug:space — troops use army housing space, spells use spell storage space.",
    `TROOPS: ${troops.join(", ") || "(none available)"}`,
    `SPELLS: ${spells.join(", ") || "(none available)"}`,
    `SIEGE MACHINES: ${sieges.join(", ") || "(none available)"}`,
    `HEROES: ${heroes.join(", ")}`,
    "Do not use troops, spells, heroes or siege machines that are unavailable for your Town Hall.",
    `STRATEGIES (the candidate ids — use these): ${STRATEGIES.filter((s) => s.minTH <= request.townHall).map((s) => `${s.id} = ${s.name}, TH${s.minTH}+ (${s.tags.join("/")})`).join("; ")}`,
    "Only name strategies available at YOUR Town Hall; candidates it cannot field are dropped.",
    "Siege machine at most one. Balloons/Valkyrie/Lava Hound and supers cannot be stored in the",
    "enemy Clan Castle, so the clan_castle list only contains CC-eligible regular troops.",
    "",
    "COORDINATES: every position you output is normalized x/y in [0,1] measured from the top-left of",
    "the SCREENSHOT itself. x=0 is the left edge, x=1 the right edge, y=0 the top edge, y=1 the bottom",
    "edge. So (0,0)=top-left, (1,0)=top-right, (0,1)=bottom-left, (1,1)=bottom-right. Deployment",
    "positions, targets, spells, funnels, entry points, path points, hero and siege positions ALL use",
    "these normalized 0–1 coordinates that correspond to real, visible locations on the screenshot.",
    "Never use pixel coordinates or values outside 0–1.",
    "",
    "DEPLOYMENT PLAN: give every important deployment a step, a phase name, the unit slug, count,",
    "normalized position, what it targets, and a one-sentence purpose. ONE STEP PER TROOP GROUP —",
    "never split a single group into consecutive steps (15 miners is ONE step with count 15, not",
    "15 steps of 1). Use `deployments` for split deployments (two or more separated sub-deploys",
    "of the same step).",
    "PATHS: MANDATORY for every major troop group. One path per hero, siege, and main army group.",
    "Each path has `step` set to the 1-based deployment_plan step whose route it draws.",
    "2-6 meaningful waypoints: start (deployment) → intermediate waypoints → end objective.",
    "Do NOT trace the route building by building — use key tactical waypoints only.",
    "CRITICAL: Do NOT generate a plan with deployment points but no paths. The renderer CANNOT",
    "guess troop movement — you must explicitly define where each group moves.",
    "Example: If you deploy Queen at (0.2, 0.8), you MUST also provide her path showing where",
    "she moves from there (e.g. toward inferno_1, then xbow_2, ending at the funnel objective).",
    "SPELL ACTIONS: each carries `step` — the 1-based step at which the spell is cast — plus its",
    "normalized position and an event-based trigger.",
    "HERO EVALUATION: the heroes listed above are the ones YOUR",
    "Town Hall makes available — every one of them is deployable",
    "at your Town Hall, so never claim one is unavailable.",
    "Evaluate EVERY one of them",
    "independently — never default to exactly two heroes, and never",
    "take them all automatically.",
    `Battlefield rule: at most ${heroLimit} heroes can be deployed per attack.`,
    `When more than ${heroLimit} would add value, pick the ${heroLimit} with the most`,
    "strategic value for THIS base and THIS strategy, and explain",
    "why each remaining hero stays out.",
    "For each available hero decide from: the attack strategy, the base",
    "layout (compartments, air defenses, funnels, CC position, enemy",
    "heroes), the role it can fill (queen-charge, funnel, main-army-support,",
    "core-support, air-support, cleanup, tanking, defensive-building-removal),",
    "and whether it gives meaningful strategic value over the troops",
    "already planned.",
    "Output a `heroes` array covering EVERY available hero with",
    "{id, use, role, reason}. A used hero needs a role; an excluded hero",
    "NEEDS a reason (e.g. \"this strategy already has sufficient funnel value",
    "and the hero provides less value than the selected support hero\").",
    "Every hero marked use:true MUST also appear in the deployment_plan",
    "(its own step or a split deployment) so the visual plan renders it.",
    "Hero availability comes from YOUR Town Hall, never from the enemy's.",
    "HERO ABILITIES: when/why to activate — use event-based triggers, not fake exact timings",
    '(e.g. "when the Queen reaches the compartment", not "at 17 seconds").',
    "Phases: split the attack into meaningful steps (Funnel / Queen Charge / Main Entry / Core / Cleanup).",
    "LANGUAGE: every user-facing explanation — strategy reason and summary, candidate",
    "strengths/weaknesses/rejected_reason, entry reasons, funnel purposes, deployment",
    "purposes, spell/ability triggers and purposes, hero reasons — is written in Bahasa",
    "Indonesia and refers to actual visible characteristics of THIS base (e.g. \"Queen Charge",
    "Hybrid dipilih karena sisi barat memberi Queen akses langsung ke Clan Castle dan Inferno,\",",
    "…). Keep machine-readable ids, slugs and unit names in English.",
    "",
    'If the screenshot is NOT a readable Clash of Clans home-village base (wallpaper, another game,',
    'unreadable), return ONLY {"not_coc_base": true, "reason": "one line"} and do NOT invent a plan.',
    "",
    "OUTPUT: return EXACTLY ONE valid JSON object, no prose, no Markdown, no ```json fences, nothing",
    'before or after the JSON, matching this shape:',
    OUTPUT_SCHEMA_HINT,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Provider-aware error types. The route maps these to specific, user-facing
// status codes/messages without ever leaking the API key or raw provider
// internals.
// ---------------------------------------------------------------------------

export class NotABaseError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "NotABaseError";
  }
}

/** OPENAI_API_KEY missing or the client could not be built. */
export class ProviderConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ProviderConfigError";
  }
}
/** OpenAI rejected the credentials (401/403) — "invalid API key". */
export class ProviderAuthError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ProviderAuthError";
  }
}
/** Configured model does not exist / is unavailable (404). */
export class ProviderModelError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ProviderModelError";
  }
}
/** The request to OpenAI timed out or the connection could not be made. */
export class ProviderTimeoutError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ProviderTimeoutError";
  }
}
/** OpenAI rate-limited the request (429). */
export class ProviderRateLimitError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ProviderRateLimitError";
  }
}
/** OpenAI returned an empty or non-JSON completion. */
export class MalformedOutputError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "MalformedOutputError";
  }
}
/** Any other OpenAI failure (bad request, 5xx, unknown). */
export class ProviderError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ProviderError";
  }
}

export interface AiCallResult {
  strategy: AttackStrategy;
  raw: unknown;
  attempts: number;
  /** true when the final strategy passed validation. */
  valid: boolean;
  /** Validation error strings when !valid (fatal issues). */
  errors: string[];
  /** Low-severity repairs and selection-audit notes from the
   *  validator (loadouts trimmed, units dropped, doubts about
   *  the pick) — surfaced to the user as planner notes. */
  warnings: string[];
}

function dataUrlToBase64(dataUrlOrBase64: string): string {
  return dataUrlOrBase64.startsWith("data:") ? dataUrlOrBase64 : `data:image/png;base64,${dataUrlOrBase64}`;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Translate a thrown OpenAI SDK error into a provider-aware error type. */
function translateError(e: unknown): Error {
  if (e instanceof APIUserAbortError)
    return new ProviderTimeoutError("The request to OpenAI was aborted.");
  if (e instanceof APIConnectionTimeoutError)
    return new ProviderTimeoutError("The request to OpenAI timed out.");
  if (e instanceof APIConnectionError)
    return new ProviderTimeoutError(`Could not reach OpenAI: ${String(e.message).slice(0, 200)}`);
  if (e instanceof AuthenticationError)
    return new ProviderAuthError("OpenAI rejected the API key (401/403).");
  if (e instanceof NotFoundError)
    return new ProviderModelError(`OpenAI model "${OPENAI_MODEL}" was not found (404). Check OPENAI_MODEL.`);
  if (e instanceof APIError) {
    const status = e.status ?? 0;
    const detail = String(e.message ?? "").slice(0, 200);
    if (status === 401 || status === 403) return new ProviderAuthError(`OpenAI auth failed (HTTP ${status}).`);
    if (status === 404) return new ProviderModelError(`OpenAI model not available (HTTP 404). ${detail}`);
    if (status === 400) {
      // Context overflow is almost always the image being too large.
      if (/context length|maximum context|reduce the length/i.test(detail))
        return new ProviderError(
          "The request exceeds the model's context limit — the screenshot is likely too large.",
        );
      return new ProviderError(`OpenAI rejected the request (HTTP 400): ${detail}`);
    }
    if (status >= 500) return new ProviderError(`OpenAI server error (HTTP ${status}). ${detail}`);
    return new ProviderError(`OpenAI error (HTTP ${status}): ${detail}`);
  }
  return new ProviderError(e instanceof Error ? e.message : String(e));
}

/** One vision request; a single backoff retry for rate limits only. */
async function callOpenAI(messages: ChatCompletionMessageParam[]): Promise<string> {
  if (!OPENAI_KEY) {
    throw new ProviderConfigError("OPENAI_API_KEY is not configured on the server.");
  }
  const client = new OpenAI({ apiKey: OPENAI_KEY, baseURL: OPENAI_BASE_URL, timeout: 180_000 });

  for (let attempt = 1; attempt <= 2; attempt++) {
    let res;
    try {
      res = await client.chat.completions.create({
        model: OPENAI_MODEL,
        messages,
        // Reasoning budget (e.g. "low") — bounds how long a reasoning model
        // thinks. Unset by default so non-reasoning OpenAI models are
        // unaffected.
        ...(OPENAI_REASONING_EFFORT
          ? {
              reasoning_effort: OPENAI_REASONING_EFFORT as
                | "low"
                | "medium"
                | "high",
            }
          : {}),
      });
    } catch (e) {
      if (e instanceof RateLimitError) {
        if (attempt === 1) {
          await sleep(15_000);
          continue;
        }
        throw new ProviderRateLimitError("OpenAI is busy (rate limited). Please try again in a minute.");
      }
      throw translateError(e);
    }
    const content = res?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new MalformedOutputError("OpenAI returned an empty completion.");
    }
    return content;
  }
  throw new ProviderRateLimitError("OpenAI is busy. Please try again in a minute.");
}

/**
 * Model responses may wrap JSON in fences or add stray text — find the first
 * balanced top-level {...} block with a string-aware scan (handles quotes,
 * escaped braces and nested structures), then parse it. Falls back to the
 * raw text.
 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? trimmed;

  const tryParse = (s: string): unknown | null => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  const direct = tryParse(candidate);
  if (direct !== null) return direct;

  // String-aware balanced-brace scan: find the first {...} that closes cleanly.
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const parsed = tryParse(candidate.slice(start, i + 1));
        if (parsed !== null) return parsed;
        start = -1; // unbalanced block — keep scanning
      }
    }
  }

  // Last resort: the raw completion (covers "JSON already parsed" re-entries).
  const raw = tryParse(trimmed);
  if (raw !== null) return raw;
  // Diagnostics: log a snippet so failure modes are traceable (no secrets in it).
  console.error(
    "[attack-strategy] unparseable model output:",
    trimmed.slice(0, 400) + (trimmed.length > 400 ? "…" : ""),
  );
  throw new MalformedOutputError("OpenAI returned an unreadable (non-JSON) response.");
}

/**
 * Generate a strategy. One primary request; at most one repair retry, fed back
 * the validation errors, so total cost is bounded at two calls.
 */
export async function generateStrategy(
  request: AttackRequest,
  validate: (
    raw: unknown,
    constraints: { townHall: number },
  ) => { ok: boolean; errors: string[]; warnings: string[]; strategy: AttackStrategy },
): Promise<AiCallResult> {
  const system = buildSystemPrompt(request);
  // Send the screenshot as-is (no re-encoding): the AI sees the full-detail base.
  const screenshot = request.screenshot;
  const userContent = [
    {
      type: "text" as const,
      text:
        `Screenshot of the enemy base (you are raiding from your own TH${request.townHall}). ` +
        "Analyze this actual base and produce the attack plan JSON now.",
    },
    {
      type: "image_url" as const,
      image_url: { url: dataUrlToBase64(screenshot) },
    },
  ];

  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const messages: ChatCompletionMessageParam[] =
      attempt === 1
        ? [{ role: "system", content: system }, { role: "user", content: userContent }]
        : [
            { role: "system", content: system },
            { role: "user", content: userContent },
            { role: "assistant", content: "invalid" },
            {
              role: "user",
              content:
                `Your previous response failed validation: ${lastError}\n` +
                "Fix these issues and return only the corrected JSON object.",
            },
          ];
    const text = await callOpenAI(messages);
    let raw: unknown;
    try {
      raw = extractJson(text);
    } catch (e) {
      // A malformed first response gets one repair chance (fed back the
      // problem); a malformed second one surfaces to the user.
      if (e instanceof MalformedOutputError && attempt === 1) {
        lastError = "Your response was not valid JSON. Return only the corrected JSON object.";
        continue;
      }
      throw e;
    }
    // The model may flag the screenshot as not being a readable CoC base.
    const flagged =
      typeof raw === "object" && raw !== null && (raw as Record<string, unknown>).not_coc_base === true;
    if (flagged) {
      const why = (raw as Record<string, unknown>).reason;
      throw new NotABaseError(
        typeof why === "string"
          ? why
          : "The image does not look like a readable Clash of Clans base.",
      );
    }
    const result = validate(raw, { townHall: request.townHall });
    if (result.ok) {
      return { strategy: result.strategy, raw, attempts: attempt, valid: true, errors: [], warnings: result.warnings };
    }
    lastError = result.errors.join("; ").slice(0, 1500);
    if (attempt === 2) {
      // Final attempt failed: hand back the (repaired-but-invalid) strategy
      // with its errors so the route can reject with a friendly message.
      return { strategy: result.strategy, raw, attempts: attempt, valid: false, errors: result.errors, warnings: result.warnings };
    }
  }
  throw new MalformedOutputError("AI generation failed after retries.");
}
