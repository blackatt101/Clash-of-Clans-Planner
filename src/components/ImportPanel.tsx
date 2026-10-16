"use client";

import { useEffect, useRef, useState } from "react";
import { SAMPLE_EXPORT } from "@/lib/sample";
import type { RawExport } from "@/lib/types";

interface Props {
  /** `isBuiltinSample` marks the bundled demo village, which is never cached. */
  onParse: (text: string, isBuiltinSample?: boolean) => void;
  error: string | null;
  hasData: boolean;
  rawExport: RawExport | null;
  /** When this device's saved session was last written, or null if none. */
  savedAt?: number | null;
  onForget?: () => void;
}

/** "just now" / "4 min ago" / a date, for the saved-on-this-device note. */
function savedLabel(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const STEPS = [
  <>Open <span className="text-ink">Settings</span> (⚙️) in Clash of Clans.</>,
  <>Tap <span className="text-ink">More Settings</span>.</>,
  <>Scroll to <span className="text-ink">Data Export</span> and tap <span className="text-ink">Copy</span>.</>,
  <>Come back here and press <span className="text-ink">Paste Village JSON</span>.</>,
];

const BTN_PRIMARY =
  "rounded-xl bg-gradient-to-b from-gold-strong to-gold px-5 py-3 text-sm font-semibold text-[#1a1408] shadow-lg shadow-gold/20 transition hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

const BTN_GHOST =
  "rounded-xl border border-line px-5 py-3 text-sm text-ink-dim transition hover:border-gold/50 hover:text-ink";

export default function ImportPanel({
  onParse,
  error,
  hasData,
  rawExport,
  savedAt,
  onForget,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [clipError, setClipError] = useState<string | null>(null);
  // The box is closed by default: it is a tool, not a landing zone, and it
  // only opens when the user asks for it (the paste button) or when the
  // clipboard path genuinely hands them something to correct.
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [copied, setCopied] = useState(false);
  // Forgetting is one click away from a button sitting in a toolbar, so it asks
  // once. A native confirm() would do, but it blocks the page and reads as a
  // browser error rather than as part of the app.
  const [confirmForget, setConfirmForget] = useState(false);
  const lastExport = useRef<RawExport | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // When a new village lands, the box that produced it can fold itself away:
  // the read succeeded, so the raw text no longer needs a place to live. It
  // stays open when there is an error to act on, because that text is the
  // thing to fix.
  useEffect(() => {
    if (rawExport && rawExport !== lastExport.current) {
      lastExport.current = rawExport;
      setText("");
      setClipError(null);
      setShowHelp(false);
      setExpanded(false);
      // A new village arrived, so an armed "Forget it?" refers to the one that
      // is no longer loaded. Disarm it — the button sits in a toolbar and is
      // otherwise one stray click from clearing the new save.
      setConfirmForget(false);
    }
  }, [rawExport]);

  const pasteFromClipboard = async () => {
    // The button is the reason the box exists: always reveal it so there is a
    // place to put the text even when the clipboard read fails.
    setExpanded(true);
    setClipError(null);
    setBusy(true);
    try {
      if (!navigator.clipboard?.readText) {
        setClipError(
          "Clipboard auto-read is unavailable or blocked by browser permissions — click the box and press Ctrl+V; it parses instantly.",
        );
        requestAnimationFrame(() => taRef.current?.focus());
        return;
      }
      const t = await navigator.clipboard.readText();
      if (!t.trim()) {
        setClipError("Your clipboard is empty — copy the Data Export first.");
        requestAnimationFrame(() => taRef.current?.focus());
        return;
      }
      onParse(t);
    } catch {
      setClipError("Couldn't read the clipboard — click the box and press Ctrl+V; it parses instantly.");
      requestAnimationFrame(() => taRef.current?.focus());
    } finally {
      setBusy(false);
    }
  };

  const copyVillage = async () => {
    if (!rawExport) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(rawExport));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  // Compact bar once a village is loaded.
  if (hasData && !expanded) {
    return (
      <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
        <span className="flex items-center gap-2 text-sm text-ink">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          Village loaded
          {rawExport?.tag && (
            <span className="font-mono text-xs text-ink-faint">{rawExport.tag}</span>
          )}
        </span>
        {/* The village is kept on this device, so say so — and say how to be rid
            of it. Somebody planning on a borrowed machine will want that. */}
        {savedAt != null && (
          <span className="flex items-center gap-2 text-xs text-ink-faint">
            <span aria-hidden>💾</span>
            Saved on this device · {savedLabel(savedAt)}
            {onForget &&
              (confirmForget ? (
                <span className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      onForget();
                      setConfirmForget(false);
                    }}
                    className="rounded-md border border-red-900/70 bg-red-950/40 px-2 py-0.5 text-red-300 transition hover:border-red-700"
                  >
                    Forget it
                  </button>
                  <button
                    onClick={() => setConfirmForget(false)}
                    className="text-ink-faint transition hover:text-ink-dim"
                  >
                    cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmForget(true)}
                  className="underline decoration-dotted underline-offset-2 transition hover:text-ink-dim"
                >
                  forget
                </button>
              ))}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={pasteFromClipboard} className={BTN_PRIMARY}>
            {busy ? "Reading…" : "📋 Paste new JSON"}
          </button>
          <button onClick={copyVillage} className={BTN_GHOST}>
            {copied ? "Copied ✓" : "Copy village JSON"}
          </button>
        </div>
        {clipError && (
          <p className="w-full rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
            {clipError}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="card-lit relative overflow-hidden rounded-3xl border border-gold/20 bg-gradient-to-br from-surface via-surface to-bg p-6 shadow-2xl shadow-black/20 sm:p-10">
      {/* Soft ambient glows in the corners — pure CSS, no images. The gold
          top-right and the blue bottom-left frame the hero copy without
          costing a paint pass on the card node itself. */}
      <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-gold/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-lane-builder/10 blur-3xl" />
      {/* A thin gold line at the very top, echoing the header's hairline so
          the card reads as part of the same material. */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent" />

      <div className="relative">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-strong">
            <span className="h-1.5 w-1.5 rounded-full bg-gold shadow-[0_0_8px_rgba(242,181,58,0.8)] animate-pulse" />
            Free planner
          </span>
          <span className="rounded-full border border-line bg-bg/40 px-3 py-1 text-xs text-ink-faint">
            No login · reads locally
          </span>
        </div>
        <h1 className="mt-5 max-w-2xl text-3xl font-bold tracking-tight text-ink sm:text-5xl sm:leading-[1.08]">
          Turn your village export into a build order.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-dim sm:text-base">
          Paste your in-game village export and get a builder-accurate schedule for
          Home Village and Builder Base, with smart priorities and offline-friendly planning.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button
            onClick={pasteFromClipboard}
            disabled={busy}
            className="group relative inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-b from-gold-strong to-gold px-6 py-3 text-sm font-semibold text-[#1a1408] shadow-lg shadow-gold/25 transition hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="relative z-10">{busy ? "Reading clipboard…" : "📋 Try auto-paste"}</span>
            <span className="relative z-10 transition-transform group-hover:translate-x-0.5">→</span>
          </button>
          <button
            onClick={() => onParse(SAMPLE_EXPORT, true)}
            className="rounded-xl border border-line bg-surface/50 px-5 py-3 text-sm text-ink-dim transition hover:border-gold/40 hover:bg-surface-2/60 hover:text-ink active:scale-[0.98]"
          >
            Try sample data
          </button>
          <button
            onClick={() => setShowHelp((v) => !v)}
            className="rounded-lg px-2 py-1 text-sm font-medium text-gold transition hover:text-gold-strong"
          >
            {showHelp ? "Hide" : "How do I get my data?"}
          </button>
        </div>
        <p className="mt-3 text-xs text-ink-faint">
          If clipboard auto-read is blocked by your browser, use Ctrl+V in the box below — it parses instantly.
        </p>

        {clipError && (
          <p className="mt-3 max-w-xl rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
            {clipError}
          </p>
        )}

        {expanded && (
          <div className="mt-4">
            <textarea
              ref={taRef}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const t = e.clipboardData.getData("text");
                // Always hand the paste to the parser (even whitespace) so the
                // panel's error surfaces instead of a silent no-op.
                e.preventDefault();
                setText(t);
                onParse(t);
              }}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && text.trim()) onParse(text);
              }}
              placeholder='Paste your "Data Export" here — or press Ctrl+V and it parses automatically'
              spellCheck={false}
              className="h-40 w-full resize-y rounded-xl border border-line bg-bg p-3 font-mono text-xs text-ink placeholder:text-ink-faint transition focus:border-gold/60 focus:outline-none focus:ring-1 focus:ring-gold/25"
            />
            <button
              onClick={() => text.trim() && onParse(text)}
              disabled={!text.trim()}
              className={`${BTN_PRIMARY} mt-3`}
            >
              Parse &amp; Schedule
            </button>
          </div>
        )}

        {showHelp && (
          <ol className="mt-5 list-decimal space-y-1 pl-5 text-sm text-ink-dim">
            {STEPS.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}

        {error && (
          <p className="mt-3 rounded-lg border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
