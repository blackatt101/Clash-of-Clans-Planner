"use client";

/**
 * The attack-plan legend. Static key: what each overlay glyph means.
 * Rendered in a corner of the viewer so it never covers the base.
 *
 * The map speaks a small, consistent vocabulary: routes are drawn
 * with a hierarchy (one thick main arrow, thinner funnel/support
 * guides), every attack group paints itself in its phase colour,
 * spell areas are translucent hints, and only priority targets get
 * a glyph. This key mirrors src/lib/attack/visuals.ts.
 */
import { PHASE_PALETTE } from "@/lib/attack/visuals";

export function AttackLegend() {
  const row = "flex items-center gap-1.5 text-[10px] leading-tight";
  const chip = "inline-flex h-4 w-4 items-center justify-center rounded-full border";

  return (
    <div className="surface-panel card-lit pointer-events-none absolute bottom-2 left-2 z-10 rounded-lg px-2.5 py-2">
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        <div className={row}>
          <span className={`${chip} border-[#f2b53a] bg-[#182936]`}>
            <span className="text-[8px] font-bold text-[#f2b53a]">①</span>
          </span>
          Deploy order
        </div>
        <div className={row}>
          <span className="text-[10px] font-black text-[#f2b53a]">→</span>
          Main route
        </div>
        <div className={row}>
          <span className="text-[#8ea2b5]">⇢</span>
          Funnel / support
        </div>
        <div className={row}>
          <span className={`${chip} border-dashed border-[#199e70] bg-transparent`} />
          Spell area
        </div>
        <div className={row}>
          <span className="text-[#e0533f]">★</span>
          Priority target
        </div>
        <div className={row}>
          <span className="text-[#eef1f7]">▲</span>
          Entry point
        </div>
        <div className={row}>
          <span className="text-[#d95926]">◎</span>
          Funnel zone
        </div>
        <div className={row}>
          <span className="text-ink-faint">○</span>
          Drag to edit
        </div>
      </div>
      {/* Attack groups paint themselves in phase colours. */}
      <div className="mt-1.5 flex items-center gap-1 border-t border-line pt-1.5">
        <span className="mr-0.5 text-[9px] uppercase tracking-wide text-ink-faint">
          Groups
        </span>
        {PHASE_PALETTE.map((c) => (
          <span
            key={c}
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}
