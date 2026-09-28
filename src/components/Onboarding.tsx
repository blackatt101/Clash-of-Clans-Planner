"use client";

import { useState } from "react";
import Modal from "@/components/Modal";

interface Props {
  open: boolean;
  onClose: () => void;
  onLoadSample: () => void;
}

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Copy your Data Export",
    body: (
      <>
        <p>
          Open Clash of Clans and go to{" "}
          <span className="font-medium text-ink">
            Settings → More Settings → Data Export
          </span>
          , then tap <span className="font-medium text-ink">Copy</span>. It copies a block of
          text — that&apos;s your whole village: every building, troop, hero and pet, plus
          anything upgrading right now.
        </p>
        <p className="mt-2 text-ink-faint">
          Nothing leaves your browser. There is no account and no server — the planner reads
          the text locally and keeps it in the URL when you share a plan.
        </p>
      </>
    ),
  },
  {
    title: "Paste it into the box",
    body: (
      <>
        <p>
          Paste into the <span className="font-medium text-ink">Paste Data Export</span> box at
          the top of the page. The box closes itself once the export parses, and the planner
          fills in your levels, costs and times straight away.
        </p>
        <p className="mt-2 text-ink-faint">
          On a phone, use the Paste button; on a desktop, <kbd>Ctrl</kbd>+<kbd>V</kbd> works, and{" "}
          <kbd>Ctrl</kbd>+<kbd>Enter</kbd> parses what you typed.
        </p>
      </>
    ),
  },
  {
    title: "Tune the plan",
    body: (
      <>
        <p>
          The planner works with no setup at all, but these are the controls that change the
          answer the most:
        </p>
        <ul className="mt-2 space-y-1.5">
          {[
            ["Builders", "how many builder huts you actually have"],
            ["Strategy", "rush archetype and how far offense runs ahead of the Town Hall"],
            ["Unavailable windows", "when you sleep, work or go to school"],
            ["Priority orders", "which heroes, pets and lab units get pushed first"],
          ].map(([label, hint]) => (
            <li key={label} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gold" />
              <span>
                <span className="font-medium text-ink">{label}</span>
                <span className="text-ink-dim"> — {hint}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-ink-faint">
          All of it lives behind <span className="font-medium text-ink-dim">Settings</span>.
        </p>
      </>
    ),
  },
];

/** First-run walkthrough. Dismissing it is remembered in localStorage. */
export default function Onboarding({ open, onClose, onLoadSample }: Props) {
  const [step, setStep] = useState(0);

  if (!open) return null;

  const last = step === STEPS.length - 1;

  return (
    <Modal
      title="Initial Setup"
      subtitle="Three steps from a fresh page to a full build plan"
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <span className="mr-auto text-xs text-ink-faint tabular-nums">
            Step {step + 1} of {STEPS.length}
          </span>
          {step > 0 && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="rounded-xl border border-line px-4 py-2 text-sm text-ink-dim transition hover:text-ink"
            >
              Back
            </button>
          )}
          {last ? (
            <>
              <button
                onClick={() => {
                  onLoadSample();
                  onClose();
                }}
                className="rounded-xl border border-line px-4 py-2 text-sm text-ink-dim transition hover:border-gold/50 hover:text-ink"
              >
                Try the sample village
              </button>
              <button
                onClick={onClose}
                className="rounded-xl bg-gradient-to-b from-gold-strong to-gold px-5 py-2 text-sm font-semibold text-[#1a1408] shadow-lg shadow-gold/20 transition hover:brightness-105 active:scale-[0.98]"
              >
                Get started
              </button>
            </>
          ) : (
            <button
              onClick={() => setStep((s) => s + 1)}
              className="rounded-xl bg-gradient-to-b from-gold-strong to-gold px-5 py-2 text-sm font-semibold text-[#1a1408] shadow-lg shadow-gold/20 transition hover:brightness-105 active:scale-[0.98]"
            >
              Next
            </button>
          )}
        </>
      }
    >
      <div className="flex gap-1.5">
        {STEPS.map((s, i) => (
          <button
            key={s.title}
            onClick={() => setStep(i)}
            aria-label={`Go to step ${i + 1}`}
            aria-current={i === step}
            className={`h-1 flex-1 rounded-full transition ${
              i <= step ? "bg-gold" : "bg-line"
            }`}
          />
        ))}
      </div>

      <h3 className="mt-4 text-base font-semibold text-ink">{STEPS[step].title}</h3>
      <div className="mt-2 text-sm leading-relaxed text-ink-dim">{STEPS[step].body}</div>
    </Modal>
  );
}
