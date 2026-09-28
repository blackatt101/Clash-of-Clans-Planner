"use client";

import { formatClock, parseClock, WEEKDAYS, type BlockSpec } from "@/lib/sleep";

interface Props {
  blocks: BlockSpec[];
  onChange: (next: BlockSpec[]) => void;
}

const PRESETS: { label: string; spec: () => Omit<BlockSpec, "id"> }[] = [
  {
    label: "Sleep 23:00–07:00",
    spec: () => ({ label: "Sleep", start: 23 * 60, end: 7 * 60, days: [] }),
  },
  {
    label: "Work 09:00–17:00, Mon–Fri",
    spec: () => ({
      label: "Work",
      start: 9 * 60,
      end: 17 * 60,
      days: [1, 2, 3, 4, 5],
    }),
  },
  {
    label: "School 08:00–15:00, Mon–Fri",
    spec: () => ({
      label: "School",
      start: 8 * 60,
      end: 15 * 60,
      days: [1, 2, 3, 4, 5],
    }),
  },
];

const timeCls =
  "rounded-lg border border-line bg-bg px-2 py-1.5 text-sm text-ink tabular-nums focus:border-gold/60 focus:outline-none";

let blockSeq = 0;
const nextId = () => `block-${Date.now().toString(36)}-${blockSeq++}`;

/**
 * Editor for the recurring spans when nothing is upgraded. Upgrades never start
 * inside one and are paused by it, so the schedule reflects the hours a real
 * player can actually log in.
 */
export default function UnavailableWindows({ blocks, onChange }: Props) {
  const patch = (id: string, next: Partial<BlockSpec>) =>
    onChange(blocks.map((b) => (b.id === id ? { ...b, ...next } : b)));

  // A <input type="time"> fires change with an empty string mid-edit; treating
  // that as 00:00 would silently corrupt the block. parseClock returns null for
  // anything that is not a real HH:MM, so the patch only happens on success.
  const onTime = (b: BlockSpec, field: "start" | "end") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseClock(e.target.value);
    if (v == null) return;
    patch(b.id, { [field]: v });
  };

  const remove = (id: string) => onChange(blocks.filter((b) => b.id !== id));

  const add = (spec: Omit<BlockSpec, "id">) => onChange([...blocks, { ...spec, id: nextId() }]);

  const toggleDay = (b: BlockSpec, day: number) => {
    // An empty list means "every day"; the first click makes the selection explicit.
    const current = b.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : b.days;
    const next = current.includes(day)
      ? current.filter((d) => d !== day)
      : [...current, day].sort((a, z) => a - z);
    patch(b.id, { days: next.length === 7 ? [] : next });
  };

  return (
    <div>
      {blocks.length === 0 ? (
        <p className="text-sm text-ink-faint">
          No windows — the planner assumes you can start the next upgrade the moment the last
          one ends.
        </p>
      ) : (
        <ul className="space-y-2">
          {blocks.map((b) => {
            const activeDays = b.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : b.days;
            return (
              <li key={b.id} className="rounded-xl border border-line bg-bg/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={b.label}
                    aria-label="Window name"
                    onChange={(e) => patch(b.id, { label: e.target.value })}
                    className="w-28 rounded-lg border border-line bg-bg px-2 py-1.5 text-sm font-medium text-ink focus:border-gold/60 focus:outline-none"
                  />
                  <input
                    type="time"
                    aria-label={`${b.label} starts`}
                    value={formatClock(b.start)}
                    onChange={(e) => {
                      const v = parseClock(e.target.value);
                      if (v != null) patch(b.id, { start: v });
                    }}
                    className={timeCls}
                  />
                  <span className="text-ink-faint">→</span>
                  <input
                    type="time"
                    aria-label={`${b.label} ends`}
                    value={formatClock(b.end)}
                    onChange={(e) => {
                      const v = parseClock(e.target.value);
                      if (v != null) patch(b.id, { end: v });
                    }}
                    className={timeCls}
                  />
                  <button
                    onClick={() => remove(b.id)}
                    aria-label={`Remove ${b.label}`}
                    className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition hover:bg-surface-2 hover:text-red-300"
                  >
                    ×
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {WEEKDAYS.map((name, day) => {
                    const on = activeDays.includes(day);
                    return (
                      <button
                        key={name}
                        onClick={() => toggleDay(b, day)}
                        aria-pressed={on}
                        title={name}
                        className={`h-7 w-9 rounded-lg text-[11px] font-medium transition ${
                          on
                            ? "bg-gold/80 text-[#1a1408]"
                            : "border border-line text-ink-faint hover:border-gold/40 hover:text-ink"
                        }`}
                      >
                        {name}
                      </button>
                    );
                  })}
                  <span className="ml-1 text-xs text-ink-faint">
                    {b.days.length === 0 ? "every day" : ""}
                    {b.end <= b.start && " · crosses midnight"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => add({ label: "Unavailable", start: 23 * 60, end: 7 * 60, days: [] })}
          className="rounded-lg border border-dashed border-line-strong px-3 py-1.5 text-sm text-ink-dim transition hover:border-gold/60 hover:text-ink"
        >
          + Add block
        </button>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => add(p.spec())}
            className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-faint transition hover:border-gold/50 hover:text-ink"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
