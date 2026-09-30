import type { GameData } from "./staticData";
import type {
  Category,
  RawEntry,
  RawExport,
  SlimEntity,
  Village,
} from "./types";

export const TOWN_HALL_ID = 1000001;
export const BUILDER_HALL_ID = 1000034;

/**
 * The building each village is gated on. Builder Base has its own Town Hall —
 * the Builder Hall — and treating it as an ordinary building meant Builder Base
 * plans never gave it Town Hall priority, and the "include the Town Hall"
 * toggle silently didn't apply there at all.
 */
export function townHallIdFor(village: Village): number {
  return village === "builderBase" ? BUILDER_HALL_ID : TOWN_HALL_ID;
}

export interface ParsedEntry {
  uid: number;
  id: number;
  name: string;
  level: number;
  count: number;
  timer?: number;
  /**
   * Set on a Home Village building that has been geared up by the Master
   * Builder. Levels alone cannot say whether a gear-up has been performed — the
   * building keeps the level the gear-up asked for — so this flag is the only
   * thing that tells a finished gear-up from one that is merely ready.
   */
  gearUp?: number;
  village: Village;
  category: Category;
  entity: SlimEntity | null;
}

export interface ParsedVillage {
  tag: string | null;
  timestamp: number | null;
  townHallLevel: number | null;
  builderHallLevel: number | null;
  entries: ParsedEntry[];
}

interface Group {
  key: keyof RawExport;
  category: Category;
  village: Village;
}

// Home village and Builder Base (the "2"-suffixed arrays) share the same
// numeric ID space; the static data's `village` field disambiguates.
const GROUPS: Group[] = [
  { key: "buildings", category: "building", village: "home" },
  { key: "traps", category: "trap", village: "home" },
  { key: "units", category: "troop", village: "home" },
  { key: "siege_machines", category: "siege", village: "home" },
  { key: "heroes", category: "hero", village: "home" },
  { key: "spells", category: "spell", village: "home" },
  { key: "pets", category: "pet", village: "home" },
  { key: "equipment", category: "equipment", village: "home" },
  { key: "helpers", category: "helper", village: "home" },
  { key: "guardians", category: "guardian", village: "home" },
  { key: "buildings2", category: "building", village: "builderBase" },
  { key: "traps2", category: "trap", village: "builderBase" },
  { key: "units2", category: "troop", village: "builderBase" },
  { key: "heroes2", category: "hero", village: "builderBase" },
];

export function parseExport(raw: RawExport, data: GameData): ParsedVillage {
  const entries: ParsedEntry[] = [];
  let uid = 0;

  for (const g of GROUPS) {
    const arr = raw[g.key] as RawEntry[] | undefined;
    if (!arr) continue;
    for (const e of arr) {
      const entity = data.get(e.data) ?? null;
      entries.push({
        uid: uid++,
        id: e.data,
        name: entity?.name ?? `Unknown #${e.data}`,
        level: e.lvl ?? 1,
        count: e.cnt ?? 1,
        timer: e.timer,
        gearUp: e.gear_up,
        village: g.village,
        category: g.category,
        entity,
      });
    }
  }

  const th = raw.buildings?.find((b) => b.data === TOWN_HALL_ID);
  const bh = raw.buildings2?.find((b) => b.data === BUILDER_HALL_ID);

  return {
    tag: raw.tag ?? null,
    timestamp: raw.timestamp ?? null,
    townHallLevel: th?.lvl ?? null,
    builderHallLevel: bh?.lvl ?? null,
    entries,
  };
}
