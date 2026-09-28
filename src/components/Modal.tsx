"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Tailwind max-width class for the panel. */
  width?: string;
}

/** Everything the browser will let you Tab to inside the panel. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Shared modal shell: blurred overlay, Escape to close, click-outside to close,
 * a sticky header, and a scrollable body. Every dialog in the planner uses this
 * so they behave identically.
 *
 * `aria-modal` is a promise that the rest of the page is out of play, and it is
 * one this shell means to keep: focus moves into the panel when it opens, Tab
 * cycles inside it instead of walking out into the chart behind the overlay, and
 * closing puts focus back where it came from. Without that the keyboard could
 * reach the village tabs, the paste button and hundreds of timeline bars that
 * are sitting underneath a 75%-black overlay.
 */
export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = "max-w-2xl",
}: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === panel,
      );
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // Where the dialog has no form fields of its own, the natural tab order
      // starts at the close button — so entering the panel with Tab lands on it
      // rather than nowhere.
      if (!active || !panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Focus in on open, and hand it back to whatever opened the dialog on close.
  // Focus the panel itself (tabIndex -1), NOT its first focusable element: the
  // close button is first, and auto-focusing it made any stray Enter/Space —
  // or a click meant for a control right next to it — close the dialog instantly,
  // which read as "I can't do anything in here".
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus();
    return () => {
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  // A press that starts inside the panel and ends on the overlay is a text
  // selection or a slider drag that overshot, not a click-away: `click` fires on
  // the nearest common ancestor of press and release, so the overlay used to
  // close the dialog and discard unapplied edits. Closing on a press that both
  // starts and ends on the overlay keeps the real gesture.
  const pressedOverlay = useRef(false);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-md sm:p-8"
      onMouseDown={(e) => {
        pressedOverlay.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedOverlay.current) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`card-lit my-auto w-full ${width} rounded-3xl border border-line bg-surface shadow-2xl shadow-black/70 focus:outline-none`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-ink-dim">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-lg text-ink-dim transition hover:bg-surface-2 hover:text-ink"
          >
            ×
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
