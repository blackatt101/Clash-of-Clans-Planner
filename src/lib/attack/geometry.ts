/**
 * Geometry for the attack overlay. Normalized [0,1] coordinates are mapped
 * into an SVG viewBox that matches the screenshot's aspect ratio, so markers
 * stay aligned with the base at any resolution. All overlay primitives use
 * these helpers — never pixels, never a hard-coded 1000×1000.
 */
import type { Point } from "@/lib/attack/types";

export interface ViewBox {
  w: number;
  h: number;
}

/** viewBox string for an image of the given intrinsic dimensions. */
export function viewBoxString(vb: ViewBox): string {
  return `0 0 ${vb.w} ${vb.h}`;
}

/** Map a normalized point into viewBox units. */
export function toVb(p: Point, vb: ViewBox): { x: number; y: number } {
  return { x: p.x * vb.w, y: p.y * vb.h };
}

/** SVG path `d` for a polyline of normalized points. */
export function pathD(points: Point[], vb: ViewBox): string {
  if (points.length === 0) return "";
  const a = toVb(points[0], vb);
  let d = `M ${a.x.toFixed(1)} ${a.y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const p = toVb(points[i], vb);
    d += ` L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }
  return d;
}

/** A point offset from `from` toward `to` by `frac` (0..1). */
function lerp(from: Point, to: Point, frac: number): Point {
  return { x: from.x + (to.x - from.x) * frac, y: from.y + (to.y - from.y) * frac };
}

/**
 * An arrowhead as an SVG `<polygon>` points string, oriented along the last
 * segment of a path. Size is in viewBox units so it scales with zoom.
 */
export function arrowHead(points: Point[], vb: ViewBox, size: number): string {
  if (points.length === 0) return "";
  const last = toVb(points[points.length - 1], vb);
  const prev = toVb(points.length > 1 ? points[points.length - 2] : lerp(points[0], { x: points[0].x + 0.01, y: points[0].y + 0.01 }, 1), vb);
  const ang = Math.atan2(last.y - prev.y, last.x - prev.x);
  const r = size;
  const tip = { x: last.x, y: last.y };
  const back = ang + Math.PI;
  const spread = 0.5; // ~28° each side
  const p1 = {
    x: tip.x + Math.cos(back + spread) * r,
    y: tip.y + Math.sin(back + spread) * r,
  };
  const p2 = {
    x: tip.x + Math.cos(back - spread) * r,
    y: tip.y + Math.sin(back - spread) * r,
  };
  // A little tail so it reads as an arrow, not just a triangle.
  const tail = {
    x: tip.x + Math.cos(back) * r * 0.4,
    y: tip.y + Math.sin(back) * r * 0.4,
  };
  return `${tip.x.toFixed(1)},${tip.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${tail.x.toFixed(1)},${tail.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
}

/** Where to anchor a marker label so it doesn't run off the base. */
export function labelAnchor(p: Point): "start" | "middle" | "end" {
  if (p.x < 0.2) return "start";
  if (p.x > 0.8) return "end";
  return "middle";
}

/** A CSS transform string for the shared zoom/pan wrapper. */
export function transformString(scale: number, tx: number, ty: number): string {
  return `translate(${tx}px, ${ty}px) scale(${scale})`;
}
