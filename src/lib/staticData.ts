import type { SlimEntity, SlimFile, SlimLevel } from "./types";

const FILES = [
  "buildings",
  "troops",
  "heroes",
  "spells",
  "pets",
  "equipment",
  "traps",
  "helpers",
] as const;

/**
 * Infer which village an entity belongs to, using the same ID-range logic as
 * inferVillage in gameLogic.ts. This handles spells, pets, equipment, and
 * helpers whose static data files have no `village` field.
 */
export function inferEntityVillage(entity: SlimEntity): "home" | "builderBase" | undefined {
  if (entity.village) return entity.village;
  const id = entity._id;
  if (id >= 26000000 && id < 27000000) return "home"; // spells (heroes live at 28M+)
  if (id >= 73000000 && id < 74000000) return "home"; // pets
  if (id >= 90000000 && id < 91000000) return "home"; // equipment
  if (id >= 93000000 && id < 94000000) return "home"; // helpers
  return undefined;
}

/**
 * In-memory index of the (slimmed) game "rulebook" data, keyed by Supercell
 * numeric entity ID — the same IDs used by the in-game "Data Export" JSON.
 *
 * PERFORMANCE FIX: Also builds `byVillage` indexes (home/builderBase) at load
 * time so that unlockOptions and computeMissingBuildings can iterate a village's
 * entities via Map iteration in O(village_entities) instead of filtering the
 * full O(all_entities) scan on every call. This is critical because computeUpgrades
 * is called on every state change, and previously unlockOptions + missingBuildings
 * each did a full O(274) scan per village.
 */
export class GameData {
  byId = new Map<number, SlimEntity>();
  images: Record<string, string> = {};
  /** Pre-built index: village → array of entities belonging to that village. */
  byVillage: { home: SlimEntity[]; builderBase: SlimEntity[] } = { home: [], builderBase: [] };

  static async load(): Promise<GameData> {
    const gd = new GameData();
    const results = await Promise.all(
      FILES.map(async (f) => {
        const res = await fetch(`/data/${f}.json`);
        if (!res.ok) throw new Error(`Failed to load /data/${f}.json`);
        return (await res.json()) as SlimFile;
      }),
    );
    for (const [i, file] of results.entries()) {
      const fromFile = FILES[i];
      for (const item of file.items) {
        if (!gd.byId.has(item._id)) {
          const stamped: SlimEntity = { ...item, fromFile };
          gd.byId.set(item._id, stamped);
          // Index by village using ID-range inference for entities without village field
          const v = inferEntityVillage(stamped);
          if (v === "home") gd.byVillage.home.push(stamped);
          else if (v === "builderBase") gd.byVillage.builderBase.push(stamped);
        }
      }
    }
    try {
      const imgRes = await fetch("/data/images.json");
      if (imgRes.ok) gd.images = (await imgRes.json()) as Record<string, string>;
    } catch {
      gd.images = {};
    }
    return gd;
  }

  image(id: number): string | undefined {
    return this.images[String(id)];
  }

  get(id: number): SlimEntity | undefined {
    return this.byId.get(id);
  }

  level(e: SlimEntity, level: number): SlimLevel | undefined {
    return e.levels.find((l) => l.l === level);
  }

  /** Absolute maximum level across all Town Hall / Builder Hall levels. */
  maxLevel(e: SlimEntity): number {
    return e.levels[e.levels.length - 1]?.l ?? 0;
  }

  /** Maximum level reachable at a given Town Hall / Builder Hall level. */
  maxLevelAt(e: SlimEntity, villageLevel: number): number {
    let max = 0;
    for (const lv of e.levels) {
      if ((lv.th ?? 0) <= villageLevel) max = lv.l;
      else break;
    }
    return max;
  }
}
