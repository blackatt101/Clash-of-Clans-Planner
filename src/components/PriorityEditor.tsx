"use client";

import { useState, useEffect } from "react";
import Modal from "@/components/Modal";

export interface PriorityItem {
  key: string; // stable id, as a string
  name: string;
  image?: string;
  note?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  items: PriorityItem[]; // everything the player can order
  defaults: string[]; // built-in order, used until the user saves their own
  order: string[]; // the user's saved order; empty means "use the default"
  onChange: (next: string[]) => void;
  emptyHint?: string;
}

/** The list the user should see: saved order, then defaults, then anything new. */
function effectiveOrder(order: string[], defaults: string[], items: PriorityItem[]): string[] {
  const available = new Set(items.map((i) => i.key));
  const out: string[] = [];
  for (const key of [...order, ...defaults, ...items.map((i) => i.key)]) {
    if (available.has(key) && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * Ordered-list editor for the focus / priority orders. Reordering is done with
 * explicit up/down buttons rather than drag-and-drop: it works with a keyboard,
 * it works on a phone, and it can't drop an item somewhere unexpected.
 */
export default function PriorityEditor({
  open,
  onClose,
  title,
  subtitle,
  items,
  defaults,
  order,
  onChange,
  emptyHint,
}: Props) {
  // The parent remounts this dialog each time it opens (keyed on open), so the
  // initializer already re-seeds from the stored order — cancel discards edits
  // by tearing the component down, not by re-seeding state.
  const [list, setList] = useState<string[]>(() => effectiveOrder(order, defaults, items));

  // When the underlying data changes while the editor is open (a new village
  // is loaded, which changes `items`), the local `list` goes stale: it was
  // seeded from the *previous* village's entities. Re-seed from the new data
  // so the user sees the current village's entities, not the old one's.
  // This effect only fires when `items` or `order` identity changes — not on
  // every keystroke — so it won't clobber the user's own reordering edits.
  const itemsKey = items.map((i) => i.key).join(",");
  const orderKey = order.join(",");
  // Re-seed only when the source list changes; local reordering stays stateful.
  // The key dependencies are intentional: parent array identity may change on
  // unrelated renders, but the draft should reset only when its contents do.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setList(effectiveOrder(order, defaults, items));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsKey, orderKey]);

  if (!open) return null;

  const byKey = new Map(items.map((i) => [i.key, i]));

  const move = (index: number, delta: -1 | 1) => {
    const next = index + delta;
    if (next < 0 || next >= list.length) return;
    setList((prev) => {
      const copy = [...prev];
      [copy[index], copy[next]] = [copy[next], copy[index]];
      return copy;
    });
  };

  const moveToTop = (index: number) =>
    setList((prev) => {
      if (index === 0) return prev;
      const copy = [...prev];
      const [it] = copy.splice(index, 1);
      copy.unshift(it);
      return copy;
    });

  return (
    <Modal
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <>
          <button
            onClick={() => setList(effectiveOrder([], defaults, items))}
            className="mr-auto rounded-xl border border-line px-4 py-2 text-sm text-ink-dim transition hover:text-ink"
          >
            Reset to default
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-line px-4 py-2 text-sm text-ink-dim transition hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onChange(list);
              onClose();
            }}
            className="rounded-xl bg-gradient-to-b from-gold-strong to-gold px-5 py-2 text-sm font-semibold text-[#1a1408] shadow-lg shadow-gold/20 transition hover:brightness-105 active:scale-[0.98]"
          >
            Save order
          </button>
        </>
      }
    >
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-faint">
          {emptyHint ?? "Nothing available to order yet."}
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs text-ink-faint">
            Highest priority at the top. Everything is planned eventually — this only decides
            what gets a builder or the laboratory first.
          </p>
          <ol className="space-y-1.5">
            {list.map((key, index) => {
              const item = byKey.get(key);
              if (!item) return null;
              return (
                <li
                  key={key}
                  className="flex items-center gap-3 rounded-xl border border-line bg-bg/40 px-3 py-2"
                >
                  <span className="w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-ink-faint">
                    {index + 1}
                  </span>
                  {item.image ? (
                    <img src={item.image} alt="" className="h-7 w-7 shrink-0 object-contain" />
                  ) : (
                    <span className="h-7 w-7 shrink-0 rounded bg-surface-2" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.name}</span>
                  {item.note && (
                    <span className="hidden shrink-0 text-xs text-ink-faint sm:inline">
                      {item.note}
                    </span>
                  )}
                  <span className="flex shrink-0 items-center gap-0.5">
                    <button
                      onClick={() => moveToTop(index)}
                      disabled={index === 0}
                      title="Move to top"
                      aria-label={`Move ${item.name} to top`}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition hover:bg-surface-2 hover:text-ink disabled:opacity-25 disabled:hover:bg-transparent"
                    >
                      ⤒
                    </button>
                    <button
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      title="Move up"
                      aria-label={`Move ${item.name} up`}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition hover:bg-surface-2 hover:text-ink disabled:opacity-25 disabled:hover:bg-transparent"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(index, 1)}
                      disabled={index === list.length - 1}
                      title="Move down"
                      aria-label={`Move ${item.name} down`}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition hover:bg-surface-2 hover:text-ink disabled:opacity-25 disabled:hover:bg-transparent"
                    >
                      ↓
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </Modal>
  );
}
