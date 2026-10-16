"use client";

/**
 * AI Attack Strategy — the feature entry. Two states:
 *
 * 1) Setup: upload a base screenshot, confirm Town Hall, optional context
 *    (heroes, style, CC troops), Generate.
 * 2) Result: Strategy / Army / Visual Attack Plan / Step-by-Step, with
 *    editing, save, share and regenerate.
 *
 * The visual plan is the programmatic SVG overlay (AttackPlanViewer) over the
 * uploaded base — never an AI-generated image.
 */
import { useCallback, useRef, useState } from "react";
import Modal from "@/components/Modal";
import AttackPlanViewer from "./AttackPlanViewer";
import type { AttackStrategy, ArmyEntry } from "@/lib/attack/types";
import {
  capacitiesForTH,
  resolveEntity,
  totalHousing,
  totalSpellHousing,
} from "@/lib/attack/catalog";
import {
  clearAttackPlan,
  decodePlanShare,
  encodePlanShare,
  loadAttackPlan,
  saveAttackPlan,
} from "@/lib/attack/planShare";

/**
 * SSR-safe, reads the shared-link fragment then the on-device save. Returns
 * null on the server (where there is no location/localStorage) so it's safe
 * to run in a lazy useState initializer.
 */
function readRestoredPlan(): {
  strategy: AttackStrategy;
  townHall: number;
  baseSrc: string | null;
} | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/#plan=([^&]+)/);
  if (m) {
    const shared = decodePlanShare(decodeURIComponent(m[1]));
    if (shared) return { strategy: shared.strategy, townHall: shared.townHall, baseSrc: null };
  }
  const saved = loadAttackPlan();
  if (saved) {
    return { strategy: saved.strategy, townHall: saved.townHall, baseSrc: saved.screenshot || null };
  }
  return null;
}

export interface AIAttackStrategyProps {
  open: boolean;
  onClose: () => void;
  images: Record<string, string>;
  /** Called when the user saves a plan (parent shows a toast). */
  onSaved?: () => void;
}

type Phase = "setup" | "working" | "result" | "error";

const STEP_TITLES = ["Base screenshot", "Your Town Hall", "Generate", "Attack plan"];

export default function AIAttackStrategy({ open, onClose, images, onSaved }: AIAttackStrategyProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [heroLevels, setHeroLevels] = useState("");
  const [style, setStyle] = useState("");
  const [ccTroops, setCcTroops] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * Restore the last plan on open: a share link (#plan=…) wins, then the
   * on-device save. Computed in a lazy initializer (client-only; SSR returns
   * null) instead of an effect, and shared links carry no base screenshot, so
   * the visual section offers to re-upload it.
   */
  const [init] = useState(readRestoredPlan);
  const [townHall, setTownHall] = useState(init?.townHall ?? 15);
  const [phase, setPhase] = useState<Phase>(init ? "result" : "setup");
  const [strategy, setStrategy] = useState<AttackStrategy | null>(init?.strategy ?? null);
  const [savedSrc, setSavedSrc] = useState<string | null>(init?.baseSrc ?? null);
  /**
   * Validator notes from the latest generation: repairs the
   * planner made (loadouts trimmed, units dropped) and
   * selection-audit doubts. Per-generation diagnostics — they
   * are not part of the saved/shared strategy itself.
   */
  const [warnings, setWarnings] = useState<string[]>([]);

  const caps = capacitiesForTH(townHall);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const onFile = useCallback((f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setErrorMsg("That file is not an image. Upload a screenshot (PNG/JPEG/WebP).");
      return;
    }
    if (f.size > 12 * 1024 * 1024) {
      setErrorMsg("Screenshot is too large (12 MB limit).");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const url = reader.result as string;
      // Send the screenshot as-is (original resolution, no re-encoding):
      // the user wants the AI to see the full-detail base map.
      setDataUrl(url);
      setErrorMsg(null);
    };
    reader.readAsDataURL(f);
  }, []);

  const generate = useCallback(async () => {
    if (!dataUrl) {
      setErrorMsg("Upload a base screenshot first.");
      return;
    }
    setPhase("working");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/attack-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screenshot: dataUrl,
          townHall,
          heroLevels: parseLevels(heroLevels),
          preferredStyle: style.trim() || undefined,
          ccTroops: splitList(ccTroops),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Generation failed.");
      }
      setStrategy(json.strategy);
      setWarnings(
        Array.isArray(json.warnings)
          ? json.warnings.filter((w: unknown) => typeof w === "string")
          : [],
      );
      setSavedSrc(dataUrl);
      setPhase("result");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Generation failed. Please try again.");
      setPhase("error");
    }
  }, [dataUrl, townHall, heroLevels, style, ccTroops]);

  const doSave = useCallback(() => {
    if (!strategy) return;
    const t = saveAttackPlan({
      screenshot: savedSrc ?? "",
      townHall,
      strategy,
    });
    notify(
      t != null
        ? savedSrc
          ? "Saved this plan on this device."
          : "Saved the strategy (re-add the base image to reopen the visual plan)."
        : "Save failed (storage full or private mode).",
    );
    onSaved?.();
  }, [strategy, savedSrc, townHall, onSaved, notify]);

  const doShare = useCallback(() => {
    if (!strategy) return;
    const frag = `#plan=${encodePlanShare(strategy, townHall)}`;
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}${frag}`;
    navigator.clipboard
      .writeText(url)
      .then(() => notify("Share link copied."))
      .catch(() => notify("Copy failed — select and copy the address bar."));
  }, [strategy, townHall, notify]);

  const regenerate = useCallback(() => {
    clearAttackPlan();
    setStrategy(null);
    setWarnings([]);
    setSavedSrc(null);
    setPhase("setup");
  }, []);

  // ---- icon helpers for the army section ----
  const iconOf = (slug: string, size = "h-9 w-9") => {
    const ent = resolveEntity(slug);
    const url = ent?.ref ? images[String(ent.ref.dataId)] : null;
    return url ? (
      <img src={url} alt={ent!.ref.name} className={`${size} object-contain`} />
    ) : (
      <span className={`${size} flex items-center justify-center rounded-lg bg-surface-2 text-[11px] font-bold text-ink-dim`}>
        {slug.slice(0, 2).toUpperCase()}
      </span>
    );
  };

  if (!open) return null;

  return (
    <Modal
      title="AI Attack Strategy"
      subtitle={
        phase === "result"
          ? "Generated from your base screenshot — drag markers to fine-tune."
          : "Upload a base screenshot; the AI drafts a 3-star attack plan you can edit."
      }
      onClose={onClose}
      width="max-w-4xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-ink-faint">
            {phase === "result" ? "Edit freely — the map is the source of truth." : "One AI request per plan. Your API key never leaves the server."}
          </div>
          <div className="flex items-center gap-2">
            {toast && <span className="text-xs text-gold">{toast}</span>}
            {phase === "result" && (
              <>
                <button className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-dim hover:text-ink" onClick={doSave}>
                  Save plan
                </button>
                <button className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-dim hover:text-ink" onClick={doShare}>
                  Share link
                </button>
                <button className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-dim hover:text-ink" onClick={regenerate}>
                  New plan
                </button>
              </>
            )}
            <button className="rounded-lg bg-gold px-3 py-2 text-sm font-semibold text-[#1a1408] hover:bg-gold-strong disabled:opacity-40" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      }
    >
      {phase !== "result" && (
        <div className="flex flex-col gap-4">
          {/* Step indicator */}
          <ol className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-ink-faint">
            {STEP_TITLES.map((t, i) => (
              <li key={t} className={`flex items-center gap-1.5 ${i <= (phase === "working" ? 3 : (dataUrl ? 1 : 0)) ? "text-gold" : ""}`}>
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current font-bold">{i + 1}</span>
                <span className="hidden sm:inline">{t}</span>
                {i < STEP_TITLES.length - 1 && <span className="mx-1 h-px w-4 bg-line" />}
              </li>
            ))}
          </ol>

          {/* 1 — Screenshot */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-ink-dim">
              1 · Enemy base screenshot
            </label>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                onFile(e.dataTransfer.files?.[0] ?? null);
              }}
              className={`relative flex min-h-40 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed transition ${
                dragOver ? "border-gold bg-gold/10" : "border-line bg-surface-2/40"
              }`}
            >
              {dataUrl ? (
                <img src={dataUrl} alt="Uploaded base" className="max-h-72 w-auto object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-2 p-8 text-center">
                  <span className="text-3xl">📸</span>
                  <p className="max-w-xs text-sm text-ink-dim">
                    Drop a Clash of Clans base screenshot here, or{" "}
                    <button
                      className="font-semibold text-gold underline decoration-gold/40 underline-offset-2 hover:decoration-gold"
                      onClick={() => fileRef.current?.click()}
                    >
                      browse files
                    </button>
                    .
                  </p>
                  <p className="text-[11px] text-ink-faint">
                    PNG / JPEG / WebP, up to 12 MB. The base is analyzed by AI on the server — it is never stored here.
                  </p>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>

          {/* 2 — Town Hall */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-dim">
                2 · Your Town Hall
              </label>
              <select
                value={townHall}
                onChange={(e) => setTownHall(Number(e.target.value))}
                className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-gold/60"
              >
                {[...Array(16)].map((_, i) => 3 + i).map((th) => (
                  <option key={th} value={th}>
                    TH{th}
                    {th === 15 ? " (current max)" : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-ink-faint">
                Army {caps.armyHousing} · Spell {caps.spellHousing} · CC troops {caps.ccTroopCapacity}
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-ink-dim">
                2 · Options <span className="text-ink-faint">(optional)</span>
              </label>
              <div className="flex flex-col gap-2">
                <input
                  className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-gold/60"
                  placeholder="Hero levels, e.g. queen:38 king:40 warden:29"
                  value={heroLevels}
                  onChange={(e) => setHeroLevels(e.target.value)}
                />
                <input
                  className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-gold/60"
                  placeholder="Preferred style, e.g. hybrid, smash, lalo"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                />
                <input
                  className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-gold/60"
                  placeholder="Enemy CC troops, e.g. valkyrie,pekka"
                  value={ccTroops}
                  onChange={(e) => setCcTroops(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* 3 — Generate */}
          {errorMsg && (
            <div className="rounded-lg border border-[#e0533f]/40 bg-[#e0533f]/10 px-3 py-2 text-sm text-[#ff9d8f]">
              {errorMsg}
            </div>
          )}
          <button
            className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-gold-strong to-gold px-4 py-3 text-sm font-bold text-[#1a1408] shadow-lg shadow-gold/20 transition hover:from-gold hover:to-gold-dim disabled:cursor-not-allowed disabled:opacity-50"
            onClick={generate}
            disabled={phase === "working"}
          >
            {phase === "working" ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#1a1408]/30 border-t-[#1a1408]" />
                Analyzing base and drafting the plan…
              </>
            ) : (
              <>⚔ Generate Attack Strategy</>
            )}
          </button>
          {phase === "working" && (
            <p className="text-center text-[11px] text-ink-faint">
              Reading the screenshot, picking a base-specific strategy and drafting deployments — usually under a minute.
            </p>
          )}
        </div>
      )}

      {phase === "result" && strategy && (
        <ResultView
          strategy={strategy}
          baseSrc={savedSrc}
          images={images}
          iconOf={iconOf}
          townHall={townHall}
          warnings={warnings}
          onStrategyChange={setStrategy}
          onBaseImage={(url) => {
            setSavedSrc(url);
            notify("Base image attached — the visual plan is ready.");
          }}
        />
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Result: Strategy / Army / Visual Plan / Step-by-Step                       */
/* -------------------------------------------------------------------------- */

function ResultView({
  strategy,
  baseSrc,
  images,
  iconOf,
  townHall,
  warnings,
  onStrategyChange,
  onBaseImage,
}: {
  strategy: AttackStrategy;
  baseSrc: string | null;
  images: Record<string, string>;
  iconOf: (slug: string, size?: string) => React.ReactNode;
  townHall: number;
  /** Validator notes from this generation (repairs, audit doubts). */
  warnings: string[];
  onStrategyChange: (s: AttackStrategy) => void;
  onBaseImage?: (url: string) => void;
}) {
  const s = strategy.strategy;
  const confidence = strategy.confidence;
  const diff = s.difficulty ?? "medium";
  const army = strategy.army;
  const troopHousing = totalHousing(army.troops);
  const spellHousing = totalSpellHousing(army.spells);

  return (
    <div className="flex flex-col gap-5">
      {/* A — Strategy */}
      <section className="surface-panel card-lit rounded-xl p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gold">{s.name}</h3>
            <p className="mt-0.5 text-[13px] text-ink-dim">{s.summary ?? s.reason}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                diff === "hard"
                  ? "bg-[#e0533f]/20 text-[#ff9d8f]"
                  : diff === "easy"
                    ? "bg-lane-pet/20 text-lane-pet"
                    : "bg-gold/20 text-gold"
              }`}
            >
              {diff}
            </span>
            {confidence && (
              <span className="text-[11px] text-ink-faint">
                confidence {Math.round((confidence.strategy ?? 0) * 100)}%
                {typeof confidence.strategy_selection === "number" &&
                  ` · selection ${Math.round(confidence.strategy_selection * 100)}%`}
                {typeof confidence.army_composition === "number" &&
                  ` · army ${Math.round(confidence.army_composition * 100)}%`}
              </span>
            )}
          </div>
        </div>
        {s.reason && s.reason !== s.summary && (
          <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">
            <span className="font-semibold text-ink">Why this base:</span> {s.reason}
          </p>
        )}
      </section>

      {/* A2 — Strategies considered before the pick */}
      {strategy.candidate_strategies?.length ? (
        <section className="surface-panel card-lit rounded-xl p-4">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-dim">
            Strategies considered
          </h3>
          <ul className="flex flex-col gap-2">
            {strategy.candidate_strategies.map((c) => (
              <li
                key={c.id}
                className={`rounded-lg border px-3 py-2 text-[13px] ${
                  c.selected
                    ? "border-gold/50 bg-gold/5"
                    : "border-line bg-surface-2/60"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink">{c.name}</span>
                  <span className="flex items-center gap-2">
                    {typeof c.fit_score === "number" && (
                      <span className="text-[11px] text-ink-faint">
                        fit {Math.round(c.fit_score * 100)}%
                      </span>
                    )}
                    {c.selected ? (
                      <span className="rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">
                        selected
                      </span>
                    ) : (
                      <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-faint">
                        rejected
                      </span>
                    )}
                  </span>
                </div>
                {c.strengths?.length ? (
                  <p className="mt-1 text-ink-dim">{c.strengths.join(" · ")}</p>
                ) : null}
                {c.selected ? (
                  c.weaknesses?.length ? (
                    <p className="mt-0.5 text-ink-faint">
                      Watch out: {c.weaknesses.join(" · ")}
                    </p>
                  ) : null
                ) : c.rejected_reason ? (
                  <p className="mt-0.5 text-ink-faint">{c.rejected_reason}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* A3 — Planner notes: what the validator repaired or questions */}
      {warnings.length ? (
        <section className="surface-panel rounded-xl border border-line p-4">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-dim">
            Planner notes
          </h3>
          <ul className="flex flex-col gap-1.5">
            {warnings.map((w, i) => (
              <li key={i} className="flex gap-2 text-[12px] leading-snug text-ink-dim">
                <span className="mt-0.5 shrink-0 text-ink-faint">•</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* B — Army */}
      <section className="surface-panel card-lit rounded-xl p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold uppercase tracking-wide text-ink-dim">Army</h3>
          <span className="text-[11px] text-ink-faint">
            {troopHousing} / {capacitiesForTH(townHall).armyHousing} housing · {spellHousing} / {capacitiesForTH(townHall).spellHousing} spell
          </span>
        </div>
        <ArmyRow label="Troops" items={army.troops} iconOf={iconOf} />
        <ArmyRow label="Spells" items={army.spells} iconOf={iconOf} />
        <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px] text-ink-dim">
          {army.siege_machine && (
            <span className="flex items-center gap-1.5">
              <b className="text-ink-faint">Siege</b>
              {iconOf(army.siege_machine.id)}
              <span>{resolveEntity(army.siege_machine.id)?.ref.name}</span>
            </span>
          )}
          {army.siege_machine?.purpose ? (
            <span className="w-full pl-9 text-[11px] text-ink-faint">
              Siege purpose: {army.siege_machine.purpose}
            </span>
          ) : null}
          {army.clan_castle?.length ? (
            <span className="flex items-center gap-1.5">
              <b className="text-ink-faint">CC</b>
              {army.clan_castle.map((c) => (
                <span key={c.id} className="flex items-center gap-1" title={c.purpose}>
                  {iconOf(c.id, "h-6 w-6")}×{c.count}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      </section>

      {/* C — Visual Attack Plan */}
      <section>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-dim">
          Visual Attack Plan
        </h3>
        {baseSrc ? (
          <AttackPlanViewer
            strategy={strategy}
            baseSrc={baseSrc}
            images={images}
            onChange={onStrategyChange}
          />
        ) : (
          <BaseImagePrompt onImage={onBaseImage} />
        )}
      </section>

      {/* D — Step-by-Step */}
      <section className="surface-panel card-lit rounded-xl p-4">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-dim">
          Step-by-step attack
        </h3>
        <ol className="flex flex-col gap-2">
          {strategy.deployment_plan.map((d) => (
            <li key={d.step} className="flex items-start gap-2.5 text-[13px]">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold text-[11px] font-bold text-[#1a1408]">
                {d.step}
              </span>
              <div className="min-w-0">
                <span className="font-semibold text-ink">
                  {resolveEntity(d.unit)?.ref.name ?? d.unit}
                </span>
                <span className="text-ink-faint"> ×{d.count}</span>
                {d.purpose ? <span className="text-ink-dim"> — {d.purpose}</span> : null}
                {d.target ? (
                  <span className="ml-1 text-[11px] uppercase tracking-wide text-ink-faint">
                    → {d.target}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        {strategy.heroes?.length ? (
          <div className="mt-3 border-t border-line pt-3">
            <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
              Hero decisions
            </h4>
            <ul className="flex flex-col gap-1.5 text-[13px] text-ink-dim">
              {strategy.heroes.map((h) => (
                <li key={h.id} className="flex items-start gap-2">
                  <span className="mt-0.5 shrink-0">{iconOf(h.id, "h-5 w-5")}</span>
                  <span className="min-w-0">
                    <b className="text-ink">{resolveEntity(h.id)?.ref.name ?? h.id}</b>
                    {h.use ? (
                      <span className="ml-1.5 rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">
                        {h.role ?? "support"}
                      </span>
                    ) : (
                      <span className="ml-1.5 text-[11px] uppercase tracking-wide text-ink-faint">
                        not selected
                      </span>
                    )}
                    {h.reason ? (
                      <span className="text-ink-faint"> — {h.reason}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {strategy.hero_abilities?.length ? (
          <div className="mt-3 border-t border-line pt-3">
            <h4 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
              Hero abilities
            </h4>
            <ul className="flex flex-col gap-1.5 text-[13px] text-ink-dim">
              {strategy.hero_abilities.map((h, i) => (
                <li key={i}>
                  <b className="text-ink">{resolveEntity(h.hero)?.ref.name ?? h.hero}</b> — {h.trigger}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ArmyRow({
  label,
  items,
  iconOf,
}: {
  label: string;
  items: ArmyEntry[];
  iconOf: (slug: string, size?: string) => React.ReactNode;
}) {
  if (items.length === 0) return null;
  const withPurpose = items.filter((c) => c.purpose);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-14 shrink-0 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
          {label}
        </span>
        <div className="flex flex-wrap gap-2">
          {items.map((c) => (
            <span
              key={c.id}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-2/60 px-2 py-1"
              title={c.purpose ?? (resolveEntity(c.id)?.ref.name ?? c.id)}
            >
              {iconOf(c.id, "h-6 w-6")}
              <span className="text-[12px] text-ink-dim">
                {resolveEntity(c.id)?.ref.name ?? c.id}
              </span>
              <span className="text-[12px] font-bold text-ink">×{c.count}</span>
            </span>
          ))}
        </div>
      </div>
      {withPurpose.length ? (
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 pl-14 text-[11px] leading-snug text-ink-faint">
          {withPurpose.map((c) => (
            <span key={c.id}>
              {resolveEntity(c.id)?.ref.name ?? c.id} — {c.purpose}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function BaseImagePrompt({ onImage }: { onImage?: (url: string) => void }) {
  const [dragOver, setDragOver] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);

  const onFile = (f: File | null) => {
    if (!f || !f.type.startsWith("image/")) {
      setNote("Pick a PNG/JPEG screenshot of the same base.");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const url = reader.result as string;
      onImage?.(url);
      setNote(null);
    };
    reader.readAsDataURL(f);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        onFile(e.dataTransfer.files?.[0] ?? null);
      }}
      className={`flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center transition ${
        dragOver ? "border-gold bg-gold/10" : "border-line bg-surface-2/40"
      }`}
    >
      <span className="text-2xl">🖼️</span>
      <p className="max-w-sm text-sm text-ink-dim">
        The strategy is attached, but the base screenshot is not (shared plans do not embed images).
        Upload the same base to see the attack plan on the map.
      </p>
      <button
        className="rounded-lg border border-gold/50 bg-gold/15 px-3 py-1.5 text-xs font-semibold text-gold hover:bg-gold/25"
        onClick={() => ref.current?.click()}
      >
        Choose base image
      </button>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {note && <p className="text-xs text-[#e0533f]">{note}</p>}
    </div>
  );
}

/**
 * Official hero maximum levels up to Town Hall 18 (Clash of Clans Wiki):
 * - Barbarian King: max 110 at TH18 (95 at TH16, 100 at TH17)
 * - Archer Queen: max 110 at TH18 (95 at TH16, 100 at TH17)
 * - Grand Warden: max 85 at TH18 (70 at TH16, 75 at TH17)
 * - Royal Champion: max 55 at TH18 (45 at TH16, 50 at TH17)
 * - Minion Prince: max 95 at TH18 (80 at TH16, 90 at TH17)
 * - Dragon Duke: max 25 at TH18 (15 at TH16, 20 at TH17)
 */
export const HERO_MAX_LEVELS: Record<string, number> = {
  barbarian_king: 110,
  king: 110,
  bk: 110,
  archer_queen: 110,
  queen: 110,
  aq: 110,
  grand_warden: 85,
  warden: 85,
  gw: 85,
  royal_champion: 55,
  champion: 55,
  rc: 55,
  minion_prince: 95,
  prince: 95,
  mp: 95,
  dragon_duke: 25,
  duke: 25,
  dd: 25,
};

export function parseLevels(raw: string): Record<string, number> | undefined {
  if (!raw.trim()) return undefined;
  const out: Record<string, number> = {};
  for (const part of raw.split(/[,\s]+/)) {
    const m = part.match(/^([a-z_]+)\s*[:=]?\s*(\d{1,3})$/i);
    if (m) {
      const heroKey = m[1].toLowerCase();
      const maxLvl = HERO_MAX_LEVELS[heroKey];
      if (maxLvl === undefined) continue;
      out[heroKey] = Math.max(1, Math.min(maxLvl, Number(m[2])));
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function splitList(raw: string): string[] | undefined {
  const parts = raw
    .split(/[,\s]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}
