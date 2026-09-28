"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameData } from "@/lib/staticData";
import { parseExport, townHallIdFor, type ParsedEntry, type ParsedVillage } from "@/lib/parse";
import { computeUpgrades, inFlightOption, type UpgradeOption } from "@/lib/upgrade";
import { formatNumber } from "@/lib/format";
import { resourceClass } from "@/lib/resourceColor";
import { decodeState, encodeState, type ShareState } from "@/lib/share";
import { clearSavedVillage, loadSavedVillage, saveVillage } from "@/lib/persist";
import {
  scheduleJobs,
  type HeroChainSpec,
  type ScheduleJob,
  type ScheduleResult,
} from "@/lib/schedule";
import { jobKind, priorityFor, type Strategy } from "@/lib/strategy";
import {
  DEFAULT_SETTINGS,
  DEFAULT_UPGRADE_ORDER,
  MAX_HERO_LANES,
  type HeroSchedule,
  type PlannerSettings,
} from "@/lib/settings";
import { effectiveCost, effectiveTime } from "@/lib/discounts";
import { FAMILY_COLORS } from "@/lib/categoryColor";
import {
  familyOf,
  focusBoost,
  focusedHeroes,
  groupKey,
  GROUP_LABELS,
  heroCap,
  HOME_HERO_FOCUS,
  orderedGroups,
  PET_FOCUS,
  upgradeOrderBoost,
} from "@/lib/priorityOrder";
import { labPriorityBoost } from "@/lib/labPriority";
import { weightBoost } from "@/lib/offense";
import {
  bbHeroTotal,
  bbDefenseTarget,
  bbRushBoost,
  bobComplete,
  bobMilestones,
  detectBbBuilders,
  BB_DEFENSE_OPTIONS,
  levelOf,
} from "@/lib/bbRush";
import { scheduleBobGoal, type BobGoalResult } from "@/lib/bbGoal";
import { formatTime } from "@/lib/format";
import { SAMPLE_EXPORT } from "@/lib/sample";
import type { ModalKey } from "@/lib/modals";
import type { RawExport, Village } from "@/lib/types";
import Header from "@/components/Header";
import ImportPanel from "@/components/ImportPanel";
import UpgradeList from "@/components/UpgradeList";
import ScheduleSettings from "@/components/ScheduleSettings";
import Schedule from "@/components/Schedule";
import ShareMenu from "@/components/ShareMenu";
import Onboarding from "@/components/Onboarding";
import OffensePercentages from "@/components/OffensePercentages";
import PriorityEditor, { type PriorityItem } from "@/components/PriorityEditor";
import NewUnlockablesNotification from "@/components/NewUnlockablesNotification";

const BUILDER_HUT_ID = 1000015;
const BOB_HUT_ID = 1000064; // B.O.B's Hut — the 6th builder
const ONBOARDED_KEY = "clash-max:onboarded";

/**
 * The top of a hero's level chain a village can reach today, read off the
 * rulebook: the highest level whose row asks for no higher Town Hall / Builder
 * Hall than the village has. This replaces a hard-coded per-TH hero cap (which
 * did not exist in the game — a Barbarian King at TH11 is not stopped at 50 by
 * anything): each level row carries its own gate, and the chain simply climbs
 * until the next row's gate is a level the village does not have yet.
 */
function heroChainCeiling(
  entity: { levels: { l: number; th?: number }[] },
  villageLevel: number | null,
): number {
  if (villageLevel == null) return 0;
  let last = 0;
  for (const row of entity.levels) {
    const needTh = row.th ?? 0;
    if (needTh <= villageLevel) last = row.l;
    else break;
  }
  return last;
}

/**
 * Live upgrades get their own uid space so a timeline bar for the upgrade
 * currently running can't collide with the plannable follow-up for the same
 * entry (which shares the entry's uid).
 */
const IN_FLIGHT_UID_BASE = 1_000_000;

/** O.T.T.O's Outpost needs this Builder Hall level, so it is the 2nd BB builder. */
const BB_OUTPOST_BUILDER_HALL = 6;
const BB_BUILDER_HALL_ID = 1000034;

/** Hero equipment is bought with ore and finishes instantly — no builder. */
const UNSCHEDULED_CATEGORIES = new Set(["equipment"]);

/**
 * parse it, or refuse it — never throw.
 *
 * `parseExport` walks the export's arrays, so JSON that is merely *shaped* like
 * a Data Export still throws on the way in: `{"tag":"#X","buildings":5}` passes
 * the "looks like an export" check and then dies on `for (const e of arr)`, as
 * does a single null in an array. All three places that take text from outside
 * this app — the paste box, a share link, the saved session — come through here,
 * so the worst case is a message the user can act on instead of a handler that
 * blows up half-way through loading a village.
 */
function safeParseExport(raw: RawExport, data: GameData): ParsedVillage | null {
  try {
    return parseExport(raw, data);
  } catch {
    return null;
  }
}

/**
 * Builder count from the export: one per Builder Hut, plus one when B.O.B's Hut
 * is present. The 6th builder comes from B.O.B's Hut, not a sixth Builder Hut,
 * so counting huts alone under-reports any player who has unlocked it.
 */
function detectBuilders(pv: ParsedVillage): number {
  const owned = new Set(pv.entries.map((e) => e.id));
  const huts = pv.entries.find((e) => e.id === BUILDER_HUT_ID && e.village === "home")?.count ?? 0;
  if (huts < 1) return DEFAULT_SETTINGS.builders;
  return Math.min(6, huts + (owned.has(BOB_HUT_ID) ? 1 : 0));
}

/** One editor row per distinct entity — an entry can repeat when it's upgrading. */
function toItems(entries: ParsedEntry[], images: Record<string, string>): PriorityItem[] {
  const seen = new Set<number>();
  const out: PriorityItem[] = [];
  for (const e of entries) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push({
      key: String(e.id),
      name: e.name,
      image: images[String(e.id)],
      note: `Lv ${e.level}`,
    });
  }
  return out;
}

const fmtDateTime = (ms: number) =>
  new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/** A date without a time — for goals that are weeks out, where the hour is noise. */
const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

/** Plain-text build order, for pasting into clan chat or Discord. */
function scheduleToText(
  schedule: ScheduleResult,
  nowEpochMs: number,
  details: Map<number, UpgradeOption>,
): string {
  const finish = new Date(nowEpochMs + schedule.makespan * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const lines = [
    "Clash Max — build plan",
    `Total ${formatTime(schedule.makespan)} · finishes ${finish}`,
    "",
  ];
  for (const lane of schedule.lanes) {
    if (lane.jobs.length === 0) continue;
    lines.push(`${lane.label}:`);
    for (const j of lane.jobs) {
      const d = details.get(j.uid);
      const level = d ? `${d.currentLevel}→${d.nextLevel}` : "";
      const timing = j.inProgress
        ? `${formatTime(j.duration)} left`
        : `${formatTime(j.duration)} starting ${fmtDateTime(nowEpochMs + j.start * 1000)}`;
      lines.push(`  ${j.name} ${level} · ${timing}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/**
 * How many heroes may be upgrading at the same time.
 *
 * "Keep 1 hero available" is a *concurrency* rule, not a rule about which
 * heroes get upgraded: every hero still gets its levels eventually, but the
 * schedule never has more than this many of them in a builder at once, so the
 * rest are ready to attack with. Reading it as "only plan this many heroes"
 * (which an earlier version did) meant the two things the setting promises —
 * keep a hero free, and upgrade every hero — could not both be true.
 */
function heroConcurrencyLimit(
  heroSchedule: HeroSchedule,
  totalHeroes: number,
): number {
  return heroCap(heroSchedule, totalHeroes);
}

/**
 * How many heroes a village has — the denominator of "keep N available".
 *
 * Counted from the export's entries, not from the upgrade options: an option
 * only exists for a hero with a level left to buy, so a maxed hero vanished from
 * the count and from the promise with it. A maxed hero is the *most* available
 * one there is, so on an account with one and two others "keep 1" was computed
 * out of two heroes instead of three and kept none.
 */
function heroCount(parsed: ParsedVillage | null, village: Village): number {
  if (!parsed) return 0;
  return parsed.entries.filter((e) => e.village === village && e.category === "hero").length;
}

/** Every upgrade that can start now, so the timeline is visible on load. */
function planAllAvailable(
  pv: ParsedVillage,
  gameData: GameData,
  settings: PlannerSettings,
): Set<number> {
  const set = new Set<number>();
  const opts = computeUpgrades(pv, gameData);
  for (const o of opts) {
    if (!o.available) continue;
    if (UNSCHEDULED_CATEGORIES.has(o.category)) continue;
    if (o.category === "hero") {
      // Every hero is planned; how many may run at once is the scheduler's job
      // (see `heroConcurrencyLimit`). "No hero upgrades" is the one setting that
      // keeps them out of the plan entirely, and it is not village-specific —
      // it is one setting, so it means no heroes anywhere.
      if (settings.heroSchedule !== "none") set.add(o.uid);
      continue;
    }
    if (o.id === townHallIdFor(o.village) && !settings.includeTh) continue;
    set.add(o.uid);
  }
  return set;
}

export default function Home() {
  const [gameData, setGameData] = useState<GameData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedVillage | null>(null);
  // The pre-paste village snapshot the "new unlockables" banner diffs against.
  // Captured in the paste event handler (before `parsed` is replaced) and read
  // as plain state at the render call site — no refs in the render body.
  const [previousParsed, setPreviousParsed] = useState<ParsedVillage | null>(null);
  const [rawExport, setRawExport] = useState<RawExport | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [village, setVillage] = useState<Village>("home");
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);
  const [planned, setPlanned] = useState<Set<number>>(new Set());
  const [settings, setSettings] = useState<PlannerSettings>(DEFAULT_SETTINGS);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [isSample, setIsSample] = useState(false);
  /** When the saved session was last written, or null if nothing is saved. */
  const [savedAt, setSavedAt] = useState<number | null>(null);
  /** Set by "forget", so the cache is not quietly rewritten behind the user. */
  const [noCache, setNoCache] = useState(false);

  // "Link copied!" is news, not a status line. Nothing used to clear it, so it
  // stayed pinned under the plan for the rest of the session — including a
  // *failure* message, which then read as a permanent error. Every write goes
  // through this timer instead of a bare setShareMsg.
  useEffect(() => {
    if (shareMsg === null) return;
    const id = setTimeout(() => setShareMsg(null), 5000);
    return () => clearTimeout(id);
  }, [shareMsg]);

  // Dialogs behave like a stack: an editor opened from Strategy Setup replaces
  // it, and closing returns you to the dialog you came from.
  const [modalStack, setModalStack] = useState<ModalKey[]>([]);
  const modal = modalStack[modalStack.length - 1] ?? null;
  const pushModal = useCallback((key: ModalKey) => setModalStack((s) => [...s, key]), []);
  const popModal = useCallback(() => setModalStack((s) => s.slice(0, -1)), []);

  useEffect(() => {
    GameData.load()
      .then(setGameData)
      .catch((e) => setLoadError("Failed to load game data: " + String(e)));
  }, []);

  // Show the walkthrough on a first visit, but never again unprompted.
  // NOTE: do NOT auto-open the modal — it places a full-screen backdrop (z-40)
  // over the whole app, which blocks every click on the UI underneath until the
  // user dismisses it. On a fresh visit that is indistinguishable from "the site
  // is broken", since only the top header buttons (higher z) remain responsive.
  // The walkthrough is reachable from the "?" Help button instead.
  //
  // Also: the restore-once gate. The effect below re-runs whenever `rawExport`
  // is written (restore itself writes it), and each re-run re-reads the device
  // cache and calls setVillage with whatever the cache says. The cache is
  // written on every village switch, debounced 600ms, so the sequence
  // "click Builder Base → switch takes effect → the pending debounced write
  // from when the user was still on Home lands" would bounce the view back to
  // the tab the cache last held — which is exactly the "I have to click the
  // tab many times" symptom. A module-scope flag restores on first load only;
  // a later re-mount (rare) falls through to the cache path below, which is
  // still correct, just not repeated mid-session.

  const dismissOnboarding = useCallback(() => {
    window.localStorage.setItem(ONBOARDED_KEY, "1");
    popModal();
  }, [popModal]);

  // Restore the village to plan, once data is ready, in order of how deliberate
  // it was: an explicit share link in the URL, then the session saved on this
  // device, then the bundled sample so the planner is never empty on a first
  // visit. A share link is consumed (the hash is cleared) so a reload of that
  // tab falls through to whatever the user does next, not to the old link.
  //
  // This effect is a ONE-TIME restore, and that has to be enforced: the
  // dependencies include `rawExport`, which the effect itself writes (restore
  // sets it from the cache or share link), so on the very next render the effect
  // re-runs and — without the guard — would re-read the cache and re-apply the
  // cached `village`, undoing whatever the user has since done. The save effect
  // below writes the cache on every village switch (debounced 600ms), so the
  // concrete symptom is: click "Builder Base" → the tab switch lands → but the
  // pending restore/write still holds "home" in the cache → view bounces back,
  // and only after a few clicks does the settled cache win. `didRestore` makes
  // the restore happen on first load only, and stay out of the user's way
  // afterwards.
  const didRestore = useRef(false);
  useEffect(() => {
    if (!gameData) return;
    if (didRestore.current) return; // restored on first load; never again
    // Both the hash and the cache are text this app did not write this session,
    // so both go through safeParseExport: a source that will not parse is
    // dropped rather than half-honoured, and a bad one cannot kill the page on
    // every reload.
    //
    // This is a one-time external-data sync (URL / device cache → initial
    // village) — the rule's legitimate use case, not derived-state re-seeding.
    const hash = window.location.hash.slice(1);
    if (hash) {
      const state = decodeState(hash);
      const pv = state ? safeParseExport(state.export, gameData) : null;
      if (state && pv) {
        didRestore.current = true;
        setRawExport(state.export);
        setParsed(pv);
        setPlanned(new Set(state.planned));
        setSettings({ ...state.settings, builders: detectBuilders(pv) });
        setVillage(state.village);
        setIsSample(false);
        window.location.hash = "";
        return;
      }
      // A link that decodes but will not parse is a broken link, not a village:
      // clear it so the address bar stops claiming otherwise, and fall through.
      if (state) window.location.hash = "";
    }
    const saved = loadSavedVillage();
    const savedPv = saved ? safeParseExport(saved.export, gameData) : null;
    if (saved && savedPv) {
      didRestore.current = true;
      setRawExport(saved.export);
      setParsed(savedPv);
      setPlanned(new Set(saved.planned));
      // The saved settings are kept as they were, builder count included: they
      // are this device's own state, not somebody else's link.
      setSettings(saved.settings);
      setVillage(saved.village);
      setSavedAt(saved.savedAt);
      setIsSample(false);
      return;
    }
    if (saved) clearSavedVillage(); // unreadable, so it is not kept
    didRestore.current = true;
    const sample = JSON.parse(SAMPLE_EXPORT) as RawExport;
    const pv = parseExport(sample, gameData);
    setRawExport(sample);
    setParsed(pv);
    setPlanned(planAllAvailable(pv, gameData, DEFAULT_SETTINGS));
    setSettings({ ...DEFAULT_SETTINGS, builders: detectBuilders(pv) });
    setIsSample(true);
  }, [gameData]);


  // Keep that session on this device. Debounced, because settings write on every
  // slider tick and the export can be tens of KB — the point is to land on the
  // settled state, not to write once per pixel of drag.
  //
  // The sample is deliberately never saved: it is not the user's village, and
  // storing it would bury both the landing panel and the user's own saved
  // village under demo data the first time they press "Try sample data".
  useEffect(() => {
    if (!rawExport || isSample || noCache) return;
    const id = setTimeout(() => {
      setSavedAt(
        saveVillage({ export: rawExport, planned: [...planned], settings, village }),
      );
    }, 600);
    return () => clearTimeout(id);
  }, [rawExport, planned, settings, village, isSample, noCache]);

  /**
   * Forget the device copy — and keep it forgotten.
   *
   * Clearing storage alone would be theatre: this effect writes on the next
   * settings change, so the village would quietly come back the moment the user
   * touched a slider. The flag holds the door shut until a new village is loaded
   * on purpose, which is the only unambiguous sign that keeping it is wanted.
   */
  const forgetSaved = useCallback(() => {
    clearSavedVillage();
    setSavedAt(null);
    setNoCache(true);
  }, []);

  // Turning hero upgrades off takes the planned heroes back out of the plan,
  // and turning it back on puts back exactly the ones it took out — so the
  // setting is reversible. Only those: a hero cleared by hand stays cleared,
  // because a setting must not quietly re-plan things the user removed
  // themselves. Turning the concurrency limit down moves nothing at all: those
  // heroes stay planned, they just stop running two at a time.
  const heroSchedule = settings.heroSchedule;
  const silencedHeroes = useRef<Set<number>>(new Set());
  // The plan as it is right now, for an effect that must read it without
  // re-running when it changes. This effect reacts to the *setting*, not to the
  // plan: re-running it on every plan edit would mean "no hero upgrades" also
  // undid a hero the user had just clicked — the mirror image of the rule above.
  const plannedRef = useRef(planned);
  useEffect(() => {
    plannedRef.current = planned;
  }, [planned]);
  useEffect(() => {
    if (!parsed || !gameData) return;
    const heroes = computeUpgrades(parsed, gameData).filter((o) => o.category === "hero");
    // The bookkeeping happens here and not inside the state updater below:
    // React may call an updater twice for the same `prev` (StrictMode does it on
    // purpose in development), and a ref mutated in there would be cleared by
    // the first call and read as empty by the second — so the restore would
    // silently do nothing.
    const current = plannedRef.current;
    if (heroSchedule === "none") {
      const doomed = heroes.filter((o) => current.has(o.uid));
      if (doomed.length === 0) return;
      for (const o of doomed) silencedHeroes.current.add(o.uid);
      setPlanned((prev) => {
        const next = new Set(prev);
        for (const o of doomed) next.delete(o.uid);
        return next;
      });
      return;
    }
    if (silencedHeroes.current.size === 0) return;
    const restore = heroes.filter(
      (o) => o.available && silencedHeroes.current.has(o.uid) && !current.has(o.uid),
    );
    silencedHeroes.current = new Set();
    if (restore.length === 0) return;
    setPlanned((prev) => {
      const next = new Set(prev);
      for (const o of restore) next.add(o.uid);
      return next;
    });
  }, [heroSchedule, parsed, gameData]);

  // The concurrency limit the schedule is built with, from the same options the
  // plan is drawn from — counted from the heroes of the village being viewed,
  // so "keep 1 available" means one of *these* heroes stays free.
  const heroLimit = useMemo(() => {
    if (!parsed) return undefined;
    return heroConcurrencyLimit(settings.heroSchedule, heroCount(parsed, village));
  }, [parsed, settings.heroSchedule, village]);

  const handleParse = useCallback(
    (
      text: string,
      /**
       * The bundled sample, loaded by a button rather than pasted. The two must
       * be told apart here because this is the one place that decides "this is
       * the user's own village": the sample must never be written to the device
       * cache, and it must never displace the village already saved there.
       */
      isBuiltinSample = false,
    ) => {
      if (!text.trim()) {
        setParsed(null);
        setRawExport(null);
        setPlanned(new Set());
        setParseError(null);
        return;
      }
      if (!gameData) {
        setParseError("Game data still loading…");
        return;
      }
      let raw: RawExport;
      try {
        raw = JSON.parse(text) as RawExport;
      } catch {
        // A rejected paste leaves the village that is already open alone. It
        // used to blank it, which dropped the user back on the landing panel —
        // offering "Try sample data", which would then overwrite the village
        // still sitting in the cache, all because of one bad paste.
        setParseError('Invalid JSON — paste the full "Data Export" text.');
        return;
      }
      if (
        !raw ||
        typeof raw !== "object" ||
        (!Array.isArray(raw.buildings) && !raw.tag)
      ) {
        setParseError("This doesn't look like a CoC Data Export.");
        return;
      }
      const pv = safeParseExport(raw, gameData);
      if (!pv) {
        setParseError("This doesn't look like a CoC Data Export.");
        return;
      }
      setPreviousParsed(parsed); // Store the previous parsed state
      setParseError(null);
      setRawExport(raw);
      setParsed(pv);
      setPlanned(planAllAvailable(pv, gameData, settings));
      setSettings((s) => ({ ...s, builders: detectBuilders(pv) }));
      setIsSample(isBuiltinSample);
      // Pasting a village by hand is a clear "yes, keep this" — it also undoes
      // a forget. Loading the sample says nothing of the sort, so it must not
      // touch the flag: the cache holds the sample only until the user pastes.
      if (!isBuiltinSample) setNoCache(false);
    },
    [gameData, settings, parsed],
  );

  const upgrades = useMemo(
    () => (parsed && gameData ? computeUpgrades(parsed, gameData) : []),
    [parsed, gameData],
  );

  const optionById = useMemo(
    () => new Map<number, UpgradeOption>(upgrades.map((o) => [o.uid, o])),
    [upgrades],
  );

  // Upgrades already running, from the export's live `timer`. Keyed in their own
  // uid space and given their own detail rows, so a bar for work in flight never
  // resolves to the follow-up upgrade of the same entry.
  const inProgress = useMemo<ScheduleJob[]>(() => {
    if (!parsed) return [];
    return parsed.entries
      .filter(
        (e) =>
          e.village === village &&
          e.entity &&
          e.timer &&
          e.timer > 0,
      )
      .map((e) => ({
        uid: IN_FLIGHT_UID_BASE + e.uid,
        name: e.name,
        duration: e.timer as number,
        // The entry's real category, not a placeholder: the scheduler reads it
        // to decide which upgrades are heroes, and a running hero that is not
        // recognisable as one escapes the "keep N available" limit — the plan
        // would start four heroes at once on an account that asked to keep one
        // free. Nothing in the views keys off it (they use `inProgress` and
        // `family`), so this is the only thing the string has to be true for.
        category: e.category,
        kind: jobKind(e.category),
        levelFrom: e.level,
        levelTo: e.level + 1,
        count: e.count,
        // The entity, so the B.O.B goal planner can tell what is running from
        // what is merely planned. Nothing in the views reads it.
        entityId: e.id,
        // Same family rule as the planned jobs, so a running upgrade is the same
        // colour before and after it finishes.
        family: familyOf(e.category, e.entity, e.id === townHallIdFor(e.village)),
      }));
  }, [parsed, village, settings.builderBaseStrategy]);

  const inFlightDetails = useMemo(() => {
    const m = new Map<number, UpgradeOption>();
    if (!parsed || !gameData) return m;
    for (const e of parsed.entries) {
      if (e.village !== village || !e.entity || !e.timer || e.timer <= 0) continue;
      const o = inFlightOption(e, gameData);
      if (o) m.set(IN_FLIGHT_UID_BASE + e.uid, o);
    }
    return m;
  }, [parsed, gameData, village, settings.builderBaseStrategy]);

  // Both maps together, for tooltips and lane lists.
  const allDetails = useMemo(() => {
    const m = new Map<number, UpgradeOption>(optionById);
    for (const [uid, o] of inFlightDetails) m.set(uid, o);
    return m;
  }, [optionById, inFlightDetails]);

  const timerByUid = useMemo(
    () =>
      new Map<number, number>(
        parsed
          ? parsed.entries
              .filter((e) => e.timer && e.timer > 0)
              .map((e) => [e.uid, e.timer as number])
          : [],
      ),
    [parsed],
  );

  // B.O.B rush context for Builder Base scheduling.
  const bbHeroTotalVal = useMemo(
    () => (parsed ? bbHeroTotal(parsed.entries) : 0),
    [parsed],
  );
  const bbDefenseId = useMemo(
    () =>
      parsed
        ? bbDefenseTarget(
            parsed.entries,
            settings.bbDefense,
            gameData ? { get: (id) => gameData.get(id) } : undefined,
          )
        : BB_DEFENSE_OPTIONS[0].id,
    [parsed, settings.bbDefense, gameData],
  );

  // The moment "now" is for the plan: the export's own timestamp, so a plan
  // built from a saved export starts where that export was taken rather than at
  // whatever time the page happens to finish loading. When there is no export
  // (or no timestamp on it) the fallback is "when the page loaded", captured
  // once via a lazy state initializer so the memo never calls an impure
  // function during render.
  const [pageLoadEpochMs] = useState(() => Date.now());
  const nowEpochMs = useMemo(
    () => (rawExport?.timestamp ? rawExport.timestamp * 1000 : pageLoadEpochMs),
    [rawExport, pageLoadEpochMs],
  );

  // Builder Base builders, read off the export: the Master Builder, O.T.T.O
  // (who arrives with Builder Hall 6) and B.O.T.O (bought with gems). None of
  // the three is a number the game reports, so the buildings that bring them
  // are what gets counted — and the setting can override the reading, for an
  // export that leaves the hut out.
  const bbBuildersDetected = useMemo(
    () =>
      parsed
        ? detectBbBuilders(parsed.entries)
        : { total: 1, outpostOwned: false, botoOwned: false },
    [parsed],
  );
  const effectiveBuilders =
    village === "builderBase"
      ? settings.bbBuilders === "auto"
        ? bbBuildersDetected.total
        : settings.bbBuilders
      : settings.builders;

  const milestones = useMemo(
    () => (parsed ? bobMilestones(parsed.entries, settings, bbDefenseId) : []),
    [parsed, settings, bbDefenseId],
  );
  const bobDoneCount = milestones.filter((m) => m.done).length;
  const bobDone = bobComplete(milestones);
  // Below Builder Hall 6 the Builder Base has no second builder at all.
  const bbOutpostPending = (parsed?.builderHallLevel ?? 0) < BB_OUTPOST_BUILDER_HALL;

  /**
   * The B.O.B plan, in "Rush 6th Builder" mode.
   *
   * The ordinary list cannot plan this: it offers one level per building, and
   * B.O.B is nine Builder Hall levels, five Star Lab levels, a troop at 18,
   * heroes at a combined 45 and three gear-ups — levels whose gates are only met
   * by the levels before them. So the Builder Base in rush mode is planned by
   * chaining, and the plan ENDS when the sixth builder is earned (`makespan`
   * is the ETA the checklist card reports). Null in every other mode, so the
   * Home Village and the "evenly" Builder Base plan keep the old scheduler.
   */
  const bobPlan = useMemo<BobGoalResult | null>(() => {
    if (!parsed || !gameData) return null;
    if (village !== "builderBase") return null;
    if (settings.builderBaseStrategy !== "rush6th") return null;
    return scheduleBobGoal({
      data: gameData,
      entries: parsed.entries,
      settings,
      inProgress,
      builders: effectiveBuilders,
      defenseId: bbDefenseId,
      nowEpochMs,
      wiggleRoom: settings.wiggleRoom * 60,
    });
  }, [
    parsed,
    gameData,
    village,
    settings,
    inProgress,
    effectiveBuilders,
    bbDefenseId,
    nowEpochMs,
  ]);

  const bobJobCount = bobPlan
    ? bobPlan.lanes.reduce((n, l) => n + l.jobs.length, 0)
    : 0;
  /** The plan that gets drawn: the B.O.B chain when it has anything to show. */
  const goalPlan = bobJobCount > 0 ? bobPlan : null;

  // The upgrade catalogue (every tickable row, not just the plan). Two views:
  // The upgrade catalogue: every tickable row for this village.
  const activeOptions = useMemo(
    () => upgrades.filter((u) => u.village === village),
    [upgrades, village],
  );

  const plannedOptions = useMemo(
    () => upgrades.filter((u) => planned.has(u.uid)),
    [upgrades, planned],
  );
  const activePlanned = plannedOptions.filter((u) => u.village === village);
  // Equipment is never scheduled, so it can't be "gated" either.
  const scheduleablePlanned = activePlanned.filter(
    (u) => !UNSCHEDULED_CATEGORIES.has(u.category),
  );
  // Home Village gear-up buildings now appear in the plan just like any other
  // defence. They show as normal upgrade rows, and the Builder Base plan
  // carries the Master Builder's trip separately when the 6th-builder rush is active.
  const schedulable = scheduleablePlanned.filter(
    (u) => u.available && u.time != null && u.time > 0,
  );
  const gatedCount = scheduleablePlanned.length - schedulable.length;
  // Whether there is a timeline to draw at all — ticked upgrades, or a goal plan
  // that needs no ticking because the goal IS the plan.
  const hasPlan = activePlanned.length > 0 || goalPlan != null;
  // The building this village is gated on: Town Hall at home, Builder Hall in
  // Builder Base. Both the "include it" toggle and the Town Hall priority group
  // key off this rather than the home village's id.
  const thId = townHallIdFor(village);
  // Each village runs its own preset set. In the Builder Base the user's choice
  // is a *goal*, not an archetype — "rush B.O.B" is offence-led, "evenly" is
  // balanced — so the Home Village archetype is mapped from it rather than
  // reused. A home archetype picked while looking at the Builder Base would be
  // meaningless there, which is why the setting is a separate field.
  const strategy: Strategy =
    village === "builderBase"
      ? settings.builderBaseStrategy === "rush6th"
        ? "offenseFirst"
        : "hybrid"
      : settings.strategy;
  const scheduleSource = settings.includeTh
    ? schedulable
    : schedulable.filter((u) => u.id !== thId);

  /**
   * Which heroes the dedicated lanes are for, so the setting can name them.
   *
   * The focus order decides it (see `focusedHeroes`), and the order lives in its
   * own dialog — naming the chosen heroes where the lane count is chosen is what
   * turns "3 lanes" into "3 lanes for these heroes" without sending the reader
   * to another dialog to find out.
   */
  const heroLaneFocus = useMemo(
    () =>
      focusedHeroes(
        scheduleSource.filter((o) => o.category === "hero"),
        settings.heroOrder,
        settings.heroLanes,
      ).map((o) => o.name),
    [scheduleSource, settings.heroOrder, settings.heroLanes],
  );

  /**
   * The plan for the ticked upgrades — what every mode but the Builder Base rush
   * uses. Kept in its own memo rather than folded into `schedule` so switching
   * strategies does not have to rebuild it: the list schedule and the B.O.B
   * chain are two answers to the same question, and rush mode picks one.
   */
  const listSchedule = useMemo(
    () => {
      const jobs = scheduleSource.map((o) => {
          const entity = gameData?.get(o.id) ?? null;
          const isTh = o.id === thId;
          const group = groupKey(o.category, entity, isTh);
          return {
            uid: o.uid,
            name: o.name,
            duration: effectiveTime(o, settings) ?? 0,
            category: o.category,
            kind: jobKind(o.category),
            // One row can stand for several copies of a building; each copy needs
            // its own upgrade, so the schedule expands this into `count` jobs.
            count: o.count,
            family: familyOf(o.category, entity, isTh),
            priority:
              priorityFor(strategy, o.category, isTh, settings.offenseBeforeTh) +
              labPriorityBoost(settings.labPriority, settings.labOrder, o.category, entity) +
              upgradeOrderBoost(settings.upgradeOrder, group) +
              weightBoost(settings.offenseWeights, group) +
              (o.category === "hero"
                ? focusBoost(settings.heroOrder, HOME_HERO_FOCUS, o.id)
                : 0) +
              (o.category === "pet" ? focusBoost(settings.petOrder, PET_FOCUS, o.id) : 0) +
              (village === "builderBase"
                ? bbRushBoost(o, settings, bbHeroTotalVal, bbDefenseId)
                : 0),
            // A follow-up to a live upgrade can't start before that one finishes.
            after: o.inFlightSeconds,
          };
        });
      /**
       * The heroes that get a builder of their own, most focused first.
       *
       * Only a hero the player planned is here — a lane dedicated to a hero
       * nobody is upgrading is the empty row this feature exists to remove — and
       * the order is the focus order's, so the hero at the top of "Hero Focus
       * Order" is the one whose lane runs from today. Their levels come from the
       * rulebook rather than the upgrade list, which can only ever name the next
       * one: that is exactly why the hero lane used to hold four bars and then
       * nothing for the rest of the plan.
       *
       * Home Village only. Builder Base heroes are chained by the B.O.B plan,
       * which also knows the storage ceilings their levels have to be paid from.
       */
      const heroChains: HeroChainSpec[] = [];
      if (village === "home" && settings.heroLanes > 0 && gameData) {
        const focused = focusedHeroes(
          scheduleSource.filter((o) => o.category === "hero"),
          settings.heroOrder,
          MAX_HERO_LANES,
        );
        for (const o of focused) {
          const entity = gameData.get(o.id);
          if (!entity) continue;
          // Climb the hero's own level rows — each one carries the Town Hall
          // level its row needs — and stop at the first row the village cannot
          // yet meet. That is the ceiling at THIS Town Hall, not a hard-coded
          // one: level 51's row says "needs TH12", and a TH11 village stops
          // there on its own.
          const thLevel = village === "home" ? parsed?.townHallLevel : parsed?.builderHallLevel;
          const last = thLevel == null ? 0 : heroChainCeiling(entity, thLevel);
          const levels: HeroChainSpec["levels"] = [];
          for (let lv = o.nextLevel; lv <= last; lv++) {
            const row = gameData.level(entity, lv);
            if (!row) continue;
            // Priced and timed by the same two helpers the ticked level is, so
            // the first link of the chain and the option it came from agree.
            const step: UpgradeOption = {
              ...o,
              currentLevel: lv - 1,
              nextLevel: lv,
              cost: row.cost,
              time: row.time,
            };
            levels.push({
              level: lv,
              duration: effectiveTime(step, settings) ?? 0,
              cost: effectiveCost(step, settings),
            });
          }
          if (levels.length === 0) continue;
          heroChains.push({
            id: o.id,
            name: o.name,
            resource: o.resource,
            uid: o.uid,
            after: o.inFlightSeconds,
            priority: jobs.find((j) => j.uid === o.uid)?.priority ?? 0,
            levels,
          });
        }
      }

      const opts = {
        builders: effectiveBuilders,
        blocks: settings.blocks,
        horizon: settings.horizon,
        heroLanes: settings.heroLanes,
        heroChain: settings.heroChain,
        heroChains,
        cwlBlock: settings.cwlBlock,
        // The limit is counted from this village's own heroes, so a Home
        // Village policy can't cap Builder Base heroes (there are only two, and
        // they are built rather than researched).
        heroConcurrency: heroLimit,
        village,
        nowEpochMs,
        wiggleRoom: settings.wiggleRoom * 60,
      };

      // The Builder Base's second builder is O.T.T.O's Outpost, which needs
      // Builder Hall 6. Below that the plan has one lane, not two — so run it
      // once to see when the Builder Hall 6 upgrade lands, then run it again
      // with the second lane opening at that moment. An earlier lane can only
      // pull that upgrade earlier, never later, so the second pass is stable.
      const bhLevel = parsed?.builderHallLevel ?? 0;
      if (village !== "builderBase" || bhLevel >= BB_OUTPOST_BUILDER_HALL) {
        return scheduleJobs(jobs, opts, inProgress);
      }
      const solo = scheduleJobs(jobs, { ...opts, builders: 1 }, inProgress);
      const bh6Uid = scheduleSource.find(
        (o) => o.id === BB_BUILDER_HALL_ID && o.nextLevel === BB_OUTPOST_BUILDER_HALL,
      )?.uid;
      const bh6 = solo.lanes
        .flatMap((l) => l.jobs)
        .find((j) => j.uid === bh6Uid);
      if (bh6) {
        return scheduleJobs(jobs, { ...opts, builderUnlock: [0, bh6.end] }, inProgress);
      }
      // Builder Hall 5 -> 6 already under way. There is no planned job to read an
      // unlock time from — the only record of it is the live timer — and without
      // this the whole Builder Base was planned on a single builder, silently and
      // for as long as that upgrade ran, which is exactly the case (BH6 about to
      // land) the second lane exists for.
      const bh6Live = parsed?.entries.find(
        (e) =>
          e.village === "builderBase" &&
          e.id === BB_BUILDER_HALL_ID &&
          e.timer != null &&
          e.timer > 0 &&
          e.level + 1 === BB_OUTPOST_BUILDER_HALL,
      );
      if (bh6Live) {
        return scheduleJobs(
          jobs,
          { ...opts, builderUnlock: [0, bh6Live.timer as number] },
          inProgress,
        );
      }
      return solo;
    },
    [
      scheduleSource,
      settings,
      inProgress,
      nowEpochMs,
      gameData,
      village,
      effectiveBuilders,
      bbHeroTotalVal,
      bbDefenseId,
      heroLimit,
      parsed,
    ],
  );

  /** The plan being drawn: the B.O.B chain in rush mode, the list otherwise. */
  const schedule: ScheduleResult = goalPlan ?? listSchedule;

  // Tooltips and lane lists look a job up by uid, so the jobs the schedule made
  // for itself need detail rows too — a chained hero level is offered by no
  // upgrade list, because the level after the next one does not exist until the
  // next one is built.
  const planDetails = useMemo(() => {
    if (!schedule.options?.length) return allDetails;
    const m = new Map(allDetails);
    for (const o of schedule.options!) m.set(o.uid, o);
    return m;
  }, [allDetails, schedule]);

  // Cost summary for planned upgrades in the active village.
  //
  // The chained levels a hero lane adds are counted too, and counted apart: they
  // are work the chart draws and the player has to pay for, but no tick in the
  // catalogue stands for them, so a total that quietly included them would read
  // as the ticked list costing more than it does.
  const summary = useMemo(() => {
    const rows = new Map<number, UpgradeOption>(activePlanned.map((o) => [o.uid, o]));
    let chained = 0;
    for (const o of schedule.options ?? []) {
      if (o.village !== village || rows.has(o.uid)) continue;
      rows.set(o.uid, o);
      chained++;
    }
    const byResource = new Map<string, number>();
    let shiny = 0;
    let glowy = 0;
    let starry = 0;
    for (const o of rows.values()) {
      const cost = effectiveCost(o, settings);
      if (cost == null) continue;
      if (typeof cost === "number") {
        byResource.set(o.resource, (byResource.get(o.resource) ?? 0) + cost);
      } else {
        shiny += cost.shiny_ore ?? 0;
        glowy += cost.glowy_ore ?? 0;
        starry += cost.starry_ore ?? 0;
      }
    }
    return { byResource, shiny, glowy, starry, chained };
  }, [activePlanned, settings, schedule, village]);

  const togglePlan = useCallback((uid: number) => {
    setPlanned((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }, []);

  const planAll = useCallback(() => {
    setPlanned(
      new Set(
        activeOptions
          .filter(
            (o) =>
              o.available &&
              !UNSCHEDULED_CATEGORIES.has(o.category) &&
              (o.id !== thId || settings.includeTh),
          )
          .map((o) => o.uid),
      ),
    );
  }, [activeOptions, settings.includeTh, thId]);

  const clearPlan = useCallback(() => setPlanned(new Set()), []);

  const copyShareLink = useCallback(async () => {
    if (!rawExport) return "Nothing to share yet — load a village first.";
    const state: ShareState = {
      export: rawExport,
      planned: [...planned],
      settings,
      village,
    };
    const url =
      window.location.origin +
      window.location.pathname +
      "#" +
      encodeState(state);
    try {
      await navigator.clipboard.writeText(url);
      setShareMsg("Link copied to clipboard!");
      return "Link copied to clipboard!";
    } catch {
      setShareMsg("Could not copy — copy the URL manually.");
      return "Could not copy — your browser blocked clipboard access.";
    }
  }, [rawExport, planned, settings, village]);

  const handleShare = useCallback(() => {
    void copyShareLink();
  }, [copyShareLink]);

  /* ---------------------------------------------------------------------- */
  /* Priority editor inputs                                                  */
  /* ---------------------------------------------------------------------- */

  const heroItems = useMemo(
    () =>
      parsed
        ? toItems(
            parsed.entries.filter((e) => e.village === "home" && e.category === "hero"),
            gameData?.images ?? {},
          )
        : [],
    [parsed, gameData],
  );

  const petItems = useMemo(
    () =>
      parsed
        ? toItems(
            parsed.entries.filter((e) => e.category === "pet"),
            gameData?.images ?? {},
          )
        : [],
    [parsed, gameData],
  );

  const labItems = useMemo(
    () =>
      parsed
        ? toItems(
            parsed.entries.filter(
              (e) =>
                e.village === village &&
                (e.category === "troop" || e.category === "spell" || e.category === "siege"),
            ),
            gameData?.images ?? {},
          )
        : [],
    [parsed, gameData, village],
  );

  const groupItems = useMemo<PriorityItem[]>(() => {
    const present = new Set<string>();
    for (const o of activeOptions) {
      if (UNSCHEDULED_CATEGORIES.has(o.category)) continue;
      present.add(
        groupKey(o.category, gameData?.get(o.id) ?? null, o.id === thId),
      );
    }
    return orderedGroups(settings.upgradeOrder, present).map((key) => ({
      key,
      name: GROUP_LABELS[key] ?? key,
    }));
  }, [activeOptions, gameData, settings.upgradeOrder, thId]);

  const scheduleText = useMemo(
    () => scheduleToText(schedule, nowEpochMs, planDetails),
    [schedule, nowEpochMs, planDetails],
  );

  // Imported settings keep this device's builder counts. How many builders you
  // have is a fact about your village, not a preference — an imported file that
  // says 6 must not hand four phantom builders to somebody who has two. It is
  // true of the Builder Base count for the same reason, and more so: the second
  // and third Builder Base builders are buildings, and the file being imported
  // was written from somebody else's village.
  const importSettingsInto = useCallback((next: PlannerSettings) => {
    setSettings((s) => ({ ...next, builders: s.builders, bbBuilders: s.bbBuilders }));
  }, []);

  const resetSettings = useCallback(() => {
    setSettings((s) => ({
      ...DEFAULT_SETTINGS,
      builders: s.builders,
      bbBuilders: s.bbBuilders,
    }));
  }, []);

  const loadSample = useCallback(() => {
    if (!gameData) return;
    const sample = JSON.parse(SAMPLE_EXPORT) as RawExport;
    setRawExport(sample);
    setParsed(parseExport(sample, gameData));
    setPlanned(new Set());
    setParseError(null);
    setIsSample(true);
  }, [gameData]);

  const readyCount = activeOptions.filter((o) => o.available).length;
  const runningCount = inProgress.length;
  // The export lists what is actually running, so if that exceeds the builders
  // we detected, the detected count is wrong (or B.O.B is mid-unlock) — say so
  // rather than silently stacking two upgrades on one builder.
  const runningBuilderLane = inProgress.filter((j) => j.kind === "builder").length;
  // Both villages: in the Builder Base the count is read off the hut that brings
  // the builder, so a base with two upgrades running on a one-lane reading (or
  // three on two) is the same signal — the reading is wrong, and the fix is the
  // builder count in Settings.
  const builderCountSuspect = runningBuilderLane > effectiveBuilders;

  return (
    <div className="min-h-screen">
      <Header
        village={village}
        onVillageChange={setVillage}
        images={gameData?.images ?? {}}
        onSettings={() => pushModal("settings")}
        onHelp={() => pushModal("onboarding")}
      />

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        {loadError && (
          <p className="mb-4 rounded-xl border border-red-900 bg-red-950/40 px-4 py-3 text-red-300">
            {loadError}
          </p>
        )}

        <ImportPanel
          onParse={handleParse}
          error={parseError}
          hasData={!!parsed}
          rawExport={rawExport}
          // The sample is not the user's village and is never cached, so while
          // it is showing there is no saved session to report on.
          savedAt={isSample ? null : savedAt}
          onForget={forgetSaved}
        />

        {isSample && parsed && (
          <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-gold/30 bg-gold/[0.07] px-4 py-2.5 text-sm text-gold-strong">
            <span className="font-semibold">Sample village.</span>
            <span className="text-ink-dim">
              Paste your own in-game Data Export above to plan your real base.
            </span>
          </div>
        )}

        {parsed && gameData && (
          <div className="mt-5 space-y-5">
            {/* Status strip */}
            <div className="surface-panel flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl px-4 py-3.5 sm:gap-x-6 sm:px-5 sm:py-4">
              {parsed.tag && (
                <span className="font-mono text-sm text-ink-dim">{parsed.tag}</span>
              )}
              <span className="flex items-center gap-2 text-sm text-ink-dim">
                <span className="text-ink-faint">Town Hall</span>
                <span className="rounded-lg bg-surface-2 px-2.5 py-0.5 font-semibold text-gold tabular-nums ring-1 ring-gold/20">
                  {parsed.townHallLevel ?? "—"}
                </span>
              </span>
              <span className="flex items-center gap-2 text-sm text-ink-dim">
                <span className="text-ink-faint">Builder Hall</span>
                <span className="rounded-lg bg-surface-2 px-2.5 py-0.5 font-semibold text-gold tabular-nums ring-1 ring-gold/20">
                  {parsed.builderHallLevel ?? "—"}
                </span>
              </span>
              <span className="text-sm text-ink-dim">
                <span className="font-semibold text-ink tabular-nums">
                  {effectiveBuilders}
                </span>{" "}
                builders
                {/* Both extra Builder Base builders are buildings, so the count
                    is a fact about the base — and the caveat is which of them is
                    still missing, not a fixed "2". */}
                {village === "builderBase" && bbOutpostPending && (
                  <span className="ml-1.5 text-xs text-ink-faint">
                    2nd at Builder Hall {BB_OUTPOST_BUILDER_HALL}
                  </span>
                )}
                {village === "builderBase" &&
                  !bbOutpostPending &&
                  !bbBuildersDetected.botoOwned &&
                  settings.bbBuilders === "auto" && (
                    <span className="ml-1.5 text-xs text-ink-faint">
                      3rd needs B.O.T.O&apos;s Shack (gems)
                    </span>
                  )}
              </span>
              {runningCount > 0 && (
                <span className="flex items-center gap-1.5 text-sm">
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-amber-400"
                    style={{ boxShadow: "0 0 5px rgba(251,191,36,0.6)" }}
                  />
                  <span className="font-medium text-amber-300">
                    {runningCount} upgrading now
                  </span>
                </span>
              )}
              {builderCountSuspect && (
                <button
                  onClick={() => pushModal("settings")}
                  title="The export shows more upgrades running at once than the builders detected. Set your real builder count in Strategy Setup."
                  className="flex items-center gap-1.5 rounded-lg border border-amber-700/60 bg-amber-950/30 px-2.5 py-1 text-xs text-amber-300 transition hover:border-amber-500 hover:bg-amber-950/50"
                >
                  ⚠ {runningBuilderLane} upgrades running on {effectiveBuilders} builders
                </button>
              )}
              <span className="ml-auto w-full shrink-0 text-sm text-ink-dim sm:ml-auto sm:w-auto sm:shrink">
                <span className="tabular-nums">{activeOptions.length}</span> upgrades ·{" "}
                {readyCount > 0 ? (
                  <span className="rounded bg-emerald-500/10 px-1.5 font-semibold text-emerald-400 tabular-nums ring-1 ring-emerald-500/25">
                    {readyCount} ready
                  </span>
                ) : (
                  <span className="rounded bg-surface-2 px-1.5 text-xs text-ink-faint ring-1 ring-white/5">
                    none ready yet
                  </span>
                )}
              </span>
            </div>

            {/* New Unlockables Notification */}
            <NewUnlockablesNotification
              currentParsed={parsed}
              previousParsed={previousParsed}
              gameData={gameData}
              village={village}
            />

            {/* 6th-builder checklist card */}
            {village === "builderBase" &&
              parsed.builderHallLevel != null &&
              milestones.length > 0 && (
                <div className="card-lit relative overflow-hidden rounded-2xl border border-gold/25 bg-surface p-5">
                  <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-ink">
                        6th Builder (B.O.B)
                      </h2>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 transition ${
                          bobDone
                            ? "bg-emerald-950/40 text-emerald-300 ring-emerald-700/50"
                            : "bg-gold/10 text-gold ring-gold/30"
                        }`}
                      >
                        {bobDone ? "unlocked" : "locked"}
                      </span>
                    </div>
                    <span className="text-xs text-ink-faint tabular-nums">
                      {bobDoneCount}/{milestones.length} tasks done
                    </span>
                  </div>
                  {/* The answer the rush mode exists to give: when the sixth
                      builder lands. It is the length of the chained plan below,
                      so it counts the levels the checklist currently shows as
                      missing — and only those. */}
                  {goalPlan && !bobDone && (
                    <p className="mt-3 rounded-xl border border-gold/25 bg-gold/[0.06] px-4 py-3 text-sm text-ink-dim">
                      Estimated 6th builder:{" "}
                      <span className="font-semibold text-gold-strong">
                        {fmtDate(nowEpochMs + goalPlan.makespan * 1000)}
                      </span>{" "}
                      <span className="text-ink-faint">
                        · {formatTime(goalPlan.makespan)} of upgrades on {effectiveBuilders}{" "}
                        builder{effectiveBuilders === 1 ? "" : "s"}
                      </span>
                    </p>
                  )}
                  {/* Why the plan waits where it waits. A price the base cannot
                      hold is a real stop in the Builder Base — you cannot save
                      towards a Builder Hall you have nowhere to put the gold for
                      — so the ceiling work the plan adds is shown with the
                      requirement that forced it. */}
                  {goalPlan && !bobDone && goalPlan.resources.some((r) => r.added.length > 0) && (
                    <div className="mt-2 space-y-1 rounded-xl border border-line bg-bg/40 px-3 py-2.5">
                      {goalPlan.resources.map((r) => (
                        <div
                          key={r.resource}
                          className="flex flex-wrap items-baseline gap-x-1.5 text-xs"
                        >
                          <span
                            aria-hidden
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: FAMILY_COLORS.resource }}
                          />
                          <span className="font-medium text-ink-dim">{r.resource}</span>
                          <span className="tabular-nums text-ink-faint">
                            {formatNumber(r.cap)} → {formatNumber(r.capAtEnd)}
                          </span>
                          <span className="text-ink-faint">
                            {r.added.length > 0
                              ? `· raises ${r.added.join(", ")}`
                              : "· already enough"}
                          </span>
                          {r.forLabel && (
                            <span className="text-gold/80">
                              · for {r.forLabel}
                              {r.forCost ? ` at ${formatNumber(r.forCost)}` : ""}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {goalPlan && goalPlan.blockers.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-amber-300/90">
                      {goalPlan.blockers.map((b) => (
                        <li key={b}>⚠ Not in this plan: {b}</li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {milestones.map((m) => (
                      <div
                        key={m.label}
                        className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
                          m.done
                            ? "border-emerald-800/50 bg-emerald-950/25"
                            : "border-line bg-bg/40 hover:border-line-strong"
                        }`}
                      >
                        <span className="flex min-w-0 flex-col gap-0.5 text-ink-dim">
                          <span className="flex min-w-0 items-center gap-1.5">
                            {m.done ? (
                              <span className="text-emerald-400">✓</span>
                            ) : (
                              <span className="h-1.5 w-1.5 rounded-full bg-gold/60" />
                            )}
                            <span className="truncate">{m.label}</span>
                          </span>
                          {m.note && (
                            <span
                              className={`pl-4 text-[10px] ${
                                m.needsHome ? "text-gold/80" : "text-emerald-400/80"
                              }`}
                            >
                              Home Village · {m.note}
                            </span>
                          )}
                        </span>
                        <span
                          className={`shrink-0 font-mono text-xs tabular-nums ${
                            m.done ? "text-emerald-300" : "text-gold"
                          }`}
                        >
                          {m.current}/{m.target}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* Build plan first: the schedule is the answer the planner exists to give. */}
            {hasPlan ? (
              <Schedule
                schedule={schedule}
                horizon={settings.horizon || undefined}
                blocks={settings.blocks}
                nowEpochMs={nowEpochMs}
                details={planDetails}
                images={gameData.images}
                village={village}
                note={
                  goalPlan
                    ? "Rush 6th Builder — the B.O.B critical path only, ending when the 6th builder is earned."
                    : undefined
                }
                onShare={handleShare}
                onCopySchedule={async () => {
                  try {
                    await navigator.clipboard.writeText(scheduleText);
                    setShareMsg("Schedule copied to clipboard!");
                  } catch {
                    setShareMsg("Could not copy — copy the URL manually.");
                  }
                }}
                onOpenShare={() => pushModal("share")}
                shareMsg={shareMsg}
                onChangeStrategy={() => pushModal("settings")}
              />
            ) : (
              <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-ink-faint">
                Tick upgrades below to build your plan — the timeline appears here.
              </p>
            )}

            {/* Plan summary */}
            {activePlanned.length > 0 && (
              <div className="surface-panel rounded-2xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gold/80">At a glance</p>
                    <h2 className="mt-0.5 text-base font-semibold text-ink">Plan summary</h2>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    <button
                      onClick={() => pushModal("settings")}
                      className="rounded-lg border border-line px-2.5 py-1.5 text-ink-dim transition hover:border-gold/50 hover:bg-surface-2/60 hover:text-ink active:scale-[0.97]"
                    >
                      ⚙ Settings
                    </button>
                    <button
                      onClick={() => pushModal("offense")}
                      className="rounded-lg border border-line px-2.5 py-1.5 text-ink-dim transition hover:border-gold/50 hover:bg-surface-2/60 hover:text-ink active:scale-[0.97]"
                    >
                      Offense %
                    </button>
                    <button
                      onClick={planAll}
                      className="rounded-lg border border-line px-2.5 py-1.5 text-ink-dim transition hover:border-gold/50 hover:bg-surface-2/60 hover:text-ink active:scale-[0.97]"
                    >
                      Plan all
                    </button>
                    <button
                      onClick={clearPlan}
                      className="rounded-lg border border-line px-2.5 py-1.5 text-ink-dim transition hover:border-red-500/50 hover:bg-red-950/20 hover:text-red-300 active:scale-[0.97]"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-sm text-ink-dim">
                  <span className="tabular-nums">{activePlanned.length}</span> upgrade
                  {activePlanned.length > 1 ? "s" : ""} in the plan
                  {summary.chained > 0 && (
                    <span className="text-ink-faint">
                      {" "}
                      · plus <span className="tabular-nums">{summary.chained}</span> hero lane level
                      {summary.chained > 1 ? "s" : ""}
                    </span>
                  )}
                  {gatedCount > 0 && (
                    <span className="rounded bg-gold/10 px-1.5 py-0.5 text-gold">
                      {" "}
                      · {gatedCount} waiting on a higher{" "}
                      {village === "home" ? "TH" : "BH"}
                    </span>
                  )}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[...summary.byResource.entries()].map(([res, amt]) => (
                    <span
                      key={res}
                      className={`rounded-lg border border-line bg-bg px-3 py-1.5 text-sm font-medium tabular-nums ring-1 ring-white/5 ${resourceClass(res)}`}
                    >
                      {formatNumber(amt)}
                    </span>
                  ))}
                  {summary.shiny + summary.glowy + summary.starry > 0 && (
                    <span className="rounded-lg border border-line bg-bg px-3 py-1.5 text-sm text-sky-300 tabular-nums ring-1 ring-white/5">
                      {summary.shiny > 0 && `${formatNumber(summary.shiny)} shiny`}
                      {summary.glowy > 0 && ` · ${formatNumber(summary.glowy)} glowy`}
                      {summary.starry > 0 && ` · ${formatNumber(summary.starry)} starry`}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Upgrade catalogue last. */}
            <div className="surface-panel rounded-2xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Catalogue</p>
                  <h2 className="mt-0.5 text-base font-semibold text-ink">All upgrades</h2>
                </div>
                <span className="text-xs text-ink-faint">
                  {activeOptions.length} upgrades · {activeOptions.filter((o) => o.available).length} ready
                </span>
              </div>
              <div className="mt-3">
                <UpgradeList
                  options={activeOptions}
                  showAvailableOnly={showAvailableOnly}
                  onToggleAvailableOnly={() => setShowAvailableOnly((v) => !v)}
                  planned={planned}
                  onTogglePlan={togglePlan}
                  images={gameData.images}
                  settings={settings}
                  timerByUid={timerByUid}
                  nowEpochMs={nowEpochMs}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Only the top of the modal stack renders, so dialogs never nest. */}
      <ScheduleSettings
        key={modal === "settings" ? "settings-open" : "settings-closed"}
        settings={settings}
        onChange={setSettings}
        village={village}
        open={modal === "settings"}
        onClose={popModal}
        onOpen={pushModal}
        onReset={resetSettings}
        bbDetected={bbBuildersDetected}
        heroFocus={heroLaneFocus}
      />

      <OffensePercentages
        key={modal === "offense" ? "offense-open" : "offense-closed"}
        open={modal === "offense"}
        onClose={popModal}
        weights={settings.offenseWeights}
        onChange={(offenseWeights) => setSettings((s) => ({ ...s, offenseWeights }))}
      />

      <PriorityEditor
        key="hero-order"
        open={modal === "heroOrder"}
        onClose={popModal}
        title="Hero Focus Order"
        subtitle="Which hero gets the next builder, and which ones get a dedicated lane"
        items={heroItems}
        defaults={HOME_HERO_FOCUS.map(String)}
        order={settings.heroOrder.map(String)}
        onChange={(next) => setSettings((s) => ({ ...s, heroOrder: next.map(Number) }))}
        emptyHint="No home-village heroes in this village."
      />

      <PriorityEditor
        key="pet-order"
        open={modal === "petOrder"}
        onClose={popModal}
        title="Pet Focus Order"
        subtitle="Which pet the Pet House levels next"
        items={petItems}
        defaults={PET_FOCUS.map(String)}
        order={settings.petOrder.map(String)}
        onChange={(next) => setSettings((s) => ({ ...s, petOrder: next.map(Number) }))}
        emptyHint="No pets unlocked in this village."
      />

      <PriorityEditor
        key="lab-order"
        open={modal === "labOrder"}
        onClose={popModal}
        title="Lab Priority Editor"
        subtitle="Which troop, spell or siege machine the Laboratory researches next"
        items={labItems}
        defaults={[]}
        order={settings.labOrder.map(String)}
        onChange={(next) => setSettings((s) => ({ ...s, labOrder: next.map(Number) }))}
        emptyHint="Nothing researchable in this village."
      />

      <PriorityEditor
        key="group-order"
        open={modal === "groupOrder"}
        onClose={popModal}
        title="Upgrade Priority Order"
        subtitle="Which kind of upgrade gets worked on first"
        items={groupItems}
        defaults={DEFAULT_UPGRADE_ORDER}
        order={settings.upgradeOrder}
        onChange={(next) => setSettings((s) => ({ ...s, upgradeOrder: next }))}
      />

      <ShareMenu
        key={modal === "share" ? "share-open" : "share-closed"}
        open={modal === "share"}
        onClose={popModal}
        settings={settings}
        scheduleText={scheduleText}
        onCopyLink={copyShareLink}
        onImportSettings={importSettingsInto}
        onResetSettings={resetSettings}
      />

      <Onboarding
        key={modal === "onboarding" ? "onboarding-open" : "onboarding-closed"}
        open={modal === "onboarding"}
        onClose={dismissOnboarding}
        onLoadSample={loadSample}
      />

      <footer className="mt-6 border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-ink-faint sm:px-6">
          <span>
            Clash Max — paste your in-game Data Export to plan every builder hour.
          </span>
          <span>Unofficial fan tool · not affiliated with Supercell.</span>
          <span className="font-mono text-[10px] text-ink-faint/70" title="Build fingerprint — if this is not the newest, your browser is showing a cached copy">
            build {process.env.NEXT_PUBLIC_BUILD_ID?.slice(0, 8) || "?"}
          </span>
        </div>
      </footer>
    </div>
  );
}
