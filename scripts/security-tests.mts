/**
 * Security test suite for Clash Planner: npx tsx scripts/security-tests.mts
 * Validates SEC-01 (Rate limiting & proxy spoofing defense),
 * SEC-02 (Streaming body caps & JSON validation),
 * SEC-03 (Production debug route & layout script gating),
 * and SEC-05 (Hardened security response headers).
 *
 * AIR-GAP GUARANTEE:
 * Sets OPENAI_BASE_URL to discard port 127.0.0.1:9 and disabled key.
 * All route-level assertions terminate at security layers prior to AI invocation,
 * ensuring zero network egress and zero third-party token consumption.
 */
import { NextRequest } from "next/server";
import { checkRateLimit, resetRateLimit, getClientIp, getTrackedIpCount, pruneStale, MAX_TRACKED_IPS } from "../src/lib/attack/rateLimit";
import { readJsonBodyWithLimit, handleAttackStrategy, POST as attackStrategyPost, MAX_PAYLOAD_BYTES, MAX_SCREENSHOT_CHARS } from "../src/app/api/attack-strategy/route";
import { GET as debugGet, POST as debugPost } from "../src/app/api/debug/route";
import nextConfig from "../next.config.ts";

// Air-gap environment to strictly block any real OpenAI network calls
process.env.OPENAI_API_KEY = "mock-disabled-test-key";
process.env.OPENAI_BASE_URL = "http://127.0.0.1:9/v1";

let pass = 0;
let fail = 0;

function t(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ PASS: ${name}`);
  } else {
    fail++;
    console.error(`  ✗ FAIL: ${name} ${extra}`);
  }
}

async function runTests() {
  console.log("=================================================");
  console.log("RUNNING CLASH PLANNER SECURITY TEST SUITE (PHASE 9)");
  console.log("=================================================\n");

  // =========================================================================
  // 1. SEC-01: Rate Limiter Math, Headers, Spoofing, and Bounded Capacity
  // =========================================================================
  console.log("--- 1. SEC-01: Rate Limiting & Spoofing Defense ---");
  resetRateLimit();

  const ipA = "198.51.100.1";
  for (let i = 1; i <= 5; i++) {
    const res = checkRateLimit(ipA, 5, 60_000);
    t(`rateLimit: request ${i}/5 allowed`, res.allowed && res.remaining === 5 - i);
  }
  const rejectedRes = checkRateLimit(ipA, 5, 60_000);
  t("rateLimit: 6th request rejected with allowed=false", !rejectedRes.allowed && rejectedRes.remaining === 0);
  t("rateLimit: resetMs is positive within window", rejectedRes.resetMs > 0 && rejectedRes.resetMs <= 60_000);

  // SEC-01: Route-level HTTP 429 and Retry-After headers
  resetRateLimit();
  const testReqIp = "198.51.100.2";
  for (let i = 1; i <= 5; i++) {
    const mockReq = new NextRequest("http://localhost:3000/api/attack-strategy", {
      method: "POST",
      headers: {
        "x-real-ip": testReqIp,
        "content-type": "application/json",
      },
      body: JSON.stringify({ screenshot: "short", townHall: 14 }),
    });
    // First 5 requests pass rate limiting (will fail at screenshot validation with 400, proving rate limit allowed them)
    const res = await attackStrategyPost(mockReq);
    t(`route: request ${i}/5 allowed through rate limiter (status ${res.status})`, res.status === 400);
  }

  // 6th request must be intercepted at Step 1 and return HTTP 429
  const blockedReq = new NextRequest("http://localhost:3000/api/attack-strategy", {
    method: "POST",
    headers: {
      "x-real-ip": testReqIp,
      "content-type": "application/json",
    },
    body: JSON.stringify({ screenshot: "short", townHall: 14 }),
  });
  const res429 = await attackStrategyPost(blockedReq);
  const data429 = await res429.json();
  t("route: 6th request returns HTTP 429", res429.status === 429);
  t("route: 429 body contains user-friendly wait message", /Too many strategy generation requests/i.test(data429.error));
  t("route: 429 includes numeric Retry-After header", Number(res429.headers.get("Retry-After")) > 0);
  t("route: 429 includes X-RateLimit-Limit header", res429.headers.get("X-RateLimit-Limit") === "5");
  t("route: 429 includes X-RateLimit-Remaining === 0", res429.headers.get("X-RateLimit-Remaining") === "0");

  // SEC-01: Bounded memory safety under sustained unique-IP traffic (Fail-Closed verification)
  resetRateLimit();
  const smallCapacity = 5;
  for (let i = 1; i <= smallCapacity; i++) {
    const res = checkRateLimit(`ip-${i}`, 5, 60_000, smallCapacity);
    t(`boundedCapacity: ip-${i} registered within capacity ${smallCapacity}`, res.allowed);
  }
  t(`boundedCapacity: tracked IP count equals maxCapacity (${smallCapacity})`, getTrackedIpCount() === smallCapacity);
  // Attempt to register a new IP when capacity is saturated
  const overflowRes = checkRateLimit("overflow-ip", 5, 60_000, smallCapacity);
  t("boundedCapacity: overflow IP is rejected (fail closed, not fail open)", !overflowRes.allowed && overflowRes.remaining === 0);
  t("boundedCapacity: tracked IP count does not exceed capacity ceiling", getTrackedIpCount() === smallCapacity);

  // SEC-01: Expiry, cleanup, and recovery of rate limiter capacity
  resetRateLimit();
  const t0 = 1_000_000;
  const cap = 2;
  checkRateLimit("ip-a", 1, 60_000, cap, t0);
  checkRateLimit("ip-b", 1, 60_000, cap, t0);
  t("rateLimit lifecycle: capacity is saturated at cap=2", getTrackedIpCount() === cap);
  const rejectBeforeExpiry = checkRateLimit("ip-c", 1, 60_000, cap, t0 + 10_000);
  t("rateLimit lifecycle: new IP rejected while unexpired", !rejectBeforeExpiry.allowed);

  // Advance time beyond windowMs (60,000ms)
  const tExpiry = t0 + 65_000;
  pruneStale(tExpiry, 60_000, true);
  t("rateLimit lifecycle: expired IPs cleaned up from memory pool", getTrackedIpCount() === 0);

  // Recovery: new IP is admitted now that capacity has recovered
  const recoverRes = checkRateLimit("ip-c", 1, 60_000, cap, tExpiry);
  t("rateLimit lifecycle: recovery succeeds after expiry and cleanup", recoverRes.allowed);

  // SEC-01 & SEC-02: Deterministic proof that rejected requests NEVER call generateStrategy
  let spyGenerateCalls = 0;
  const mockSpyGenerate = async () => {
    spyGenerateCalls++;
    return {
      valid: true,
      strategy: { name: "Mock Strategy", type: "qc-hybrid", summary: "Mock" } as any,
      attempts: 1,
      warnings: [],
    };
  };

  // Rejection 1: Rate limit 429 must not invoke AI
  resetRateLimit();
  for (let i = 1; i <= 5; i++) {
    checkRateLimit("spy-test-ip", 5, 60_000);
  }
  const reqBlocked429 = new NextRequest("http://localhost:3000/api/attack-strategy", {
    method: "POST",
    headers: { "x-real-ip": "spy-test-ip", "content-type": "application/json" },
    body: JSON.stringify({ screenshot: "data:image/png;base64,validlengthhere...", townHall: 14 }),
  });
  await handleAttackStrategy(reqBlocked429, mockSpyGenerate as any);
  t("zero-egress proof: 429 rate limit NEVER calls generateStrategy", spyGenerateCalls === 0);

  // Rejection 2: Content-Length 413 must not invoke AI
  const reqBlocked413 = new NextRequest("http://localhost:3000/api/attack-strategy", {
    method: "POST",
    headers: { "x-real-ip": "spy-ip-2", "content-length": "20000000", "content-type": "application/json" },
    body: JSON.stringify({ screenshot: "valid", townHall: 14 }),
  });
  await handleAttackStrategy(reqBlocked413, mockSpyGenerate as any);
  t("zero-egress proof: 413 oversized Content-Length NEVER calls generateStrategy", spyGenerateCalls === 0);

  // Rejection 3: Malformed JSON 400 must not invoke AI
  const reqBlocked400 = new NextRequest("http://localhost:3000/api/attack-strategy", {
    method: "POST",
    headers: { "x-real-ip": "spy-ip-3", "content-type": "application/json" },
    body: "broken json {",
  });
  await handleAttackStrategy(reqBlocked400, mockSpyGenerate as any);
  t("zero-egress proof: 400 malformed JSON NEVER calls generateStrategy", spyGenerateCalls === 0);

  // Rejection 4: Invalid Town Hall 400 must not invoke AI
  const reqBlockedTh = new NextRequest("http://localhost:3000/api/attack-strategy", {
    method: "POST",
    headers: { "x-real-ip": "spy-ip-4", "content-type": "application/json" },
    body: JSON.stringify({ screenshot: "data:image/png;base64," + "A".repeat(15000), townHall: 99 }),
  });
  await handleAttackStrategy(reqBlockedTh, mockSpyGenerate as any);
  t("zero-egress proof: 400 invalid Town Hall NEVER calls generateStrategy", spyGenerateCalls === 0);

  // Valid request: Passes all guards and invokes mockGenerate (proves spy is hooked and working!)
  const reqValidAllowed = new NextRequest("http://localhost:3000/api/attack-strategy", {
    method: "POST",
    headers: { "x-real-ip": "spy-ip-5", "content-type": "application/json" },
    body: JSON.stringify({ screenshot: "data:image/png;base64," + "A".repeat(15000), townHall: 14 }),
  });
  const resValidAllowed = await handleAttackStrategy(reqValidAllowed, mockSpyGenerate as any);
  t("zero-egress proof: valid request cleanly invokes mock generateFn exactly once", spyGenerateCalls === 1);
  t("zero-egress proof: mock generateFn response returns HTTP 200 with mock strategy", resValidAllowed.status === 200);

  // SEC-01: Trusted proxy and spoofing defenses
  const reqSpoofedDirect = new Request("http://origin:3000", {
    headers: { "cf-connecting-ip": "1.1.1.1", "x-real-ip": "198.51.100.77" },
  });
  t("getClientIp: untrusted direct connection rejects forged CF-Connecting-IP", getClientIp(reqSpoofedDirect) === "198.51.100.77");

  const reqCfEdge = new Request("https://clashplanner.xyz", {
    headers: { "cf-connecting-ip": "203.0.113.55", "x-real-ip": "162.158.1.9" },
  });
  t("getClientIp: verified Cloudflare edge IP extracts authentic client IP", getClientIp(reqCfEdge) === "203.0.113.55");

  // =========================================================================
  // 2. SEC-02: Streaming Body Size Limits, Malformed JSON, & Screenshot Caps
  // =========================================================================
  console.log("\n--- 2. SEC-02: Streaming Body Limits & Malformed Inputs ---");

  // Fast pre-check: Content-Length > MAX_PAYLOAD_BYTES returns 413 immediately
  const reqOversizedContentLength = new NextRequest("http://localhost:3000/api/attack-strategy", {
    method: "POST",
    headers: {
      "content-length": String(MAX_PAYLOAD_BYTES + 1024),
      "content-type": "application/json",
    },
    body: JSON.stringify({ test: "data" }),
  });
  const resContentLength = await readJsonBodyWithLimit(reqOversizedContentLength, MAX_PAYLOAD_BYTES);
  t("readJsonBodyWithLimit: oversized Content-Length returns status 413", !resContentLength.ok && resContentLength.status === 413);
  t("readJsonBodyWithLimit: 413 error message mentions MB cap", !resContentLength.ok && /Request payload too large/i.test(resContentLength.error));

  // Chunked stream exceeding MAX_PAYLOAD_BYTES triggers reader.cancel() and returns 413
  const chunkSize = 64 * 1024; // 64 KB chunks
  const chunkData = new Uint8Array(chunkSize).fill(65); // 'A'
  let cancelled = false;
  let chunksRead = 0;

  const oversizedStream = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunksRead++;
      controller.enqueue(chunkData);
      if (chunksRead > 200) { // > 12.8 MB
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  const reqStreamingOversized = new NextRequest("http://localhost:3000/api/attack-strategy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: oversizedStream,
  });

  const resStreaming = await readJsonBodyWithLimit(reqStreamingOversized, MAX_PAYLOAD_BYTES);
  t("readJsonBodyWithLimit: chunked stream exceeding 10MB returns 413", !resStreaming.ok && resStreaming.status === 413);
  t("readJsonBodyWithLimit: aborted stream triggers reader.cancel()", cancelled);

  // Malformed JSON returns 400
  const reqMalformed = new NextRequest("http://localhost:3000/api/attack-strategy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{\"broken\": incomplete json...",
  });
  const resMalformed = await readJsonBodyWithLimit(reqMalformed, MAX_PAYLOAD_BYTES);
  t("readJsonBodyWithLimit: malformed JSON returns status 400", !resMalformed.ok && resMalformed.status === 400);
  t("readJsonBodyWithLimit: malformed JSON returns controlled error message", !resMalformed.ok && resMalformed.error === "Invalid JSON body.");

  // Empty body returns 400
  const reqEmpty = new NextRequest("http://localhost:3000/api/attack-strategy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "   ",
  });
  const resEmpty = await readJsonBodyWithLimit(reqEmpty, MAX_PAYLOAD_BYTES);
  t("readJsonBodyWithLimit: empty whitespace body returns 400", !resEmpty.ok && resEmpty.status === 400);

  // Valid JSON parse within limits succeeds
  const reqValid = new NextRequest("http://localhost:3000/api/attack-strategy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ screenshot: "valid", townHall: 15 }),
  });
  const resValid = await readJsonBodyWithLimit(reqValid, MAX_PAYLOAD_BYTES);
  t("readJsonBodyWithLimit: valid JSON payload parses successfully", resValid.ok && resValid.body.townHall === 15);

  // Route-level screenshot length enforcement: screenshot.length > MAX_SCREENSHOT_CHARS returns 413
  resetRateLimit();
  // Screenshot is 8.5MB (exceeds 8MB screenshot limit but fits within 10MB streaming limit)
  const oversizedScreenshot = "data:image/png;base64," + "A".repeat(8.5 * 1024 * 1024);
  const reqScreenshotLimit = new NextRequest("http://localhost:3000/api/attack-strategy", {
    method: "POST",
    headers: {
      "x-real-ip": "198.51.100.90",
      "content-type": "application/json",
    },
    body: JSON.stringify({ screenshot: oversizedScreenshot, townHall: 14 }),
  });
  const resScreenshotLimit = await attackStrategyPost(reqScreenshotLimit);
  t("route: screenshot length > 8MB returns HTTP 413", resScreenshotLimit.status === 413);
  const dataScreenshot = await resScreenshotLimit.json();
  t("route: 413 error message specifies 8MB limit", /Screenshot exceeds maximum supported size \(8MB\)/i.test(dataScreenshot.error));

  // =========================================================================
  // 3. SEC-03: Production Debug Route & Layout Script Gating
  // =========================================================================
  console.log("\n--- 3. SEC-03: Debug Route & Telemetry Script Gating ---");

  const envObj = process.env as Record<string, string | undefined>;
  const originalEnv = envObj.NODE_ENV;
  try {
    // Test production mode behavior
    envObj.NODE_ENV = "production";

    const prodGetRes = await debugGet();
    t("debug route: GET returns 404 in production", prodGetRes.status === 404);
    const prodGetData = await prodGetRes.json();
    t("debug route: GET 404 returns disabled message", prodGetData.error === "Debug endpoint disabled in production.");

    const dummyDebugReq = new NextRequest("http://localhost:3000/api/debug", {
      method: "POST",
      body: JSON.stringify({ error: "test client error" }),
    });
    const prodPostRes = await debugPost(dummyDebugReq);
    t("debug route: POST returns 404 in production", prodPostRes.status === 404);
    const prodPostData = await prodPostRes.json();
    t("debug route: POST 404 returns disabled message", prodPostData.error === "Debug endpoint disabled in production.");

    // Test development mode behavior
    envObj.NODE_ENV = "development";
    const devGetRes = await debugGet();
    t("debug route: GET returns 200 in development", devGetRes.status === 200);
    const devGetData = await devGetRes.json();
    t("debug route: GET 200 returns active message in dev", devGetData.msg === "debug endpoint active (dev only)");

    const devPostRes = await debugPost(dummyDebugReq);
    t("debug route: POST returns 200 in development", devPostRes.status === 200);
  } finally {
    envObj.NODE_ENV = originalEnv;
  }

  // =========================================================================
  // 4. SEC-05: Response Headers & Server Information Disclosure
  // =========================================================================
  console.log("\n--- 4. SEC-05: Security Headers & Server Hardening ---");
  const config = (nextConfig as unknown as { default?: unknown }).default || nextConfig;
  t("nextConfig: poweredByHeader is false", (config as { poweredByHeader: boolean }).poweredByHeader === false);
  const headerRules = await (config as { headers: () => Promise<Array<{ source: string; headers: Array<{ key: string; value: string }> }>> }).headers();
  const rootRule = headerRules.find((r: { source: string }) => r.source === "/:path*");
  t("nextConfig: headers rule for /:path* is configured", rootRule !== undefined);

  if (rootRule) {
    const headerMap = new Map(rootRule.headers.map((h: { key: string; value: string }) => [h.key.toLowerCase(), h.value]));
    t("nextConfig: X-Content-Type-Options is nosniff", headerMap.get("x-content-type-options") === "nosniff");
    t("nextConfig: X-Frame-Options is SAMEORIGIN", headerMap.get("x-frame-options") === "SAMEORIGIN");
    t("nextConfig: Referrer-Policy is strict-origin-when-cross-origin", headerMap.get("referrer-policy") === "strict-origin-when-cross-origin");
    t("nextConfig: Permissions-Policy restricts sensitive APIs", headerMap.has("permissions-policy"));
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log("\n=================================================");
  console.log(`SECURITY TESTS SUMMARY: ${pass} PASSED, ${fail} FAILED`);
  console.log("=================================================");

  if (fail > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Unhandled test suite exception:", err);
  process.exit(1);
});
