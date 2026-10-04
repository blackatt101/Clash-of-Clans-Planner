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
import type { AttackRequest } from "@/lib/attack/types";

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
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const screenshot = typeof body.screenshot === "string" ? body.screenshot : "";
  const townHall =
    typeof body.townHall === "number" ? Math.round(body.townHall) : 0;
  if (!screenshot || (screenshot.length < 10_000 && !screenshot.startsWith("data:"))) {
    return NextResponse.json(
      { error: "Missing or empty base screenshot." },
      { status: 400 },
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
    const result = await generateStrategy(request, validateStrategy);
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
