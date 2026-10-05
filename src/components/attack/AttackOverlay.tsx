"use client";

/**
 * The SVG attack overlay. Pure rendering: it draws ONLY what is in
 * the strategy JSON (the source of truth) — markers at the JSON
 * positions, paths along the JSON points, spell circles at the JSON
 * spell positions. No coordinates are ever invented here.
 *
 * The overlay is an ANNOTATION LAYER, not a second map: the base
 * screenshot stays the primary visual element, so every primitive
 * is deliberately small (see visuals.ts) and grouped:
 *
 *   - one marker per troop GROUP ("Miner ×15"), never a swarm;
 *   - every marker, label and route of the same plan PHASE shares
 *     one colour, so an attack group can be followed across the
 *     base (Queen Charge green, King funnel red, Hybrid blue…);
 *   - routes draw with a hierarchy: the main push is the one
 *     thick solid arrow, funnels are thinner dashed routes,
 *     cleanup is a faint dotted guide;
 *   - spell areas are small, translucent hints that only appear
 *     at the step the spell is cast;
 *   - only strategically important targets get a compact glyph.
 *
 * Step-by-step reveal (the plan is a sequence, not a static map):
 *   - the CURRENT step is fully visible and highlighted,
 *   - COMPLETED steps stay visible but subdued,
 *   - FUTURE steps are hidden.
 * A path or spell appears only at the deployment step it is
 * attached to (`step` field; older plans fall back to unit
 * matching, and unattributable elements show in "All steps" only).
 *
 * Overlap control is deterministic, never random: labels are placed
 * by geometry.placeLabels, which finds a collision-free anchor
 * around the marker and draws a leader line when the label cannot
 * sit adjacent — the tactical position (where the troops deploy) is
 * never moved, only the label is offset.
 *
 * All primitives live in viewBox units (see `vb`), which match the
 * screenshot's intrinsic pixels, so the overlay is always exactly
 * aligned with the base image.
 */
import { useMemo } from "react";
import type { AttackStrategy, Point } from "@/lib/attack/types";
import { resolveEntity } from "@/lib/attack/catalog";
import {
  arrowHead,
  labelAnchor,
  pathD,
  placeLabels,
  simplifyPath,
  toVb,
  type LabelRequest,
  type PlacedLabel,
  type Rect,
  type ViewBox,
} from "@/lib/attack/geometry";
import {
  FUNNEL_R,
  ENTRY_S,
  MARKER_CLEARANCE,
  MARKER_R,
  PATH_WEIGHTS,
  SPELL_BADGE_R,
  SPELL_DEFAULT_RADIUS,
  SPELL_FILL_OPACITY,
  SPELL_RADIUS,
  SUBMARKER_CLEARANCE,
  SUBMARKER_R,
  TARGET_R,
  pathRole,
  phaseColor,
  phaseIndexOf,
  targetGlyph,
} from "@/lib/attack/visuals";
import {
  VIS_OPACITY,
  isRendered,
  pathStepIndex,
  spellStepIndex,
  stepLabel,
  stepVis,
  type StepVis,
} from "@/lib/attack/steps";

/** Spell colours (the spell type is the meaning, not the group). */
const SPELL_COLORS: Record<string, string> = {
  "healing-spell": "#199e70",
  "rage-spell": "#e0533f",
  "freeze-spell": "#4fc3f7",
  "poison-spell": "#a05cd5",
  "lightning-spell": "#ffd35c",
  "haste-spell": "#8ed16a",
  "jump-spell": "#f2b53a",
};
const SPELL_DEFAULT = "#8ea2b5";
/** Routes that cannot be attributed to a step (overview only). */
const ROUTE_DEFAULT = "#f2b53a";
const TARGET_COLORS: Record<string, string> = {
  high: "#e0533f",
  medium: "#f2b53a",
  low: "#8ea2b5",
};

export interface OverlayToggles {
  markers: boolean;
  paths: boolean;
  spells: boolean;
  targets: boolean;
}

export interface OverlayDrag {
  stepIndex?: number;
  spellIndex?: number;
  pathIndex?: number;
  pointIndex?: number;
}

export interface OverlayProps {
  strategy: AttackStrategy;
  vb: ViewBox;
  images: Record<string, string>;
  /** Index into deployment_plan; -1 = no step focused (all steps). */
  activeStep: number;
  activePhase: string | null;
  toggles: OverlayToggles;
  onStepSelect: (index: number) => void;
  onPathPointRemove: (pathIndex: number, pointIndex: number) => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
}

/** Which element a placed label belongs to (opaque pass-through). */
type LabelOwner =
  | { kind: "marker"; step: number }
  | { kind: "sub"; step: number }
  | { kind: "spell"; index: number }
  | { kind: "path"; index: number };

export default function AttackOverlay(props: OverlayProps) {
  const {
    strategy, vb, images, activeStep, activePhase, toggles,
    onStepSelect, onPathPointRemove, svgRef,
  } = props;

  const steps = strategy.deployment_plan;
  // Memoized so the iconFor useMemo below has stable dependencies.
  const paths = useMemo(() => strategy.paths ?? [], [strategy.paths]);
  const spells = useMemo(() => strategy.spell_actions ?? [], [strategy.spell_actions]);
  const targets = strategy.base_analysis?.importantTargets ?? [];
  const funnels = strategy.base_analysis?.funnels ?? [];
  const entries = strategy.base_analysis?.entryPoints ?? [];
  const phases = strategy.attack_phases ?? [];

  /** Marker icon per slug, resolved once per render. */
  const iconFor = useMemo(() => {
    const m = new Map<string, string | null>();
    const add = (slug: string | null | undefined) => {
      if (!slug || m.has(slug)) return;
      const ent = resolveEntity(slug);
      m.set(slug, ent ? images[String(ent.ref.dataId)] ?? null : null);
    };
    for (const s of steps) add(s.unit);
    for (const t of strategy.army.troops) add(t.id);
    for (const p of paths) add(p.unit);
    for (const s of spells) add(s.spell);
    return m;
  }, [steps, strategy.army.troops, paths, spells, images]);

  const drag = (d: OverlayDrag) =>
    svgRef.current?.dispatchEvent(new CustomEvent("attack-drag-start", { detail: d }));

  const isActive = (phase: string) => (activePhase !== null ? phase === activePhase : true);

  // ---- step attribution: which deployment step owns each path/spell ----
  const pathStep = useMemo(() => paths.map((p) => pathStepIndex(p, steps)), [paths, steps]);
  const spellStep = useMemo(
    () => spells.map((s) => spellStepIndex(s, steps, paths)),
    [spells, steps, paths],
  );

  /** Colour of the attack group (phase) that owns deployment step `i`. */
  const groupColor = (i: number): string =>
    phaseColor(phaseIndexOf(steps[i].phase, phases));

  /** Visibility of a path/spell attributed to step `si` (null = no step). */
  const elemVis = (si: number | null): StepVis =>
    si == null ? (activeStep < 0 ? "all" : "future") : stepVis(si, activeStep);

  /** Opacity of deployment step i (the phase filter dims non-matching phases). */
  const stepOp = (i: number): number => {
    const base = VIS_OPACITY[stepVis(i, activeStep)];
    return activePhase !== null && !isActive(steps[i].phase) ? 0.12 : base;
  };

  /** Opacity of a path/spell attributed to step `si`. */
  const elemOp = (si: number | null): number => {
    if (si == null) {
      // Not attributable to any step: complete-plan view only.
      if (activeStep >= 0) return 0;
      return activePhase === null ? 1 : 0.5;
    }
    return VIS_OPACITY[stepVis(si, activeStep)];
  };

  // ---- deterministic label placement (independent of the active step,
  //      so labels never jump around while stepping through the plan) ----
  const placedLabels = useMemo(() => {
    const base = strategy.base_analysis;
    const targets = base?.importantTargets ?? [];
    const funnels = base?.funnels ?? [];
    const entries = base?.entryPoints ?? [];
    const obstacles: Rect[] = [];
    const requests: LabelRequest[] = [];
    const addObstacle = (cx: number, cy: number, r: number) => {
      obstacles.push({ x: cx - r, y: cy - r, w: r * 2, h: r * 2 });
    };
    const nameOf = (slug: string) => resolveEntity(slug)?.ref.name ?? slug;
    const colorOf = (phaseName: string) =>
      phaseColor(phaseIndexOf(phaseName, strategy.attack_phases ?? []));

    // Deployment markers, in step order (placement priority). The
    // label sits just outside the marker + its step badge.
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const { x, y } = toVb(s.position, vb);
      addObstacle(x, y, vb.w * MARKER_CLEARANCE);
      requests.push({
        key: `lbl-m-${i}`,
        anchor: s.position,
        text: stepLabel(s, nameOf(s.unit)),
        fontSize: vb.w * 0.024,
        anchorRadius: vb.w * MARKER_CLEARANCE,
        color: colorOf(s.phase),
        owner: { kind: "marker", step: i } satisfies LabelOwner,
      });
      s.deployments?.forEach((d, j) => {
        const p = toVb(d.position, vb);
        addObstacle(p.x, p.y, vb.w * SUBMARKER_CLEARANCE);
        requests.push({
          key: `lbl-s-${i}-${j}`,
          anchor: d.position,
          text: `${d.label ? `${d.label} ` : ""}×${d.count}`,
          fontSize: vb.w * 0.019,
          anchorRadius: vb.w * SUBMARKER_CLEARANCE,
          color: colorOf(s.phase),
          owner: { kind: "sub", step: i } satisfies LabelOwner,
        });
      });
    }

    // Spell icons (the small badge, not the whole hint area).
    for (let i = 0; i < spells.length; i++) {
      const sp = spells[i];
      const { x, y } = toVb(sp.position, vb);
      addObstacle(x, y, vb.w * 0.04);
      requests.push({
        key: `lbl-sp-${i}`,
        anchor: sp.position,
        text: sp.spell.replace("-spell", "").toUpperCase(),
        fontSize: vb.w * 0.019,
        anchorRadius: vb.w * 0.04,
        color: SPELL_COLORS[sp.spell] ?? SPELL_DEFAULT,
        owner: { kind: "spell", index: i } satisfies LabelOwner,
      });
    }

    // NOTE: paths deliberately get NO text label of their own — the
    // arrow starts at the group's marker, whose label already names
    // it, and the route is painted in the group's colour. A duplicate
    // label could only sit on top of that marker, which is exactly the
    // clutter this layer exists to prevent.

    // Priority targets and entry points keep their inline names;
    // reserve those boxes so placed labels never cover them.
    for (const t of targets) {
      const { x, y } = toVb(t.position, vb);
      const r = vb.w * TARGET_R;
      const fs = vb.w * 0.016;
      const label = targetGlyph(t.type, t.label);
      addObstacle(x, y, r * 1.3);
      obstacles.push({
        x: x - (label.length * fs * 0.6) / 2,
        y: y + r + vb.w * 0.006,
        w: label.length * fs * 0.6,
        h: fs * 1.3,
      });
    }
    for (const e of entries) {
      const { x, y } = toVb(e.position, vb);
      const s = vb.w * ENTRY_S;
      addObstacle(x, y, s * 1.15);
      obstacles.push({
        x: x - vb.w * 0.02,
        y: y + s + vb.w * 0.014,
        w: vb.w * 0.04,
        h: vb.w * 0.016,
      });
    }
    for (const f of funnels) {
      const { x, y } = toVb(f.position, vb);
      const r = vb.w * FUNNEL_R;
      // The "FUNNEL" caption above the ring.
      obstacles.push({
        x: x - vb.w * 0.035,
        y: y - r - vb.w * 0.026,
        w: vb.w * 0.07,
        h: vb.w * 0.02,
      });
    }

    return placeLabels(requests, obstacles, vb);
  }, [strategy, steps, spells, vb]);

  /** Render opacity for a placed label, from its owning element. */
  const labelStyle = (l: PlacedLabel): { opacity: number; skip: boolean } => {
    const o = l.owner as LabelOwner | undefined;
    if (!o) return { opacity: 1, skip: false };
    if (o.kind === "marker" || o.kind === "sub") {
      return {
        opacity: stepOp(o.step),
        skip: !isRendered(stepVis(o.step, activeStep)),
      };
    }
    const si = o.kind === "spell" ? spellStep[o.index] : pathStep[o.index];
    return { opacity: elemOp(si), skip: !isRendered(elemVis(si)) };
  };

  // A marker: group-coloured icon in a badge + the step number.
  // The count lives in the (collision-placed) label layer, never on
  // the marker itself.
  const marker = (
    key: string,
    p: Point,
    slug: string,
    stepNo: number,
    i: number,
    sub: boolean,
    opacity: number,
  ) => {
    const { x, y } = toVb(p, vb);
    const r = vb.w * (sub ? SUBMARKER_R : MARKER_R);
    const icon = iconFor.get(slug) ?? null;
    const color = groupColor(i);
    const active = activeStep === i && activePhase === null && !sub;
    return (
      <g
        key={key}
        id={key}
        opacity={opacity}
        style={{ cursor: sub ? "default" : "grab" }}
        onClick={() => {
          if (!sub) onStepSelect(i);
        }}
        onPointerDown={(e) => {
          if (sub) return;
          e.stopPropagation();
          drag({ stepIndex: i });
        }}
      >
        {active && (
          <circle
            cx={x} cy={y} r={r * 1.65} fill="none" stroke={color}
            strokeWidth={vb.w * 0.0028}
            strokeDasharray={`${vb.w * 0.01} ${vb.w * 0.007}`} opacity={0.9}
          />
        )}
        <circle cx={x} cy={y} r={r} fill="rgba(8,12,18,0.85)" stroke={color} strokeWidth={vb.w * (active ? 0.0045 : 0.003)} />
        {icon ? (
          <image
            href={icon}
            x={x - r * 0.62} y={y - r * 0.62} width={r * 1.24} height={r * 1.24}
            preserveAspectRatio="xMidYMid meet"
          />
        ) : (
          <text x={x} y={y + r * 0.36} textAnchor="middle" fontSize={r * 0.9} fill={color} fontWeight={700}>
            {slug.slice(0, 2).toUpperCase()}
          </text>
        )}
        {!sub && (
          <g transform={`translate(${x + r * 0.82}, ${y - r * 0.82})`}>
            <circle r={vb.w * 0.019} fill={color} stroke="#080c12" strokeWidth={vb.w * 0.0028} />
            <text textAnchor="middle" y={vb.w * 0.0075} fontSize={vb.w * 0.021} fontWeight={700} fill="#080c12">
              {stepNo}
            </text>
          </g>
        )}
      </g>
    );
  };

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 h-full w-full touch-none select-none"
      viewBox={`0 0 ${vb.w} ${vb.h}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Layer 2 — target highlights: compact glyphs, always visible
          (they answer "what matters here"); the base stays readable */}
      {toggles.targets && targets.map((t, i) => {
        const { x, y } = toVb(t.position, vb);
        const r = vb.w * TARGET_R;
        const color = TARGET_COLORS[t.priority ?? "medium"] ?? SPELL_DEFAULT;
        const label = targetGlyph(t.type, t.label);
        return (
          <g key={`t-${i}`} opacity={0.95}>
            <path d={starPath(x, y, r, r * 0.45)} fill={color} fillOpacity={0.9} stroke="#080c12" strokeWidth={vb.w * 0.0022} />
            {(t.confidence != null && t.confidence < 0.6) && (
              <text x={x} y={y - r - vb.w * 0.005} textAnchor="middle" fontSize={vb.w * 0.014} fill={color} stroke="#080c12" strokeWidth={vb.w * 0.0022} style={{ paintOrder: "stroke" }}>
                ?{Math.round(t.confidence * 100)}%
              </text>
            )}
            <text x={x} y={y + r + vb.w * 0.018} textAnchor={labelAnchor(t.position)} fontSize={vb.w * 0.016} fontWeight={600} fill="#eef1f7" stroke="#080c12" strokeWidth={vb.w * 0.003} style={{ paintOrder: "stroke" }}>
              {label}
            </text>
          </g>
        );
      })}

      {/* Entry points — where the attack walks in */}
      {toggles.targets && entries.map((e, i) => {
        const { x, y } = toVb(e.position, vb);
        const s = vb.w * ENTRY_S;
        return (
          <g key={`e-${i}`} opacity={0.9}>
            <path d={`M ${x} ${y - s * 0.7} L ${x + s * 0.62} ${y + s * 0.45} L ${x - s * 0.62} ${y + s * 0.45} Z`} fill="#eef1f7" fillOpacity={0.85} stroke="#080c12" strokeWidth={vb.w * 0.0018} />
            <text x={x} y={y + s + vb.w * 0.017} textAnchor="middle" fontSize={vb.w * 0.015} fill="#eef1f7" stroke="#080c12" strokeWidth={vb.w * 0.0026} style={{ paintOrder: "stroke" }}>
              entry
            </text>
          </g>
        );
      })}

      {/* Funnels — where the attack packs together */}
      {toggles.markers && funnels.map((f, i) => {
        const { x, y } = toVb(f.position, vb);
        const r = vb.w * FUNNEL_R;
        return (
          <g key={`f-${i}`} opacity={0.9}>
            <circle cx={x} cy={y} r={r} fill="none" stroke="#d95926" strokeWidth={vb.w * 0.004} strokeDasharray={`${vb.w * 0.009} ${vb.w * 0.007}`} />
            <circle cx={x} cy={y} r={vb.w * 0.009} fill="#d95926" opacity={0.55} />
            <text x={x} y={y - r - vb.w * 0.007} textAnchor="middle" fontSize={vb.w * 0.017} fontWeight={800} fill="#d95926" stroke="#080c12" strokeWidth={vb.w * 0.003} style={{ paintOrder: "stroke" }}>
              FUNNEL
            </text>
          </g>
        );
      })}

      {/* Layer 3 — troop routes, simplified to meaningful waypoints and
          revealed with the step they belong to. The route is painted in
          its group's colour; its weight says what kind of route it is:
          the push is the thick solid arrow, funnels and cleanup are
          thinner, quieter guides. */}
      {toggles.paths && paths.map((p, pi) => {
        const si = pathStep[pi];
        if (!isRendered(elemVis(si))) return null;
        const op = elemOp(si);
        const weight = PATH_WEIGHTS[pathRole(p.style)];
        const color =
          si != null ? groupColor(si) : ROUTE_DEFAULT;
        const pts =
          p.points.length > 4
            ? simplifyPath(p.points, vb.w * 0.015)
            : p.points;
        const d = pathD(pts, vb);
        const head = arrowHead(pts, vb, vb.w * weight.arrow);
        return (
          <g key={`p-${pi}`} id={`ovl-path-${pi}`} opacity={op}>
            {weight.glow > 0 && (
              <path d={d} fill="none" stroke={color} strokeWidth={vb.w * weight.glow} strokeOpacity={weight.glowOpacity} strokeLinecap="round" />
            )}
            <path
              d={d} fill="none" stroke={color}
              strokeWidth={vb.w * weight.core}
              strokeOpacity={weight.coreOpacity}
              strokeDasharray={weight.dashed ? `${vb.w * 0.013} ${vb.w * 0.009}` : undefined}
              strokeLinecap="round"
            />
            <polygon points={head} fill={color} stroke="#080c12" strokeWidth={vb.w * 0.0018} />
            {pts.map((pt, j) => {
              const { x, y } = toVb(pt, vb);
              const edge = j === 0 || j === pts.length - 1;
              return (
                <circle
                  key={j}
                  cx={x} cy={y} r={vb.w * weight.dot}
                  fill="#080c12" stroke={color} strokeWidth={vb.w * 0.0026}
                  opacity={edge ? 0.95 : 0.45}
                  style={{ cursor: "grab" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    drag({ pathIndex: pi, pointIndex: j });
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (pts.length > 2) onPathPointRemove(pi, j);
                  }}
                />
              );
            })}
          </g>
        );
      })}

      {/* Layer 4 — spell areas: small translucent hints, only at the
          step the spell is cast */}
      {toggles.spells && spells.map((s, idx) => {
        const si = spellStep[idx];
        if (!isRendered(elemVis(si))) return null;
        const op = elemOp(si);
        const { x, y } = toVb(s.position, vb);
        const color = SPELL_COLORS[s.spell] ?? SPELL_DEFAULT;
        const radius = vb.w * (SPELL_RADIUS[s.spell] ?? SPELL_DEFAULT_RADIUS);
        const icon = iconFor.get(s.spell) ?? null;
        return (
          <g
            key={`s-${idx}`}
            id={`ovl-spell-${idx}`}
            opacity={op}
            style={{ cursor: "grab" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              drag({ spellIndex: idx });
            }}
          >
            <circle cx={x} cy={y} r={radius} fill={color} fillOpacity={SPELL_FILL_OPACITY} stroke={color} strokeWidth={vb.w * 0.003} strokeDasharray={`${vb.w * 0.007} ${vb.w * 0.005}`} strokeOpacity={0.7} />
            <circle cx={x} cy={y} r={vb.w * SPELL_BADGE_R} fill="rgba(8,12,18,0.88)" stroke={color} strokeWidth={vb.w * 0.003} />
            {icon ? (
              <image href={icon} x={x - vb.w * 0.018} y={y - vb.w * 0.018} width={vb.w * 0.036} height={vb.w * 0.036} preserveAspectRatio="xMidYMid meet" />
            ) : (
              <text x={x} y={y + vb.w * 0.009} textAnchor="middle" fontSize={vb.w * 0.024} fill={color} fontWeight={700}>
                {s.spell.slice(0, 2).toUpperCase()}
              </text>
            )}
          </g>
        );
      })}

      {/* Layer 5 — deployment markers, one per troop GROUP, revealed
          with their step; sub-deployments ride along with their parent */}
      {toggles.markers && steps.map((s, i) => {
        if (!isRendered(stepVis(i, activeStep))) return null;
        const op = stepOp(i);
        return (
          <g key={`step-${i}`} id={`ovl-step-${i}`}>
            {marker(`m-${i}`, s.position, s.unit, s.step, i, false, op)}
            {s.deployments?.map((d, j) =>
              marker(`ms-${i}-${j}`, d.position, s.unit, s.step, i, true, op),
            )}
          </g>
        );
      })}

      {/* Layer 6 — labels. Deterministically placed around their
          marker with leader lines when they cannot sit adjacent, so
          they never cover markers, badges, paths, spells or priority
          targets. Painted in the group colour of the step they name. */}
      {placedLabels.map((l) => {
        const { opacity, skip } = labelStyle(l);
        if (skip) return null;
        const ax = l.anchor.x * vb.w;
        const ay = l.anchor.y * vb.h;
        const nearX = Math.min(Math.max(ax, l.cx - l.w / 2), l.cx + l.w / 2);
        const nearY = Math.min(Math.max(ay, l.cy - l.h / 2), l.cy + l.h / 2);
        return (
          <g key={l.key} id={l.key} opacity={opacity} pointerEvents="none">
            {l.leader && (
              <line
                x1={ax} y1={ay} x2={nearX} y2={nearY}
                stroke={l.color} strokeWidth={vb.w * 0.0018} strokeOpacity={0.75}
              />
            )}
            <rect
              x={l.cx - l.w / 2} y={l.cy - l.h / 2} width={l.w} height={l.h}
              rx={l.h / 2} fill="rgba(8,12,18,0.82)"
              stroke={l.color} strokeOpacity={0.5} strokeWidth={vb.w * 0.0013}
            />
            <text
              x={l.cx} y={l.cy} textAnchor="middle" dominantBaseline="central"
              fontSize={l.fontSize} fontWeight={700} fill={l.color}
              stroke="#080c12" strokeWidth={vb.w * 0.0026} style={{ paintOrder: "stroke" }}
            >
              {l.text}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** A five-point star (priority target glyph). */
function starPath(cx: number, cy: number, outer: number, inner: number): string {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    d += `${i === 0 ? "M" : "L"} ${(cx + Math.cos(ang) * r).toFixed(1)} ${(cy + Math.sin(ang) * r).toFixed(1)} `;
  }
  return d + "Z";
}
