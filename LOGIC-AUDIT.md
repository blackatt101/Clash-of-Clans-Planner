# CoC Planner — Logic Audit (Confirmed Findings Only)

All findings below were adversarially verified against the code. "Fix status" reflects the state at audit time: most already have a fix in the working tree; where not, the one-line fix is given so it can be applied directly.

## Critical

### 1. In-flight hero cap seed assumes all in-flight heroes start at t=0
- **File/line:** `src/lib/schedule.ts` L308
- **State:** `builders=1`, `heroConcurrency=2`, two in-flight 300 s heroes, one planned hero. `occupy()` stacks the second in-flight hero at lane start `lastEnd(spans)` (> 0), but `heroSpans` is seeded `{start:0, end:duration}` for **both**, so `respectHeroCap` counts a stacked hero as running from t=0.
- **Wrong schedule today:** planned hero is pushed to start 600 (queued behind the whole in-flight stack) instead of the cap-allowed/lane-allowed start; with the common "keep 2" config every planned hero is silently queued behind the entire in-flight stack.
- **Fix:** seed `heroSpans` from the actual `start`/`end` already stored on each in-flight `AssignedJob` (`builderLanes.concat(labLane,petLane).flat().filter(ip => ip.inProgress && ip.category==="hero").map(ip => ({start:ip.start,end:ip.end}))`). **Already applied — safe to keep.**

### 2. Empty hero lane claims the "first kept lane" slot, zeroing out builder lanes
- **File/line:** `src/lib/schedule.ts` L571
- **State:** `heroLanes ≥ 1` with a focused hero capped at the current TH (`levels` array empty), no in-flight hero, no building jobs → lane 0 is an empty hero lane.
- **Wrong schedule today:** lane 0 (idle, `keptAny=false`) is kept, `keptAny` flips to true; the idle builder lane 1 is pruned; the L579 fallback never fires. Output: `["Hero lane 1" (0 jobs), lab, pet]` — the plan has **no builder lane at all**, breaking the "at least one builder lane always survives" invariant.
- **Fix:** skip a lane when idle AND (it is a hero lane OR a lane was already kept). **Already applied — safe to keep.**

### 3. `startIn` hole-filling check uses `s.start` instead of the previous booking's end; jobs that fit the hole are rejected
- **File/line:** `src/lib/schedule.ts` L412
- **State:** 1 builder, sleep 00:00–23:00, in-flight [0,3600], b0 dur 300. Hole [3600,39600] fits b0 easily.
- **Wrong schedule today:** `cand=startAt(0)=39600 ≥ s.end` → `continue` skips both the fit-check and the `from=s.end` advance; b0 starts at 82800 (the sleep lift) instead of the hole start 3600 — builder idles 22.75 h.
- **Fix:** restructure the loop to `from = Math.max(from, s.end)` then fit-check `cand + job.duration <= s.start`. **Already applied — safe to keep.** (Verdict: R1 now 3600, R5 now 831600, controls unchanged.)

## Major

### 4. Hero-concurrency cap push bypasses `wiggleRoom`
- **File/line:** `src/lib/schedule.ts` L392
- **State:** 1 builder, `heroConcurrency:1`, `wiggleRoom:300`, one in-flight hero [0,500], one planned hero.
- **Wrong schedule today:** cap path uses `settle(capped)` (no buffer) → planned hero starts at exactly 500; the identical delay via lane load gives 800 (500+300). Inconsistent login-buffer application.
- **Fix:** in the cap loop, `start = Math.max(start, settle(capped + opts.wiggleRoom))`, break when `capped === start`. **Already applied — safe to keep** (wiggleRoom=0 byte-identical to old behavior).

### 5. Non-contiguous `heroChains[].levels` → wrong `currentLevel` in `chainOptions`, no validation
- **File/line:** `src/lib/schedule.ts` L526
- **State:** caller passes `levels=[{level:2},{level:4}]` (gap). L543 assumes contiguity: `currentLevel: lv.level - 1` → row for level 4 shows 3→4, but the hero actually climbed 2→4.
- **Wrong schedule today:** the lane timeline is internally consistent (chained by placement order); only the display row lies (`uid 4007004: currentLevel=3` instead of 2).
- **Fix:** track `prev` in the loop, emit `currentLevel: prev, nextLevel: lv.level`. **Already applied — safe to keep** (contiguous input byte-identical; the only production caller in `page.tsx` produces contiguous levels, so no behavior change today).

### 6. `anchor===0` conflates "no other work" with "other work ends at t=0"
- **File/line:** `src/lib/schedule.ts` L509
- **State:** `heroChain="plan"`, ticked work = zero-duration jobs only (e.g. Wall upgrades, `time:0`), one focused hero chain.
- **Wrong schedule today:** `anchor=0` → `toMax=true` → hero lane fills to the chain's max level (tens of thousands of s) instead of the bounded fill the player's ticked work implies; violates "a hero cannot delay anything already scheduled".
- **Fix:** `toMax = heroChain==="max" || (anchor===0 && !otherWorkPlanned)` where `otherWorkPlanned` = any builder lane beyond hero lanes, lab, or pet holds ≥1 job. **Already applied — safe to keep.**

### 7. Stale Star Lab gate blocker reported even when the plan itself schedules the unblocking level
- **File/line:** `src/lib/bbGoal.ts` L638
- **State:** Star Lab at L3 in the base, B.O.B troop needing Star Lab 4 not yet researched.
- **Wrong schedule today:** `blockers` gets "Baby Dragon — level 5 requires Star Lab 4, which is not in this base yet" the moment the gate is unresolved and is never pruned — even though the plan's own lanes schedule Star Lab 3→4→…→9. Contradictory output: same plan both builds the lab and claims the requirement is unmet.
- **Fix:** defer via a `pendingLabGates` set; only add to `blockers` at the end of the loop if `atLevel(BB_STAR_LAB, labNeed) == null` after the plan's own lab chain. **Already applied — safe to keep.** (Genuinely unreachable gates, e.g. a troop needing a lab level above the plan's target, still report correctly.)

### 8. Gear-up trip's option row reuses the defence's `levelFrom/levelTo`, indistinguishable in timeline/tooltip
- **File/line:** `src/lib/bbGoal.ts` L730
- **State:** any base where the picked defence (e.g. Double Cannon at L3 in the sample base) has a 3→4 gear-up target on the critical path.
- **Wrong schedule today:** the trip's detail row reads "Double Cannon 3→4" — identical to the actual defence upgrade row committed earlier in the same plan; the trip is only distinguishable by uid and null cost. Two identical bars on the same Builder 1 lane.
- **Fix:** special-case gear-up candidates in `commit()`: `name: c.gearUp ? g.label : displayName`, `currentLevel: c.gearUp ? c.level : c.level-1`, plus an optional `gearUp?: GearUp` field on `UpgradeOption`. **Needs a small follow-up:** add the `gearUp` field to `UpgradeOption` in `upgrade.ts` and render a distinguishing marker in `Timeline.tsx`/`Schedule.tsx` (tooltip lookup resolves it by uid). Safe to implement now; no game-rule data question.

### 9. In-progress upgrades placed on lanes but their levels never recorded → next chained level overlaps the in-flight job
- **File/line:** `src/lib/bbGoal.ts` L357
- **State:** Builder Base export, BH5 with live timer (BH 5→6 in-flight, duration T); call site passes `inProgress` with `entityId:1000034, levelFrom:5, levelTo:6`.
- **Wrong schedule today (pre-fix):** `simLevel`/`reachedAt` seeded only from entries' timers, so `atLevel(BB_BUILDER_HALL, 6)` resolves undefined; the chain re-books a duplicate 5→6 planned job back-to-back at [T, T+D] and 6→7 starts at 502400 (overlapping the in-flight job) instead of after T; makespan/ETA corrupted.
- **Fix:** after the place-loop, for each `inProgress` job with `entityId != null`: `simLevel.set(id, max(cur, levelTo))` and `record(id, levelTo, 0)`. **Already applied (L366-376) — must be kept; removing it reintroduces the double-booking. Safe.**

### 10. In-progress work booked on a locked O.T.T.O lane
- **File/line:** `src/lib/bbGoal.ts` L362
- **State:** BH5 base, O.T.T.O lane not yet unlocked (`laneUnlock[i] === Infinity`), two or more in-progress builder-base jobs.
- **Wrong schedule today (pre-fix):** `place()` picks the least-loaded lane across all lanes without checking `laneUnlock`, so an in-progress job is booked at t=0 on the O.T.T.O lane even though that builder does not exist until BH6 finishes; the lane's first planned job then starts after the phantom span instead of after the lane unlock (~100000 s phantom gap in the repro).
- **Fix:** the lane pick now skips `!Number.isFinite(laneUnlock[i])`, falling back to lane 0 if no owned lane is open. **Already applied — safe to keep** (owned-lane/BH6+ behavior unchanged).

### 11. In-progress Star Lab booked on a builder lane, not the Star Lab lane
- **File/line:** `src/lib/bbGoal.ts` L357
- **State:** in-flight Star Lab upgrade; `page.tsx` builds the `inProgress` job with `kind: jobKind(e.category)` → "builder" for a Star Lab entry (category "building"), so the `ip.kind === "lab"` branch never fires.
- **Wrong schedule today:** the in-flight Star Lab occupies a builder lane from t=0 while the Star Lab lane stays free; a troop level whose Star Lab gate is met by the in-flight upgrade's target level (lab mid-(N-1)→N, troop needs N) starts at t=0 on the lab lane instead of waiting for the lab upgrade to finish — the schedule is optimistic by the in-flight upgrade's duration for that troop level.
- **Fix:** route by entity, not kind: `if (ip.kind === "lab" || ip.entityId === BB_STAR_LAB) { place(ip, -1); continue; }`. **Not yet applied — safe to apply now** (`BB_STAR_LAB` is already imported; `inProgress` jobs carry `entityId` from `page.tsx` L576; the narrow triggering case requires the troop's other gates to be met by the in-flight level).

### 12. `start===end` (incl. 0/0) is treated as a 24-hour-per-day block; `nextUnblocked`'s 400-day escape collapses to `t`
- **File/line:** `src/lib/sleep.ts` L77
- **State:** window `start=0, end=0, days=[]` (user types 00:00–00:00 — the natural path: `<input type="time">` mid-edit fires an empty/`"00:00"` value; see finding 13).
- **Wrong schedule today:** `occurrence()` clamps to `[midnight, midnight+24h)` every day; `blocked()` true everywhere; `unblockedAt` returns tomorrow's midnight which is inside the next occurrence; `nextUnblocked` hits the escape horizon and returns `t` itself — jobs are placed to start inside a permanently-blocked window, with no warning.
- **Fix (interacts with finding 15):** treat a zero-width window as blocking nothing: `const endMin = spec.end > spec.start ? spec.end : spec.end < spec.start ? spec.end + MIN : spec.start;` and the degenerate return becomes `return { s, e }` (`e === s` → empty span, `blocked()` always false, `unblockedAt` falls through to `?? t`). **Not yet applied — safe now, but apply together with finding 15** (the all-day-degenerate detection in `nextUnblocked`) since the two fixes share the degenerate-case semantics. No game-rule data question.

### 13. `parseClock` silently maps any malformed/empty string to 0, and normalizes out-of-range minutes into the next day
- **File/line:** `src/lib/sleep.ts` L194
- **State:** empty start/end field → 0 ("00:00"); `'12:75'` → 795 = 13:15 (not clamped to 12:59).
- **Wrong schedule today:** clearing the end field of a window that starts at 00:00 silently produces the `start=end=0` spec from finding 12 — a full unavailability window from a malformed UI state; a silently-shifted boundary otherwise.
- **Fix:** `if (!m) return null;` (caller patches only on success) and validate `m[1] <= "23" && m[2] <= "59"` before computing. **Not yet applied — safe now; pairs with finding 12** (13 removes the input path that produces 12's degenerate spec; 12 removes the 24h clamp so any residual 0/0 is inert).

### 14. `nextUnblocked`'s 400-day escape is measured from the original `t`, not from `cur`
- **File/line:** `src/lib/sleep.ts` L185
- **State:** two degenerate all-day blocks (or any chain whose total walk from `t` exceeds ~400 days), each individual hop a legitimate +1 day.
- **Wrong schedule today:** `if (next - t > ESCAPE_HORIZON_MS) return t;` fires on a legitimate bounded chain and pins the plan to `t` (inside a block); a 10-day CWL + daily sleep works today only because the walk stays under 400 days — any input that exceeds it silently degrades.
- **Fix:** `if (next - cur > ESCAPE_HORIZON_MS) return t;`. **Not yet applied — safe now; apply with finding 15** (both change `nextUnblocked`'s escape semantics; re-verify the genuine no-exit week-partition case still returns `t` early, and that a bounded 10-day-CWL+sleep chain returns the real opening).

### 15. `nextUnblocked`'s 400-day escape is unreachable for the degenerate all-day case the comment describes
- **File/line:** `src/lib/sleep.ts` L185
- **State:** `start=0, end=0, days=[]`; `t` = Fri Sep 25 10:00 local. Each walk step lands exactly one hour past a midnight-anchored 24 h span, so `blocked()` flips false at ~Nov 2 23:00 (+38.58 days); the `next - t > 400d` guard never fires; the 512-iteration guard is the only other stopper.
- **Wrong schedule today:** jobs are silently scheduled ~38 days out with no user-visible signal that the block is mis-set; the documented "return t, show an unsatisfiable span" path is dead for all-day blocks.
- **Fix:** detect the all-day degenerate case before walking: if any spec has `start === end === 0` and runs on `dayStart(t).dow`, return `t` immediately (tag the window with its spec, or do the check at the call sites that build windows from specs). **Not yet applied — safe now; apply with finding 12** (12's zero-width fix makes `blocked()` always false for 0/0, which alone would also neutralize this symptom, but 15 restores the documented "unsatisfiable span" UX the comment promises).

### 16. CWL `unblockedAt` returns a past date when `t` is on the 11th–last of the month
- **File/line:** `src/lib/sleep.ts` L152
- **State:** `t` = Oct 15 09:00; `cwlWindow().blocked(t)` false, but `unblockedAt(t)` = Oct 11 00:00 (4 days in the past).
- **Wrong schedule today:** none observable — `nextUnblocked` returns `t` before calling `unblockedAt` when unblocked — but the interface contract (`unblockedAt(t) >= t` when not blocked) is broken; any future consumer computing a delay gets a negative number.
- **Fix:** `unblockedAt: (t) => blocked(t) ? new Date(y, m, 11).getTime() : t`. **Not yet applied — safe now** (behavior-neutral today; removes a latent trap).

### 17. `cwlWindow.nextBlockAt` / `unblockedAt` — net claim re-verified: `unblockedAt` is the bug, `nextBlockAt` is correct
- **File/line:** `src/lib/sleep.ts` L154
- **State:** this finding's own walk-through concludes `nextBlockAt` (next month's 1st) is always strictly after `t` for a 1st–10th monthly window — **not** a bug. The real defect is the same as finding 16: `unblockedAt` returns the 11th of the **same** month (a past instant) when `blocked(t)` is false.
- **Wrong schedule today:** none observable in the current codebase (same as finding 16); contract violation is latent.
- **Fix:** identical to finding 16 — guard `unblockedAt` with `if (!blocked(t)) return t;`; no change to `nextBlockAt`. **Not yet applied — safe now.** Consolidate with finding 16; do not apply twice.

### 18. All-day block clamp (`start === end`) uses `s + DAY_MS`, 1 h off on DST transition days
- **File/line:** `src/lib/sleep.ts` L77
- **State:** `spec {start:0, end:0}` on a spring-forward day (US Eastern Mar 8 2026) → span [00:00 EST, 01:00 EDT) spills 1 h into the next day; on a fall-back day (Nov 1 2026) → span [00:00 EDT, 23:00 EST) is 1 h short.
- **Wrong schedule today:** at most 1 h of under/over-block on 2 days/year, and only for the all-day degenerate spec; `nextUnblocked`'s escape still fires (consecutive clamped spans chain to tomorrow's midnight).
- **Fix:** `return spec.end === spec.start ? { s, e: wallClock(s, MIN) } : { s, e };` — DST-correct next local midnight. **Not yet applied — safe now; apply with finding 12** (both touch the same degenerate-case return; the zero-width fix from 12 makes the all-day clamp moot for 0/0, and 18 is the DST-correct clamp for any other `start===end` spec).

### 19. Unlock row for a facility whose own build is gated by the facility's own lab column
- **File/line:** `src/lib/upgrade.ts` L328
- **State:** TH18 export omitting the Laboratory (trimmed export). `unlockOptions` emits "Laboratory 0→1 available=true gate=none" while simultaneously emitting "Archer 0→1 available=false gate=Lab 1 not in this base yet" — two rows in the same village giving contradictory advice.
- **Wrong schedule today:** no wrong schedule, but wrong UI: the planner offers the facility as an available build while its own facility-gate logic asserts the facility is absent.
- **Fix:** for the four `FACILITY_GATES` buildings (Lab 1000007, Star Lab 1000046, Blacksmith 1000070, Pet House 1000068), gate the entity's own first row on `villageLevel(pv, village) >= first.th` instead of letting the generic `levelGate`/`missingFacilityGate` pass; rewrite the `missingFacilityGate` doc paragraph accordingly. **Not yet applied — safe now** (display/gate-label only; `available=true` remains game-correct — the facility really can be placed at TH ≥ 3 — the fix makes the two rows agree on the underlying fact).

### 20. `computeUpgrades` silently drops entries mid-upgrade to their absolute max level
- **File/line:** `src/lib/upgrade.ts` L421
- **State:** BH10 export, Star Lab at L9 with a live timer (in-flight 9→10, the absolute max). `from = e.level+1 = 10`, `next = data.level(entity, 11)` undefined; max-level branch gate `e.level >= maxLevelAt(entity, 10)` → `9 >= 10` false; absolute-max clause `9 >= 10` false → `continue` — no option emitted.
- **Wrong schedule today:** a running final step vanishes from the option list; consumers keying on option uid / `inFlightSeconds` (page.tsx jobs and heroChains `after: o.inFlightSeconds`; B.O.B goal planner) resolve against a uid that was never offered. Identical state **without** a timer emits a normal option — asymmetric.
- **Fix:** add a timer-aware branch in `if (!next)`: when `e.timer > 0`, emit a terminal placeholder `{uid: e.uid, currentLevel: e.level, nextLevel: e.level, available: false, gate: {label:"Max", ...}, inFlightSeconds: e.timer}`. **Not yet applied — safe now**; consumers already handle `available:false` rows.

### 21. `unlockOptions` offers O.T.T.O's Outpost L1 as `available: true` when BH ≥ 6, even though it is a game-granted milestone, not a buyable building
- **File/line:** `src/lib/upgrade.ts` L342
- **State:** BH6 base with no O.T.T.O's Outpost entry (milestone not yet "owned"). Outpost L1 row: `th:6, cost:0, time:0`; `levelGate` and `missingFacilityGate` both pass → `available: true`. Same shape for Gem Mine L1 (milestone-granted, no facility gate).
- **Wrong schedule today:** `planAllAvailable` adds the Outpost to the plan; `schedule.ts` books a zero-time job for it; the plan claims a builder-2-unlock "job" that the game grants for free as a BH6 milestone (the L2+ rows are the real buyable upgrades). `BUILDABLE_TYPES` documents "the Builder Hall and O.T.T.O's Outpost arrive with the game's own milestones" but is dead code — never consulted.
- **Fix:** extend the L330 filter (`entity._id === BB_BOB_CONTROL`) to also skip O.T.T.O's Outpost (1000078) and Gem Mine (1000058) as L0→L1 unlock rows; follow-up upgrades (L1→L2+) on a base that lists them still flow through `computeUpgrades`. **Not yet applied — safe now**; optionally remove the dead `BUILDABLE_TYPES` and the stale "called once per village" comment in the same pass.

### 22. Dead code: `BUILDABLE_TYPES` and the stale "facilityLevels hoisted" comment in `unlockOptions`
- **File/line:** `src/lib/upgrade.ts` L232
- **State:** `BUILDABLE_TYPES` is exported but never referenced (grep confirms). The L338-340 comment claims `facilityLevels` is "called once per village at the top", but L341 calls it **inside** the entity loop — O(entities × entries) on every `computeUpgrades` call (page.tsx L241, L442, L543 on every state change).
- **Wrong schedule today:** none (performance + misdocumentation only).
- **Fix:** lift `const facilitiesForVillage = facilityLevels(pv, village)` above the entity loop; delete the stale comment; delete or wire up `BUILDABLE_TYPES`. **Safe now** — pure cleanup, no behavior change.

## Minor

### 23. `bobMilestones` reports a gear-up trip row `done=false` when the export omits the gearUp flag but both halves are met — the checklist/ETA path disagrees with `bbGoal`
- **File/line:** `src/lib/bbRush.ts` L346
- **State:** export with no `gear_up` field on any Home Village entry (trimmed/older-format export); all three gear-up level halves met.
- **Wrong schedule today:** the L346 guard `hvDone && hasGearFlag && !gearUpPerformed` never fires (global flag absent); each gear-up row falls to the L359-378 branch and reports `done: hvDone = true` — which is **correct** on its own (absence of the flag is not positive evidence the trip didn't happen). The reviewer's specific "checklist says not done, ETA says earned" mismatch does **not** reproduce in the no-flag state: `bbGoal` L421-428 uses `bbDone && hvDone` when the global flag is absent and marks the same gear-ups done. The **real** latent issue is narrower: the L346 trip row couples to the **global** `hasGearUpFlag` rather than to whether *that gear-up's own home-village entry* carries the flag. An export that lists a gear-up building at target level but omits its `gear_up` field (while another entry, e.g. Cannon, has the flag) fires L346 for the listed building — a conservative "ready" row, not a wrong one. The clean fix is a per-gear-up check: `ownEntry = entries.find(e => e.village==="home" && e.id===g.hvId)`; fire the trip row only when `ownEntry?.gearUp != null && hvDone && !performed`. **Needs a data question before applying:** confirm whether Supercell's export ever omits `gear_up` on a building that *has* been geared up (i.e. whether the flag's absence on a listed entry means "not performed" or "field not in this export format"). If the flag is always present on geared-up buildings in every format the parser supports, apply the per-gear-up fix now (safe, aligns the two consumers); if some older format omits it, keep the global fallback for the flag-absent case.
- **Re-verification update (2026-09-25):** re-checked and **not confirmed as a bug**. The global fallback reading gear-ups as done when no `gear_up` field is present is the documented, intentional design: the doc comment on `gearUpPerformed` (bbRush.ts L254-267) says the flag is "the only field that distinguishes 'ready to gear up' from 'already geared up'" and is "false when the export does not carry the field at all, which is why callers check hasGearFlag before acting on it"; harness scenario 1 ("all met, no flags") expects zero gear trips and yields makespan 26.0d / 0 blockers / 0 gear-up options. The cited L346-trip-row vs L415-428-fallback inconsistency does not exist: in the no-flag state the L346 guard never fires and every row reports `done: hvDone`, matching the `bbDone && hvDone` fallback. No concrete state produces a wrong output — the flag's absence means "unknown" and the code conservatively reads unknown as done (the safer direction; the ETA is a floor via `blockers`). The open data question stands: if exports are confirmed to always carry `gear_up` on listed buildings, the per-entry check (`entries.find(e => e.village === "home" && e.id === g.hvId)?.gearUp != null`) replaces the global `hasGearUpFlag`; until then the global fallback is correct.

### 24. `bobCriticalTargets` chains an arbitrary `defenseId` (incl. X-Bow, capped at 5) to level 9
- **File/line:** `src/lib/bbRush.ts` L538
- **State:** `settings.bbDefense = 1000081` (X-Bow, data max level 5). `bbDefenseTarget` L409 returns the chosen id as-is; the auto-pick path correctly skips X-Bow via `BB_DEFENSE_MAX_LEVEL`, but manual pick and the settings default do not.
- **Wrong schedule today:** `bobCriticalTargets` chains X-Bow to level 9; `bbGoal.stepOf` returns null past level 5; the "defence to 9" row is permanently unmet while other rows complete; the resource/ETA card reports the achievable chain's makespan as the 6th-builder ETA on a plan that structurally cannot earn the builder. `bobComplete` correctly stays false, but the ETA is wrong.
- **Fix:** add the same `canReach9` check to `bbDefenseTarget` before returning a chosen id: if `BB_DEFENSE_MAX_LEVEL[id] < 9` or the data's last level row is < 9, fall back to the auto-pick path. **Safe to apply now**; also mark the X-Bow option in `ScheduleSettings.tsx` L617-621 as "can't reach 9 — auto pick".
- **Re-verification update (2026-09-25):** re-checked and **confirmed real**. `public/data/buildings.json` lists X-Bow (1000081) with levels [1,2,3,4,5] (data max = 5); the manual-pick path (bbRush.ts L409, `if (chosenId != null) return chosenId`) bypasses the `BB_DEFENSE_MAX_LEVEL` guard that the auto path applies (L410-421), so `bobCriticalTargets` (L538) emits `{id:1000081, target:9}`. In `scheduleBobGoal`, `stepOf(1000081, 6)` returns null (no level-6 row), so no X-Bow job is ever scheduled and the `bobMilestones` row (X-Bow 5/9) is permanently unmet, while the resource/ETA card reports the makespan of the achievable chain (BH 5→9, Star Lab 5→9) — the inconsistency claimed. Refined fix (clamps rather than falls back to auto-pick, inside `bobCriticalTargets`):
  ```ts
  const cap = BB_DEFENSE_MAX_LEVEL[defenseId];
  const effectiveTarget = cap != null
    ? Math.min(BB_DEFENSE_TARGET_LEVEL, cap)
    : BB_DEFENSE_TARGET_LEVEL;
  add(defenseId, effectiveTarget, defenseName, "building");
  ```
  This makes the manual-pick path consistent with the auto-pick guard at bbRush.ts L410-421, so `bobCriticalTargets` no longer emits `X-Bow → 9` when the data max is 5.

### 25. Gear-up trip duration is `GEAR_UP_SECONDS[g.key] ?? 0` — a missing key silently makes the trip zero-length
- **File/line:** `src/lib/bbRush.ts` L100
- **State:** `GEAR_UPS` and `GEAR_UP_SECONDS` are two separate hand-written lists keyed by the same `key` string; `GearUp.key` is `string`, not `keyof GEAR_UP_SECONDS`. Today the three keys match, so the bug is latent — any future rename/new key silently turns that trip into `duration: 0`; `commit` L795 skips the zero-duration bar, `gearUpDone.add` L789 still fires; the plan claims the 6th builder earned with no Master Builder trip and no lane-0 block, while the game charges 2-14 days of real absent-builder time.
- **Fix:** `type GearUpKey = 'cannon' | 'archerTower' | 'mortar';`; `GEAR_UP_SECONDS: Record<GearUpKey, number>`; `GearUp.key: GearUpKey`. A missing/typo'd key becomes a compile error instead of a silent zero-duration trip. **Safe to apply now** — pure type-tightening, no runtime behavior change for the current three keys.
- **Re-verification update (2026-09-25):** re-checked and **not confirmed as a bug as stated** — kept only as a [minor] forward-looking maintenance hazard. The current key sets are in sync (GEAR_UPS and GEAR_UP_SECONDS both have exactly "cannon", "archerTower", "mortar"), so no missing key exists and every trip today gets its real duration; the defect is hypothetical. The claimed "claims earned on zero work" bar-skip is not reproducible either: a zero-duration trip round only matters when the Base half was already complete before planning, in which case `gearUpDone` is pre-filled at init (bbGoal.ts L427) and the trip round is skipped entirely — no zero-duration bar is emitted, and the observable effect of a future missing key would be a too-early makespan (an honest minor hazard), not a false 6th-builder earned claim. The type-tightening fix remains safe and worthwhile as a guard against future renames; apply per original Fix.
