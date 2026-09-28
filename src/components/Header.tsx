"use client";

import type { Village } from "@/lib/types";

interface Props {
  village: Village;
  onVillageChange: (v: Village) => void;
  images: Record<string, string>;
  onSettings: () => void;
  onHelp: () => void;
}

const TABS: { value: Village; label: string; short: string; img: string; fallback: string }[] = [
  { value: "home", label: "Home Village", short: "Home", img: "1000001", fallback: "🏠" },
  { value: "builderBase", label: "Builder Base", short: "Builder", img: "1000034", fallback: "🔧" },
];

export default function Header({
  village,
  onVillageChange,
  images,
  onSettings,
  onHelp,
}: Props) {
  const iconBtn =
    "group flex h-9 w-9 items-center justify-center rounded-xl border border-line text-ink-dim transition hover:border-gold/50 hover:text-ink hover:bg-surface-2/60";

  return (
    /* Near-opaque, and deliberately *not* blurred. `backdrop-blur` on a sticky
       header re-runs the blur over whatever is scrolling underneath it on every
       frame — and underneath it here is the timeline, hundreds of bars
       wide. That is a per-frame filter pass over a large area in exchange for a
       slightly softer edge; the border and the 95% background carry the same
       separation for free. */
    <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/[0.97]">
      {/* A single hairline of light at the very top of the page, like a rim of
          light caught on the edge of a card — it lifts the header off the page
          without a visible border on both sides. */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-gold/25 to-transparent" />
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-gold-strong to-gold shadow-lg shadow-gold/20">
            <span className="absolute inset-0 rounded-2xl bg-gradient-to-t from-transparent to-white/15" />
            <span className="relative text-xl leading-none drop-shadow">🏰</span>
          </span>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[17px] font-bold tracking-tight text-ink">
              Clash <span className="text-gold">Max</span>
            </div>
            <div className="hidden text-[11px] uppercase tracking-[0.16em] text-ink-faint sm:block">
              Builder time, optimized
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <nav
            className="flex rounded-xl border border-line bg-surface/80 p-1"
            role="group"
            aria-label="Planner mode"
          >
            {TABS.map((t) => {
              const active = village === t.value;
              const icon = images[t.img];
              return (
                <button
                  key={t.value}
                  onClick={() => onVillageChange(t.value)}
                  aria-pressed={active}
                  className={`relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition sm:px-3.5 ${
                    active
                      ? "text-[#1a1408]"
                      : "text-ink-dim hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  {/* Active state: a gold pill behind the text, with a soft
                      outer glow. The pill is a pseudo-element layer, not a
                      background on the button node itself, so the button's
                      own paint is still cheap. */}
                  {active && (
                    <span className="absolute inset-0 -z-10 rounded-lg bg-gradient-to-b from-gold-strong to-gold shadow-md shadow-gold/25" />
                  )}
                  {icon ? (
                    <img
                      src={icon}
                      alt=""
                      className={`h-5 w-5 object-contain transition ${active ? "drop-shadow" : ""}`}
                    />
                  ) : (
                    <span className="text-base leading-none">{t.fallback}</span>
                  )}
                  <span className="hidden sm:inline">{t.label}</span>
                  <span className="sm:hidden">{t.short}</span>
                </button>
              );
            })}
          </nav>

          <button
            onClick={onSettings}
            className={iconBtn}
            title="Strategy Setup"
            aria-label="Strategy Setup"
          >
            <span className="text-[15px] transition-transform duration-200 group-hover:rotate-45">⚙</span>
          </button>
          <button onClick={onHelp} className={iconBtn} title="How this works" aria-label="How this works">
            ?
          </button>
        </div>
      </div>
    </header>
  );
}
