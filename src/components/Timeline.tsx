"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatCost, formatTime } from "@/lib/format";
import type { AssignedJob, JobKind, ScheduleResult } from "@/lib/schedule";
import type { UpgradeOption } from "@/lib/upgrade";
import type { Village } from "@/lib/types";
import {
  facilityIconId,
  FAMILIES,
  FAMILY_COLORS,
  FAMILY_LABEL,
  LANE_COLORS,
  LANE_LEGEND,
  laneBarClass,
  STATE_LEGEND,
  type Family,
} from "@/lib/categoryColor";
import { resourceClass } from "@/lib/resourceColor";
import { blockOccurrences, type BlockSpec } from "@/lib/sleep";

interface Props {
  schedule: ScheduleResult;
  horizon?: number; // seconds; draws a vertical marker when > 0
  blocks: BlockSpec[];
  nowEpochMs: number;
  details: Map<number, UpgradeOption>;
  images: Record<string, string>;
  village: Village;
  onChangeStrategy?: () => void;
}

interface Band {
  start: number;
  end: number;
  label: string;
}

const DAY = 86400; // seconds — the unit used by makespan and job durations
const HOUR = 3600;
/** Width of the frozen lane-label column. Must match the `w-32` class below. */
const LABEL_W = 128;
/**
 * Floor for a bar's drawn width, in pixels. A 12-second upgrade is a fraction of
 * a pixel at any zoom, and the icon is what identifies the bar — so a bar is
 * never drawn narrower than the icon it is carrying. Bars that hit this floor
 * are drawn wider than they truly last, and say so in their tooltip.
 */
const MIN_BAR = 24;
/** Icon size per bar width, so the artwork always fits inside the floor above. */
const iconCls = (w: number) =>
  w >= 120 ? "h-7 w-7" : w >= 42 ? "h-[18px] w-[18px]" : "h-4 w-4";
const padCls = (w: number) => (w >= 42 ? "px-1.5 gap-1.5" : "px-0.5");

const ZOOM_PRESETS: { label: string; days: number | null }[] = [
  { label: "All", days: null },
  { label: "2w", days: 14 },
  { label: "1w", days: 7 },
  { label: "3d", days: 3 },
  { label: "1d", days: 1 },
];
/** Days of plan shown per screen width, per preset. */
const PX_PER_DAY: Record<number, number> = { 1: 1500, 3: 560, 7: 260, 14: 130 };

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
function fmtDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
}

/**
 * One entry per calendar day the plan touches, positioned from the plan's own
 * `t = 0` (the export timestamp). Walks local midnights so DST can't drift them.
 */
function daySegments(nowEpochMs: number, span: number) {
  const out: { t: number; label: string; today: boolean }[] = [];
  out.push({ t: 0, label: fmtDay(nowEpochMs), today: true });
  let cursor = new Date(nowEpochMs);
  cursor.setHours(24, 0, 0, 0);
  for (let guard = 0; guard < 1200; guard++) {
    const rel = (cursor.getTime() - nowEpochMs) / 1000;
    if (rel >= span) break;
    out.push({ t: rel, label: fmtDay(cursor.getTime()), today: false });
    cursor = new Date(cursor.getTime());
    cursor.setHours(24, 0, 0, 0);
  }
  return out;
}

/** Evenly spaced tick marks, spread until they are far enough apart to read. */
function makeTicks(spanSec: number, pxPerDay: number, zoomDays: number | null) {
  let interval: number;
  if (zoomDays === null) interval = spanSec / 8;
  else if (zoomDays === 1) interval = 2 * HOUR;
  else if (zoomDays === 3) interval = 6 * HOUR;
  else interval = DAY;
  const MIN_PX = 68;
  for (let g = 0; g < 60 && (interval / DAY) * pxPerDay < MIN_PX; g++) interval *= 2;
  for (let g = 0; g < 60 && spanSec / interval > 90; g++) interval *= 2;
  const ticks: number[] = [];
  for (let t = 0; t <= spanSec + 1; t += interval) ticks.push(t);
  return { ticks, interval };
}

/** Every unavailable window mapped onto the [0, makespan] seconds axis. */
function unavailableBands(
  nowEpochMs: number,
  makespan: number,
  blocks: BlockSpec[],
): Band[] {
  if (blocks.length === 0 || makespan <= 0) return [];
  const bands: Band[] = [];
  for (const spec of blocks) {
    const until = nowEpochMs + (makespan + 86400) * 1000;
    for (const { s, e } of blockOccurrences(spec, nowEpochMs, until)) {
      const relStart = (s - nowEpochMs) / 1000;
      const relEnd = (e - nowEpochMs) / 1000;
      if (relEnd <= 0 || relStart >= makespan) continue;
      bands.push({ start: Math.max(0, relStart), end: Math.min(makespan, relEnd), label: spec.label });
    }
  }
  return bands;
}

/** Stretches of a lane with nothing booked on it, as [start, end) seconds. */
function idleGaps(jobs: AssignedJob[], makespan: number): { start: number; end: number }[] {
  const seq = [...jobs].sort((a, b) => a.start - b.start);
  const gaps: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const j of seq) {
    if (j.start - cursor > 60) gaps.push({ start: cursor, end: j.start });
    cursor = Math.max(cursor, j.end);
  }
  if (makespan - cursor > 60) gaps.push({ start: cursor, end: makespan });
  return gaps;
}

const laneKindOf = (key: string): JobKind =>
  key === "lab" ? "lab" : key === "pethouse" ? "pet" : "builder";

/**
 * The colour a bar wears. `family` is decided where the job is built — that is
 * the only place the entity is still in hand — so the fallback here exists
 * solely so a job arriving without one still renders.
 */
const familyOfJob = (j: AssignedJob): Family => j.family ?? "buildings";

/** Horizontal Gantt timeline: one lane per builder + lab + pet house. */
export default function Timeline({
  schedule,
  horizon,
  blocks,
  nowEpochMs,
  details,
  images,
  village,
  onChangeStrategy,
}: Props) {
  const { lanes, makespan } = schedule;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  /** Latest pointer position — a ref, not state. See `placeTip` for why. */
  const tipPos = useRef({ x: 0, y: 0 });
  const [avail, setAvail] = useState(0);
  const [hover, setHover] = useState<AssignedJob | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Default to 2 weeks, not "all": a full-year plan at "all" zoom is a chart
  // wider than the card can ever read, and the user can still click "All" when
  // they want it.
  const [zoomDays, setZoomDays] = useState<number | null>(14);
  const [hiddenLanes, setHiddenLanes] = useState<Set<string>>(new Set());

  /**
   * Place the tooltip by writing to the DOM rather than through state.
   *
   * A mousemove over a bar used to store its x/y in state, re-rendering the
   * whole timeline — every lane, every bar, each with its rim and its gloss —
   * dozens of times a second. Scrolling does it too: the bars slide under a
   * stationary pointer, so enter/move events keep firing. Position is the only
   * thing changing at that rate and it needs no React at all. Identity still
   * goes through state, because that is what changes the tooltip's content.
   */
  const placeTip = () => {
    const el = tipRef.current;
    if (!el) return;
    const { x, y } = tipPos.current;
    const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
    const vh = typeof window === "undefined" ? 800 : window.innerHeight;
    el.style.left = `${Math.max(8, Math.min(x - 36, vw - 296))}px`;
    // Below the pointer normally, above it when the bar is near the bottom of
    // the window — hovering the last lane is ordinary, and a fixed-position
    // pointer-events-none tooltip that hangs off the bottom edge can never be
    // read or scrolled to.
    const h = el.offsetHeight;
    const below = y + 16;
    el.style.top = `${below + h > vh - 8 ? Math.max(8, y - h - 12) : below}px`;
  };

  // The fit-to-width preset needs the real pixel width of the track area, which
  // only exists after layout. Measuring it also gives every bar an exact pixel
  // width, so the micro/full-detail switch is decided on real geometry.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const read = () => setAvail(el.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const span = Math.max(makespan, 1);
  const trackAvail = avail > 0 ? Math.max(320, avail - LABEL_W) : 760;
  // The chart always spans the plan and no more, so a preset can only ever zoom
  // IN. At "2 weeks" on a three-day plan the preset's own scale would draw a
  // 390px chart in a 900px card — the lanes would end mid-card with the rest of
  // it empty, which reads as a rendering fault rather than as zoom. So a preset
  // sets the scale only where it is wider than fitting the whole plan; where it
  // is narrower, "All" is already more zoomed-in than the preset asked for.
  const fitPerDay = trackAvail / (span / DAY);
  const pxPerDay =
    zoomDays === null ? fitPerDay : Math.max(PX_PER_DAY[zoomDays], fitPerDay);
  const contentW = (span / DAY) * pxPerDay;

  const pos = (t: number) => (t / DAY) * pxPerDay;
  /**
   * A bar is `duration` wide, except that nothing is ever drawn narrower than
   * its own icon — see MIN_BAR. The floor is the only lie in the geometry, and
   * `isCapped` marks the bars it applies to.
   */
  const barW = (duration: number) => Math.max(MIN_BAR, (duration / DAY) * pxPerDay);
  const isCapped = (duration: number) => (duration / DAY) * pxPerDay < MIN_BAR;
  /** Windows and idle gaps are not bars — they keep their true width. */
  const bandW = (duration: number) => Math.max(2, (duration / DAY) * pxPerDay);

  const showHorizon = (horizon ?? 0) > 0 && horizon! < makespan;
  const showDays = zoomDays !== null;

  // These are pure and expensive (hundreds of bars + day walk + band walk).
  // Without memo, every hover/selection re-render recomputes them, which is
  // what makes the chart feel heavy on scroll.
  const days = useMemo(() => daySegments(nowEpochMs, span), [nowEpochMs, span]);
  const bands = useMemo(
    () => unavailableBands(nowEpochMs, makespan, blocks),
    [nowEpochMs, makespan, blocks],
  );
  const { ticks, interval } = useMemo(
    () => makeTicks(span, pxPerDay, zoomDays),
    [span, pxPerDay, zoomDays],
  );
  const tickStep = (interval / DAY) * pxPerDay;
  // Width of "today" — from now to the next local midnight — so the whole chart
  // can mark where the plan starts from.
  const todayW = days.length > 1 ? pos(days[1].t) : contentW;

  const tickLabel = (t: number) => {
    if (t === 0) return "Now";
    const ms = nowEpochMs + t * 1000;
    return interval < DAY ? fmtDateTime(ms) : fmtDate(ms);
  };

  const visibleLanes = useMemo(
    () => lanes.filter((l) => !hiddenLanes.has(l.key)),
    [lanes, hiddenLanes],
  );
  const allJobs = useMemo(() => lanes.flatMap((l) => l.jobs), [lanes]);

  /**
   * The lane keys behind one filter chip: one per builder, or the single lab /
   * pet lane. Both the chip's own on/off state and the toggle decide from this
   * same list — they used to disagree, with the chip reading only `builder-0`
   * while the toggle asked whether *all* builder lanes were hidden, so on a
   * village with more builders than the one it checked, a single click on a
   * dimmed chip hid every builder lane instead of showing them.
   */
  const laneKeysOf = (kind: JobKind) =>
    lanes
      .filter((l) =>
        l.key === "lab" ? kind === "lab" : l.key === "pethouse" ? kind === "pet" : kind === "builder",
      )
      .map((l) => l.key);

  const lanesHidden = (kind: JobKind) => {
    const keys = laneKeysOf(kind);
    return keys.length > 0 && keys.every((k) => hiddenLanes.has(k));
  };

  const toggleLaneKind = (kind: JobKind) =>
    setHiddenLanes((prev) => {
      const next = new Set(prev);
      const keys = laneKeysOf(kind);
      const allHidden = keys.length > 0 && keys.every((k) => next.has(k));
      for (const k of keys) {
        if (allHidden) next.delete(k);
        else next.add(k);
      }
      return next;
    });

  // Lane keys belong to a village (builder-0..n exist in both, but the lab is a
  // different facility and the Pet House does not exist in the Builder Base), so
  // a filter carried across a village switch would hide lanes the user never
  // touched. The selection goes too — it names a job in the plan being left.
  // The parent remounts this component on a village switch (keyed on village),
  // so both are derived fresh from the initial state instead of reset in an
  // effect — same observable behavior, no setState-during-effect.

  const selectedJob = selectedKey ? allJobs.find((j) => j.key === selectedKey) ?? null : null;
  const selectedDetail = selectedJob ? details.get(selectedJob.uid) : undefined;
  const hoverDetail = hover ? details.get(hover.uid) : undefined;

  const laneFacilityIcon = (key: string) => {
    const id = facilityIconId(laneKindOf(key), village);
    return images[String(id)];
  };

  // The lane filter names what is actually drawn: the Builder Base researches in
  // the Star Lab and has no Pet House, so those two chips would be a mislabel and
  // a control for a lane that does not exist.
  const laneChips = LANE_LEGEND.filter(
    (l) => !(village === "builderBase" && l.key === "pet"),
  ).map((l) =>
    village === "builderBase" && l.key === "lab" ? { ...l, label: "Star Lab" } : l,
  );

  /** The level text a bar carries, so two copies never look like one upgrade. */
  const barLabel = (job: AssignedJob) => {
    const d = details.get(job.uid);
    return {
      name: d?.name ?? job.name,
      level: d ? (d.gearUp ? "" : `${d.currentLevel}→${d.nextLevel}`) : "",
      copy: job.instances > 1 ? `${job.instance}/${job.instances}` : "",
      icon: d ? images[String(d.id)] : undefined,
    };
  };

  return (
    <div>
      {/* Lane filter + strategy + zoom */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {laneChips.map((l) => {
            const kind = l.key as JobKind;
            const off = lanesHidden(kind);
            return (
              <button
                key={l.key}
                onClick={() => toggleLaneKind(kind)}
                aria-pressed={!off}
                title={off ? `Show ${l.label}` : `Hide ${l.label}`}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                  off
                    ? "border-line/60 bg-transparent text-ink-faint"
                    : "border-line bg-surface-2 text-ink"
                }`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${l.swatch} ${off ? "opacity-30" : ""}`} />
                {l.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onChangeStrategy && (
            <button
              onClick={onChangeStrategy}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink-dim transition hover:border-gold/50 hover:text-ink"
            >
              Change Strategy
            </button>
          )}
          <div className="flex items-center gap-1 rounded-lg border border-line bg-bg/60 p-0.5">
            {ZOOM_PRESETS.map((z) => (
              <button
                key={z.label}
                onClick={() => setZoomDays(z.days)}
                aria-pressed={zoomDays === z.days}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  zoomDays === z.days
                    ? "bg-gradient-to-b from-gold-strong to-gold text-[#1a1408]"
                    : "text-ink-dim hover:bg-surface-2 hover:text-ink"
                }`}
              >
                {z.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* The chart. Everything inside the scroller shares one stacking context
          so the frozen labels (z-40) beat the unavailable-window overlay (z-30),
          which in turn sits over the bars (z-2) — you can see an upgrade running
          through a window you are asleep for. */}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface/40">
        <div ref={scrollRef} className="tl-scroll overflow-x-auto scroll-pl-40">
          <div
            className="tl-chart relative"
            style={{ width: LABEL_W + contentW }}
          >
            {showDays && (
              <div className="flex">
                <div className="sticky left-0 z-40 w-32 shrink-0 border-r border-line bg-surface" />
                <div className="relative h-6 bg-bg/40" style={{ width: contentW }}>
                  {days.map((d, i) => (
                    <span
                      key={`d${i}`}
                      className={`absolute inset-y-0 flex items-center justify-center overflow-hidden whitespace-nowrap border-l text-[11px] font-semibold ${
                        d.today
                          ? "border-gold/40 bg-gold/[0.07] text-gold"
                          : "border-line/70 text-ink-dim"
                      }`}
                      style={{
                        left: pos(d.t),
                        width: i + 1 < days.length ? pos(days[i + 1].t) - pos(d.t) : contentW - pos(d.t),
                      }}
                    >
                      {d.label}
                    </span>
                  ))}
                  {bands.map((b, i) => (
                    <span
                      key={`dh${i}`}
                      className="tl-unavailable-head absolute inset-y-0 flex items-center justify-center overflow-hidden"
                      style={{ left: pos(b.start), width: bandW(b.end - b.start) }}
                    >
                      {bandW(b.end - b.start) > 52 && (
                        <span className="tl-unavailable-label">{b.label}</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Time axis */}
            <div className="flex">
              <div
                className="sticky left-0 z-40 flex w-32 shrink-0 items-end border-r border-b border-line bg-surface px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-ink-faint"
                style={{ boxShadow: "2px 0 6px rgba(0,0,0,.35)" }}
              >
                {showDays ? "Time" : "Plan"}
              </div>
              <div
                className="relative h-7 border-b border-line bg-bg/30"
                style={{ width: contentW }}
              >
                {ticks.map((t, i) => (
                  <span
                    key={`t${i}`}
                    className={`absolute top-0 h-full whitespace-nowrap pl-1.5 text-[11px] font-medium leading-7 ${
                      t === 0 ? "font-bold text-gold" : "text-ink-faint"
                    }`}
                    style={{ left: pos(t) }}
                  >
                    {tickLabel(t)}
                  </span>
                ))}
                {/* Before the day row exists, the axis is the only place a window
                    can be named — so draw the bands and their labels here. */}
                {!showDays &&
                  bands.map((b, i) => (
                    <span
                      key={`ah${i}`}
                      className="tl-unavailable-head absolute inset-y-0 flex items-center justify-center overflow-hidden"
                      style={{ left: pos(b.start), width: bandW(b.end - b.start) }}
                    >
                      {bandW(b.end - b.start) > 52 && (
                        <span className="tl-unavailable-label">{b.label}</span>
                      )}
                    </span>
                  ))}
                {showHorizon && (
                  <span
                    className="absolute top-0 h-full w-px bg-red-400/80"
                    style={{ left: pos(horizon!) }}
                    title="Planning horizon"
                  />
                )}
              </div>
            </div>

            {/* Lanes */}
            <div className="relative">
              {/* Gridlines, drawn once for the whole stack rather than repeated
                  inside every lane. They were per-lane spans of byte-identical
                  paint — lanes x (ticks + days) nodes where one overlay plus one
                  span per day does the same job.

                  The `z-[1]` is load-bearing: a lane's track is `relative`, so
                  its opaque background is painted among the positioned
                  descendants, in tree order — which puts it *after* this overlay
                  and would hide the gridlines. Explicit steps instead: overlay 1,
                  idle gaps and bars 2, the selected bar 3, window bands 30, the
                  frozen lane labels 40. */}
              <div
                className="pointer-events-none absolute inset-y-0 z-[1]"
                style={{
                  left: LABEL_W,
                  width: contentW,
                  backgroundImage:
                    tickStep >= 2
                      ? `repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, rgba(255,255,255,0) 1px ${tickStep}px)`
                      : undefined,
                }}
              >
                {days.map((d, i) =>
                  i === 0 ? null : (
                    <span
                      key={`gd${i}`}
                      className="absolute inset-y-0 w-px bg-white/[0.11]"
                      style={{ left: pos(d.t) }}
                    />
                  ),
                )}
              </div>

              {visibleLanes.map((lane, rowIdx) => {
                const kind = laneKindOf(lane.key);
                const busyNow = lane.jobs.some((j) => j.inProgress);
                const chip = busyNow
                  ? "bg-amber-400/15 text-amber-200 ring-amber-400/40"
                  : lane.jobs.length === 0
                    ? "bg-red-400/10 text-red-300 ring-red-400/30"
                    : "bg-white/5 text-ink-faint ring-white/10";
                const chipText = busyNow ? "Working" : lane.jobs.length === 0 ? "Idle" : "Planned";
                const avatar = laneFacilityIcon(lane.key);
                return (
                  <div key={lane.key} className="flex border-b border-line/50 last:border-b-0">
                    {/* Frozen label. The left edge carries the lane's own colour,
                        so which facility a row is reads before the icon does. */}
                    <div
                      className="tl-lane-label sticky left-0 z-40 flex w-32 shrink-0 items-center gap-2 border-r border-line bg-surface py-2 pl-2 pr-1.5"
                    >
                      <span
                        className="absolute inset-y-0 left-0 w-[3px]"
                        style={{ backgroundColor: LANE_COLORS[kind] }}
                      />
                      <span className="tl-avatar">
                        {avatar ? (
                          <img src={avatar} alt="" loading="lazy" />
                        ) : (
                          <span className={`h-2.5 w-2.5 rounded-full ${laneBarClass(kind)}`} />
                        )}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="truncate text-[12px] font-semibold leading-none text-ink">
                          {lane.label}
                        </span>
                        <span
                          className={`w-fit rounded-full px-1.5 py-px text-[9px] font-bold uppercase leading-[1.5] tracking-wide ring-1 ${chip}`}
                        >
                          {chipText}
                        </span>
                      </span>
                    </div>

                    {/* Track. The banding and the inset shading are what stop a
                        wide chart reading as one flat field. */}
                    <div
                      className={`tl-track relative min-h-[56px] bg-track ${
                        rowIdx % 2 ? "tl-row-alt" : ""
                      }`}
                      style={{ width: contentW }}
                    >
                      {/* Today, drawn down the whole chart, not only on the axis */}
                      {todayW > 0 && (
                        <span
                          className="tl-today-col absolute inset-y-0"
                          style={{ left: 0, width: todayW }}
                        />
                      )}

                      {/* Idle: capacity going unused, with the reason on hover.
                          z-[2] keeps it over the hoisted gridlines, as it was
                          when the gridlines were its siblings. */}
                      {idleGaps(lane.jobs, span).map((g, i) => (
                        <span
                          key={`i${i}`}
                          className="tl-idle absolute inset-y-[3px] z-[2] rounded-[3px]"
                          style={{ left: pos(g.start), width: bandW(g.end - g.start) }}
                          title={`No upgrade queued for ${formatTime(g.end - g.start)}`}
                        />
                      ))}

                      {lane.jobs.map((j) => {
                        const { name, level, copy, icon } = barLabel(j);
                        const w = barW(j.duration);
                        const isSelected = selectedKey === j.key;
                        const fam = familyOfJob(j);
                        // Detail is dropped in steps as a bar gets narrower, so a
                        // sliver still shows its icon rather than clipped text.
                        const noText = w < 46;
                        const noDuration = w < 96;
                        const noLevel = w < 132;
                        const capped = isCapped(j.duration);
                        return (
                          <button
                            key={j.key}
                            type="button"
                            onMouseEnter={(e) => {
                              tipPos.current = { x: e.clientX, y: e.clientY };
                              // The tooltip is always mounted, so it can be placed
                              // before the state change that fills it in lands.
                              placeTip();
                              setHover(j);
                            }}
                            onMouseMove={(e) => {
                              tipPos.current = { x: e.clientX, y: e.clientY };
                              placeTip();
                            }}
                            onMouseLeave={() => setHover(null)}
                            onClick={() => setSelectedKey(isSelected ? null : j.key)}
                            aria-label={`${name} ${level}${copy ? ` copy ${copy}` : ""}, ${formatTime(j.duration)}`}
                            className={`tl-sheen tl-bar${capped ? " tl-micro" : ""} absolute bottom-[3px] top-[3px] z-[2] flex cursor-pointer items-center overflow-hidden rounded text-left transition-[filter,box-shadow] duration-200 hover:brightness-[1.18] ${
                              j.inProgress ? "tl-running" : ""
                            } ${
                              isSelected ? "z-[3] ring-2 ring-white/70" : ""
                            } ${noText ? "justify-center" : ""}`}
                            style={{
                              left: pos(j.start),
                              width: w,
                              // The hue is the whole family signal, so it is
                              // set here from data rather than written as a
                              // bg-* class — there are seven families and a
                              // Tailwind map for them would just be this
                              // object spelled a second time.
                              backgroundColor: FAMILY_COLORS[fam],
                            }}
                          >
                            {/* Ink on the bars is near-black, not white: the
                                family hues are deep enough that white text tops
                                out at 4.2:1 and fails on four of the seven,
                                while #0d1017 clears 4.5:1 on every one. That
                                margin is thinner than it was, so the secondary
                                text is solid ink too — a 70% tint of it drops to
                                3.2–4.4:1, under the AA floor for 10px type. */}
                            <span className={`flex w-full min-w-0 items-center ${padCls(w)}`}>
                              {icon && (
                                <img
                                  src={icon}
                                  alt=""
                                  loading="lazy"
                                  /* No drop-shadow: it is a filter pass per icon,
                                     and there is one icon per bar — the bar's own
                                     rim and gloss already lift it off the track. */
                                  className={`shrink-0 object-contain ${iconCls(w)}`}
                                />
                              )}
                              {!noText && (
                                <span className="min-w-0 truncate text-[11px] font-semibold leading-none text-[#0d1017]">
                                  {name}
                                </span>
                              )}
                              {!noText && !noLevel && level && (
                                <span className="shrink-0 text-[10px] font-medium leading-none text-[#0d1017]">
                                  {level}
                                </span>

                              )}
                              {!noText && copy && (
                                <span className="shrink-0 rounded bg-[#0d1017] px-1 py-px text-[9px] font-bold leading-[1.4] text-white/90">
                                  {copy}
                                </span>
                              )}
                              {!noDuration && (
                                <span className="ml-auto shrink-0 pl-2 text-[10px] font-medium tabular-nums leading-none text-[#0d1017]">
                                  {formatTime(j.duration)}
                                </span>
                              )}
                            </span>
                            {j.inProgress && w >= 58 && (
                              <span className="absolute right-1 top-1/2 -translate-y-1/2 rounded bg-[#facc15] px-1 py-px text-[9px] font-extrabold leading-[1.4] text-[#0c0e14]">
                                NOW
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Unavailable windows, over the bars: an upgrade really does keep
                  running while you sleep, and this is what that looks like. */}
              <div
                className="pointer-events-none absolute inset-y-0 z-30"
                style={{ left: LABEL_W, width: contentW }}
              >
                {bands.map((b, i) => (
                  <span
                    key={`b${i}`}
                    className="tl-unavailable absolute inset-y-0"
                    style={{ left: pos(b.start), width: bandW(b.end - b.start) }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Legend — outside the scroller, so it can never scroll out of view. */}
      <div className="mt-3 space-y-2 border-t border-line pt-3">
        {/* What each bar IS — the swatch is the bar's own colour, so the legend
            is a direct key to the chart. */}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
            Upgrade type
          </span>
          {FAMILIES.map((f) => (
            <span key={f} className="flex items-center gap-1.5 text-[11px] text-ink-dim">
              <span className="tl-sw" style={{ backgroundColor: FAMILY_COLORS[f] }} />
              {FAMILY_LABEL[f]}
            </span>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
            State
          </span>
          {STATE_LEGEND.map((l) => (
            <span key={l.key} className="flex items-center gap-1.5 text-[11px] text-ink-dim">
              <span className={l.swatch} />
              {l.label}
            </span>
          ))}
          <span className="ml-auto text-[11px] text-ink-faint">
            <span className="text-ink-dim">n/N</span> = which copy of a building
          </span>
        </div>
      </div>

      {/* Selected upgrade detail card */}
      {selectedJob && selectedDetail && (
        <div className="mt-4 rounded-xl border border-line bg-bg/60 p-4">
          <div className="flex items-center gap-3">
            {images[String(selectedDetail.id)] ? (
              <img
                src={images[String(selectedDetail.id)]}
                alt=""
                className="h-10 w-10 object-contain"
              />
            ) : (
              <span
                className="tl-sw"
                style={{ backgroundColor: FAMILY_COLORS[familyOfJob(selectedJob)] }}
              />
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                <span>{selectedDetail.name}</span>
                {selectedDetail.gearUp && (
                  <span className="rounded bg-amber-400/20 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-amber-400 ring-1 ring-amber-400/40">
                    Gear Up
                  </span>
                )}
                {selectedJob.instances > 1 && (
                  <span className="rounded bg-white/5 px-1.5 py-px text-xs font-bold text-ink-dim ring-1 ring-white/10">
                    copy {selectedJob.instance} of {selectedJob.instances}
                  </span>
                )}
              </div>
              <div className="text-xs text-ink-dim">
                {selectedDetail.gearUp ? (
                  <span>Master Builder Trip · Home Village {selectedDetail.gearUp.hvName}</span>
                ) : (
                  <>
                    Level {selectedDetail.currentLevel} → {selectedDetail.nextLevel}
                  </>
                )}
                {selectedJob.inProgress && (
                  <span className="ml-2 text-amber-300">· running now</span>
                )}
              </div>
            </div>
            <button
              onClick={() => setSelectedKey(null)}
              aria-label="Close details"
              className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-faint transition hover:bg-surface-2 hover:text-ink"
            >
              ×
            </button>
          </div>
          <div className="mt-3 grid gap-x-8 gap-y-1.5 text-sm tabular-nums sm:grid-cols-2">
            <span className="text-ink-dim">
              {selectedJob.inProgress ? "Remaining" : "Time"}:{" "}
              <span className="text-ink">{formatTime(selectedJob.duration)}</span>
            </span>
            {selectedDetail.cost != null && !selectedJob.inProgress && (
              <span className="text-ink-dim">
                Cost per copy:{" "}
                <span className={resourceClass(selectedDetail.resource)}>
                  {formatCost(selectedDetail.cost)}
                </span>
              </span>
            )}
            <span className="text-ink-dim">
              Starts:{" "}
              <span className="text-ink">
                {selectedJob.start === 0 && selectedJob.inProgress
                  ? "in progress"
                  : fmtDateTime(nowEpochMs + selectedJob.start * 1000)}
              </span>
            </span>
            <span className="text-ink-dim">
              Finishes:{" "}
              <span className="text-ink">
                {fmtDateTime(nowEpochMs + selectedJob.end * 1000)}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* Hover tooltip, with a caret pointing back at the bar. Always mounted —
          `placeTip` writes its position straight to the DOM, and it has to exist
          before the hover state that fills it in does. Empty and hidden the rest
          of the time. */}
      <div
        ref={tipRef}
        className={`pointer-events-none fixed z-50 w-72 rounded-xl border border-white/20 bg-[#0f172a]/96 p-3 shadow-2xl shadow-black/60 ${
          hover ? "" : "hidden"
        }`}
        style={{ left: 8, top: 0 }}
      >
        {hover && (
          <>
            <div className="flex items-center gap-2">
              {hoverDetail && images[String(hoverDetail.id)] && (
                <img
                  src={images[String(hoverDetail.id)]}
                  alt=""
                  className="h-7 w-7 shrink-0 object-contain"
                />
              )}
              <span className="truncate text-[13px] font-bold leading-tight text-white">
                {hoverDetail?.name ?? hover.name}
              </span>
              {hoverDetail?.gearUp && (
                <span className="shrink-0 rounded bg-amber-400/20 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-amber-300 ring-1 ring-amber-400/40">
                  Gear Up
                </span>
              )}
              {hover.instances > 1 && (
                <span className="ml-auto shrink-0 rounded bg-white/10 px-1.5 py-px text-[10px] font-bold text-white/85">
                  {hover.instance}/{hover.instances}
                </span>
              )}
            </div>
            {hoverDetail && (
              <div className="mt-1 text-[11px] text-white/70">
                {hoverDetail.gearUp ? (
                  <span>Master Builder Trip · Home Village {hoverDetail.gearUp.hvName}</span>
                ) : (
                  <>
                    Level {hoverDetail.currentLevel} → {hoverDetail.nextLevel}
                    {hover.instances > 1 && " · one copy"}
                  </>
                )}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/80">
              {hover.inProgress ? (
                <span className="font-semibold text-amber-300">
                  Currently upgrading · {formatTime(hover.duration)} left
                </span>
              ) : (
                <span>
                  Time: <span className="text-white">{formatTime(hover.duration)}</span>
                </span>
              )}
              {hoverDetail && hoverDetail.cost != null && !hover.inProgress && (
                <span>
                  Cost:{" "}
                  <span className={resourceClass(hoverDetail.resource)}>
                    {formatCost(hoverDetail.cost)}
                  </span>
                </span>
              )}
            </div>
            <div className="mt-1.5 text-[11px] tabular-nums text-white/60">
              {fmtDateTime(nowEpochMs + hover.start * 1000)} →{" "}
              {fmtDateTime(nowEpochMs + hover.end * 1000)}
            </div>
            {isCapped(hover.duration) && (
              <div className="mt-1 text-[10px] italic text-white/45">
                Bar drawn at the icon minimum, not to scale
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
