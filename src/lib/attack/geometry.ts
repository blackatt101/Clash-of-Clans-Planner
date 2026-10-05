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

/**
 * Ramer–Douglas–Peucker polyline simplification (deterministic).
 * Keeps the first and last point; drops intermediate points that
 * deviate from the simplified line by less than `epsilon`. Used to
 * keep AI-drawn paths to their meaningful waypoints.
 */
export function simplifyPath(points: Point[], epsilon: number): Point[] {
  return simplifyPathIndexed(points, epsilon).points;
}

/**
 * `simplifyPath`, but also reports which original indices survived.
 * Callers render the simplified polyline yet edit the original
 * point array (drag / remove a waypoint), so every rendered dot
 * must dispatch its source index, not its position in the
 * simplified list.
 */
export function simplifyPathIndexed(
  points: Point[],
  epsilon: number,
): { points: Point[]; indices: number[] } {
  if (points.length <= 2 || epsilon <= 0) {
    return { points, indices: points.map((_, i) => i) };
  }
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let maxI = -1;
    const ax = points[a].x;
    const ay = points[a].y;
    const dx = points[b].x - ax;
    const dy = points[b].y - ay;
    const len = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) {
      // Perpendicular distance to segment a–b (falls back to the
      // endpoint distance when the segment is degenerate).
      const d =
        len > 0
          ? Math.abs((points[i].x - ax) * dy - (points[i].y - ay) * dx) / len
          : Math.hypot(points[i].x - ax, points[i].y - ay);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxI > 0 && maxD > epsilon) {
      keep[maxI] = true;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  const kept: Point[] = [];
  const indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) {
      kept.push(points[i]);
      indices.push(i);
    }
  }
  return { points: kept, indices };
}

/* ------------------------------------------------------------------------ */
/* Label placement                                                            */
/* ------------------------------------------------------------------------ */

/** Axis-aligned box in viewBox units. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A label awaiting placement. `anchor` is normalized [0,1]. */
export interface LabelRequest {
  /** Stable key (renders as the React key). */
  key: string;
  anchor: Point;
  text: string;
  /** Font size in viewBox units. */
  fontSize: number;
  /**
   * Radius (viewBox units) of the marker the label belongs to —
   * labels keep a clear gap around it (and its step badge).
   */
  anchorRadius: number;
  /** Label colour (passed through untouched). */
  color?: string;
  /** Opaque caller data (e.g. which element owns this label). */
  owner?: unknown;
}

/** A label with a resolved, collision-free box (viewBox units). */
export interface PlacedLabel {
  key: string;
  anchor: Point;
  text: string;
  fontSize: number;
  /** Box center in viewBox units. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** True when the label sits beyond the marker's immediate ring
   *  and needs a leader line back to it. */
  leader: boolean;
  /** Passed through from the request. */
  color?: string;
  /** Passed through from the request. */
  owner?: unknown;
}

/** Deterministic placement order: below first, then around. */
const LABEL_DIRS = [
  { dx: 0, dy: 1 },
  { dx: 1, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: -1 },
] as const;

/** Average glyph width for a bold system font, as a fraction of the size. */
const GLYPH_WIDTH = 0.62;
/** Line height as a fraction of the font size. */
const LINE_HEIGHT = 1.35;
/** Padding between a label box and anything else (viewBox units). */
const LABEL_PAD = 2;
/** Ring distances (× anchorRadius) tried in order before giving up. */
const LABEL_RINGS = [1.45, 2.6, 3.9];
/** Beyond this gap (× anchorRadius) a leader line is drawn. */
const LEADER_GAP = 1.9;

function estimateSize(text: string, fontSize: number): { w: number; h: number } {
  return {
    w: Math.max(1, text.length * fontSize * GLYPH_WIDTH) + LABEL_PAD * 2,
    h: fontSize * LINE_HEIGHT + LABEL_PAD * 2,
  };
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}
export { rectsOverlap };

/**
 * Place labels at deterministic, collision-free anchors around their
 * markers. Candidates are tried in a fixed order (ring, then
 * compass direction starting south), so the same strategy always
 * produces the same layout. Labels that cannot avoid everything
 * settle on the least-crowded candidate — never a random offset.
 *
 * `obstacles` are boxes the labels must not cover (other markers,
 * spell circles, priority targets, …) in viewBox units.
 */
export function placeLabels(
  requests: LabelRequest[],
  obstacles: Rect[],
  vb: ViewBox,
): PlacedLabel[] {
  const placed: Rect[] = [];
  const out: PlacedLabel[] = [];
  for (const req of requests) {
    const { w, h } = estimateSize(req.text, req.fontSize);
    const ax = req.anchor.x * vb.w;
    const ay = req.anchor.y * vb.h;
    let best: { box: Rect; score: number; ring: number } | null = null;
    for (const ring of LABEL_RINGS) {
      const d = req.anchorRadius * ring;
      for (const dir of LABEL_DIRS) {
        // Box near-edge sits at distance d from the anchor.
        const cx =
          ax + dir.dx * (d + (dir.dx !== 0 ? w / 2 : 0));
        const cy =
          ay + dir.dy * (d + (dir.dy !== 0 ? h / 2 : 0));
        // Keep the box inside the viewBox.
        const bx = Math.min(Math.max(cx, w / 2 + LABEL_PAD), vb.w - w / 2 - LABEL_PAD);
        const by = Math.min(Math.max(cy, h / 2 + LABEL_PAD), vb.h - h / 2 - LABEL_PAD);
        const box: Rect = { x: bx - w / 2, y: by - h / 2, w, h };
        let score = 0;
        for (const o of obstacles) if (rectsOverlap(box, o)) score++;
        for (const p of placed) if (rectsOverlap(box, p)) score++;
        if (score === 0) {
          best = { box, score, ring };
          break;
        }
        if (!best || score < best.score) best = { box, score, ring };
      }
      if (best && best.score === 0) break;
    }
    const box = best!.box;
    placed.push(box);
    // Leader line when the label is beyond the marker's near ring.
    const nearX = Math.min(Math.max(ax, box.x), box.x + box.w);
    const nearY = Math.min(Math.max(ay, box.y), box.y + box.h);
    const gap = Math.hypot(nearX - ax, nearY - ay);
    out.push({
      key: req.key,
      anchor: req.anchor,
      text: req.text,
      fontSize: req.fontSize,
      cx: box.x + box.w / 2,
      cy: box.y + box.h / 2,
      w: box.w,
      h: box.h,
      leader: gap > req.anchorRadius * LEADER_GAP,
      color: req.color,
      owner: req.owner,
    });
  }
  return out;
}
