"use client";

/**
 * AttackTimeline: Visual timeline showing attack phase progression
 * with clickable steps (PROMPT D §17).
 *
 * Displays phases as connected nodes with vertical flow showing
 * the attack sequence. Current step is highlighted, completed steps
 * are subdued, future steps are neutral.
 */
import { useMemo } from "react";
import type { AttackStrategy } from "@/lib/attack/types";
import { phaseColor, phaseIndexOf } from "@/lib/attack/visuals";
import { stepVis } from "@/lib/attack/steps";

export interface AttackTimelineProps {
  strategy: AttackStrategy;
  activeStep: number;
  onStepSelect: (index: number) => void;
}

export function AttackTimeline({
  strategy,
  activeStep,
  onStepSelect,
}: AttackTimelineProps) {
  const steps = strategy.deployment_plan;
  const phases = strategy.attack_phases ?? [];

  // Group steps by phase for timeline visualization
  const phaseGroups = useMemo(() => {
    const groups: Array<{
      phaseName: string;
      color: string;
      stepIndices: number[];
      description?: string;
    }> = [];

    for (const step of steps) {
      let group = groups.find((g) => g.phaseName === step.phase);
      if (!group) {
        group = {
          phaseName: step.phase,
          color: phaseColor(phaseIndexOf(step.phase, phases)),
          stepIndices: [],
          description: phases.find(
            (p) => p.name.toLowerCase() === step.phase.toLowerCase(),
          )?.description,
        };
        groups.push(group);
      }
      group.stepIndices.push(steps.indexOf(step));
    }

    return groups;
  }, [steps, phases]);

  // Determine if a phase is current, done, or future
  const getPhaseStatus = (stepIndices: number[]) => {
    if (activeStep < 0) return "all";
    const current = stepIndices.includes(activeStep);
    const allDone = stepIndices.every((idx) => stepVis(idx, activeStep) === "done");
    const anyFuture = stepIndices.some((idx) => stepVis(idx, activeStep) === "future");

    if (current) return "current";
    if (allDone) return "done";
    if (anyFuture) return "future";
    return "all";
  };

  return (
    <div className="surface-panel card-lit rounded-xl p-4">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-dim">
        Attack Timeline
      </h3>

      <div className="relative">
        {/* Vertical timeline connector */}
        <div className="absolute left-4 top-3 bottom-3 w-0.5 bg-line" />

        <div className="flex flex-col gap-2">
          {phaseGroups.map((group, idx) => {
            const status = getPhaseStatus(group.stepIndices);
            const isCurrent = status === "current";
            const isDone = status === "done";
            const opacity = isDone ? 0.5 : isCurrent ? 1 : 0.7;

            return (
              <div key={idx} className="relative">
                {/* Phase node */}
                <button
                  onClick={() => {
                    // Jump to first step of this phase
                    onStepSelect(group.stepIndices[0]);
                  }}
                  className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                    isCurrent
                      ? "border-gold/60 bg-gold/5"
                      : "border-line/60 bg-surface-2/30 hover:border-line hover:bg-surface-2/50"
                  }`}
                  style={{ opacity }}
                >
                  {/* Phase indicator circle */}
                  <div
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-bold ${
                      isCurrent ? "ring-2 ring-gold/40 ring-offset-2 ring-offset-[#080c12]" : ""
                    }`}
                    style={{ backgroundColor: group.color }}
                  >
                    <span className="text-sm text-[#080c12]">{idx + 1}</span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-semibold capitalize ${
                          isDone ? "text-ink-dim" : "text-ink"
                        }`}
                      >
                        {group.phaseName}
                      </span>
                      {isDone && (
                        <span className="text-xs text-ink-faint">✓</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-dim">
                      {group.stepIndices.length} step{group.stepIndices.length !== 1 ? "s" : ""}
                      {group.description && (
                        <span className="ml-1">• {group.description}</span>
                      )}
                    </div>
                    {isCurrent && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {group.stepIndices.map((stepIdx) => {
                          const step = steps[stepIdx];
                          const isActiveStep = stepIdx === activeStep;
                          return (
                            <button
                              key={stepIdx}
                              onClick={(e) => {
                                e.stopPropagation();
                                onStepSelect(stepIdx);
                              }}
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
                                isActiveStep
                                  ? "bg-gold text-[#080c12]"
                                  : "bg-surface-2 text-ink-dim hover:text-ink"
                              }`}
                            >
                              {step.step}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </button>

                {/* Connector arrow to next phase */}
                {idx < phaseGroups.length - 1 && (
                  <div className="ml-4 flex h-3 items-center">
                    <div className="w-0.5 bg-line" style={{ height: "100%" }} />
                    <div
                      className="ml-[-3px] h-0 w-0 border-l-[5px] border-r-0 border-t-[4px] border-l-transparent border-r-transparent"
                      style={{ borderTopColor: "var(--line)" }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-3 border-t border-line pt-2 text-[11px] leading-snug text-ink-faint">
        Click a phase to jump to its first step. Current phase shows clickable
        step numbers.
      </p>
    </div>
  );
}
