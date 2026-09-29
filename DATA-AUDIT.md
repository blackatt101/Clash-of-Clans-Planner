# Data Audit Report — coc-planner

**Scope:** All data consumed by the planner (`/root/coc-planner/public/data/*.json`) and the hand-maintained constants in `bbRush.ts` / `bbGoal.ts`, compared against the source-of-truth game data at `/root/ClashKingAssets/assets/static_data/*.json` and the external CoC wiki (Fandom).

**Method:**
1. Every entity and level in the game data was diffed against the slim planner copy for cost, time, and townhall (TH) requirements.
2. The Builder Base capacity tables (`BB_HALL_CAPACITY`, `BB_STORAGE_CAPACITY`) in `bbRush.ts` were checked for internal consistency with the code's own comments and against the Fandom wiki (direct fetch blocked; numbers verified via the code's documented arithmetic).
3. B.O.B target constants and gear-up building targets were verified against the max levels available in the game data.
4. The `slim_data.py` script was reviewed for correctness of its filtering logic.

---

## Confirmed Discrepancies

### Critical

**1. `slim_data.py` — `townhall_req` references undefined variable `f` at function definition time**
- **File:** `scripts/slim_data.py`, line 41
- **Claim:** `if it.get("village") == "builderBase" and f in ("troops", "spells") and lab:`
- **Corrected fact:** `f` is not a parameter of `townhall_req` and is not defined in the function's local scope. It is set by the module-level `for f in FILES:` loop on line 47, which *happens to* be in scope when the function is called during the loop body. The script currently runs because Python resolves `f` from the enclosing module scope at call time. However, this is a latent bug: the function is semantically coupled to the loop variable, and any refactoring that moves the call out of the loop will cause a `NameError`. The `f` variable should be passed as a parameter.
- **Affected planner behavior:** Gating — if the script is ever refactored and `f` is no longer in scope at call time, Builder Base troop/spell TH gates will silently fail to apply the lab-level correction, and the B.O.B rush will be broken.
- **Fix:** Add `f` as a parameter to `townhall_req(it, lv, fname)` and pass `f` from the loop.

**2. `BB_DEFENSE_OPTIONS` includes X-Bow (1000081) which has max level 5, but `BB_DEFENSE_TARGET_LEVEL = 9`**
- **File:** `src/lib/bbRush.ts`, line 224 (X-Bow in `BB_DEFENSE_OPTIONS`) and line 81 (`BB_DEFENSE_TARGET_LEVEL = 9`)
- **Claim:** X-Bow is listed as a valid "defence to level 9" target for B.O.B.
- **Corrected fact:** The game data shows X-Bow has only 5 levels (L1–L5, all requiring TH10). It can never reach level 9, so it cannot satisfy the B.O.B requirement of "one defence at level 9."
- **Affected planner behavior:** Category mapping / B.O.B targets — if a player's highest defence in the Builder Base is X-Bow, the planner's `bbDefenseTarget` auto-pick will select X-Bow as the "highest level" defence and target it at level 9, producing an unachievable goal.
- **Fix:** Either (a) filter `BB_DEFENSE_OPTIONS` at runtime to exclude entities whose max level in the game data is below `BB_DEFENSE_TARGET_LEVEL`, or (b) remove X-Bow from the list if it is not expected to reach 9 in the current version. A runtime filter is safer since the game data will evolve.

**3. `BB_TROOP_OPTIONS` includes Baby Dragon (4000041), Cannon Cart (4000037), and Bomber (4000035), whose first level in the game data is not L1**
- **File:** `src/lib/bbRush.ts`, lines 193–198
- **Claim:** These troops are offered as "single max troop" picker options at level 18.
- **Corrected fact:** In the game data, Baby Dragon levels start at L5, Cannon Cart at L7, and Bomber at L5. The `stepOf` function in `bbGoal.ts` handles missing lower levels by synthesising them as "instant, free steps" (line 453: `return { entity, step: { ...above, l: level, cost: null, time: 0 } }`), so the planner will schedule the missing L1–L4/L1–L6 steps as free. This is *intentional* (the unlock step arrives with the Star Lab that unlocks it), not a bug. **No fix needed** — the code is correct and the comment in `stepOf` documents this behaviour.

### Major

**4. `GEAR_UP_SECONDS` values are hardcoded and cannot be verified against the game data**
- **File:** `src/lib/bbRush.ts`, lines 96–100
- **Claim:** `cannon: 2 days, archerTower: 7 days, mortar: 14 days`
- **Corrected fact:** The game data (`buildings.json`) does not contain a gear-up duration field for the Master Builder's trips. These values are game constants that exist only in the planner's source. The Fandom wiki could not be fetched (402/Cloudflare) to cross-check. The values are plausible given the building's own upgrade times (Double Cannon L4 = 12h, so 2 days is consistent; Multi Mortar L8 = 9d, so 14 days is plausible), but they are unverified.
- **Affected planner behavior:** B.O.B targets — the gear-up durations directly affect the B.O.B ETA and lane scheduling in `bbGoal.ts` (a gear-up blocks one lane for its full duration).
- **Fix:** No change needed unless the values are confirmed wrong in-game. Document that they are hardcoded game constants, not derived from the data file.

**5. `slim_data.py` — docstring claims "all 162 rows" match the `lab+2` pattern; verified true**
- **File:** `scripts/slim_data.py`, line 27
- **Claim:** "all 162 rows match" the `th = lab + 2` pattern.
- **Corrected fact:** Verified: all 162 Builder Base research rows in `troops.json` and `spells.json` that carry a `required_lab_level` satisfy `required_townhall == required_lab_level + 2`. The correction in `townhall_req` is correct and complete.
- **Affected planner behavior:** None — this is a verification, not a discrepancy. The docstring is accurate.

### Minor

**6. `BB_STORAGE_CAPACITY` — level 0 entry is 0, which is correct but asymmetric with real building data**
- **File:** `src/lib/bbRush.ts`, line 48
- **Claim:** `BB_STORAGE_CAPACITY[0] = 0`.
- **Corrected fact:** The game data shows Elixir/Gold Storage L1 has `build_cost: 20000` and `build_time: 1800` — so L1 is a real level with a build time, not an instant unlock. The `[0] = 0` entry represents "building not placed" and is correct as an index-0 sentinel. No fix needed.

**7. `BB_HALL_CAPACITY` — level 0 entry is 0**
- **File:** `src/lib/bbRush.ts`, line 51
- **Claim:** `BB_HALL_CAPACITY[0] = 0`.
- **Corrected fact:** The game data shows Builder Hall L1 has `build_cost: 0, build_time: 0` (instant, free). The `[0] = 0` sentinel for "not placed" is correct. The L1 entry (`[1] = 50_000`) is the hall's intrinsic storage at level 1. No fix needed.

**8. `slim_data.py` — `time_of` uses `build_time` before `upgrade_time`**
- **File:** `scripts/slim_data.py`, lines 16–21
- **Claim:** `time_of` checks `upgrade_time` first, then `build_time`.
- **Corrected fact:** Verified the actual code: `time_of` returns `level["upgrade_time"]` if present, else `level["build_time"]`, else `None`. The game data for troops/heroes uses `upgrade_time`+`upgrade_cost`; buildings/traps use `build_time`+`build_cost`. The ordering is correct. No fix needed.

---

## Verified Clean

The following data was cross-checked between `/root/ClashKingAssets/assets/static_data/` and `/root/coc-planner/public/data/` and found to be consistent:

| File | Entities | Levels | Notes |
|------|----------|--------|-------|
| `buildings.json` | 76 | 731 | All costs, times, and TH gates match. Builder Base troops correctly use `lab` for TH gate. |
| `troops.json` | 98 | 1062 | All costs and times match. TH mismatches (162) are the expected `lab` correction for Builder Base research rows. |
| `heroes.json` | 8 | 536 | Full match. Battle Machine L1–L35, Battle Copter L15–L35. |
| `spells.json` | 20 | 158 | Full match. Lab correction applied to Builder Base spells (same 162-row correction as troops). |
| `pets.json` | 12 | 155 | Full match. |
| `equipment.json` | 42 | 918 | Full match. All 918 levels carry dict costs (`shiny_ore`/`glowy_ore`/`starry_ore`), which `bbCostValue` in `bbRush.ts` correctly rejects (returns `null` for non-numeric costs). |
| `traps.json` | 12 | 107 | Full match. |
| `helpers.json` | 4 | 34 | Full match. |

**B.O.B target constants verified against game data:**

| Constant | Value | Game Data Max | Status |
|----------|-------|---------------|--------|
| `BB_BUILDER_HALL_TARGET` | 9 | BH L10 | OK |
| `BB_STAR_LAB_TARGET` | 9 | Star Lab L10 | OK |
| `BB_BOB_CONTROL_TARGET` | 5 | B.O.B Control L5 | OK |
| `BB_DEFENSE_TARGET_LEVEL` | 9 | Most defences L10; X-Bow L5 | X-Bow unreachable (see issue #2) |
| `BB_TROOP_TARGET_LEVEL` | 18 | All BB troops L20 | OK |
| `BB_HERO_TOTAL_TARGET` | 45 | BM L35 + BC L35 = 70 max | OK (game requirement constant) |
| `GEAR_UPS` cannon target | Double Cannon L4 | L10 | OK |
| `GEAR_UPS` archer target | Archer Tower L6 | L10 | OK |
| `GEAR_UPS` mortar target | Multi Mortar L8 | L10 | OK |
| `GEAR_UPS` HV cannon target | Cannon L7 | L21 | OK |
| `GEAR_UPS` HV archer target | Archer Tower L10 | L21 | OK |
| `GEAR_UPS` HV mortar target | Mortar L8 | L18 | OK |

**Builder Hall cost ladder (game data):**

| Level | Cost (Builder Gold) | Time (s) |
|-------|--------------------:|---------:|
| L1 | 0 | 0 |
| L2 | 3,500 | 5 s |
| L3 | 30,000 | 1 h |
| L4 | 200,000 | 1 d |
| L5 | 400,000 | 2 d |
| L6 | 1,200,000 | 3 d |
| L7 | 1,800,000 | 4 d |
| L8 | 2,800,000 | 5 d |
| L9 | 3,800,000 | 6 d |
| L10 | 4,800,000 | 7 d |

The `bbRush.ts` comment (lines 43–46) states "at Builder Hall 8 the ceilings are 1.3M + 2 × 1.6M = 4.5M, just enough for Builder Hall 9's 3.8M" — this is internally consistent with `BB_HALL_CAPACITY[8] = 1_300_000` and `BB_STORAGE_CAPACITY[8] = 1_600_000`. The capacity table's high end (BH8–BH10: 1.3M/1.5M/1.5M) is corroborated by the code's own comment arithmetic. The low end (BH1–BH7: 50k/75k/100k/150k/300k/400k/600k) could not be independently verified because the Fandom wiki blocked all fetch attempts, but no internal inconsistency was found.

**Wall build times:** All 10 wall levels have `build_time: 0` in the game data, confirming the `bbRush.ts` comment that Builder Base walls "take Builder Gold and no builder time at all."

**B.O.B Control:** All 5 levels have `build_time: 0`, confirming the comment that "its levels cost gold but take no builder time at all."

---

## Summary of Required Fixes

| # | Severity | File | What to change |
|---|----------|------|----------------|
| 1 | Critical | `scripts/slim_data.py` line 41 | Add `fname` parameter to `townhall_req(it, lv, fname)`; update the call site at line 61 to pass `f`. |
| 2 | Critical | `src/lib/bbRush.ts` line 224 | Add a runtime filter to `bbDefenseTarget` (line 385) that excludes defences whose game-data max level is below `BB_DEFENSE_TARGET_LEVEL` (9). |
| 4 | Major | `src/lib/bbRush.ts` lines 96–100 | Document that `GEAR_UP_SECONDS` values are hardcoded game constants not derivable from the data file. No code change unless values are confirmed wrong. |

No changes to `BB_HALL_CAPACITY` or `BB_STORAGE_CAPACITY` are required based on this audit.

## Resume pass — 2026-09-29 (status re-verified against current tree)

| # | Status 2026-09-29 |
|---|-------------------|
| 1 | **Fixed 2026-09-29.** The parameter was added (`townhall_req(it, lv, fname)`) but the call site still passed two arguments — the script would `TypeError` on any run. Call site now `townhall_req(it, lv, f)`. Latent-while-unused: the committed `public/data/*.json` predates the change and was not regenerated. |
| 2 | **Applied, widened** (bbRush.ts): `BB_DEFENSE_MAX_LEVEL` + `canReach9` on the auto path, manual picks below target rejected with fall-through to auto, `ScheduleSettings.tsx` labels X-Bow "caps at 5, auto pick instead". Same fix as LOGIC-AUDIT #24. |
| 3 | Intentional behaviour, unchanged. |
| 4 | Documented as intended; additionally typed `Record<GearUpKey, number>` so a key rename is a compile error (LOGIC-AUDIT #25). Values still unverified against an external wiki — accept as planner constants. |
| 5 | Verification, nothing to fix. |
| 6, 7, 8 | Verification, nothing to fix. |
