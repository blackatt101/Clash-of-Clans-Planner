import { useState } from "react";
import { getNewlyUnlockedEntities, hasNewUnlockablesAfterLevelChange } from "@/lib/newUnlockables";
import type { ParsedVillage } from "@/lib/parse";
import type { GameData } from "@/lib/staticData";

interface NewUnlockablesNotificationProps {
  currentParsed: ParsedVillage | null;
  previousParsed: ParsedVillage | null;
  gameData: GameData | null;
  village: "home" | "builderBase";
}

export default function NewUnlockablesNotification({
  currentParsed,
  previousParsed,
  gameData,
  village,
}: NewUnlockablesNotificationProps) {
  const [dismissed, setDismissed] = useState(false);

  if (!currentParsed || !gameData || dismissed) return null;
  if (!hasNewUnlockablesAfterLevelChange(previousParsed, currentParsed, gameData)) return null;

  const prevLevel = previousParsed
    ? village === "home"
      ? previousParsed.townHallLevel
      : previousParsed.builderHallLevel
    : null;
  const unlocked = getNewlyUnlockedEntities(currentParsed, gameData, village, prevLevel);
  if (unlocked.length === 0) return null;

  return (
    <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-emerald-500/20 p-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-emerald-400">New items available!</h3>
          <p className="mt-1 text-sm text-ink-dim">
            Your {village === "home" ? "Town Hall" : "Builder Hall"} upgrade has unlocked new items:
          </p>
          <ul className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4">
            {unlocked.map((entity, index) => (
              <li
                key={index}
                className="truncate rounded-lg bg-surface px-2 py-1 text-xs font-medium text-ink"
                title={entity.name}
              >
                {entity.name}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-faint">
            Consider adding these to your upgrade plan to maximize your base potential.
          </p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="mt-0.5 rounded-lg p-1 text-ink-dim transition hover:bg-surface hover:text-ink"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}