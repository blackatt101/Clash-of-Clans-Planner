"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { DEFAULT_WEIGHTS, OFFENSE_GROUPS, type OffenseWeights } from "@/lib/settings";
import { weightBoost } from "@/lib/offense";

interface Props {
  open: boolean;
  onClose: () => void;
  weights: OffenseWeights;
  onChange: (next: OffenseWeights) => void;
}

/** Groups that count as "offense" when reporting the split. */
const OFFENSE_KEYS = new Set(["hero", "lab", "pet", "army"]);

const PRESETS: { label: string; hint: string; build: () => OffenseWeights }[] = [
  {
    label: "Offense first",
    hint: "Army, heroes and pets jump the queue",
    build: () => ({
      ...DEFAULT_WEIGHTS,
      hero: 75,
      lab: 75,
      pet: 70,
      army: 65,
      defense: 35,
      trap: 30,
      resource: 30,
      townhall: 45,
    }),
  },
  {
    label: "Balanced",
    hint: "Everything even — the strategy preset decides",
    build: () => ({ ...DEFAULT_WEIGHTS }),
  },
  {
    label: "Defense first",
    hint: "Structures and traps before army",
    build: () => ({
      ...DEFAULT_WEIGHTS,
      hero: 40,
      lab: 40,
      pet: 40,
      army: 45,
      defense: 75,
      trap: 70,
      resource: 60,
      townhall: 55,
    }),
  },
];

/**
 * Offense Percentages: how strongly each group pulls the schedule toward it.
 *
 * The sliders feed `weightBoost`, which is signed around the 50% midpoint — so
 * dragging one group up doesn't silently reward every group the user never
 * touched. The split readout is derived, not stored, so it can't disagree with
 * the sliders.
 */
export default function OffensePercentages({ open, onClose, weights, onChange }: Props) {
  // The parent remounts this dialog each time it opens (keyed on open), so
  // the lazy initializer already re-seeds from the settings — Cancel discards
  // edits because the component is torn down, not because state was reset.
  const [local, setLocal] = useState<OffenseWeights>(weights);

  const set = (key: string, value: number) => setLocal((w) => ({ ...w, [key]: value }));

  if (!open) return null;

  const offenseMean =
    [...OFFENSE_KEYS].reduce((sum, k) => sum + (local[k] ?? 50), 0) / OFFENSE_KEYS.size;
  // "rest" is every group the scheduler actually reads that is not offense —
  // including the "other" bucket (gear-up buildings, misc) that has no slider.
  // Averaging the slider means would ignore it, so derive the baseline from the
  // full weight map instead.
  const allKeys = new Set<string>([...OFFENSE_KEYS, ...Object.keys(DEFAULT_WEIGHTS)]);
  const restKeys = [...allKeys].filter((k) => !OFFENSE_KEYS.has(k));
  const restMean =
    restKeys.reduce((sum, k) => sum + (local[k] ?? 50), 0) / Math.max(1, restKeys.length);
  const offenseShare = Math.round((offenseMean / Math.max(1, offenseMean + restMean)) * 100);

  return (
    <Modal
      title="Offense Percentages"
      subtitle="How much each group pulls the schedule toward it"
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="mr-auto rounded-xl border border-line px-4 py-2 text-sm text-ink-dim transition hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onChange(local);
              onClose();
            }}
            className="rounded-xl bg-gradient-to-b from-gold-strong to-gold px-5 py-2 text-sm font-semibold text-[#1a1408] shadow-lg shadow-gold/20 transition hover:brightness-105 active:scale-[0.98]"
          >
            Apply
          </button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => setLocal(p.build())}
            title={p.hint}
            className="rounded-xl border border-line px-3 py-1.5 text-sm text-ink-dim transition hover:border-gold/50 hover:text-ink"
          >
            {p.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 rounded-xl border border-line bg-bg px-3 py-1.5">
          <span className="text-xs text-ink-faint">Split</span>
          <span className="text-sm font-semibold text-gold tabular-nums">
            {offenseShare}% offense
          </span>
          <span className="text-sm text-ink-dim tabular-nums">/ {100 - offenseShare}%</span>
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-gradient-to-r from-lane-lab to-gold transition-all"
          style={{ width: `${offenseShare}%` }}
        />
      </div>

      <div className="mt-5 space-y-4">
        {OFFENSE_GROUPS.map((g) => {
          const value = local[g.key] ?? 50;
          const boost = weightBoost(local, g.key);
          return (
            <div key={g.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-ink">{g.label}</span>
                <span className="text-xs text-ink-faint">
                  {boost > 0 && (
                    <span className="text-emerald-400">+{boost} earlier</span>
                  )}
                  {boost < 0 && <span className="text-amber-400">{boost} later</span>}
                  {boost === 0 && "neutral"}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={value}
                  aria-label={`${g.label} priority`}
                  onChange={(e) => set(g.key, Number(e.target.value))}
                  className="w-full accent-gold"
                />
                <span className="w-10 shrink-0 text-right text-sm font-medium text-gold tabular-nums">
                  {value}
                </span>
              </div>
              <div className="text-xs text-ink-faint">{g.hint}</div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
