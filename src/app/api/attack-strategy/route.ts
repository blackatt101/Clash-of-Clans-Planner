import { NextRequest, NextResponse } from "next/server";
import {
  MalformedOutputError,
  NotABaseError,
  ProviderAuthError,
  ProviderConfigError,
  ProviderError,
  ProviderModelError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  generateStrategy,
} from "@/lib/attack/ai";
import { validateStrategy } from "@/lib/attack/validate";
import { checkRateLimit, getClientIp } from "@/lib/attack/rateLimit";
import type { AttackRequest } from "@/lib/attack/types";

/**
 * Maximum allowed payload size: 10MB.
 * Rationale:
 * A high-resolution Clash of Clans base screenshot (e.g. iPad Pro 2732x2048 or 4K phone)
 * is typically 2.5MB to 5.5MB as a binary PNG file. When encoded in base64 (4/3 expansion),
 * a 5.5MB binary image expands to ~7.3MB. With JSON formatting, tags, and request metadata,
 * 10MB accommodates all legitimate high-resolution uploads while preventing excessive memory usage.
 */
export const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_SCREENSHOT_CHARS = 8 * 1024 * 1024;

export interface ReadBodySuccess {
  ok: true;
  body: Record<string, unknown>;
}

export interface ReadBodyFailure {
  ok: false;
  error: string;
  status: number;
}

/**
 * Safely reads the request body stream up to maxBytes, aborting the stream immediately
 * if exceeded (protects against missing Content-Length / chunked streaming memory exhaustion).
 * Decodes UTF-8 incrementally to avoid redundant byte buffer duplications in RAM.
 */
export async function readJsonBodyWithLimit(
  req: NextRequest,
  maxBytes: number,
): Promise<ReadBodySuccess | ReadBodyFailure> {
  // 1. Fast pre-check via Content-Length header
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const len = parseInt(contentLength, 10);
    if (!Number.isNaN(len) && len > maxBytes) {
      return {
        ok: false,
        error: `Request payload too large (max ${Math.round(maxBytes / (1024 * 1024))}MB).`,
        status: 413,
      };
    }
  }

  // 2. Stream-based read with byte counter and incremental UTF-8 decoding
  if (!req.body) {
    return { ok: false, error: "Empty request body.", status: 400 };
  }

  const reader = req.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let text = "";
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel("Payload limit exceeded");
          return {
            ok: false,
            error: `Request payload too large (max ${Math.round(maxBytes / (1024 * 1024))}MB).`,
            status: 413,
          };
        }
        text += decoder.decode(value, { stream: true });
      }
    }
    text += decoder.decode(); // flush remaining bytes
  } catch {
    if (totalBytes > maxBytes) {
      return {
        ok: false,
        error: `Request payload too large (max ${Math.round(maxBytes / (1024 * 1024))}MB).`,
        status: 413,
      };
    }
    return { ok: false, error: "Failed to read request stream.", status: 400 };
  }

  if (totalBytes === 0 || !text.trim()) {
    return { ok: false, error: "Missing or empty request body.", status: 400 };
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Invalid JSON body.", status: 400 };
    }
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: "Invalid JSON body.", status: 400 };
  }
}

/**
 * POST /api/attack-strategy
 *
 * Body: { screenshot: string (data URL or raw base64), townHall: number,
 *         heroLevels?, preferredStyle?, ccTroops?, ccSpells? }
 *
 * The AI key never reaches the browser: this handler is the only place that
 * talks to the OpenAI API. ONE generation request produces the whole plan; the
 * model itself flags unreadable / non-CoC screenshots (cost control: no
 * separate verification call). The strategy is validated and repaired;
 * invalid strategies are rejected with a friendly message.
 */
export type GenerateStrategyFn = typeof generateStrategy;

export async function handleAttackStrategy(
  req: NextRequest,
  generateFn: GenerateStrategyFn = generateStrategy,
) {
  // 1. Sliding window rate limiting per client IP (5 requests / 60 seconds)
  const clientIp = getClientIp(req);
  const rateLimit = checkRateLimit(clientIp, 5, 60_000);
  if (!rateLimit.allowed) {
    const retrySecs = Math.ceil(rateLimit.resetMs / 1000);
    return NextResponse.json(
      {
        error: `Too many strategy generation requests. Please wait ${retrySecs}s before trying again.`,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retrySecs),
          "X-RateLimit-Limit": String(rateLimit.limit),
          "X-RateLimit-Remaining": String(rateLimit.remaining),
        },
      },
    );
  }

  // 2. Stream-based payload size limit (max 18MB) and JSON parse
  const bodyResult = await readJsonBodyWithLimit(req, MAX_PAYLOAD_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json(
      { error: bodyResult.error },
      { status: bodyResult.status },
    );
  }
  const body = bodyResult.body;

  const screenshot = typeof body.screenshot === "string" ? body.screenshot : "";
  const townHall =
    typeof body.townHall === "number" ? Math.round(body.townHall) : 0;
  if (!screenshot || (screenshot.length < 10_000 && !screenshot.startsWith("data:"))) {
    return NextResponse.json(
      { error: "Missing or empty base screenshot." },
      { status: 400 },
    );
  }
  if (screenshot.length > MAX_SCREENSHOT_CHARS) {
    return NextResponse.json(
      { error: "Screenshot exceeds maximum supported size (8MB)." },
      { status: 413 },
    );
  }
  if (townHall < 3 || townHall > 18) {
    return NextResponse.json(
      { error: "Town Hall must be between 3 and 18." },
      { status: 400 },
    );
  }

  const request: AttackRequest = {
    screenshot,
    townHall,
    heroLevels: body.heroLevels && typeof body.heroLevels === "object"
      ? (Object.fromEntries(
          Object.entries(body.heroLevels as Record<string, unknown>).map(([k, v]) => [k, Number(v)]),
        ) as Record<string, number>)
      : undefined,
    preferredStyle:
      typeof body.preferredStyle === "string" ? body.preferredStyle.slice(0, 80) : undefined,
    ccTroops: Array.isArray(body.ccTroops)
      ? (body.ccTroops as unknown[]).filter((x) => typeof x === "string").map(String).slice(0, 40)
      : undefined,
    ccSpells: Array.isArray(body.ccSpells)
      ? (body.ccSpells as unknown[]).filter((x) => typeof x === "string").map(String).slice(0, 20)
      : undefined,
  };

  // Generate + validate (one strategy request, at most one repair retry).
  // Provider-aware errors map to specific, user-facing codes; none ever leak
  // the API key or raw OpenAI internals.
  try {
    const result = await generateFn(request, validateStrategy);
    if (!result.valid) {
      return NextResponse.json(
        {
          error: "The generated strategy failed validation.",
          details: result.errors,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({
      strategy: result.strategy,
      attempts: result.attempts,
      // Validator repairs and selection-audit notes (trimmed
      // loadouts, dropped units, doubts about the pick) so the
      // user can see what the planner fixed or questions.
      warnings: result.warnings,
    });
  } catch (e) {
    // The model flagged the image as not being a readable CoC base.
    if (e instanceof NotABaseError) {
      return NextResponse.json(
        { error: `We couldn't confidently identify the base layout. ${e.message}` },
        { status: 422 },
      );
    }
    if (e instanceof ProviderConfigError) {
      console.error("[attack-strategy] provider not configured:", e.message);
      return NextResponse.json(
        { error: "AI is not configured on this server yet." },
        { status: 503 },
      );
    }
    if (e instanceof ProviderAuthError) {
      console.error("[attack-strategy] auth failure:", e.message);
      return NextResponse.json(
        {
          error:
            "The AI provider rejected the API key. Check the server's OPENAI_API_KEY.",
        },
        { status: 503 },
      );
    }
    if (e instanceof ProviderModelError) {
      console.error("[attack-strategy] model failure:", e.message);
      return NextResponse.json(
        {
          error: "The configured AI model is unavailable. Check the server's OPENAI_MODEL.",
        },
        { status: 503 },
      );
    }
    if (e instanceof ProviderRateLimitError) {
      console.error("[attack-strategy] rate limited");
      return NextResponse.json(
        {
          error:
            "The AI provider is busy right now. Please wait a minute and try again.",
        },
        { status: 503 },
      );
    }
    if (e instanceof ProviderTimeoutError) {
      console.error("[attack-strategy] timeout:", e.message);
      return NextResponse.json(
        {
          error:
            "The AI provider timed out. Please try again in a moment.",
        },
        { status: 504 },
      );
    }
    if (e instanceof MalformedOutputError) {
      console.error("[attack-strategy] malformed output:", e.message);
      return NextResponse.json(
        {
          error:
            "The AI returned a response we couldn't use. Please try again.",
        },
        { status: 502 },
      );
    }
    if (e instanceof ProviderError) {
      console.error("[attack-strategy] provider error:", e.message);
      // A context-overflow 400 is almost always "the image is too large".
      const friendly = /context limit|too large/i.test(e.message)
        ? "The base screenshot is too large for the AI model. Try a smaller / lower-resolution screenshot and again."
        : "The AI provider failed. Please try again in a moment.";
      return NextResponse.json(
        { error: friendly },
        { status: 502 },
      );
    }
    // Unknown / unexpected.
    console.error("[attack-strategy] unexpected error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("OPENAI_API_KEY")) {
      return NextResponse.json(
        { error: "AI is not configured on this server yet." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "Something went wrong generating the strategy. Please try again." },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  return handleAttackStrategy(req, generateStrategy);
}
