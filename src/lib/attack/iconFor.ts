/**
 * Resolves a unit slug to the app's EXISTING icon URL (public/data/images.json
 * -> public/icons/*.webp), and to a base64 data URL so the exported PNG can
 * embed the icon without any network dependency. No new icon assets are
 * generated here.
 */
import { resolveEntity } from "@/lib/attack/catalog";

/**
 * @param slug a canonical or alias slug ("miner", "queen", "healing-spell")
 * @param images the GameData.images record (numeric-id -> url), as used
 *   everywhere else in the planner.
 * @returns the icon URL or null if the slug is unknown / has no icon.
 */
export function iconForSlug(slug: string, images: Record<string, string>): string | null {
  const entity = resolveEntity(slug);
  if (!entity) return null;
  return images[String(entity.ref.dataId)] ?? null;
}

export interface IconMeta {
  slug: string;
  /** URL for on-screen <img> / svg <image>. */
  url: string | null;
  /** Base64 data URL for offline export. null if the fetch has not resolved. */
  dataUrl: string | null;
  name: string;
}

/**
 * Load data URLs for the icons a strategy actually references, so PNG export
 * is self-contained. Resolves to a map slug -> IconMeta. Missing icons fall
 * back to a generated monogram badge so a marker is never blank.
 */
export async function preloadIconData(
  slugs: string[],
  images: Record<string, string>,
): Promise<Map<string, IconMeta>> {
  const out = new Map<string, IconMeta>();
  const unique = [...new Set(slugs)];
  await Promise.all(
    unique.map(async (slug) => {
      const entity = resolveEntity(slug);
      const url = entity ? (images[String(entity.ref.dataId)] ?? null) : null;
      let dataUrl: string | null = null;
      if (url) {
        try {
          const res = await fetch(url);
          const blob = await res.blob();
          dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch {
          dataUrl = null;
        }
      }
      out.set(slug, {
        slug,
        url,
        dataUrl,
        name: entity?.ref.name ?? slug,
      });
    }),
  );
  return out;
}

/** A small monogram badge (data-URL SVG) used when an icon is unavailable. */
export function monogramFor(slug: string, name: string): string {
  const letter = (name[0] ?? "?").toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="#182936"/>` +
    `<rect x="1.5" y="1.5" width="61" height="61" rx="13" fill="none" stroke="#f2b53a" stroke-width="3"/>` +
    `<text x="32" y="41" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#ffd35c" text-anchor="middle">${letter}</text>` +
    `</svg>`;
  return "data:image/svg+xml;base64," + btoa(svg);
}
