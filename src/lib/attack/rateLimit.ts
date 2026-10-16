/**
 * Sliding-window rate limiter for attack strategy API requests.
 *
 * ARCHITECTURAL CONSTRAINTS & BEHAVIOR:
 * 1. Process-Local State: This rate limiter is strictly in-memory per Node.js process.
 *    State resets on service restart, and multiple Node instances maintain separate pools.
 *    (For distributed multi-instance deployments, use an external shared KV store such as Redis).
 *    Do not assume distributed synchronization across multiple instances.
 * 2. Strictly Bounded Memory: A hard capacity ceiling (MAX_TRACKED_IPS = 10,000) is enforced.
 *    If capacity is exhausted under a sustained distributed unique-IP flood, new untracked IPs
 *    are rejected (fail closed) to protect against memory exhaustion without allowing unmetered
 *    calls to reach external AI providers.
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

interface WindowRecord {
  timestamps: number[];
}

const windows = new Map<string, WindowRecord>();
export const MAX_TRACKED_IPS = 10_000;
let lastPrune = Date.now();

/**
 * Returns current count of tracked client IPs (for testing and diagnostics).
 */
export function getTrackedIpCount(): number {
  return windows.size;
}

/**
 * Prunes expired timestamps and inactive IPs from the tracker.
 */
export function pruneStale(now: number, windowMs: number, force = false): void {
  // Only prune at most once every 30 seconds unless map exceeds threshold or forced
  if (!force && now - lastPrune < 30_000 && windows.size < MAX_TRACKED_IPS) return;
  lastPrune = now;

  for (const [ip, record] of windows.entries()) {
    record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);
    if (record.timestamps.length === 0) {
      windows.delete(ip);
    }
  }
}

/**
 * Checks whether a given client key (typically an IP) is within rate limits.
 *
 * @param key Identifier for the client (IP address)
 * @param limit Maximum requests allowed within windowMs (default: 5)
 * @param windowMs Time window in milliseconds (default: 60,000 ms = 1 min)
 * @param maxTrackedIps Maximum allowed active unique client keys (default: 10,000)
 * @param now Current timestamp in ms (default: Date.now())
 */
export function checkRateLimit(
  key: string,
  limit = 5,
  windowMs = 60_000,
  maxTrackedIps = MAX_TRACKED_IPS,
  now = Date.now(),
): RateLimitResult {
  pruneStale(now, windowMs);

  let record = windows.get(key);
  if (!record) {
    if (windows.size >= maxTrackedIps) {
      // Memory safety defense: Fail closed when tracking capacity is saturated
      // under sustained unique-IP traffic. Rejects unmetered entry rather than
      // failing open or permitting unbounded RAM growth.
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetMs: windowMs,
      };
    }
    record = { timestamps: [] };
    windows.set(key, record);
  }

  // Filter timestamps outside current window
  record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);

  if (record.timestamps.length >= limit) {
    const oldest = record.timestamps[0];
    const resetMs = Math.max(0, windowMs - (now - oldest));
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetMs,
    };
  }

  record.timestamps.push(now);
  const oldest = record.timestamps[0];
  const resetMs = Math.max(0, windowMs - (now - oldest));

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - record.timestamps.length),
    resetMs,
  };
}

/**
 * Resets the rate limit for a specific key (primarily for tests).
 */
export function resetRateLimit(key?: string): void {
  if (key) {
    windows.delete(key);
  } else {
    windows.clear();
  }
}

/**
 * Official Cloudflare IPv4 CIDR blocks.
 * Used to verify whether the incoming reverse proxy peer ($remote_addr / X-Real-IP)
 * is legitimately an authorized Cloudflare edge node.
 */
const CLOUDFLARE_IPV4_CIDRS: [string, number][] = [
  ["173.245.48.0", 20],
  ["103.21.244.0", 22],
  ["103.22.200.0", 22],
  ["103.31.4.0", 22],
  ["141.101.64.0", 18],
  ["108.162.192.0", 18],
  ["190.93.240.0", 20],
  ["188.114.96.0", 20],
  ["197.234.240.0", 22],
  ["198.41.128.0", 17],
  ["162.158.0.0", 15],
  ["104.16.0.0", 13],
  ["104.24.0.0", 14],
  ["172.64.0.0", 13],
  ["131.0.72.0", 22],
];

/** Official Cloudflare IPv6 CIDR blocks. */
const CLOUDFLARE_IPV6_CIDRS: [string, number][] = [
  ["2400:cb00::", 32],
  ["2606:4700::", 32],
  ["2803:f800::", 32],
  ["2405:b500::", 32],
  ["2405:8100::", 32],
  ["2a06:98c0::", 29], // Exact /29 subnet matching
  ["2c0f:f248::", 32],
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let res = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    res = (res << 8) | n;
  }
  return res >>> 0;
}

function isIpv4InCidr(ipInt: number, cidrIp: string, prefixLen: number): boolean {
  const cidrInt = ipv4ToInt(cidrIp);
  if (cidrInt === null) return false;
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (ipInt & mask) === (cidrInt & mask);
}

function ipv6ToBigInt(ip: string): bigint | null {
  const clean = ip.trim().toLowerCase();
  const parts = clean.split("::");
  if (parts.length > 2) return null;

  const parseHextets = (s: string): number[] | null => {
    if (!s) return [];
    const hex = s.split(":");
    const out: number[] = [];
    for (const h of hex) {
      if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
      out.push(parseInt(h, 16));
    }
    return out;
  };

  if (parts.length === 1) {
    const hextets = parseHextets(parts[0]);
    if (!hextets || hextets.length !== 8) return null;
    let val = BigInt(0);
    for (const h of hextets) {
      val = (val << BigInt(16)) | BigInt(h);
    }
    return val;
  }

  const left = parseHextets(parts[0]);
  const right = parseHextets(parts[1]);
  if (!left || !right) return null;
  if (left.length + right.length >= 8) return null;

  const middleCount = 8 - (left.length + right.length);
  const allHextets = [...left, ...new Array(middleCount).fill(0), ...right];
  let val = BigInt(0);
  for (const h of allHextets) {
    val = (val << BigInt(16)) | BigInt(h);
  }
  return val;
}

function isIpv6InCidr(ipBigInt: bigint, cidrIp: string, prefixLen: number): boolean {
  const cidrBigInt = ipv6ToBigInt(cidrIp);
  if (cidrBigInt === null) return false;
  const shift = BigInt(128 - prefixLen);
  const mask =
    shift >= BigInt(128)
      ? BigInt(0)
      : ((BigInt(1) << BigInt(128)) - BigInt(1)) ^
        ((BigInt(1) << shift) - BigInt(1));
  return (ipBigInt & mask) === (cidrBigInt & mask);
}

/**
 * Normalizes an IP string: strips IPv4-mapped IPv6 prefixes (::ffff:x.x.x.x) and trims whitespace.
 */
export function normalizeIp(ip: string): string {
  let clean = ip.trim().toLowerCase();
  if (clean.startsWith("::ffff:")) {
    clean = clean.slice(7);
  }
  return clean;
}

/**
 * Checks whether an IP belongs to Cloudflare's public edge network or local loopback.
 */
export function isCloudflareOrLocalIp(ip: string): boolean {
  const clean = normalizeIp(ip);
  if (clean === "127.0.0.1" || clean === "::1" || clean === "localhost") {
    return true;
  }

  // IPv6 check
  if (clean.includes(":")) {
    const bigInt = ipv6ToBigInt(clean);
    if (bigInt === null) return false;
    return CLOUDFLARE_IPV6_CIDRS.some(([cidrIp, prefixLen]) =>
      isIpv6InCidr(bigInt, cidrIp, prefixLen),
    );
  }

  // IPv4 check
  const intVal = ipv4ToInt(clean);
  if (intVal === null) return false;
  return CLOUDFLARE_IPV4_CIDRS.some(([cidrIp, prefixLen]) =>
    isIpv4InCidr(intVal, cidrIp, prefixLen),
  );
}

/**
 * Extracts client IP securely based on the deployment architecture:
 * Cloudflare Proxy -> Nginx -> Next.js on single VPS.
 *
 * Security considerations:
 * 1. In Nginx: `proxy_set_header X-Real-IP $remote_addr;` guarantees that X-Real-IP
 *    is the direct TCP peer of Nginx.
 * 2. If CF-Connecting-IP is present:
 *    We ONLY trust CF-Connecting-IP when X-Real-IP is verified to be present AND belongs
 *    to an authorized Cloudflare edge IP (or local loopback in dev/tests).
 *    If X-Real-IP is absent (e.g. direct connection to port 3000 bypassing Nginx) or
 * 3. If X-Real-IP is present but not from Cloudflare, it is the direct remote address
 *    captured by Nginx ($remote_addr) and is used directly.
 * 4. X-Forwarded-For is UNTRUSTED when X-Real-IP is absent because the request did
 *    not pass through our verified reverse proxy. Direct requests without verified
 *    proxy headers must never trust client-supplied headers (CF-Connecting-IP or
 *    X-Forwarded-For) and safely fall back to loopback ("127.0.0.1") to prevent
 *    rate-limit IP spoofing / rotation attacks.
 */
export function getClientIp(req: Request): string {
  const rawCfIp = req.headers.get("cf-connecting-ip");
  const rawRealIp = req.headers.get("x-real-ip");

  const cfIp = rawCfIp ? normalizeIp(rawCfIp) : null;
  const realIp = rawRealIp ? normalizeIp(rawRealIp) : null;

  // 1. CF-Connecting-IP is ONLY trusted if X-Real-IP exists and is verified to be
  // from a legitimate Cloudflare edge IP (or loopback in local development/tests).
  if (cfIp && realIp && isCloudflareOrLocalIp(realIp)) {
    return cfIp;
  }

  // 2. If X-Real-IP is present (set by Nginx from $remote_addr), use it.
  if (realIp) {
    return realIp;
  }

  // 3. Fallback when request did not arrive through a verified reverse proxy:
  // Do NOT trust client-supplied headers (X-Forwarded-For, CF-Connecting-IP).
  return "127.0.0.1";
}
