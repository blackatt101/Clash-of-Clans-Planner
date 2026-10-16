"use client";

import { useState, type ReactNode } from "react";
import Modal from "@/components/Modal";
import UnavailableWindows from "@/components/UnavailableWindows";
import {
  BB_STRATEGIES,
  GOLD_PASS_PRESETS,
  HERO_CHAIN_OPTIONS,
  HORIZON_PRESETS,
  MAX_HERO_LANES,
  type BuilderBaseStrategy,
  type HeroChain,
  type HeroSchedule,
  type LabPriority,
  type PlannerSettings,
} from "@/lib/settings";
import { STRATEGIES } from "@/lib/strategy";
import { BB_TROOP_OPTIONS, BB_DEFENSE_OPTIONS } from "@/lib/bbRush";
import type { ModalKey } from "@/lib/modals";
import type { Village } from "@/lib/types";

interface Props {
  settings: PlannerSettings;
  onChange: (next: PlannerSettings) => void;
  village: Village;
  open: boolean;
  onClose: () => void;
  onOpen: (key: ModalKey) => void;
  onReset: () => void;
  /**
   * What the export says the Builder Base has. The game never reports a builder
   * count for either village — in the Builder Base each extra builder is a
   * building — so "Auto" shows the reading here and the player can correct it.
   */
  bbDetected: { total: number; outpostOwned: boolean; botoOwned: boolean };
  /**
   * The heroes the dedicated lanes go to, in lane order — the top of the focus
   * order, so this is the answer to "which heroes did I just focus".
   */
  heroFocus: string[];
}

const HERO_OPTIONS: { value: HeroSchedule; label: string }[] = [
  { value: "all", label: "Upgrade all heroes" },
  { value: "keep1", label: "Keep 1 hero available" },
  { value: "keep2", label: "Keep 2 heroes available" },
  { value: "keep3", label: "Keep 3 heroes available" },
  { value: "keep4", label: "Keep 4 heroes available" },
  { value: "none", label: "No hero upgrades" },
];

const LAB_OPTIONS: { value: LabPriority; label: string }[] = [
  { value: "general", label: "General" },
  { value: "air", label: "Air" },
  { value: "ground", label: "Ground" },
  { value: "farming", label: "Farming" },
];

const selectCls =
  "w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm text-ink focus:border-gold/60 focus:outline-none";
const numCls =
  "w-20 rounded-lg border border-line bg-bg px-2 py-1.5 text-center text-sm text-ink focus:border-gold/60 focus:outline-none";
const linkBtn =
  "rounded-lg border border-line px-3 py-1.5 text-sm text-ink-dim transition hover:border-gold/50 hover:text-ink";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-sm font-medium text-ink">{label}</div>
      {hint && <div className="text-xs text-ink-faint">{hint}</div>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gold">{title}</h4>
      {note && <p className="mt-1 text-xs text-ink-faint">{note}</p>}
      <div className="mt-3 grid gap-x-8 gap-y-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-sm text-ink"
    >
      <span
        className={`relative h-5 w-9 rounded-full transition ${checked ? "bg-gold" : "bg-line-strong"}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg transition ${
            checked ? "left-4" : "left-0.5"
          }`}
        />
      </span>
      {label}
    </button>
  );
}

export default function ScheduleSettings({
  settings,
  onChange,
  village,
  open,
  onClose,
  onOpen,
  onReset,
  bbDetected,
  heroFocus,
}: Props) {
  const [confirmReset, setConfirmReset] = useState(false);
  const set = (patch: Partial<PlannerSettings>) => onChange({ ...settings, ...patch });

  // Closing the dialog only hides it — the parent remounts this component when
  // `open` flips, so `confirmReset` (an armed "Reset everything?" with one
  // stray click from wiping the settings) is already disarmed on every open.

  // Each village picks from its own preset set: the Home Village from the rush
  // archetypes, the Builder Base from the 6th-builder goals. They are not the
  // same choice with a different value — see the note on `builderBaseStrategy`.
  const bb = village === "builderBase";

  if (!open) return null;

  return (
    <Modal
      title="Strategy Setup"
      subtitle="Everything the planner needs to model your village"
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-xl border border-line px-4 py-2 text-sm text-ink-dim transition hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={onClose}
            className="rounded-xl bg-gradient-to-b from-gold-strong to-gold px-5 py-2 text-sm font-semibold text-[#1a1408] shadow-lg shadow-gold/20 transition hover:brightness-105 active:scale-[0.98]"
          >
            Done
          </button>
        </>
      }
    >
      <div className="space-y-6">
        <Section
          title={bb ? "Builder Base Strategy" : "Home Village Strategy"}
          note={
            bb
              ? "The Builder Base has one job the Home Village does not: it is how you earn the 6th builder. Rushing B.O.B plans for that."
              : "The Home Village has its own preset set; the Builder Base picks from Builder Base goals instead."
          }
        >
          {bb ? (
            <Field
              label="Goal"
              hint={BB_STRATEGIES.find((s) => s.value === settings.builderBaseStrategy)?.hint}
            >
              <select
                aria-label="Builder Base strategy"
                value={settings.builderBaseStrategy}
                onChange={(e) =>
                  set({ builderBaseStrategy: e.target.value as BuilderBaseStrategy })
                }
                className={selectCls}
              >
                {BB_STRATEGIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Rush Archetype" hint={STRATEGIES.find((s) => s.value === settings.strategy)?.hint}>
              <select
                aria-label="Strategy"
                value={settings.strategy}
                onChange={(e) => set({ strategy: e.target.value as PlannerSettings["strategy"] })}
                className={selectCls}
              >
                {STRATEGIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {!bb && (
            <Field label="Offense Before TH" hint="Where to place the Town Hall in the rush order">
              <div className="flex items-center gap-3 pt-1">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={settings.offenseBeforeTh}
                  onChange={(e) => set({ offenseBeforeTh: Number(e.target.value) })}
                  className="w-full accent-gold"
                />
                <span className="w-9 text-right text-sm font-medium text-gold">
                  {settings.offenseBeforeTh}%
                </span>
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-ink-faint">
                <span>Quickest TH</span>
                <span>Offense first</span>
              </div>
            </Field>
          )}

          <div className="sm:col-span-2">
            <Field
              label="Offense Percentages"
              hint="Fine-tune how strongly each group pulls the schedule"
            >
              <button onClick={() => onOpen("offense")} className={linkBtn}>
                Open Offense Percentages…
              </button>
            </Field>
          </div>
        </Section>

        <Section title="Priority Orders">
          <div className="sm:col-span-2">
            <p className="mb-3 text-xs text-ink-faint">
              Everything gets planned eventually — these orders decide what gets a builder or the
              laboratory <span className="text-ink-dim">first</span>.
            </p>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => onOpen("heroOrder")} className={linkBtn}>
                Hero Focus Order
              </button>
              <button onClick={() => onOpen("petOrder")} className={linkBtn}>
                Pet Focus Order
              </button>
              <button onClick={() => onOpen("labOrder")} className={linkBtn}>
                Lab Priority Editor
              </button>
              <button onClick={() => onOpen("groupOrder")} className={linkBtn}>
                Upgrade Priority Order
              </button>
            </div>
          </div>
        </Section>

        <Section title="Planning Horizon">
          <Field label="How far ahead to plan">
            <select
              aria-label="Planning horizon"
              value={settings.horizon}
              onChange={(e) => set({ horizon: Number(e.target.value) })}
              className={selectCls}
            >
              {HORIZON_PRESETS.map((p) => (
                <option key={p.label} value={p.seconds}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        <Section title="Builders & Heroes">
          <Field
            label="Builders"
            hint={
              village === "builderBase"
                ? `Master Builder + O.T.T.O's Outpost (Builder Hall 6)${
                    bbDetected.botoOwned ? " + B.O.T.O's Shack" : ""
                  }`
                : undefined
            }
          >
            {village === "builderBase" ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {(["auto", 1, 2, 3] as const).map((v) => (
                  <button
                    key={String(v)}
                    onClick={() => set({ bbBuilders: v })}
                    title={
                      v === "auto"
                        ? "Read the count off your export"
                        : `${v} Builder Base builder${v === 1 ? "" : "s"}`
                    }
                    className={`h-8 rounded-lg px-3 text-sm font-medium transition ${
                      settings.bbBuilders === v
                        ? "bg-gold text-bg"
                        : "border border-line text-ink-dim hover:border-gold/50 hover:text-ink"
                    }`}
                  >
                    {v === "auto" ? `Auto (${bbDetected.total})` : v}
                  </button>
                ))}
                {/* The third builder is bought with gems, so a player who has him
                    but whose export does not list the Shack reads as a 2 — this
                    is the way to say so. */}
                {settings.bbBuilders === "auto" && !bbDetected.botoOwned && (
                  <span className="text-xs text-ink-faint">
                    Auto reads 2 — the third is B.O.T.O&apos;s Shack, bought with gems
                  </span>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <button
                    key={n}
                    onClick={() => set({ builders: n })}
                    className={`h-8 w-8 rounded-lg text-sm font-medium transition ${
                      settings.builders === n
                        ? "bg-gold text-bg"
                        : "border border-line text-ink-dim hover:border-gold/50 hover:text-ink"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}
          </Field>

          <Field label="Hero Scheduling">
            <select
              aria-label="Hero scheduling"
              value={settings.heroSchedule}
              onChange={(e) => set({ heroSchedule: e.target.value as HeroSchedule })}
              className={selectCls}
            >
              {HERO_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          {!bb && (
            <div className="sm:col-span-2">
              <Field
                label="Dedicated hero lanes"
                hint="Builders that do nothing but chain one hero's levels, one hero per lane — which hero gets one is Hero Focus Order"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  {Array.from({ length: MAX_HERO_LANES + 1 }, (_, n) => n).map((n) => (
                    <button
                      key={n}
                      onClick={() => set({ heroLanes: n })}
                      title={
                        n === 0
                          ? "No dedicated lane — heroes queue with everything else"
                          : `${n} builder${n === 1 ? "" : "s"} chained onto ${n} hero${n === 1 ? "" : "es"}`
                      }
                      className={`h-8 rounded-lg px-3 text-sm font-medium transition ${
                        settings.heroLanes === n
                          ? "bg-gold text-bg"
                          : "border border-line text-ink-dim hover:border-gold/50 hover:text-ink"
                      }`}
                    >
                      {n === 0 ? "Off" : n}
                    </button>
                  ))}
                  <span className="text-xs text-ink-faint">
                    {settings.heroLanes === 0
                      ? "Heroes wait for a builder like everything else"
                      : heroFocus.length > 0
                        ? `Lane${settings.heroLanes === 1 ? "" : "s"}: ${heroFocus.join(", ")}`
                        : "No planned hero to focus — tick a hero first"}
                  </span>
                </div>
                {/* How far a lane runs is a question about the chart, not about
                    the heroes: "plan" stops it where the rest of the plan stops,
                    "max" keeps it going to the hero's last level. It only means
                    anything once there is a lane, so it appears with one. */}
                {settings.heroLanes > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-ink-faint">Lanes run:</span>
                    <select
                      aria-label="Hero lane length"
                      value={settings.heroChain}
                      onChange={(e) => set({ heroChain: e.target.value as HeroChain })}
                      className={`${selectCls} h-8 w-auto`}
                    >
                      {HERO_CHAIN_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </Field>
            </div>
          )}

          <Field label="Clan War League" hint="Keep heroes available for CWL attacks">
            <Toggle
              checked={settings.cwlBlock}
              onChange={(v) => set({ cwlBlock: v })}
              label="Block hero upgrades during CWL (1st–10th)"
            />
          </Field>
        </Section>

        <Section title="Laboratory Priority">
          <Field label="Quick preset" hint="Sets a starting point — the editor above overrides it">
            <select
              aria-label="Laboratory priority"
              value={settings.labPriority}
              onChange={(e) => set({ labPriority: e.target.value as LabPriority })}
              className={selectCls}
            >
              {LAB_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </Section>

        <Section title="Additional Options">
          <Field label="Gold Pass discount">
            <div className="flex flex-wrap items-center gap-1.5">
              {GOLD_PASS_PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => set({ goldPass: p })}
                  className={`rounded-lg px-2.5 py-1 text-sm font-medium tabular-nums transition ${
                    settings.goldPass === p
                      ? "bg-gold text-bg"
                      : "border border-line text-ink-dim hover:border-gold/50 hover:text-ink"
                  }`}
                >
                  {p}%
                </button>
              ))}
              <input
                type="number"
                aria-label="Custom gold pass discount"
                min={0}
                max={100}
                value={settings.goldPass}
                onChange={(e) => set({ goldPass: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                className={numCls}
              />
            </div>
          </Field>

          <Field label="Boosts" hint="Extra time reduction per lane">
            <div className="flex flex-wrap gap-3 text-sm text-ink-dim">
              <label className="flex items-center gap-1.5">
                Builder
                <input
                  type="number"
                  aria-label="Builder boost"
                  min={0}
                  max={100}
                  value={settings.builderBoost}
                  onChange={(e) => set({ builderBoost: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                  className={numCls}
                />
                %
              </label>
              <label className="flex items-center gap-1.5">
                Research
                <input
                  type="number"
                  aria-label="Research boost"
                  min={0}
                  max={100}
                  value={settings.researchBoost}
                  onChange={(e) => set({ researchBoost: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                  className={numCls}
                />
                %
              </label>
            </div>
          </Field>

          <Field label="Wiggle Room (min)" hint="Buffer between upgrades for login lag">
            <input
              type="number"
              aria-label="Wiggle room minutes"
              min={0}
              max={120}
              value={settings.wiggleRoom}
              onChange={(e) => set({ wiggleRoom: Math.min(120, Math.max(0, Number(e.target.value) || 0)) })}
              className={numCls}
            />
          </Field>

          <Field label="Town Hall" hint="When off, the Town Hall upgrade is left out of the plan">
            <Toggle
              checked={settings.includeTh}
              onChange={(v) => set({ includeTh: v })}
              label="Include Town Hall upgrade in plan"
            />
          </Field>
        </Section>

        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gold">
            Unavailable Windows
          </h4>
          <p className="mt-1 text-xs text-ink-faint">
            Upgrades pause inside these spans, so the plan matches the hours you can actually
            play. A window may cross midnight.
          </p>
          <div className="mt-3">
            <UnavailableWindows
              blocks={settings.blocks}
              onChange={(blocks) => set({ blocks })}
            />
          </div>
        </section>

        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gold">Danger Zone</h4>
          <div className="mt-3">
            {confirmReset ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-900/70 bg-red-950/25 px-3 py-2.5">
                <span className="text-sm text-red-200">
                  Reset every setting to its default? Your village and plan are untouched.
                </span>
                <button
                  onClick={() => {
                    onReset();
                    setConfirmReset(false);
                    onClose();
                  }}
                  className="rounded-lg border border-red-800 px-3 py-1.5 text-sm text-red-200 transition hover:bg-red-900/40"
                >
                  Yes, reset everything
                </button>
                <button
                  onClick={() => setConfirmReset(false)}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-dim transition hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3 text-sm text-ink-dim">
                <button onClick={() => setConfirmReset(true)} className={linkBtn}>
                  Reset settings to defaults
                </button>
                <button onClick={() => onOpen("share")} className={linkBtn}>
                  Export &amp; Import…
                </button>
              </div>
            )}
          </div>
        </section>

        {bb && settings.builderBaseStrategy === "rush6th" && (
          <Section
            title="B.O.B Targets"
            note="B.O.B asks for one troop at 18 and one defence at 9 — you choose which."
          >
            <Field label="Single Max Troop" hint="Which troop goes to level 18">
              <select
                aria-label="Max troop"
                value={String(settings.bbMaxTroop)}
                onChange={(e) => set({ bbMaxTroop: Number(e.target.value) })}
                className={selectCls}
              >
                {BB_TROOP_OPTIONS.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Defense Level 9 Target">
              <select
                aria-label="Defense target"
                value={settings.bbDefense != null ? String(settings.bbDefense) : ""}
                onChange={(e) =>
                  set({ bbDefense: e.target.value === "" ? null : Number(e.target.value) })
                }
                className={selectCls}
              >
                <option value="">Auto (highest defense)</option>
                {BB_DEFENSE_OPTIONS.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          </Section>
        )}
      </div>
    </Modal>
  );
}
