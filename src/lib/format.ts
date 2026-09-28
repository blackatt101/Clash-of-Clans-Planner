import type { Cost } from "./types";

export function formatTime(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "0s";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (parts.length === 0) parts.push(`${s}s`);
  return parts.slice(0, 3).join(" ");
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatCost(cost: Cost | null | undefined): string {
  if (cost == null) return "—";
  if (typeof cost === "number") return formatNumber(cost);
  const parts: string[] = [];
  if (cost.shiny_ore) parts.push(`${formatNumber(cost.shiny_ore)} shiny`);
  if (cost.glowy_ore) parts.push(`${formatNumber(cost.glowy_ore)} glowy`);
  if (cost.starry_ore) parts.push(`${formatNumber(cost.starry_ore)} starry`);
  return parts.join(" · ") || "—";
}
