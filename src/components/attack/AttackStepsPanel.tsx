"use client";

/**
 * The step-by-step instruction panel: the whole deployment
 * sequence as a readable list, so the attack can be followed
 * as instructions — not squinted at on the map.
 *
 * The same reveal rules the map overlay uses drive the list:
 * the CURRENT step is highlighted, COMPLETED steps are subdued
 * and FUTURE steps are neutral. Clicking a row focuses the map
 * on that step; the header row resets to the whole plan.
 *
 * Each row carries the step's own words (unit, count, purpose,
 * target) — the renderer never invents instructions.
 */
import { resolveEntity } from "@/lib/attack/catalog";
import { iconForSlug } from "@/lib/attack/iconFor";
import { stepVis } from "@/lib/attack/steps";
import { phaseColor, phaseIndexOf } from "@/lib/attack/visuals";
import type { AttackStrategy } from "@/lib/attack/types";

interface AttackStepsPanelProps {
  strategy: AttackStrategy;
  /** Index into deployment_plan; -1 = the whole plan. */
  activeStep: number;
  onSelect: (index: number) => void;
  images: Record<string, string>;
}

export function AttackStepsPanel({
  strategy,
  activeStep,
  onSelect,
  images,
}: AttackStepsPanelProps) {
  const steps = strategy.deployment_plan;
  const phases = strategy.attack_phases ?? [];
  const colorOf = (phaseName: string) =>
    phaseColor(phaseIndexOf(phaseName, phases));

  return (
    <section className="surface-panel card-lit rounded-xl p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wide text-ink-dim">
          Attack sequence
        </h3>
        <button
          className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-[11px] font-medium text-ink-dim transition hover:text-ink"
          onClick={() => onSelect(-1)}
          aria-pressed={activeStep < 0}
        >
          All steps
        </button>
      </div>

      <ol className="flex flex-col gap-1.5">
        {steps.map((d, i) => {
          const vis = stepVis(i, activeStep);
          const name = resolveEntity(d.unit)?.ref.name ?? d.unit;
          const color = colorOf(d.phase);
          const icon = iconForSlug(d.unit, images);
          const current = vis === "current";
          const done = vis === "done";
          return (
            <li key={d.step}>
              <button
                onClick={() => onSelect(i)}
                aria-pressed={current}
                className={`flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${
                  current
                    ? "border-gold/60 bg-gold/5"
                    : done
                      ? "border-line bg-surface-2/40 opacity-45 hover:opacity-75"
                      : "border-line/60 bg-surface-2/20 hover:border-line hover:bg-surface-2/50"
                }`}
              >
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-[#080c12]"
                  style={{ backgroundColor: color }}
                  title={d.phase}
                >
                  {d.step}
                </span>
                {icon ? (
                  <img
                    src={icon}
                    alt={name}
                    className="mt-0.5 h-6 w-6 shrink-0 object-contain"
                  />
                ) : (
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[10px] font-bold text-ink-dim">
                    {d.unit.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className={`text-[13px] ${done || vis === "future" ? "text-ink-dim" : "font-semibold text-ink"}`}>
                    {d.count > 1 ? `${d.count}× ` : ""}
                    {name}
                  </span>
                  {d.purpose ? (
                    <span className="block text-[12px] leading-snug text-ink-dim">
                      {d.purpose}
                    </span>
                  ) : null}
                  {d.target ? (
                    <span className="mt-0.5 block text-[11px] uppercase tracking-wide text-ink-faint">
                      → {d.target}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <p className="mt-2.5 border-t border-line pt-2 text-[11px] leading-snug text-ink-faint">
        Drag the ① marker on the map to adjust a deployment; double-click a
        path point to remove it. Steps reveal one at a time — completed
        actions stay subdued, the current action is highlighted.
      </p>
    </section>
  );
}
