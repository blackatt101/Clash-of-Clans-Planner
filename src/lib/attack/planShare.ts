/**
 * Save/share for attack plans. Same conventions as the planner's village
 * cache (persist.ts) and share links (share.ts): localStorage on this device
 * for saving, a base64url fragment for sharing.
 *
 * A shared link carries the strategy JSON + Town Hall but NOT the base
 * screenshot — a multi-MB image doesn't belong in a URL. Recipients re-upload
 * the same base to see the visual plan; the strategy sections work alone.
 */
import type { AttackStrategy } from "./types";

const KEY = "clash-max:attack-plan";
const VERSION = 1;

export interface SavedAttackPlan {
  version: number;
  savedAt: number;
  screenshot: string; // data URL
  townHall: number;
  strategy: AttackStrategy;
}

export function saveAttackPlan(
  plan: Omit<SavedAttackPlan, "version" | "savedAt">,
): number | null {
  const savedAt = Date.now();
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ version: VERSION, savedAt, ...plan }),
    );
    return savedAt;
  } catch {
    // Screenshot data URLs can exceed quota in private mode. The plan still
    // works; saving just fails silently, like the village cache.
    try {
      window.localStorage.setItem(
        KEY,
        JSON.stringify({ version: VERSION, savedAt, ...plan, screenshot: "" }),
      );
    } catch {
      /* give up quietly */
    }
    return null;
  }
}

export function loadAttackPlan(): SavedAttackPlan | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<SavedAttackPlan>;
    if (!o || typeof o !== "object" || !o.strategy || !Array.isArray((o.strategy as AttackStrategy).deployment_plan)) {
      clearAttackPlan();
      return null;
    }
    return {
      version: VERSION,
      savedAt: typeof o.savedAt === "number" ? o.savedAt : 0,
      screenshot: typeof o.screenshot === "string" ? o.screenshot : "",
      townHall: typeof o.townHall === "number" ? o.townHall : 15,
      strategy: o.strategy as AttackStrategy,
    };
  } catch {
    clearAttackPlan();
    return null;
  }
}

export function clearAttackPlan(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/* -------------------------------------------------------------------------- */
/* Share links — strategy only, no screenshot                                */
/* -------------------------------------------------------------------------- */

function toBase64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(b: string): string {
  const bin = atob(b.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodePlanShare(
  strategy: AttackStrategy,
  townHall: number,
): string {
  return toBase64url(JSON.stringify({ app: "clash-max-attack", v: VERSION, th: townHall, strategy }));
}

/** Parse a share fragment written by encodePlanShare, or null. */
export function decodePlanShare(hash: string): { strategy: AttackStrategy; townHall: number } | null {
  try {
    const obj = JSON.parse(fromBase64url(hash)) as Record<string, unknown>;
    if (obj.app !== "clash-max-attack" || !obj.strategy) return null;
    const s = obj.strategy as AttackStrategy;
    if (!Array.isArray(s.deployment_plan)) return null;
    // Re-validate on load — a link is user-editable.
    // (The validator is lazy-imported by the caller; a structurally sane
    //  plan is enough here.)
    return {
      strategy: s,
      townHall: typeof obj.th === "number" ? obj.th : 15,
    };
  } catch {
    return null;
  }
}
