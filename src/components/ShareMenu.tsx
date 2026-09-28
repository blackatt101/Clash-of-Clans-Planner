"use client";

import { useRef, useState } from "react";
import Modal from "@/components/Modal";
import { exportSettings, importSettings } from "@/lib/share";
import type { PlannerSettings } from "@/lib/settings";

interface Props {
  open: boolean;
  onClose: () => void;
  settings: PlannerSettings;
  scheduleText: string;
  onCopyLink: () => Promise<string>; // resolves to a status message
  onImportSettings: (settings: PlannerSettings) => void;
  onResetSettings: () => void;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-bg/40 p-4">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </section>
  );
}

export default function ShareMenu({
  open,
  onClose,
  settings,
  scheduleText,
  onCopyLink,
  onImportSettings,
  onResetSettings,
}: Props) {
  const [status, setStatus] = useState<string | null>(null);
  /** Whether the status line is a failure, so it stops reading as a green "ok". */
  const [statusError, setStatusError] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // The dialog unmounts nothing when it closes, so a status line from the last
  // visit ("Could not copy…") would still be sitting there on the next one, now
  // describing an action the user did not just take. Start clean each open:
  // the parent remounts this component when `open` flips, so the initial state
  // is already clean and there is nothing to reset.

  if (!open) return null;

  const note = (msg: string, isErr = false) => {
    setStatus(msg);
    setStatusError(isErr);
  };

  const applyImport = (text: string) => {
    try {
      onImportSettings(importSettings(text));
      note("Settings imported.");
      setPasteText("");
      setPasteOpen(false);
    } catch (e) {
      note(`Import failed — ${e instanceof Error ? e.message : String(e)}`, true);
    }
  };

  const download = () => {
    const blob = new Blob([exportSettings(settings)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clash-max-settings.json";
    a.click();
    URL.revokeObjectURL(url);
    note("Settings file downloaded.");
  };

  const btn =
    "rounded-xl border border-line px-3.5 py-2 text-sm text-ink-dim transition hover:border-gold/50 hover:text-ink";
  const btnPrimary =
    "rounded-xl bg-gradient-to-b from-gold-strong to-gold px-4 py-2 text-sm font-semibold text-[#1a1408] shadow-md shadow-gold/15 transition hover:brightness-105 active:scale-[0.98]";

  return (
    <Modal
      title="Export & Import"
      subtitle="Move your plan and settings in and out of the planner"
      onClose={onClose}
      footer={
        <button
          onClick={onClose}
          className="rounded-xl bg-gradient-to-b from-gold-strong to-gold px-5 py-2 text-sm font-semibold text-[#1a1408] shadow-lg shadow-gold/20 transition hover:brightness-105 active:scale-[0.98]"
        >
          Done
        </button>
      }
    >
      <div className="space-y-4">
        <Row
          title="Share link"
          hint="A URL that carries your village, your plan and every setting — no account needed."
        >
          <button
            className={btnPrimary}
            onClick={async () => note(await onCopyLink())}
          >
            Copy share link
          </button>
        </Row>

        <Row title="Schedule" hint="The full build order as plain text, for pasting into chat.">
          <button
            className={btn}
            onClick={async () =>
              note(
                (await copy(scheduleText))
                  ? "Schedule copied."
                  : "Could not copy — your browser blocked clipboard access.",
              )
            }
          >
            Copy schedule
          </button>
        </Row>

        <Row
          title="Settings"
          hint="Strategy, builders, unavailable windows, priority orders and boosts."
        >
          <button
            className={btn}
            onClick={async () =>
              note(
                (await copy(exportSettings(settings)))
                  ? "Settings copied as JSON."
                  : "Could not copy — your browser blocked clipboard access.",
              )
            }
          >
            Copy settings
          </button>
          <button className={btn} onClick={download}>
            Download .json
          </button>
          <button className={btn} onClick={() => fileRef.current?.click()}>
            Import file
          </button>
          <button className={btn} onClick={() => setPasteOpen((v) => !v)}>
            {pasteOpen ? "Hide paste box" : "Paste instead"}
          </button>
          <button
            className="rounded-xl border border-line px-3.5 py-2 text-sm text-ink-faint transition hover:border-red-800 hover:text-red-300"
            onClick={() => {
              onResetSettings();
              note("Settings reset to defaults.");
            }}
          >
            Reset settings
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              applyImport(await file.text());
            }}
          />
        </Row>

        {pasteOpen && (
          <div className="rounded-2xl border border-line bg-bg/40 p-4">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste settings JSON here…"
              rows={5}
              className="w-full rounded-xl border border-line bg-bg px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-gold/60 focus:outline-none"
            />
            <button
              className={`${btnPrimary} mt-2`}
              disabled={!pasteText.trim()}
              onClick={() => applyImport(pasteText)}
            >
              Import pasted settings
            </button>
          </div>
        )}

        {status && (
          <p
            className={`rounded-xl border px-4 py-2.5 text-sm ${
              statusError
                ? "border-red-900/60 bg-red-950/40 text-red-300"
                : "border-line bg-surface-2/60 text-emerald-300"
            }`}
          >
            {status}
          </p>
        )}
      </div>
    </Modal>
  );
}
