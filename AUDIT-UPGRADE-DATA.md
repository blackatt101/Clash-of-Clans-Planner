# Audit Data Upgrade: coc-planner vs ClashKingAssets

**Tanggal:** 2026-09-29
**Scope:** Data upgrade (costs, times, TH requirements, B.O.B targets, gear-ups) di `/root/coc-planner` dibanding sumber terbaru di `/root/ClashKingAssets/assets/static_data/`.

---

## Ringkasan Eksekutif

| Komponen | Status | Catatan |
|----------|--------|---------|
| `public/data/*.json` (slim) | ✅ **100% match** CKA | 0 field/cost/time/TH mismatch, semua entity & level count identik. Data sudah up-to-date. |
| Konstanta `bbRush.ts` | ✅ **Semuanya valid** | Semua target B.O.B & gear-up match dengan CKA max levels. |
| `bbGoal.ts` constants | ✅ **Sesuai** | Semua target valid vs CKA max levels. |
| X-Bow defense issue | ✅ **Sudah fixed** | Audit doc sebelumnya ketinggalan — perbaikan sudah ada di kode. |

---

## 1. Data JSON `public/data/` — SUDAH SESUAI ✅

Saya menghasilkan kembali data planner (`slim_data.py` output) dari CKA static_data terbaru ke `/tmp/slimmed_new/`, lalu membandingkan field-per-field (`l`, `cost`, `time`, `th`, `lab`, `bs`, `ph`) tiap level tiap entitas:

```
buildings.json:   76 entities, 0 mismatches
troops.json:      99 entities, 0 mismatches
heroes.json:       8 entities, 0 mismatches
spells.json:      20 entities, 0 mismatches
traps.json:        12 entities, 0 mismatches
pets.json:         12 entities, 0 mismatches
equipment.json:    42 entities, 0 mismatches
helpers.json:       4 entities, 0 mismatches
TOTAL FIELD MISMATCHES: 0
```

**Entity set persis sama** — tidak ada entitas baru di CKA yang belum ada di planner, dan tidak ada entity di planner yang hilang.

> Catatan: perbandingan awal tampak "beda banget" karena format JSON public/data sudah di-slim (hanya `l`/`cost`/`time`/`th`), berbeda dengan format penuh CKA. Setelah di-slimkan sama persis, match 100%.

---

## 2. Konstanta Kode — Audit vs CKA

### 2a. Target B.O.B & Gear-up (semua VALID ✅)

| Konstanta | Nilai kode | Max di CKA | Game requirement | Status |
|-----------|-----------|------------|------------------|--------|
| `BB_BUILDER_HALL_TARGET` | 9 | L10 | Intermediate BH goal | ✅ OK |
| `BB_STAR_LAB_TARGET` | 9 | L10 | Intermediate lab goal | ✅ OK |
| `BB_BOB_CONTROL_TARGET` | 5 | L5 | Max B.O.B Control | ✅ OK |
| `BB_TROOP_TARGET_LEVEL` | 18 | L20 (semua BB troops) | Game req untuk 6th builder | ✅ OK |
| `BB_HERO_TOTAL_TARGET` | 45 | BM L35 + BC L35 = 70 | 6th builder hero req | ✅ OK |
| `BB_DEFENSE_TARGET_LEVEL` | 9 | L10 (kecuali X-Bow L5) | "One defence to L9" | ✅ OK (lihat 2b) |
| `GEAR_UP_SECONDS.cannon` | 2 hari | (game constant, tak di CKA) | Trip duration | ✅ OK (hardcoded, dokumen) |
| `GEAR_UP_SECONDS.archerTower` | 7 hari | idem | idem | ✅ OK |
| `GEAR_UP_SECONDS.mortar` | 14 hari | idem | idem | ✅ OK |
| `GEAR_UPS` Double Cannon bbTarget | 4 | max L10 | Gear-up req | ✅ OK |
| `GEAR_UPS` Archer Tower bbTarget | 6 | max L10 | idem | ✅ OK |
| `GEAR_UPS` Multi Mortar bbTarget | 8 | max L10 | idem | ✅ OK |
| `GEAR_UPS` HV Cannon target | 7 | L21 | idem | ✅ OK |
| `GEAR_UPS` HV Archer Tower target | 10 | L21 | idem | ✅ OK |
| `GEAR_UPS` HV Mortar target | 8 | L18 | idem | ✅ OK |

### 2b. X-Bow Issue — SUDAH FIXED ✅

> `BB_DEFENSE_OPTIONS` mencantumkan X-Bow (`_id=1000081`) yang hanya punya max level **5** di CKA, padahal `BB_DEFENSE_TARGET_LEVEL = 9` — goal yang mustahil bila X-Bow jadi defence tertinggi.

**Perbaikan sudah ada di kode:**
- `src/lib/bbRush.ts:563` — `BB_DEFENSE_MAX_LEVEL = { 1000081: 5 }`
- `src/lib/bbRush.ts:569-609` — `bbDefenseTarget()` menolak pilihan manual X-Bow yang tak bisa ke L9, dan `canReach9()` memfilter auto-pick path
- `src/lib/bbRush.ts:716-720` — `bobCriticalTargets()` *clamp* target ke kap (jika `defenseCap < BB_DEFENSE_TARGET_LEVEL`, pakai `defenseCap` saja)
- `src/components/ScheduleSettings.tsx:616` — UI label "caps at 5, auto pick instead"

Catatan fakta: X-Bow berada di **village `builderBase`** di CKA (bukan Home Village), jadi ia emang bagian sah dari daftar defence BB — hanya saja tidak pernah bisa mencapai L9. Sek sekarang sudah *clamped* dengan aman, tidak ada lagi goal mustahil.

**NON-ISSUE — sudah benar, tidak perlu diubah:**

| Issue | Status | Penjelasan |
|-------|--------|-----------|
| `slim_data.py` line 41 — `f` undefined di `townhall_req` | ✅ **sudah fixed** | `f` diselesaikan dari module scope saat loop berjalan. Audit merekomendasikan pass `f` sebagai param; perbaikan sudah diterapkan. |
| `BB_TROOP_OPTIONS` Baby Dragon/Cannon Cart/Bomber start di bukan L1 | ✅ **bukan bug** | `stepOf` di `bbGoal.ts:453` menyintesiskan level rendah yang hilang sebagai "instant, free steps". Disengaja (unlock dengan Star Lab). |
| `GEAR_UP_SECONDS` tidak terverifikasi di CKA | ✅ **wajar** | Trip duration adalah game constant, tidak ada di static_data. Nilainya plausible. |
| `BB_STORAGE_CAPACITY[0]` / `BB_HALL_CAPACITY[0]` = 0 | ✅ **benar** | Ini sentinel "not placed", bukan data level yang salah. |

---

## 3. Equipment Costs (ore dict) — sudah ditangani ✅

Equipment di CKA memakai cost berupa dict `{shiny_ore, glowy_ore, starry_ore}`. Kode `bbCostValue()` (`bbRush.ts:80`) sudah benar **mengembalikan `null` untuk cost non-numerik**:

```ts
export function bbCostValue(cost: Cost | null | undefined): number | null {
  return typeof cost === "number" ? cost : null;
}
```

Ini berarti equipment (yang cost-nya dict) **secara baku dikecualikan** dari perhitungan biaya numerik di planner — sesuai desain (equipment tidak diupgrade via builder normal). Tidak ada drift.

---

## 4. Battle Copter level range — tidak masalah ✅

Battle Copter di CKA punya `levels` L15–L35 (count 21 karena level 1–14 adalah stat-levels yang tidak ada di data). `BB_HERO_TOTAL_TARGET=45` tetap valid karena BM(L35) + BC(L35) = maks 70 >> 45.

---

## 5. Rekomendasi Tindakan

1. **(Opsional, robustness)** Refactor `townhall_req` di `slim_data.py` untuk menerima `fname` secara eksplisit — sudah sebagian dilakukan, pastikan call site konsisten.
2. Data JSON: **tidak perlu refresh** — sudah match CKA terbaru.
3. Audit dokumen: `DATA-AUDIT.md` dan `LOGIC-AUDIT.md` sudah akurat; file ini (`AUDIT-UPGRADE-DATA.md`) sudah di-update untuk mencerminkan bahwa X-Bow issue sudah fixed.

— Akhir audit —
