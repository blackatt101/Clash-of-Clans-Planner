"use client";

/**
 * The attack-plan legend. Static key: what each overlay glyph means. Rendered
 * in a corner of the viewer so it never covers the base. Uses the app's own
 * colour tokens so it matches the overlay.
 */
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
          Deploy
        </div>
        <div className={row}>
          <span className="text-[#f2b53a]">→</span>
          Attack direction
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
          <span className="text-[#d95926]">◎</span>
          Funnel
        </div>
        <div className={row}>
          <span className="text-[#eef1f7]">▲</span>
          Entry point
        </div>
        <div className={row}>
          <span className={`${chip} border-[#3987e5] bg-[#182936]`}>
            <span className="text-[8px] font-bold text-[#3987e5]">H</span>
          </span>
          Hero
        </div>
        <div className={row}>
          <span className="text-ink-faint">○</span>
          Drag to edit
        </div>
      </div>
    </div>
  );
}
