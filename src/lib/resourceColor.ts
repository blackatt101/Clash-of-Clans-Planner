export function resourceClass(resource: string): string {
  const r = resource.toLowerCase();
  if (r.includes("dark elixir")) return "text-violet-300";
  if (r.includes("builder") && r.includes("elixir")) return "text-cyan-300";
  if (r.includes("builder") && r.includes("gold")) return "text-orange-300";
  if (r.includes("gold")) return "text-amber-300";
  if (r.includes("elixir")) return "text-pink-300";
  return "text-zinc-300";
}
