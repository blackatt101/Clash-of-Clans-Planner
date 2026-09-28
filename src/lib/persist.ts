import type { RawExport, Village } from "./types";
import { normaliseSettings, type PlannerSettings } from "./settings";

/**
 * The village you last loaded, kept on this device.
 *
 * Pasting a Data Export is the price of admission to this app, and the export
 * itself never goes stale — it is a snapshot of a village, and a village only
 * changes when the player plays. Not keeping it meant every reload, every
 * closed tab and every crash cost another trip through the game's settings
 * menu. So the whole session is written down: the export, the plan, the
 * settings and which tab was open.
 *
 * It is localStorage, not a server: nothing leaves the device. That also makes
 * it disposable — clearing it costs one paste, which is exactly what the
 * "Forget" button is for, and a record that fails to read is deleted rather
 * than guessed at (a half-written record would otherwise mean a plan built
 * from a village the player does not have).
 *
 * Precedence on load: an explicit share link in the URL wins, then this, then
 * the bundled sample. A link is a deliberate act; the cache is a convenience.
 */
const KEY = "clash-max:village";

/**
 * Bump when the record's shape changes. Older records are dropped rather than
 * migrated — re-pasting is cheap, and a stale record is a silent wrong plan.
 */
const VERSION = 1;

export interface SavedVillage {
  version: number;
  savedAt: number; // epoch ms, for the "saved on this device" note
  export: RawExport;
  planned: number[];
  settings: PlannerSettings;
  village: Village;
}

/** The saved session, or null if there is none (or it cannot be trusted). */
export function loadSavedVillage(): SavedVillage | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<SavedVillage>;
    if (!o || !o.export || typeof o.export !== "object") {
      clearSavedVillage();
      return null;
    }
    // No hard version gate: settings are re-normalised from scratch below, so a
    // record written by an older build still gives its village back — only a
    // record whose export is unreadable is discarded, not one whose settings
    // drifted out of date.
    return {
      version: VERSION,
      savedAt: typeof o.savedAt === "number" ? o.savedAt : 0,
      export: o.export as RawExport,
      // Settings are normalised the same way a share link's are, so a
      // hand-edited or older record can never hand the planner a bad field.
      settings: normaliseSettings(o.settings),
      planned: Array.isArray(o.planned)
        ? o.planned.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
        : [],
      village: o.village === "builderBase" ? "builderBase" : "home",
    };
  } catch {
    clearSavedVillage();
    return null;
  }
}

export function saveVillage(
  v: Omit<SavedVillage, "version" | "savedAt">,
): number | null {
  const savedAt = Date.now();
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ version: VERSION, savedAt, ...v }));
    return savedAt;
  } catch {
    // Private mode, or the quota is full (an export can be a fair few KB). The
    // planner works fine without the cache; it just costs a paste next time.
    return null;
  }
}

export function clearSavedVillage(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do — there is no cache to be rid of */
  }
}
