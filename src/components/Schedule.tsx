"use client";

import { formatTime } from "@/lib/format";
import type { AssignedJob, JobKind, ScheduleResult } from "@/lib/schedule";
import type { UpgradeOption } from "@/lib/upgrade";
import type { Village } from "@/lib/types";
import Timeline from "@/components/Timeline";
import type { BlockSpec } from "@/lib/sleep";
import { FAMILY_COLORS, laneBarClass } from "@/lib/categoryColor";

interface Props {
  schedule: ScheduleResult;
  horizon?: number;
  blocks: BlockSpec[];
  nowEpochMs: number;
  details: Map<number, UpgradeOption>;
  images: Record<string, string>;
  village: Village;
  onShare: () => void;
  onCopySchedule: () => void;
  onOpenShare: () => void;
  shareMsg: string | null;
  onChangeStrategy?: () => void;
  /**
   * A line under the title, for a plan whose meaning is not obvious from the
   * bars — chiefly the B.O.B chain, which is only the critical path and stops
   * at the sixth builder rather than at a maxed base.
   */
  note?: string;
}

/** All the copies of one upgrade that landed on a single lane. */
interface Group {
  uid: number;
  name: string;
  jobs: AssignedJob[];
  /** Combined duration of every copy on this lane. */
  total: number;
  inProgress: boolean;
}

/**
 * One row per upgrade, not per copy. The export's `cnt` turns 7 Gold Mines at
 * level 12 into 7 scheduled jobs, and listing the same name seven times reads as
 * a bug rather than as seven real upgrades — so they collapse into "×7" here,
 * while the timeline still draws all seven bars at their distinct times.
 */
function groupJobs(jobs: AssignedJob[], details: Map<number, UpgradeOption>): Group[] {
  const byUid = new Map<number, Group>();
  for (const j of jobs) {
    const found = byUid.get(j.uid);
    if (found) {
      found.jobs.push(j);
      found.total += j.inProgress ? 0 : j.duration;
    } else {
      byUid.set(j.uid, {
        uid: j.uid,
        name: details.get(j.uid)?.name ?? j.name,
        jobs: [j],
        total: j.inProgress ? 0 : j.duration,
        inProgress: !!j.inProgress,
      });
    }
  }
  return [...byUid.values()];
}

/** The colour a job row wears — the same one its bar carries in the timeline. */
const famOf = (j: AssignedJob) => j.family ?? "buildings";

function kindOfLane(key: string): JobKind {
  return key === "lab" ? "lab" : key === "pethouse" ? "pet" : "builder";
}

/** When a job starts, as "Now" / "in 3d 4h" / a date once it is far out. */
function startLabel(start: number, nowEpochMs: number): string {
  if (start <= 60) return "Now";
  if (start < 2 * 86400) return `in ${formatTime(start)}`;
  return new Date(nowEpochMs + start * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function Schedule({
  schedule,
  horizon,
  blocks,
  nowEpochMs,
  details,
  images,
  village,
  onShare,
  onCopySchedule,
  onOpenShare,
  shareMsg,
  onChangeStrategy,
  note,
}: Props) {
  const finishDate = new Date(nowEpochMs + schedule.makespan * 1000).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", year: "numeric" },
  );

  return (
    <section className="card-lit overflow-hidden rounded-2xl border border-gold/20 bg-gradient-to-b from-surface to-bg shadow-xl shadow-black/15">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line bg-surface/55 px-5 py-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_9px_rgba(52,211,153,0.6)]" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300">Active build plan</span>
          </div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink">Build plan</h2>
          <p className="mt-1 text-sm text-ink-dim">
            Total wall-clock time{" "}
            <span className="font-semibold text-gold">{formatTime(schedule.makespan)}</span>
            {" · "}finishes <span className="text-ink">{finishDate}</span>
            {schedule.beyondHorizon > 0 && (
              <span className="ml-1 rounded bg-red-500/10 px-1.5 py-0.5 text-xs text-red-400 ring-1 ring-red-500/25">
                {schedule.beyondHorizon} beyond horizon
              </span>
            )}
          </p>
          {note && (
            <p className="mt-2 max-w-prose rounded-lg border border-gold/15 bg-gold/[0.05] px-2.5 py-1.5 text-xs leading-relaxed text-gold/80">{note}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onChangeStrategy && (
            <button
              onClick={onChangeStrategy}
              className="rounded-xl border border-line bg-surface/50 px-3.5 py-2 text-sm text-ink-dim transition hover:border-gold/50 hover:bg-surface-2/60 hover:text-ink active:scale-[0.97]"
            >
              Change Strategy
            </button>
          )}
          <button
            onClick={onCopySchedule}
            className="rounded-xl border border-line bg-surface/50 px-3.5 py-2 text-sm text-ink-dim transition hover:border-gold/50 hover:bg-surface-2/60 hover:text-ink active:scale-[0.97]"
          >
            Copy schedule
          </button>
          <button
            onClick={onOpenShare}
            className="rounded-xl border border-line bg-surface/50 px-3.5 py-2 text-sm text-ink-dim transition hover:border-gold/50 hover:bg-surface-2/60 hover:text-ink active:scale-[0.97]"
          >
            Export / Import
          </button>
          <button
            onClick={onShare}
            className="rounded-xl bg-gradient-to-br from-gold-strong to-gold px-4 py-2 text-sm font-semibold text-[#1a1408] shadow-lg shadow-gold/25 transition hover:brightness-105 active:scale-[0.97]"
          >
            Share plan
          </button>
        </div>
      </div>

      <div className="px-5 py-5">
        {/* Keyed on village: a lane filter or a selected job belongs to the
            plan being looked at, so remounting on a village switch clears both
            without a reset effect (the Timeline reads its state fresh). */}
        <Timeline
          key={village}
          schedule={schedule}
          horizon={horizon}
          blocks={blocks}
          nowEpochMs={nowEpochMs}
          details={details}
          images={images}
          village={village}
          onChangeStrategy={onChangeStrategy}
        />
      </div>

      <div className="grid gap-3 border-t border-line px-5 py-5 sm:grid-cols-2 lg:grid-cols-3">
        {schedule.lanes.map((lane) => (
          <div
            key={lane.key}
            className="rounded-xl border border-line bg-bg/50 p-3.5"
          >
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2 font-medium text-ink">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${laneBarClass(kindOfLane(lane.key))}`}
                />
                <span className="truncate">{lane.label}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                {formatTime(lane.jobs.reduce((s, j) => Math.max(s, j.end), 0))}
              </span>
            </div>
            {lane.jobs.length === 0 ? (
              <p className="mt-2 text-sm text-ink-faint">Idle</p>
            ) : (
              <ul className="mt-2.5 space-y-1.5 text-sm">
                {groupJobs(lane.jobs, details).map((g) => {
                  const d = details.get(g.uid);
                  const img = d ? images[String(d.id)] : undefined;
                  const copies = g.jobs.length;
                  const first = g.jobs.reduce((a, b) => (a.start <= b.start ? a : b));
                  const last = g.jobs.reduce((a, b) => (a.end >= b.end ? a : b));
                  return (
                    <li key={`${g.uid}-${first.key}`} className="flex items-start gap-2 text-ink-dim">
                      {img ? (
                        <img
                          src={img}
                          alt=""
                          loading="lazy"
                          className="mt-0.5 h-5 w-5 shrink-0 object-contain"
                        />
                      ) : (
                        <span
                          className="tl-sw mt-0.5"
                          style={{ backgroundColor: FAMILY_COLORS[famOf(first)] }}
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5">
                          <span
                            aria-hidden
                            className="mt-[-2px] h-2 w-2 shrink-0 self-center rounded-full"
                            style={{ backgroundColor: FAMILY_COLORS[famOf(first)] }}
                          />
                          <span className="truncate text-ink">
                            {g.inProgress && <span className="mr-1 text-amber-300">⏳</span>}
                            {g.name}
                          </span>
                          {d && (
                            <span className="shrink-0 text-xs text-ink-faint">
                              {d.gearUp ? (
                                <span className="rounded bg-amber-400/20 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-amber-400 ring-1 ring-amber-400/30">
                                  Gear Up
                                </span>
                              ) : (
                                `${d.currentLevel}→${d.nextLevel}`
                              )}
                            </span>
                          )}
                          {copies > 1 && (
                            <span className="shrink-0 rounded bg-white/5 px-1 text-[10px] font-bold text-ink-dim ring-1 ring-white/10">
                              ×{copies}
                            </span>
                          )}
                        </span>
                        {/* With copies, the span matters more than the sum: they
                            run in parallel, so the lane frees up at `last`, not
                            after `copies × duration`. */}
                        <span className="text-[11px] text-ink-faint">
                          {copies > 1
                            ? `${formatTime(g.total)} of work · ${formatTime(
                                last.end - first.start,
                              )} span`
                            : formatTime(g.total)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-xs tabular-nums text-ink-faint">
                        {g.inProgress
                          ? `${formatTime(last.duration)} left`
                          : startLabel(first.start, nowEpochMs)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>

      {shareMsg && (
        <p className="border-t border-line px-5 py-3 text-sm text-emerald-300">{shareMsg}</p>
      )}
    </section>
  );
}
