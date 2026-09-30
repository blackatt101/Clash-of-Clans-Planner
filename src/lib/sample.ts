// A small sample "Data Export" so people can try the tool without the game.
export const SAMPLE_EXPORT = JSON.stringify(
  {
    tag: "#SAMPLE123",
    timestamp: 1789646143,
    buildings: [
      { data: 1000001, lvl: 14 },
      { data: 1000008, lvl: 15, cnt: 6 },
      { data: 1000000, lvl: 8, cnt: 4 },
      { data: 1000002, lvl: 13, cnt: 7 },
      { data: 1000015, lvl: 4, cnt: 5 },
    ],
    traps: [{ data: 12000000, lvl: 5, cnt: 6 }],
    units: [
      { data: 4000000, lvl: 7 },
      { data: 4000006, lvl: 6 },
    ],
    heroes: [
      { data: 28000000, lvl: 40 },
      { data: 28000001, lvl: 38 },
    ],
    spells: [{ data: 26000000, lvl: 8 }],
    siege_machines: [{ data: 4000051, lvl: 2 }],
    pets: [{ data: 73000000, lvl: 5 }],
    equipment: [{ data: 90000000, lvl: 9 }],
    // Guardians: TH18-only, defensive companion units
    guardians: [
      { data: 107000000, lvl: 2 }, // Longshot
      { data: 107000001, lvl: 1 }, // Smasher
    ],
    // The Builder Base half is a real base, not just a Builder Hall: buildings
    // the export does not list read as "not built" there (see `unlockOptions` in
    // upgrade.ts), so a one-building sample would be offered the whole rulebook
    // as things to build. Copied the way the game lists them, too — one row per
    // copy of a building, and `cnt` only where the game itself counts in batches
    // (walls, traps).
    buildings2: [
      { data: 1000034, lvl: 7 }, // Builder Hall
      { data: 1000078, lvl: 1 }, // O.T.T.O's Outpost (2nd builder, from BH6)
      { data: 1000046, lvl: 5 }, // Star Laboratory
      { data: 1000039, lvl: 3 }, // Clock Tower
      { data: 1000040, lvl: 5 }, // Builder Barracks
      { data: 1000036, lvl: 4 }, // Elixir Storage
      { data: 1000036, lvl: 4 },
      { data: 1000038, lvl: 4 }, // Gold Storage
      { data: 1000038, lvl: 4 },
      { data: 1000035, lvl: 5, cnt: 2 }, // Elixir Collector
      { data: 1000037, lvl: 5, cnt: 2 }, // Gold Mine
      { data: 1000058, lvl: 2 }, // Gem Mine
      { data: 1000044, lvl: 4, cnt: 2 }, // Cannon
      { data: 1000041, lvl: 3 }, // Double Cannon
      { data: 1000048, lvl: 4, cnt: 2 }, // Archer Tower
      { data: 1000043, lvl: 3 }, // Hidden Tesla
      { data: 1000050, lvl: 2 }, // Firecrackers
      { data: 1000045, lvl: 3 }, // Multi Mortar
      { data: 1000055, lvl: 2 }, // Crusher
      { data: 1000054, lvl: 2 }, // Air Bombs
      { data: 1000051, lvl: 1 }, // Guard Post
      { data: 1000033, lvl: 5, cnt: 60 }, // Wall
    ],
    traps2: [
      { data: 12000011, lvl: 3, cnt: 6 }, // Push Trap
      { data: 12000010, lvl: 3, cnt: 4 }, // Spring Trap
      { data: 12000013, lvl: 3, cnt: 4 }, // Mine
      { data: 12000014, lvl: 2, cnt: 2 }, // Mega Mine
    ],
    units2: [
      { data: 4000031, lvl: 8 }, // Raged Barbarian
      { data: 4000032, lvl: 6 }, // Sneaky Archer
      { data: 4000033, lvl: 5 }, // Beta Minion
      { data: 4000035, lvl: 6 }, // Bomber
      { data: 4000041, lvl: 5 }, // Baby Dragon
    ],
    heroes2: [{ data: 28000003, lvl: 15 }],
  },
  null,
  2,
);
