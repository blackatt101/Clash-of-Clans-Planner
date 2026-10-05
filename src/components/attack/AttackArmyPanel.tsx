"use client";

/**
 * The army composition panel — WHAT is being deployed, kept off
 * the map: troops, spells, heroes and the siege machine, each
 * with its icon, quantity and the planner's stated purpose.
 *
 * Everything here is read from the strategy JSON (the source of
 * truth); the panel only formats it.
 */
import { resolveEntity } from "@/lib/attack/catalog";
import { iconForSlug } from "@/lib/attack/iconFor";
import type { AttackStrategy, ArmyEntry } from "@/lib/attack/types";

interface AttackArmyPanelProps {
  strategy: AttackStrategy;
  images: Record<string, string>;
}

function Entry({ entry, images }: { entry: ArmyEntry; images: Record<string, string> }) {
  const name = resolveEntity(entry.id)?.ref.name ?? entry.id;
  const icon = iconForSlug(entry.id, images);
  return (
    <li className="flex items-center gap-2 text-[13px]">
      {icon ? (
        <img src={icon} alt={name} title={entry.purpose} className="h-6 w-6 shrink-0 object-contain" />
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[10px] font-bold text-ink-dim">
          {entry.id.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span className="min-w-0">
        <span className="font-medium text-ink">{name}</span>
        {entry.count > 1 ? (
          <span className="text-ink-faint"> ×{entry.count}</span>
        ) : null}
        {entry.purpose ? (
          <span className="block truncate text-[11px] text-ink-faint" title={entry.purpose}>
            {entry.purpose}
          </span>
        ) : null}
      </span>
    </li>
  );
}

export function AttackArmyPanel({ strategy, images }: AttackArmyPanelProps) {
  const army = strategy.army;
  const heroes = (strategy.heroes ?? []).filter((h) => h.use);
  const hasHeroes = heroes.length > 0;

  return (
    <section className="surface-panel card-lit rounded-xl p-4">
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-dim">
        Army composition
      </h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
            Troops
          </h4>
          <ul className="flex flex-col gap-1">
            {army.troops.map((t) => (
              <Entry key={t.id} entry={t} images={images} />
            ))}
          </ul>
        </div>

        <div>
          <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
            Spells
          </h4>
          <ul className="flex flex-col gap-1">
            {army.spells.map((s) => (
              <Entry key={s.id} entry={s} images={images} />
            ))}
            {army.clan_castle?.length ? (
              <li className="mt-1 border-t border-line pt-1">
                <span className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                  Clan Castle
                </span>
                <ul className="mt-1 flex flex-col gap-1">
                  {army.clan_castle.map((c) => (
                    <Entry key={c.id} entry={c} images={images} />
                  ))}
                </ul>
              </li>
            ) : null}
          </ul>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
        {hasHeroes ? (
          <div>
            <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
              Heroes
            </h4>
            <ul className="flex flex-col gap-1">
              {heroes.map((h) => {
                const name = resolveEntity(h.id)?.ref.name ?? h.id;
                const icon = iconForSlug(h.id, images);
                return (
                  <li key={h.id} className="flex items-center gap-2 text-[13px]">
                    {icon ? (
                      <img src={icon} alt={name} className="h-6 w-6 shrink-0 object-contain" />
                    ) : (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[10px] font-bold text-ink-dim">
                        {h.id.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span className="font-medium text-ink">{name}</span>
                    {h.role ? (
                      <span className="rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">
                        {h.role}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {army.siege_machine ? (
          <div>
            <h4 className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
              Siege machine
            </h4>
            {(() => {
              const name = resolveEntity(army.siege_machine!.id)?.ref.name ?? army.siege_machine!.id;
              const icon = iconForSlug(army.siege_machine!.id, images);
              return (
                <div className="flex items-center gap-2 text-[13px]">
                  {icon ? (
                    <img src={icon} alt={name} className="h-6 w-6 shrink-0 object-contain" />
                  ) : (
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[10px] font-bold text-ink-dim">
                      {army.siege_machine!.id.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span className="font-medium text-ink">{name}</span>
                </div>
              );
            })()}
            {army.siege_machine.purpose ? (
              <p className="mt-1 max-w-56 text-[11px] leading-snug text-ink-faint">
                {army.siege_machine.purpose}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
