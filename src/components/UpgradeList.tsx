"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { UpgradeOption } from "@/lib/upgrade";
import { formatCost, formatTime } from "@/lib/format";
import { resourceClass } from "@/lib/resourceColor";
import type { Cost } from "@/lib/types";
import type { PlannerSettings } from "@/lib/settings";
import { effectiveCost, effectiveTime } from "@/lib/discounts";
import { categoryBarClass } from "@/lib/categoryColor";

interface Props {
  options: UpgradeOption[];
  showAvailableOnly: boolean;
  onToggleAvailableOnly: () => void;
  planned: Set<number>;
  onTogglePlan: (uid: number) => void;
  images: Record<string, string>;
  settings: PlannerSettings;
  timerByUid: Map<number, number>;
  nowEpochMs: number;
}

const CATEGORY_ORDER = [
  "building",
  "trap",
  "troop",
  "spell",
  "siege",
  "hero",
  "pet",
  "helper",
  "equipment",
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  building: "Buildings",
  trap: "Traps",
  troop: "Troops",
  spell: "Spells",
  siege: "Siege Machines",
  hero: "Heroes",
  pet: "Pets",
  helper: "Helpers",
  equipment: "Hero Equipment",
};

/**
 * Hero equipment is bought with ore and completes instantly — it never occupies
 * a builder, so it sits outside the schedule and is shown as a plain cost list.
 */
const UNSCHEDULED = new Set(["equipment"]);

function CostBadge({ resource, cost }: { resource: string; cost: Cost | null }) {
  const isOre = cost != null && typeof cost === "object";
  return (
    <span className={`text-sm ${isOre ? "text-sky-300" : resourceClass(resource)}`}>
      {formatCost(cost)}
    </span>
  );
}

export default function UpgradeList({
  options,
  showAvailableOnly,
  onToggleAvailableOnly,
  planned,
  onTogglePlan,
  images,
  settings,
  timerByUid,
  nowEpochMs,
}: Props) {
  const [query, setQuery] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Default-collapsed: the catalogue can be hundreds of rows, and drawing them
  // all up front is most of the page's render cost — so it opens on demand.
  // The toolbar's Expand / Collapse still wins when the user uses it.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement | null>(null);

  // "/" focuses the search box when the list area has focus, not when the user
  // is typing in a text field or modal. A small speed-up for people who search
  // the catalogue frequently; costs zero when they don't.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      // Don't steal the key from an input/textarea/select the user is typing in.
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Tick once a second so in-progress countdowns feel live — but only while
  // there is a countdown to move. The tick re-renders this whole list, and an
  // idle village has nothing to keep live, so it would be a re-render a second
  // forever for no visible change.
  const ticking = timerByUid.size > 0;
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  const presentCats = useMemo(
    () => CATEGORY_ORDER.filter((cat) => options.some((o) => o.category === cat)),
    [options],
  );

  const toggleCat = (cat: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });

  const expandAll = () => setOpen(new Set(presentCats));
  const collapseAll = () => setOpen(new Set());

  // Memoised so the expensive O(options × groups) filtering only re-runs when
  // the inputs actually change, not on every re-render of the parent page.
  const filtered = useMemo(() => {
    if (!query && !showAvailableOnly) return options;
    const q = query.toLowerCase();
    return options.filter((o) => {
      if (showAvailableOnly && !o.available) return false;
      if (q && !o.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [options, query, showAvailableOnly]);

  const grouped = useMemo(
    () =>
      CATEGORY_ORDER.map((cat) => ({
        cat,
        items: filtered.filter((o) => o.category === cat),
      })).filter((g) => g.items.length > 0 && open.has(g.cat)),
    [filtered, open],
  );

  const availableCount = useMemo(() => options.filter((o) => o.available).length, [options]);
  const plannedCount = useMemo(() => options.filter((o) => planned.has(o.uid)).length, [options, planned]);
  const remaining = nowMs - nowEpochMs;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg/35 p-2">
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search upgrades…  ( / )"
          aria-label="Search upgrades"
          className="w-full max-w-64 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm text-ink placeholder:text-ink-faint transition focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/25"
        />
        <span className="text-sm text-ink-dim">
          <span className="font-semibold text-emerald-400">{availableCount}</span> of{" "}
          {options.length} ready
          {plannedCount > 0 && (
            <span className="ml-2 text-gold">{plannedCount} in plan</span>
          )}
        </span>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-dim">
          <input
            type="checkbox"
            checked={showAvailableOnly}
            onChange={onToggleAvailableOnly}
            className="h-4 w-4 accent-gold"
          />
          Ready only
        </label>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <button
            onClick={expandAll}
            className="rounded-lg border border-line px-2.5 py-1 text-ink-dim transition hover:border-gold/50 hover:text-ink"
          >
            Expand all
          </button>
          <button
            onClick={collapseAll}
            className="rounded-lg border border-line px-2.5 py-1 text-ink-dim transition hover:border-gold/50 hover:text-ink"
          >
            Collapse all
          </button>
        </div>
      </div>

      {/* Category accordion */}
      <div className="mt-4 space-y-2">
        {presentCats.map((cat) => {
          const items = grouped.find((g) => g.cat === cat)?.items ?? [];
          const isOpen = open.has(cat);
          const plannedHere = items.filter((o) => planned.has(o.uid)).length;
          const scheduleable = !UNSCHEDULED.has(cat);
          return (
            <section
              key={cat}
              className={`overflow-hidden rounded-xl border transition ${
                isOpen
                  ? "border-line bg-surface/50"
                  : "border-line/60 bg-surface/25 hover:border-line"
              }`}
            >
              <button
                onClick={() => toggleCat(cat)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-2/40"
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center text-xs text-ink-faint transition-transform duration-200 ${
                    isOpen ? "rotate-90 text-gold" : ""
                  }`}
                >
                  ▶
                </span>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${categoryBarClass(cat)}`} />
                <span className="text-sm font-semibold text-ink">{CATEGORY_LABELS[cat]}</span>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium tabular-nums text-ink-faint">
                  {items.length}
                </span>
                {!scheduleable && (
                  <span className="hidden rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-ink-faint sm:inline">
                    instant · no builder
                  </span>
                )}
                {scheduleable && plannedHere > 0 && (
                  <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-medium tabular-nums text-gold">
                    {plannedHere} planned
                  </span>
                )}
                <span className="ml-auto shrink-0 text-xs tabular-nums text-ink-faint">
                  {scheduleable
                    ? formatTime(
                        items.reduce((sum, o) => sum + (effectiveTime(o, settings) ?? 0), 0),
                      )
                    : ""}
                </span>
              </button>

              {isOpen && (
                <div className="border-t border-line/70">
                  {items.map((o, i) => {
                    const img = images[String(o.id)];
                    const isPlanned = planned.has(o.uid);
                    const cost = effectiveCost(o, settings);
                    const time = effectiveTime(o, settings);
                    const remainingSec = timerByUid.has(o.uid)
                      ? Math.max(0, (timerByUid.get(o.uid) ?? 0) - Math.floor(remaining / 1000))
                      : null;
                    return (
                      <div
                        key={o.uid}
                        className={`group flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-sm transition hover:bg-surface-2/50 ${
                          i % 2 ? "bg-transparent" : "bg-bg/20"
                        } ${!o.available ? "opacity-55" : ""}`}
                      >
                        {scheduleable ? (
                          <button
                            onClick={() => onTogglePlan(o.uid)}
                            aria-label={isPlanned ? "Remove from plan" : "Add to plan"}
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs font-bold transition active:scale-[0.9] ${
                              isPlanned
                                ? "border-gold bg-gold text-bg shadow-md shadow-gold/20"
                                : "border-line-strong text-ink-faint hover:border-gold hover:bg-gold/10 hover:text-gold"
                            }`}
                          >
                            {isPlanned ? "✓" : "+"}
                          </button>
                        ) : (
                          <span className="h-8 w-8 shrink-0" />
                        )}

                        {img ? (
                          <img
                            src={img}
                            alt=""
                            loading="lazy"
                            className="h-7 w-7 shrink-0 rounded-md object-contain"
                          />
                        ) : (
                          <span className="h-7 w-7 shrink-0 rounded-md bg-surface-2" />
                        )}

                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="truncate text-ink">{o.name}</span>
                          {o.count > 1 && (
                            <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-ink-dim">
                              ×{o.count}
                            </span>
                          )}
                        </div>

                        <span className="hidden shrink-0 rounded bg-surface-2 px-2 py-0.5 font-mono text-xs tabular-nums text-ink-dim sm:inline">
                          {o.currentLevel} → {o.nextLevel}
                        </span>

                        <span className="shrink-0 tabular-nums">
                          <CostBadge resource={o.resource} cost={cost} />
                        </span>

                        <span className="hidden w-16 shrink-0 text-right text-ink-dim tabular-nums sm:inline">
                          {UNSCHEDULED.has(cat) ? "instant" : formatTime(time)}
                        </span>

                        {remainingSec != null ? (
                          <span
                            title={`The upgrade running now finishes in ${formatTime(remainingSec)} — this row is the step after it.`}
                            className="shrink-0 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300 tabular-nums"
                          >
                            ⏳ {formatTime(remainingSec)} left
                          </span>
                        ) : o.available ? (
                          <span className="shrink-0 rounded-md bg-emerald-500/12 px-2 py-0.5 text-xs font-medium text-emerald-300">
                            Ready
                          </span>
                        ) : (
                          <span
                            title={
                              o.gate
                                ? `Needs ${o.gate.label} level ${o.gate.level}, which this village has not reached yet.`
                                : undefined
                            }
                            className="shrink-0 cursor-help rounded-md bg-surface-2 px-2 py-0.5 text-xs text-ink-faint"
                          >
                            {o.gate ? `${o.gate.label} ${o.gate.level}` : "Locked"}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="mt-6 text-center text-sm text-ink-faint">
          No upgrades match. Try a different search, or clear the “Ready only” filter.
        </p>
      )}
    </div>
  );
}
