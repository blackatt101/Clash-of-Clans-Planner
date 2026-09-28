export type Village = "home" | "builderBase";

/**
 * What an upgrade IS, for colouring: the seven families the planner shows.
 * Lives here rather than with the colours so `schedule.ts` can carry a family on
 * a job without importing anything that depends on it.
 */
export type Family =
  | "hero"
  | "trap"
  | "buildings"
  | "resource"
  | "defense"
  | "army"
  | "spell";

export type Category =
  | "building"
  | "trap"
  | "troop"
  | "hero"
  | "spell"
  | "pet"
  | "equipment"
  | "helper"
  | "siege";

export interface OreCost {
  shiny_ore?: number;
  glowy_ore?: number;
  starry_ore?: number;
}

export type Cost = number | OreCost;

export interface SlimLevel {
  l: number;
  cost: Cost | null;
  time: number | null;
  th?: number;
  lab?: number;
  bs?: number;
  ph?: number;
}

export interface SlimEntity {
  _id: number;
  name: string;
  village?: Village;
  type?: string;
  resource?: string;
  rarity?: string;
  hero?: string;
  flying?: boolean;
  /**
   * Which slim data file this entity was read from ("troops", "spells", …),
   * stamped in by `GameData.load`. The source data leaves `type` empty for
   * every non-building entity, so the file — not a gate-column guess — is what
   * says whether an entity is a troop, a spell, a pet, a hero, equipment, a
   * trap or a helper.
   */
  fromFile?: string;
  levels: SlimLevel[];
}

export interface SlimFile {
  items: SlimEntity[];
}

export interface RawEntry {
  data: number;
  lvl?: number;
  cnt?: number;
  timer?: number;
  weapon?: number;
  gear_up?: number;
  extra?: boolean;
}

export interface RawExport {
  tag?: string;
  timestamp?: number;
  helpers?: RawEntry[];
  buildings?: RawEntry[];
  traps?: RawEntry[];
  units?: RawEntry[];
  siege_machines?: RawEntry[];
  heroes?: RawEntry[];
  spells?: RawEntry[];
  pets?: RawEntry[];
  equipment?: RawEntry[];
  buildings2?: RawEntry[];
  traps2?: RawEntry[];
  units2?: RawEntry[];
  heroes2?: RawEntry[];
}
