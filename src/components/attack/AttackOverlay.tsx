"use client";

/**
 * The SVG attack overlay. Pure rendering: it draws ONLY what is in the
 * strategy JSON (the source of truth) — markers at the JSON positions, paths
 * along the JSON points, spell circles at the JSON spell positions. No
 * coordinates are ever invented here.
 *
 * All primitives live in viewBox units (see `vb`), which match the
 * screenshot's intrinsic pixels, so the overlay is always exactly aligned
 * with the base image.
 */
import { useMemo } from "react";
import type { AttackStrategy, Point } from "@/lib/attack/types";
import { heroOfUnit, resolveEntity } from "@/lib/attack/catalog";
import { arrowHead, labelAnchor, pathD, toVb, type ViewBox } from "@/lib/attack/geometry";

/** Colour per path style, reusing the app's lane tokens. */
const PATH_COLORS: Record<string, string> = {
  attack: "#f2b53a",
  funnel: "#d95926",
  cleanup: "#199e70",
};
const HERO_COLOR = "#3987e5";
const MARKER_COLOR = "#f2b53a";
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
/** Approximate spell radius as a fraction of the base (planning hint only). */
const SPELL_RADIUS: Record<string, number> = {
  "healing-spell": 0.1,
  "rage-spell": 0.11,
  "freeze-spell": 0.13,
  "poison-spell": 0.09,
  "lightning-spell": 0.06,
  "jump-spell": 0.07,
};
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
  /** Index into deployment_plan; -1 = no step focused. */
  activeStep: number;
  activePhase: string | null;
  toggles: OverlayToggles;
  onStepSelect: (index: number) => void;
  onPathPointRemove: (pathIndex: number, pointIndex: number) => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
}

/** Opacity for a step given the playback head. */
function stepOpacity(i: number, activeStep: number): number {
  if (activeStep < 0) return 1;
  if (i === activeStep) return 1;
  if (i < activeStep) return 0.3;
  return 0.75;
}

function starPath(cx: number, cy: number, outer: number, inner: number): string {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    d += `${i === 0 ? "M" : "L"} ${(cx + Math.cos(ang) * r).toFixed(1)} ${(cy + Math.sin(ang) * r).toFixed(1)} `;
  }
  return d + "Z";
}

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

  /** slug -> existing app icon URL, resolved once per render. */
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

  // A marker: icon in a badge + step number + count, at a normalized point.
  const marker = (
    key: string,
    p: Point,
    slug: string,
    stepNo: number,
    count: number,
    subLabel: string | undefined,
    i: number,
    phase: string,
    hero: boolean,
    sub: boolean,
  ) => {
    const { x, y } = toVb(p, vb);
    const r = vb.w * (sub ? 0.03 : 0.045);
    const icon = iconFor.get(slug) ?? null;
    const color = hero ? HERO_COLOR : MARKER_COLOR;
    const op = isActive(phase) ? stepOpacity(i, activeStep) : 0.12;
    const active = activeStep === i && activePhase === null;
    return (
      <g
        key={key}
        opacity={op}
        style={{ cursor: sub ? "default" : "grab" }}
        onClick={() => (sub ? undefined : onStepSelect(i))}
        onPointerDown={(e) => {
          if (sub) return;
          e.stopPropagation();
          drag({ stepIndex: i });
        }}
      >
        {active && (
          <circle
            cx={x} cy={y} r={r * 1.7} fill="none" stroke={color}
            strokeWidth={vb.w * 0.003}
            strokeDasharray={`${vb.w * 0.012} ${vb.w * 0.008}`} opacity={0.9}
          />
        )}
        <circle cx={x} cy={y} r={r} fill="rgba(8,12,18,0.85)" stroke={color} strokeWidth={vb.w * (active ? 0.005 : 0.0035)} />
        {icon ? (
          <image
            href={icon}
            x={x - r * 0.66} y={y - r * 0.66} width={r * 1.32} height={r * 1.32}
            preserveAspectRatio="xMidYMid meet"
          />
        ) : (
          <text x={x} y={y + r * 0.36} textAnchor="middle" fontSize={r * 0.95} fill={color} fontWeight={700}>
            {slug.slice(0, 2).toUpperCase()}
          </text>
        )}
        {!sub && (
          <g transform={`translate(${x + r * 0.8}, ${y - r * 0.8})`}>
            <circle r={vb.w * 0.024} fill={color} stroke="#080c12" strokeWidth={vb.w * 0.003} />
            <text textAnchor="middle" y={vb.w * 0.009} fontSize={vb.w * 0.028} fontWeight={700} fill="#080c12">
              {stepNo}
            </text>
          </g>
        )}
        <text
          x={x} y={y + r + vb.w * 0.024} textAnchor="middle"
          fontSize={vb.w * 0.024} fontWeight={700} fill={color}
          stroke="#080c12" strokeWidth={vb.w * 0.0045} style={{ paintOrder: "stroke" }}
        >
          {sub ? subLabel : count > 1 ? `×${count}` : ""}
        </text>
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
      {/* Targets + entry points (background layer) */}
      {toggles.targets && targets.map((t, i) => {
        const { x, y } = toVb(t.position, vb);
        const r = vb.w * 0.028;
        const color = TARGET_COLORS[t.priority ?? "medium"] ?? SPELL_DEFAULT;
        const label = t.label ?? t.type.replace(/_/g, " ");
        return (
          <g key={`t-${i}`} opacity={0.95}>
            <path d={starPath(x, y, r, r * 0.45)} fill={color} fillOpacity={0.92} stroke="#080c12" strokeWidth={vb.w * 0.0025} />
            {(t.confidence != null && t.confidence < 0.6) && (
              <text x={x} y={y - r - vb.w * 0.006} textAnchor="middle" fontSize={vb.w * 0.016} fill={color} stroke="#080c12" strokeWidth={vb.w * 0.0025} style={{ paintOrder: "stroke" }}>
                ?{Math.round(t.confidence * 100)}%
              </text>
            )}
            <text x={x} y={y + r + vb.w * 0.022} textAnchor={labelAnchor(t.position)} fontSize={vb.w * 0.018} fontWeight={600} fill="#eef1f7" stroke="#080c12" strokeWidth={vb.w * 0.0035} style={{ paintOrder: "stroke" }}>
              {label}
            </text>
          </g>
        );
      })}

      {toggles.targets && entries.map((e, i) => {
        const { x, y } = toVb(e.position, vb);
        const s = vb.w * 0.03;
        return (
          <g key={`e-${i}`} opacity={0.95}>
            <path d={`M ${x} ${y - s * 0.7} L ${x + s * 0.62} ${y + s * 0.45} L ${x - s * 0.62} ${y + s * 0.45} Z`} fill="#eef1f7" fillOpacity={0.9} stroke="#080c12" strokeWidth={vb.w * 0.002} />
            <text x={x} y={y + s + vb.w * 0.02} textAnchor="middle" fontSize={vb.w * 0.017} fill="#eef1f7" stroke="#080c12" strokeWidth={vb.w * 0.003} style={{ paintOrder: "stroke" }}>
              entry
            </text>
          </g>
        );
      })}

      {/* Funnels */}
      {toggles.markers && funnels.map((f, i) => {
        const { x, y } = toVb(f.position, vb);
        const r = vb.w * 0.05;
        return (
          <g key={`f-${i}`} opacity={0.9}>
            <circle cx={x} cy={y} r={r} fill="none" stroke={PATH_COLORS.funnel} strokeWidth={vb.w * 0.005} strokeDasharray={`${vb.w * 0.011} ${vb.w * 0.008}`} />
            <circle cx={x} cy={y} r={vb.w * 0.012} fill={PATH_COLORS.funnel} opacity={0.55} />
            <text x={x} y={y - r - vb.w * 0.008} textAnchor="middle" fontSize={vb.w * 0.02} fontWeight={800} fill={PATH_COLORS.funnel} stroke="#080c12" strokeWidth={vb.w * 0.0035} style={{ paintOrder: "stroke" }}>
              FUNNEL
            </text>
          </g>
        );
      })}

      {/* Troop paths */}
      {toggles.paths && paths.map((p, pi) => {
        const color =
          p.style === "funnel" ? PATH_COLORS.funnel
          : p.style === "cleanup" ? PATH_COLORS.cleanup
          : heroOfUnit(p.unit) ? HERO_COLOR
          : MARKER_COLOR;
        const d = pathD(p.points, vb);
        const head = arrowHead(p.points, vb, vb.w * 0.035);
        const start = toVb(p.points[0], vb);
        return (
          <g key={`p-${pi}`}>
            <path d={d} fill="none" stroke={color} strokeWidth={vb.w * 0.006} strokeOpacity={0.3} strokeLinecap="round" />
            <path d={d} fill="none" stroke={color} strokeWidth={vb.w * 0.0022} strokeDasharray={`${vb.w * 0.014} ${vb.w * 0.01}`} strokeLinecap="round" />
            <polygon points={head} fill={color} stroke="#080c12" strokeWidth={vb.w * 0.002} />
            {p.points.map((pt, j) => {
              const { x, y } = toVb(pt, vb);
              const edge = j === 0 || j === p.points.length - 1;
              return (
                <circle
                  key={j}
                  cx={x} cy={y} r={vb.w * 0.011}
                  fill="#080c12" stroke={color} strokeWidth={vb.w * 0.003}
                  opacity={edge ? 0.95 : 0.45}
                  style={{ cursor: "grab" }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    drag({ pathIndex: pi, pointIndex: j });
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (p.points.length > 2) onPathPointRemove(pi, j);
                  }}
                />
              );
            })}
            <text
              x={start.x + vb.w * 0.02} y={start.y - vb.w * 0.022}
              fontSize={vb.w * 0.02} fontWeight={700} fill={color}
              stroke="#080c12" strokeWidth={vb.w * 0.003} style={{ paintOrder: "stroke" }}
            >
              {p.unit}
            </text>
          </g>
        );
      })}

      {/* Spell areas */}
      {toggles.spells && spells.map((s, idx) => {
        const { x, y } = toVb(s.position, vb);
        const color = SPELL_COLORS[s.spell] ?? SPELL_DEFAULT;
        const radius = vb.w * (SPELL_RADIUS[s.spell] ?? 0.08);
        const icon = iconFor.get(s.spell) ?? null;
        return (
          <g
            key={`s-${idx}`}
            style={{ cursor: "grab" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              drag({ spellIndex: idx });
            }}
          >
            <circle cx={x} cy={y} r={radius} fill={color} fillOpacity={0.14} stroke={color} strokeWidth={vb.w * 0.0035} strokeDasharray={`${vb.w * 0.008} ${vb.w * 0.006}`} />
            <circle cx={x} cy={y} r={vb.w * 0.032} fill="rgba(8,12,18,0.88)" stroke={color} strokeWidth={vb.w * 0.0035} />
            {icon ? (
              <image href={icon} x={x - vb.w * 0.022} y={y - vb.w * 0.022} width={vb.w * 0.044} height={vb.w * 0.044} preserveAspectRatio="xMidYMid meet" />
            ) : (
              <text x={x} y={y + vb.w * 0.011} textAnchor="middle" fontSize={vb.w * 0.03} fill={color} fontWeight={700}>
                {s.spell.slice(0, 2).toUpperCase()}
              </text>
            )}
            <text x={x} y={y + vb.w * 0.05} textAnchor="middle" fontSize={vb.w * 0.02} fontWeight={700} fill={color} stroke="#080c12" strokeWidth={vb.w * 0.004} style={{ paintOrder: "stroke" }}>
              {s.spell.replace("-spell", "").toUpperCase()}
            </text>
          </g>
        );
      })}

      {/* Deployment markers — main + sub-deployments */}
      {toggles.markers && steps.map((s, i) => {
        const hero = heroOfUnit(s.unit) !== null;
        return (
          <g key={`step-${i}`}>
            {marker(`m-${i}`, s.position, s.unit, s.step, s.count, undefined, i, s.phase, hero, false)}
            {s.deployments?.map((d, j) =>
              marker(`ms-${i}-${j}`, d.position, s.unit, s.step, d.count, d.label ? `${d.label} ×${d.count}` : `×${d.count}`, i, s.phase, hero, true),
            )}
          </g>
        );
      })}
    </svg>
  );
}
