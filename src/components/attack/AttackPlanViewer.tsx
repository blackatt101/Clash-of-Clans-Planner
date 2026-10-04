"use client";

/**
 * AttackPlanViewer: the uploaded base screenshot + the SVG attack overlay,
 * zoom/pan-able, with step-by-step playback, layer toggles, in-map editing
 * (drag markers / spell areas / path points) and PNG export.
 *
 * The overlay is the single rendering of the strategy JSON; everything here
 * reads positions from the JSON, never invents them.
 *
 * Coordinate alignment: the base image and the overlay SVG share the SAME
 * box. That box has the image's intrinsic aspect ratio (letterboxed into a
 * square stage), and the overlay's viewBox is built from that same aspect,
 * so a normalized (0..1) coordinate lands on the same pixel in both. This
 * holds for any screenshot resolution.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AttackStrategy, Point } from "@/lib/attack/types";
import { resolveEntity } from "@/lib/attack/catalog";
import AttackOverlay, { type OverlayToggles } from "./AttackOverlay";
import { exportAttackPlan } from "@/lib/attack/export";
import { AttackLegend } from "./AttackLegend";

export interface AttackPlanViewerProps {
  strategy: AttackStrategy;
  /** Data URL of the uploaded base screenshot (the base image). */
  baseSrc: string;
  images: Record<string, string>;
  /** Editing callback — the viewer moves markers/paths/spells; the parent
   *  owns the strategy state. */
  onChange: (next: AttackStrategy) => void;
  /** Called with the exported data URL. */
  onExported?: (dataUrl: string) => void;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export default function AttackPlanViewer({
  strategy,
  baseSrc,
  images,
  onChange,
  onExported,
}: AttackPlanViewerProps) {
  const [activeStep, setActiveStep] = useState(0);
  const [activePhase, setActivePhase] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [toggles, setToggles] = useState<OverlayToggles>({
    markers: true,
    paths: true,
    spells: true,
    targets: true,
  });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // Intrinsic base-image aspect (width/height), measured on load.
  const [aspect, setAspect] = useState(1);
  // Stage box pixel size, measured; the image+overlay box is sized to fit it.
  const [stagePx, setStagePx] = useState({ w: 0, h: 0 });

  const stageRef = useRef<HTMLDivElement>(null); // square stage, overflow hidden
  const boxRef = useRef<HTMLDivElement>(null); // letterboxed image+overlay box
  const svgRef = useRef<SVGSVGElement>(null);

  // Keep the stage's pixel size fresh (drives the letterbox box dimensions).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setStagePx({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Letterbox the base into the square stage: the box keeps the image's
  // aspect, so the object-fit:fill image and the overlay (whose viewBox
  // matches that aspect) occupy the identical rectangle.
  const boxW = stagePx.w > 0 ? Math.min(stagePx.w, stagePx.h * aspect) : 0;
  const boxH = stagePx.w > 0 ? Math.min(stagePx.h, boxW / aspect) : 0;
  const dragRef = useRef<{
    kind: "marker" | "spell" | "path" | "pan";
    stepIndex?: number;
    spellIndex?: number;
    pathIndex?: number;
    pointIndex?: number;
    startX?: number;
    startY?: number;
    startPan?: { x: number; y: number };
  } | null>(null);

  // Overlay viewBox matches the image aspect so normalized coords align.
  const vb = useMemo(() => ({ w: 1000 * aspect, h: 1000 }), [aspect]);

  const toNorm = useCallback((clientX: number, clientY: number): Point => {
    const el = boxRef.current;
    if (!el) return { x: 0.5, y: 0.5 };
    const r = el.getBoundingClientRect();
    return { x: clamp01((clientX - r.left) / r.width), y: clamp01((clientY - r.top) / r.height) };
  }, []);

  // ---- strategy edit helpers ----
  const moveStep = useCallback(
    (i: number, pos: Point) => {
      const next = structuredClone(strategy);
      next.deployment_plan[i].position = pos;
      onChange(next);
    },
    [strategy, onChange],
  );
  const moveSpell = useCallback(
    (i: number, pos: Point) => {
      const next = structuredClone(strategy);
      if (next.spell_actions?.[i]) next.spell_actions[i].position = pos;
      onChange(next);
    },
    [strategy, onChange],
  );
  const movePathPoint = useCallback(
    (pi: number, pointIndex: number, pos: Point) => {
      const next = structuredClone(strategy);
      if (next.paths?.[pi]?.points[pointIndex]) next.paths[pi].points[pointIndex] = pos;
      onChange(next);
    },
    [strategy, onChange],
  );
  const removePathPoint = useCallback(
    (pi: number, pointIndex: number) => {
      const next = structuredClone(strategy);
      next.paths?.[pi]?.points.splice(pointIndex, 1);
      if (next.paths && next.paths[pi].points.length < 2) next.paths.splice(pi, 1);
      onChange(next);
    },
    [strategy, onChange],
  );

  // Drag plumbing: the overlay dispatches `attack-drag-start` on its own <svg>.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onDragStart = (e: Event) => {
      const d = (e as CustomEvent<Record<string, number | undefined>>).detail ?? {};
      const kind: "marker" | "spell" | "path" =
        d.stepIndex != null ? "marker" : d.spellIndex != null ? "spell" : "path";
      dragRef.current = { kind, stepIndex: d.stepIndex, spellIndex: d.spellIndex, pathIndex: d.pathIndex, pointIndex: d.pointIndex };
      e.preventDefault();
    };
    svg.addEventListener("attack-drag-start", onDragStart);
    return () => svg.removeEventListener("attack-drag-start", onDragStart);
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === "pan") {
        if (d.startX == null || d.startY == null || d.startPan == null) return;
        setPan({ x: d.startPan.x + (e.clientX - d.startX), y: d.startPan.y + (e.clientY - d.startY) });
        return;
      }
      const p = toNorm(e.clientX, e.clientY);
      if (d.kind === "marker" && d.stepIndex != null) moveStep(d.stepIndex, p);
      else if (d.kind === "spell" && d.spellIndex != null) moveSpell(d.spellIndex, p);
      else if (d.kind === "path" && d.pathIndex != null && d.pointIndex != null)
        movePathPoint(d.pathIndex, d.pointIndex, p);
    },
    [toNorm, moveStep, moveSpell, movePathPoint],
  );
  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Pan begins on empty base space (markers stopPropagation their own down).
  const onBackgroundPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragRef.current = { kind: "pan", startX: e.clientX, startY: e.clientY, startPan: pan };
    },
    [pan],
  );

  // Wheel zoom (non-passive).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setZoom((z) => Math.min(6, Math.max(0.5, z * f)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Playback.
  const stepCount = strategy.deployment_plan.length;
  useEffect(() => {
    if (!playing || stepCount === 0) return;
    const id = setInterval(() => {
      setActiveStep((s) => {
        if (s + 1 > stepCount - 1) {
          setPlaying(false);
          return stepCount - 1;
        }
        return s + 1;
      });
    }, 2200);
    return () => clearInterval(id);
  }, [playing, stepCount]);

  const zoomBy = useCallback((f: number) => setZoom((z) => Math.min(6, Math.max(0.5, z * f))), []);
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Clamp the playback head in case the strategy's step count shrank
  // (e.g. the user removed steps while it was focused further along).
  const focusedStep =
    activeStep < 0 ? -1 : Math.min(activeStep, Math.max(0, stepCount - 1));

  const doExport = useCallback(async () => {
    if (!svgRef.current || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const url = await exportAttackPlan({
        svgElement: svgRef.current,
        baseSrc,
        strategy,
        images,
      });
      onExported?.(url);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attack-plan-${strategy.strategy.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.png`;
      a.click();
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }, [strategy, baseSrc, images, exporting, onExported]);

  const phases = useMemo(() => {
    const names: string[] = [];
    for (const s of strategy.deployment_plan) if (!names.includes(s.phase)) names.push(s.phase);
    return names;
  }, [strategy.deployment_plan]);

  const step = focusedStep >= 0 ? strategy.deployment_plan[focusedStep] : null;
  const stepUnitName = step ? (resolveEntity(step.unit)?.ref.name ?? step.unit) : null;

  const btn =
    "inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-ink-dim transition hover:border-gold/50 hover:text-ink";

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button className={btn} onClick={() => { setActiveStep((s) => Math.max(0, s - 1)); setActivePhase(null); }} aria-label="Previous step">← Prev</button>
          <button
            className={`${btn} ${playing ? "border-gold/60 text-gold" : ""}`}
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause" : "Play step-by-step"}
          >
            {playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button className={btn} onClick={() => { setActiveStep((s) => Math.min(stepCount - 1, s + 1)); setActivePhase(null); }} aria-label="Next step">Next →</button>
          <button className={btn} onClick={() => { setActiveStep(-1); setActivePhase(null); }}>All steps</button>
          {focusedStep >= 0 && (
            <span className="ml-1 text-xs text-ink-faint">Step {focusedStep + 1} / {stepCount}</span>
          )}
        </div>

        <div className="mx-1 h-5 w-px bg-line" />
        <div className="flex flex-wrap items-center gap-1">
          {phases.map((p) => (
            <button
              key={p}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium capitalize transition ${
                activePhase === p ? "bg-gold text-[#1a1408]" : "border border-line bg-surface-2 text-ink-dim hover:text-ink"
              }`}
              onClick={() => { setActivePhase(activePhase === p ? null : p); setActiveStep(-1); }}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          {(
            [
              ["markers", "Markers"],
              ["paths", "Paths"],
              ["spells", "Spells"],
              ["targets", "Targets"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={btn}
              aria-pressed={toggles[key]}
              onClick={() => setToggles((t) => ({ ...t, [key]: !t[key] }))}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${toggles[key] ? "bg-gold" : "bg-ink-faint/40"}`} />
              {label}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-line" />
          <button className={btn} onClick={() => zoomBy(1.25)} aria-label="Zoom in">＋</button>
          <button className={btn} onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">－</button>
          <button className={btn} onClick={resetView}>Reset view</button>
          <button className={`${btn} border-gold/40 text-gold`} onClick={doExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Download Attack Plan"}
          </button>
        </div>
      </div>

      {exportError && <p className="text-xs text-[#e0533f]">{exportError}</p>}

      {/* Stage: square, overflow-hidden; the image+overlay box is letterboxed
          to the base's aspect and shared by both (zoom/pan transform). */}
      <div
        ref={stageRef}
        className="relative overflow-hidden rounded-xl border border-line bg-black/50"
        style={{ aspectRatio: "1 / 1", maxWidth: 720 }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerDown={onBackgroundPointerDown}
      >
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            ref={boxRef}
            className="relative pointer-events-auto"
            style={{
              width: boxW,
              height: boxH,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center",
            }}
          >
            <img
              src={baseSrc}
              alt="Enemy base"
              draggable={false}
              className="absolute inset-0 h-full w-full select-none"
              style={{ objectFit: "fill" }}
              onLoad={(e) => {
                const el = e.currentTarget;
                if (el.naturalWidth > 0) setAspect(el.naturalWidth / el.naturalHeight);
              }}
            />
            <AttackOverlay
              strategy={strategy}
              vb={vb}
              images={images}
              activeStep={focusedStep}
              activePhase={activePhase}
              toggles={toggles}
              onStepSelect={(i) => { setActiveStep(i); setActivePhase(null); }}
              onPathPointRemove={removePathPoint}
              svgRef={svgRef}
            />
          </div>
        </div>
        <AttackLegend />
      </div>

      {/* Step detail */}
      {step && (
        <div className="surface-panel card-lit rounded-xl p-3 text-sm">
          <div className="font-semibold text-gold">
            Step {step.step} — Deploy {step.count}× {stepUnitName}
          </div>
          <div className="mt-0.5 text-[13px] text-ink-dim">
            Goes toward <b className="text-ink">{step.target ?? "the core"}</b>
            {" — "}
            {step.purpose ?? `Phase: ${step.phase}.`}
          </div>
          <div className="mt-1 text-[11px] text-ink-faint">
            Deploys at {Math.round(step.position.x * 100)}% from left, {Math.round(step.position.y * 100)}% from top.
            Drag the ① marker on the map to adjust; double-click path points to remove them.
          </div>
        </div>
      )}
      {activePhase && (
        <div className="surface-panel card-lit rounded-xl p-3 text-sm">
          <span className="font-semibold capitalize text-gold">{activePhase}:</span>{" "}
          <span className="text-ink-dim">
            {strategy.attack_phases.find((p) => p.name.toLowerCase() === activePhase.toLowerCase())?.description ??
              "Highlighted markers and paths belong to this phase; everything else is dimmed."}
          </span>
        </div>
      )}
    </div>
  );
}
