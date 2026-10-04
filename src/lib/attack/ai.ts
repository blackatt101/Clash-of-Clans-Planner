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
import { capacitiesForTH } from "./catalog";
import type { AttackRequest, AttackStrategy } from "./types";

const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1";
/**
 * Optional reasoning budget for reasoning models (e.g. "low"). When a
 * reasoning model thinks for too long, gateway origin timeouts (Cloudflare
 * 524) cut the run; capping the effort keeps image runs fast. Only sent when
 * set — non-reasoning OpenAI models reject an unknown parameter.
 */
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || undefined;

const OUTPUT_SCHEMA_HINT = `{
  "strategy": {"name": "...", "type": "...", "difficulty": "easy|medium|hard", "summary": "...", "reason": "..."},
  "army": {
    "troops": [{"id": "miner", "count": 15}],
    "spells": [{"id": "rage-spell", "count": 2}],
    "siege_machine": {"id": "siege-barracks"},
    "clan_castle": [{"id": "valkyrie", "count": 4}]
  },
  "base_analysis": {
    "townHallLevel": 15, "townHallPosition": {"x":0.5,"y":0.3}, "townHallWeapon": "...",
    "clanCastlePosition": {"x":0.5,"y":0.5}, "baseShape": "ring|box|anti-2star|anti-3star|compact|spread|hybrid",
    "importantTargets": [{"type": "eagle_artillery", "position": {"x":0.4,"y":0.4}, "priority": "high", "confidence": 0.9}],
    "entryPoints": [{"position": {"x":0.2,"y":0.8}, "reason": "..."}],
    "funnels": [{"position": {"x":0.2,"y":0.75}, "purpose": "..."}]
  },
  "deployment_plan": [
    {"step": 1, "phase": "queen-charge", "unit": "archer-queen", "count": 1,
     "position": {"x":0.2,"y":0.8}, "target": "western compartment", "purpose": "...",
     "deployments": [{"count": 2, "position": {"x":0.2,"y":0.8}, "label": "SW"}]}
  ],
  "paths": [{"unit": "hybrid", "points": [{"x":0.5,"y":0.85},{"x":0.5,"y":0.4}], "style": "attack|funnel|cleanup"}],
  "spell_actions": [{"spell": "rage-spell", "position": {"x":0.3,"y":0.5}, "trigger": "...", "purpose": "..."}],
  "hero_abilities": [{"hero": "archer-queen", "trigger": "...", "purpose": "..."}],
  "attack_phases": [{"name": "Queen Charge", "description": "..."}],
  "confidence": {"base_analysis": 0.9, "strategy": 0.85, "deployment": 0.8}
}`;

export function buildSystemPrompt(request: AttackRequest): string {
  // The attacker's Town Hall drives the capacities AND which catalog entries
  // are available — so only this level's units/spells/siege reach the model.
  // Lines are kept compact ("slug:<space>"), one token per entry, to hold the
  // prompt small for fast (less 524-prone) runs — the model already knows what
  // housing means; the validator is the real enforcement point.
  const caps = capacitiesForTH(request.townHall);
  const maxTroopTH = request.townHall;
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
    "Analyze the ACTUAL screenshot — do not imagine a different base.",
    "Read from it: the enemy Town Hall level, its position and Town Hall weapon, Clan Castle position and pull risk,",
    "major defenses (eagle artillery, infernos, x-bows, scattershots, monolith, spell towers, air",
    "defenses, enemy heroes), wall layout, compartments, choke points and funnel opportunities.",
    "Base every strategic decision on structures and geometry that are actually visible.",
    "",
    "CHOOSE THE STRATEGY FROM THE BASE: pick whichever valid attack fits THIS layout —",
    "queen-charge hybrid, queen-charge / blizzard Lalo, Lavaloon, Super Archer Blimp, Hydra,",
    "E-Drag, Zap Dragons, GoWiBo, Witch Smash, Root Rider, Valkyrie-based, or another that fits the",
    "detected Town Hall. Never default to one popular attack; the plan must be specific to this base.",
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
    "normalized position, what it targets, and a one-sentence purpose. Use `deployments` for split",
    "deployments (two or more separated sub-deploys of the same step).",
    "PATHS: for major troop groups, 2-5 normalized points showing intended movement, ending on",
    "where the group should end up (e.g. the core).",
    "SPELL ACTIONS: normalized positions plus event-based triggers.",
    "HERO ABILITIES: when/why to activate — use event-based triggers, not fake exact timings",
    '(e.g. "when the Queen reaches the compartment", not "at 17 seconds").',
    "Phases: split the attack into meaningful steps (Funnel / Queen Charge / Main Entry / Core / Cleanup).",
    "If a building is uncertain, mark it `unknown_defense` with low confidence — do not guess.",
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
        // Reasoning budget (e.g. "low") — keeps long-thinking models under
        // the gateway's origin timeout. Unset by default so non-reasoning
        // OpenAI models are unaffected.
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
  ) => { ok: boolean; errors: string[]; strategy: AttackStrategy },
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
      return { strategy: result.strategy, raw, attempts: attempt, valid: true, errors: [] };
    }
    lastError = result.errors.join("; ").slice(0, 1500);
    if (attempt === 2) {
      // Final attempt failed: hand back the (repaired-but-invalid) strategy
      // with its errors so the route can reject with a friendly message.
      return { strategy: result.strategy, raw, attempts: attempt, valid: false, errors: result.errors };
    }
  }
  throw new MalformedOutputError("AI generation failed after retries.");
}
