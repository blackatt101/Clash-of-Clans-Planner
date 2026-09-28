/**
 * Recurring "unavailable" windows — spans of the week when no work happens
 * (sleep, school, work). Times are minutes-of-day in the browser's local zone.
 *
 * `end` may be less than `start` to express a window that crosses midnight
 * (e.g. start=22:00 → 1320, end=07:00 → 420 means 10pm–7am). For an overnight
 * window the *start* day is the one that decides whether it runs, so a Mon–Fri
 * block that begins at 23:00 also covers Saturday 00:00–07:00.
 *
 * A zero-width window (`start === end`) blocks nothing: the natural path is a
 * 00:00–00:00 span, which a user types while mid-editing the clock fields.
 * It is treated as "no block" rather than a 24-hour block, so a silently
 * mis-set field can no longer schedule the whole plan a month out.
 */
export interface BlockSpec {
  id: string;
  label: string;
  start: number; // minutes-of-day
  end: number; // minutes-of-day, may be < start (overnight)
  days: number[]; // 0 = Sunday … 6 = Saturday; empty = every day
}

const MIN = 24 * 60;
const DAY_MS = 86400000;
/**
 * How far `nextUnblocked` will walk looking for an opening before deciding the
 * windows have none. Measured from the requested instant; see the note there.
 */
const ESCAPE_HORIZON_MS = 400 * DAY_MS;

/** Local midnight for `t`, shifted by `offset` days. DST-safe (uses the Date API). */
function dayStart(t: number, offset = 0): { ms: number; dow: number } {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return { ms: d.getTime(), dow: d.getDay() };
}

function runsOn(spec: BlockSpec, dow: number): boolean {
  return spec.days.length === 0 || spec.days.includes(dow);
}

/**
 * The instant at wall-clock minute `min` on the local day that contains `ms`.
 *
 * Built through the `Date` constructor, which reads the fields as local wall
 * clock, rather than by adding minutes to local midnight as absolute
 * milliseconds. Those two agree on every ordinary day and disagree on the two
 * days a year the zone changes offset: adding 9h to local midnight on a
 * spring-forward day lands at 10:00 local, so a 09:00 work window would drift to
 * 10:00–18:00 — and the timeline bands, which are drawn from the same function,
 * would drift with it and hide the mistake. `min` may exceed 1439, which rolls
 * into the next day.
 */
function wallClock(ms: number, min: number): number {
  const d = new Date(ms);
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    Math.floor(min / 60),
    min % 60,
    0,
    0,
  ).getTime();
}

/**
 * The occurrence of `spec` that begins on the day `offset` days from `t`, as an
 * absolute [start, end) epoch range, or null when the window doesn't run that day.
 */
function occurrence(t: number, spec: BlockSpec, offset: number): { s: number; e: number } | null {
  const { ms, dow } = dayStart(t, offset);
  if (!runsOn(spec, dow)) return null;
  const s = wallClock(ms, spec.start);
  // start === end is the degenerate "no window" case (a 00:00–00:00 span has
  // zero width and blocks nothing — otherwise a 24 h clamp would turn one
  // mistyped field into an all-day block), not midnight-crossing:
  const endMin =
    spec.end === spec.start ? spec.start : spec.end > spec.start ? spec.end : spec.end + MIN;
  const e = wallClock(ms, endMin);
  // For any other start === end spec (e.g. a stored 12:00–12:00 legacy state),
  // clamp to the DST-correct next local midnight rather than +MIN, which would
  // block 48 h straight on a fall-back day / 47 h on a spring-forward day.
  return spec.end === spec.start && spec.start !== 0
    ? { s, e: wallClock(dayStart(t, offset + 1).ms, 0) }
    : { s, e };
}

/** The occurrence covering `t`, if any. Yesterday's is checked for overnight tails. */
function covering(t: number, spec: BlockSpec): { s: number; e: number } | null {
  for (const offset of [0, -1]) {
    const o = occurrence(t, spec, offset);
    if (o && t >= o.s && t < o.e) return o;
  }
  return null;
}

/**
 * A recurring "unavailable" window. Work (upgrades) pauses while inside and
 * resumes at `unblockedAt`; work that is not yet running stops at `nextBlockAt`.
 */
export interface UnavailableWindow {
  blocked: (t: number) => boolean;
  unblockedAt: (t: number) => number;
  nextBlockAt: (t: number) => number;
}

/** A recurring block (or a legacy CWL-style predicate) as an UnavailableWindow. */
export function blockWindow(spec: BlockSpec): UnavailableWindow {
  return {
    blocked: (t) => covering(t, spec) != null,
    unblockedAt: (t) => covering(t, spec)?.e ?? t,
    nextBlockAt: (t) => {
      for (let d = 0; d <= 7; d++) {
        const { ms, dow } = dayStart(t, d);
        if (!runsOn(spec, dow)) continue;
        const s = wallClock(ms, spec.start);
        if (s > t) return s;
      }
      return t + 7 * DAY_MS;
    },
  };
}

/** Windows for a whole block list. */
export function blockWindows(specs: BlockSpec[]): UnavailableWindow[] {
  return specs.map(blockWindow);
}

/**
 * Absolute occurrences of `spec` that overlap [fromMs, toMs), for drawing the
 * shading bands on the timeline. Walks day by day from the day before `fromMs`
 * so an overnight window that started yesterday is still caught.
 */
export function blockOccurrences(
  spec: BlockSpec,
  fromMs: number,
  toMs: number,
): { s: number; e: number }[] {
  const out: { s: number; e: number }[] = [];
  const maxDays = Math.ceil((toMs - fromMs) / DAY_MS) + 2;
  for (let d = -1; d <= maxDays; d++) {
    const o = occurrence(fromMs, spec, d);
    if (!o) continue;
    if (o.s > toMs) break;
    if (o.e > fromMs && o.s < toMs) out.push(o);
  }
  return out;
}

/**
 * Clan War League hero block: heroes should stay available on the 1st–10th of
 * each month. `blocked` is true during that span (local time).
 */
export function cwlWindow(): UnavailableWindow {
  const blocked = (t: number) => new Date(t).getDate() <= 10;
  return {
    blocked,
    // The contract is `unblockedAt(t) >= t` whenever not blocked: when `t`
    // falls on an unblocked day (the 11th onward) there is no waiting — the
    // span opens "now", not on some past 11th.
    unblockedAt: (t) =>
      blocked(t) ? new Date(new Date(t).getFullYear(), new Date(t).getMonth(), 11, 0, 0, 0, 0).getTime() : t,
    nextBlockAt: (t) => {
      const d = new Date(t);
      return new Date(d.getFullYear(), d.getMonth() + 1, 1, 0, 0, 0, 0).getTime();
    },
  };
}

/**
 * The first moment at or after `t` when none of `windows` blocks.
 *
 * This is what "unavailable" means for a planner: you are not there to start the
 * next upgrade, so it waits. Work already running is never paused — a builder
 * finishes what it started.
 */
export function nextUnblocked(t: number, windows: UnavailableWindow[]): number {
  let cur = t;
  // Windows can overlap (sleep + CWL), so re-test after each jump. The escape
  // bound is measured from the hop just taken (`cur`), not from the original
  // `t`: a legitimate chain of overlapping +1-day blocks walks freely, while a
  // window with no exit (every `unblockedAt` lands back inside the next
  // occurrence — today only the degenerate all-day case, since zero-width
  // spans block nothing) trips the bound after ~400 days of hops and the
  // caller is handed the requested moment: the job lands where it was wanted
  // and the window shows as an unsatisfiable span, rather than the whole plan
  // being dragged into 2028 by one mis-set field.
  for (let guard = 0; guard < 512; guard++) {
    const w = windows.find((x) => x.blocked(cur));
    if (!w) return cur;
    const next = w.unblockedAt(cur);
    if (next <= cur) return cur;
    if (next - cur > ESCAPE_HORIZON_MS) return t;
    cur = next;
  }
  return cur;
}

/** Parse "HH:MM" into minutes-of-day, or null when the input is not a real clock value. */
export function parseClock(s: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Format minutes-of-day back to "HH:MM". */
export function formatClock(minutes: number): string {
  const m = ((minutes % MIN) + MIN) % MIN;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "23:00–07:00 · Mon–Fri" / "23:00–07:00 · every day" */
export function describeBlock(spec: BlockSpec): string {
  const span = `${formatClock(spec.start)}–${formatClock(spec.end)}`;
  if (spec.days.length === 0 || spec.days.length === 7) return `${span} · every day`;
  const sorted = [...spec.days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  const name = (d: number) => WEEKDAYS[d];
  const label = contiguous && sorted.length > 2
    ? `${name(sorted[0])}–${name(sorted[sorted.length - 1])}`
    : sorted.map(name).join(", ");
  return `${span} · ${label}`;
}
