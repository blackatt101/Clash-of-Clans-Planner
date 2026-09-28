import { normaliseSettings, type PlannerSettings } from "./settings";
import type { RawExport, Village } from "./types";

export interface ShareState {
  export: RawExport;
  planned: number[]; // entry uids
  settings: PlannerSettings;
  /**
   * Which village the sender was looking at. A plan is per-village — the
   * Builder Base half of a link is invisible from the Home Village tab — so the
   * link has to say, or the recipient opens a Builder Base plan on the wrong
   * tab and reads it as empty. Links made before this field existed default to
   * "home", which is what they meant.
   */
  village: Village;
}

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

export function encodeState(state: ShareState): string {
  return toBase64url(JSON.stringify(state));
}

/**
 * Older links stored the sleep window as a single `settings.sleep` object and,
 * before that, a bare top-level `builders` number. Fold both into the current
 * shape so a link saved last week still opens with the same schedule.
 */
function migrate(obj: Record<string, unknown>): unknown {
  const settings = obj.settings;
  if (settings && typeof settings === "object") {
    const s = settings as Record<string, unknown>;
    if (!s.blocks && s.sleep && typeof s.sleep === "object") {
      const { start, end } = s.sleep as { start?: unknown; end?: unknown };
      if (typeof start === "number" && typeof end === "number") {
        s.blocks = [{ id: "sleep", label: "Sleep", start, end, days: [] }];
      }
    }
    delete s.sleep;
    return s;
  }
  return { builders: obj.builders };
}

export function decodeState(hash: string): ShareState | null {
  try {
    const obj = JSON.parse(fromBase64url(hash));
    if (!obj || typeof obj !== "object" || !obj.export) return null;
    return {
      export: obj.export,
      planned: Array.isArray(obj.planned) ? obj.planned : [],
      settings: normaliseSettings(migrate(obj)),
      village: obj.village === "builderBase" ? "builderBase" : "home",
    };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Settings-only export / import                                               */
/* -------------------------------------------------------------------------- */

export interface SettingsFile {
  app: "clash-max";
  version: 1;
  settings: PlannerSettings;
}

export function exportSettings(settings: PlannerSettings): string {
  const file: SettingsFile = { app: "clash-max", version: 1, settings };
  return JSON.stringify(file, null, 2);
}

/**
 * Parse an exported settings file. Accepts either the wrapper written by
 * `exportSettings` or a bare settings object, so a user can hand-edit one.
 */
export function importSettings(text: string): PlannerSettings {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("Not a settings file.");
  const o = parsed as Record<string, unknown>;
  const body = o.app === "clash-max" ? o.settings : parsed;
  return normaliseSettings(body);
}
