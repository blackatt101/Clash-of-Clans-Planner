/**
 * Raster export of the visual attack plan: draws the base screenshot and the
 * current SVG overlay into a canvas and returns a PNG/JPEG data URL. This is
 * what "Download Attack Plan" produces — the exact overlay the user is
 * looking at, composited onto the base. It is a rendering of the strategy
 * data, NOT an AI-generated image: no coordinates are invented here.
 */
import type { AttackStrategy } from "@/lib/attack/types";
import { preloadIconData } from "@/lib/attack/iconFor";


export interface ExportOptions {
  /** The SVG node currently shown (used to serialize the overlay). */
  svgElement: SVGSVGElement;
  /** The uploaded base screenshot (data URL or object URL). */
  baseSrc: string;
  strategy: AttackStrategy;
  images: Record<string, string>;
  /** Output square side in px. */
  size?: number;
  format?: "png" | "jpeg";
  /** Include the legend band at the bottom. */
  withLegend?: boolean;
}

/**
 * Build the exported image. Returns a data URL. Runs on the main thread —
 * export is a user-initiated, infrequent action.
 */
export async function exportAttackPlan(opts: ExportOptions): Promise<string> {
  const size = opts.size ?? 1400;
  const format = opts.format ?? "png";
  const legend = opts.withLegend !== false;

  // 1) Load icon data-URLs so the serialized SVG can embed them offline.
  const slugs = collectSlugs(opts.strategy);
  const icons = await preloadIconData(slugs, opts.images);
  const svgDataUrl = await serializeSvg(opts.svgElement, icons);

  // 2) Load the base screenshot.
  const base = await loadImage(opts.baseSrc);
  const baseRatio = base.width / base.height;

  // 3) Determine the canvas layout: base scaled to fit, legend strip below.
  const pad = Math.round(size * 0.02);
  const legendH = legend ? Math.round(size * 0.11) : 0;
  const area = size - pad * 2;
  const side = Math.min(area, area / baseRatio) ;
  const boardW = Math.max(area, side);
  const boardH = Math.max(area, side / baseRatio);

  const canvas = document.createElement("canvas");
  canvas.width = boardW + pad * 2;
  canvas.height = boardH + pad * 2 + legendH + (legend ? pad : 0);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");

  // 4) Background + base image (drawn to fill the board area, centered).
  ctx.fillStyle = "#080c12";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const boardX = (canvas.width - boardW) / 2;
  const boardY = pad;
  const offX = boardX + (boardW - side) / 2;
  const offY = boardY + (boardH - side) / 2;

  // The base image may be non-square; letterbox it into the square board.
  const drawSide = baseRatio >= 1 ? side : side * baseRatio;
  const drawOther = baseRatio >= 1 ? side / baseRatio : side;
  ctx.drawImage(
    base,
    offX + (side - drawSide) / 2,
    offY + (side - drawOther) / 2,
    drawSide,
    drawOther,
  );

  // 5) Overlay the serialized SVG, aligned to the base's drawn letterbox
  //    rectangle (its viewBox shares the base's aspect ratio, so this keeps
  //    every marker exactly on top of the building it points at).
  const overlay = await loadImage(svgDataUrl);
  ctx.drawImage(
    overlay,
    offX + (side - drawSide) / 2,
    offY + (side - drawOther) / 2,
    drawSide,
    drawOther,
  );

  // 6) Legend strip.
  if (legend) {
    drawLegend(ctx, boardX, boardY + boardH + pad, boardW, legendH);
  }

  const mime = format === "jpeg" ? "image/jpeg" : "image/png";
  return canvas.toDataURL(mime, 0.92);
}

/* -------------------------------------------------------------------------- */

function collectSlugs(strategy: AttackStrategy): string[] {
  const out = new Set<string>();
  for (const s of strategy.deployment_plan) out.add(s.unit);
  for (const p of strategy.paths ?? []) out.add(p.unit);
  for (const s of strategy.spell_actions ?? []) out.add(s.spell);
  for (const h of strategy.hero_abilities ?? []) out.add(h.hero);
  return [...out];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image for export."));
    img.src = src;
  });
}

/**
 * Clone the live SVG and inline any `<image href>` that points at a local
 * /icons/ path with its base64 data URL, so the exported PNG is self-contained.
 */
async function serializeSvg(svg: SVGSVGElement, icons: Map<string, { dataUrl: string | null; url: string | null }>): Promise<string> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const nodes = clone.querySelectorAll("image");
  for (const n of nodes) {
    const href = n.getAttribute("href") ?? "";
    if (href.startsWith("/icons/")) {
      // Resolve the icon to its data URL by matching against the icon set.
      const match = [...icons.values()].find((m) => m.url === href);
      const dataUrl = match?.dataUrl;
      if (dataUrl) {
        n.setAttribute("href", dataUrl);
      } else {
        n.remove();
      }
    }
  }
  // Give the cloned SVG an explicit intrinsic size matching its viewBox so that
  // when it is loaded as an <img> and drawn into the canvas, the browser keeps
  // the aspect exactly (otherwise an SVG without width/height can rasterize at
  // a default 300x150 and desync every marker from the base underneath it).
  const vbAttr = svg.getAttribute("viewBox")?.split(/\s+/).map(Number);
  const vw = vbAttr && vbAttr.length === 4 ? vbAttr[2] : 1000;
  const vh = vbAttr && vbAttr.length === 4 ? vbAttr[3] : 1000;
  clone.setAttribute("width", String(vw));
  clone.setAttribute("height", String(vh));
  clone.removeAttribute("class"); // drop Tailwind class= (not needed in the image)
  const xml = new XMLSerializer().serializeToString(clone);
  return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(xml)));
}

async function drawLegend(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const rows = [
    "① Deployment — where to drop each group",
    "→ Troop path / attack direction",
    "○ Spell placement area",
    "★ Priority defensive target",
    "FUNNEL — where to clear buildings to force the path",
  ];
  ctx.fillStyle = "rgba(24,41,54,0.6)";
  ctx.fillRect(x, y, width, height);
  ctx.font = `${Math.round(height * 0.16)}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = "#eef1f7";
  ctx.textBaseline = "middle";
  const lineH = height / (rows.length + 1);
  rows.forEach((line, i) => {
    ctx.fillText(line, x + 12, y + lineH * (i + 0.5));
  });
}
