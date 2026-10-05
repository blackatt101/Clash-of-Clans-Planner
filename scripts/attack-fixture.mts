/**
 * A realistic TH15 queen-charge-hybrid plan used by the render
 * verification scripts. The miner group is split into two consecutive
 * steps on purpose: the validator must merge it into one "Miner ×15"
 * marker, and the path/spell step references must survive the remap.
 * User-facing text is Bahasa Indonesia (the planner spec §19), exactly
 * as the prompt now demands.
 * Exported raw (pre-validation) — feed it through validateStrategy.
 */
export const fixture = {
  strategy: {
    name: "Queen Charge Hybrid (Lalo)",
    type: "queen-charge-hybrid",
    difficulty: "medium",
    summary: "Queen berjalan di barat, Balloon + Hog Rider menembus core dari selatan.",
    reason:
      "Queen Charge Hybrid dipilih karena sisi barat memberi Queen akses langsung ke Clan Castle dan compartment barat, sementara bagian selatan memungkinkan Hog Rider dan Balloon masuk ke core tanpa memutar terlalu jauh. Eagle Artillery timur laut berada di jalur pasukan udara sehingga dapat dihancurkan saat hybrid menembus core.",
  },
  candidate_strategies: [
    {
      id: "queen-charge-hybrid",
      name: "Queen Charge Hybrid",
      fit_score: 0.86,
      strengths: [
        "Sisi barat terbuka: Queen bisa berjalan langsung ke Clan Castle tanpa melewati pertahanan berat.",
        "Eagle Artillery timur laut berada di jalur alami pasukan udara dari selatan.",
        "Funnel barat cukup lebar, jadi pathing hybrid dapat diprediksi.",
      ],
      weaknesses: [
        "Inferno barat laut bisa mengenai Queen selama charge — butuh Rage tepat waktu.",
      ],
      selected: true,
    },
    {
      id: "lavaloon",
      name: "Lavaloon",
      fit_score: 0.52,
      strengths: [
        "Air Defense selatan terjangkau dari funnel barat.",
      ],
      weaknesses: [
        "Air Sweeper selatan menjangkau jalur Lalo dan memaksa Lava Hound memutar ke timur.",
        "Scattershot tenggara berada tepat di jalur Balloon menuju core.",
      ],
      selected: false,
      rejected_reason:
        "Ditolak karena Air Sweeper selatan dan Scattershot tenggara membuat pathing Lalo tidak dapat diprediksi; serangan ini butuh funnel sempurna yang tidak dimiliki base ini.",
    },
    {
      id: "super-archer-blimp",
      name: "Super Archer Blimp",
      fit_score: 0.44,
      strengths: [
        "Blimp bisa melewati dinding barat tanpa membuka funnel terlebih dahulu.",
      ],
      weaknesses: [
        "Eagle Artillery timur laut menjangkau area pendaratan blimp.",
        "Tanpa Queen Charge, compartment barat tetap tertutup dan Super Archer terpecah.",
      ],
      selected: false,
      rejected_reason:
        "Ditolak karena Eagle Artillery menjangkau area pendaratan dan tidak ada Queen Charge yang membuka compartment barat lebih dulu.",
    },
  ],
  army: {
    troops: [
      { id: "miner", count: 15, purpose: "Tekanan darat utama sekaligus membuka funnel compartment barat" },
      { id: "hog-rider", count: 10, purpose: "Menembus ring selatan dan mengikuti celah ke core" },
      { id: "balloon", count: 6, purpose: "Pasukan udara utama penghancur pertahanan udara" },
      { id: "healer", count: 8, purpose: "Menjaga Balloon tetap hidup saat menembus core" },
    ],
    spells: [
      { id: "healing-spell", count: 3, purpose: "Menjaga pasukan udara di bawah Scattershot" },
      { id: "rage-spell", count: 2, purpose: "Menjaga Queen saat charge dan mempercepat pasukan udara di core" },
      { id: "poison-spell", count: 1, purpose: "Membunuh pasukan Clan Castle saat muncul" },
    ],
    siege_machine: { id: "siege-barracks", purpose: "Membuka funnel barat dan menambah pasukan di depan Hybrid" },
    clan_castle: [{ id: "miner", count: 8, purpose: "Memperkuat funnel barat bersama Miner army" }],
  },
  base_analysis: {
    townHallLevel: 15,
    townHallPosition: { x: 0.5, y: 0.42 },
    townHallWeapon: "unknown",
    clanCastlePosition: { x: 0.42, y: 0.5 },
    baseShape: "ring",
    structuralTraits: [
      "ring base",
      "centralized Town Hall",
      "exposed eagle artillery (north-east)",
      "dense core",
      "strong single-entry side (west)",
    ],
    keyDefenses: [
      { type: "eagle_artillery", position: { x: 0.55, y: 0.45 }, threat: "high" },
      { type: "inferno", position: { x: 0.45, y: 0.38 }, threat: "high" },
      { type: "scattershot", position: { x: 0.6, y: 0.55 }, threat: "high" },
      { type: "air_defense", position: { x: 0.7, y: 0.4 }, threat: "high" },
      { type: "clan_castle", position: { x: 0.42, y: 0.5 }, threat: "medium" },
    ],
    pathingNotes:
      "Deploy Queen di barat daya → Miner membuka funnel barat → Queen berjalan ke barat dan mengambil Clan Castle → Hog Rider masuk dari selatan mengikuti celah ring → Balloon dan Healer mengikuti jalur yang sama ke core → Royal Champion membersihkan sisa di timur laut. Risiko utama: Miner bisa tertarik ke selatan jika funnel tidak rapat.",
    importantTargets: [
      { type: "eagle_artillery", position: { x: 0.55, y: 0.45 }, priority: "high", confidence: 0.9 },
      { type: "inferno", position: { x: 0.45, y: 0.38 }, priority: "high", confidence: 0.85 },
      { type: "scattershot", position: { x: 0.6, y: 0.55 }, priority: "medium", confidence: 0.8 },
      { type: "x_bow", position: { x: 0.35, y: 0.6 }, priority: "medium", confidence: 0.7 },
      { type: "air_defense", position: { x: 0.7, y: 0.4 }, priority: "high", confidence: 0.9 },
      { type: "clan_castle", position: { x: 0.42, y: 0.5 }, priority: "medium", confidence: 0.95 },
    ],
    entryPoints: [
      {
        position: { x: 0.2, y: 0.82 },
        reason: "Celah barat daya adalah funnel terlebar dan memberi akses langsung ke compartment barat.",
        reachableDefenses: "Cannon barat, dinding barat, Clan Castle",
        heroAccess: "Queen bisa berjalan ke Clan Castle dan Inferno barat laut dari sini.",
        risk: "Rendah — celah lebar dan hanya satu compartment yang harus dilalui sebelum core.",
      },
    ],
    funnels: [
      { position: { x: 0.27, y: 0.73 }, purpose: "Miner menyegel compartment barat agar Hybrid tidak tertarik ke selatan" },
    ],
  },
  deployment_plan: [
    { step: 1, phase: "queen-charge", unit: "archer-queen", count: 1, position: { x: 0.18, y: 0.8 }, target: "compartment barat", purpose: "Berjalan di tepi barat dan mengambil pull Clan Castle." },
    { step: 2, phase: "funnel", unit: "miner", count: 5, position: { x: 0.25, y: 0.72 }, target: "funnel barat daya", purpose: "Menyegel compartment barat menuju core." },
    { step: 3, phase: "funnel", unit: "miner", count: 10, position: { x: 0.28, y: 0.75 }, target: "funnel barat daya", purpose: "Melanjutkan funnel dari selatan." },
    { step: 4, phase: "main-entry", unit: "hog-rider", count: 10, position: { x: 0.5, y: 0.92 }, target: "pertahanan selatan", purpose: "Menghancurkan ring selatan menuju core." },
    { step: 5, phase: "main-entry", unit: "balloon", count: 6, position: { x: 0.55, y: 0.9 }, target: "pertahanan udara", purpose: "Pasukan udara utama menargetkan Air Defense." },
    { step: 6, phase: "core", unit: "healer", count: 8, position: { x: 0.6, y: 0.92 }, target: "core", purpose: "Menjaga pasukan udara tetap hidup sampai ke core." },
    { step: 7, phase: "cleanup", unit: "royal-champion", count: 1, position: { x: 0.4, y: 0.3 }, target: "sisa timur laut", purpose: "Membersihkan sisa timur laut dan berburu hero musuh." },
  ],
  heroes: [
    { id: "archer-queen", use: true, role: "queen-charge", reason: "Melalui compartment barat dan mengambil pull Clan Castle sebelum pasukan utama masuk." },
    { id: "royal-champion", use: true, role: "cleanup", reason: "Membersihkan sisa timur laut dan berburu hero musuh begitu core runtuh." },
    { id: "barbarian-king", use: false, role: null, reason: "Funnel Miner sudah menyegel compartment barat; King hanya akan menggandakan nilai funnel Queen." },
    { id: "grand-warden", use: false, role: null, reason: "Pasukan udara sudah dijaga 8 Healer sampai ke core; aura Warden melindungi pasukan yang sudah tercakup." },
    { id: "minion-prince", use: false, role: null, reason: "Tidak ada compartment udara tunggal yang bisa di-storm — Air Defense menyebar, jadi charge Prince menambah sedikit dibanding layar Balloon." },
    { id: "dragon-duke", use: false, role: null, reason: "Pasukan udara sudah mengandalkan dukungan Warden dan layar Balloon; hero udara kedua menambah sedikit tanpa compartment udara kedua untuk di-storm." },
  ],
  paths: [
    { step: 1, unit: "archer-queen", points: [{ x: 0.18, y: 0.8 }, { x: 0.2, y: 0.62 }, { x: 0.3, y: 0.55 }], style: "attack" },
    { step: 3, unit: "miner", points: [{ x: 0.28, y: 0.75 }, { x: 0.35, y: 0.65 }], style: "funnel" },
    { step: 4, unit: "hog-rider", points: [{ x: 0.5, y: 0.92 }, { x: 0.5, y: 0.7 }, { x: 0.5, y: 0.5 }], style: "attack" },
    { step: 5, unit: "balloon", points: [{ x: 0.55, y: 0.9 }, { x: 0.6, y: 0.65 }, { x: 0.7, y: 0.42 }], style: "attack" },
    { step: 7, unit: "royal-champion", points: [{ x: 0.4, y: 0.3 }, { x: 0.6, y: 0.25 }], style: "cleanup" },
  ],
  spell_actions: [
    { step: 5, spell: "rage-spell", position: { x: 0.62, y: 0.6 }, trigger: "Saat Balloon melewati Air Defense", purpose: "Mempercepat pasukan udara menembus core." },
    { step: 6, spell: "healing-spell", position: { x: 0.55, y: 0.5 }, trigger: "Saat hybrid mencapai core", purpose: "Menjaga Balloon tetap hidup di bawah Scattershot." },
    { step: 7, spell: "poison-spell", position: { x: 0.42, y: 0.5 }, trigger: "Saat pasukan Clan Castle muncul", purpose: "Membunuh lure Clan Castle." },
  ],
  hero_abilities: [
    { hero: "archer-queen", trigger: "Saat Queen mencapai compartment yang berisi Eagle", purpose: "Menembus zona kill barat." },
    { hero: "royal-champion", trigger: "Saat Champion dikelilingi di timur laut", purpose: "Membersihkan dan berburu hero musuh." },
  ],
  attack_phases: [
    { name: "queen-charge", description: "Queen berjalan di tepi barat." },
    { name: "funnel", description: "Miner menyegel compartment barat." },
    { name: "main-entry", description: "Hog Rider dan Balloon masuk dari selatan." },
    { name: "core", description: "Pasukan udara runtuh ke core." },
    { name: "cleanup", description: "Champion membersihkan timur laut." },
  ],
  confidence: { base_analysis: 0.9, strategy_selection: 0.87, army_composition: 0.84, deployment: 0.79 },
};
