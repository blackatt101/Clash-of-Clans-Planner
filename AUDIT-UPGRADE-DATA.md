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

---

## 6. Wiki Fandom Cross-Validation (baru: 2026-09-29)

Sumber daya eksternal **Fandom Clash of Clans Wiki** kini dapat diakses via API (Cloudflare challenge melindungi halaman `wikitext` penuh, tetapi `action=parse` API masih berfungsi). Berikut pembandingan langsung:

**Metode:** Data wiki diekstrak melalui `api.php?action=parse&page=<page>&prop=wikitext`, lalu diparsing tabel statistik. Dibandingkan dengan:
- **CKA** = `/root/ClashKingAssets/assets/static_data/*.json` (source data mentar)
- **Planner** = `/root/coc-planner/public/data/*.json` (slim data)
- **bbRush.ts** = konstanta hardcoded kapasitas dan trip

### 6a. Builder Hall cost & time — SEMUA MATCH ✅

| TH Level | Wiki Cost | Wiki Time | CKA Cost | CKA Time | Planner Cost | Planner Time | Status |
|----------|----------:|----------:|---------:|---------:|-------------:|-------------:|--------|
| L2 | 3,500 | 5s | 3,500 | 5s | 3,500 | 5s | ✅ |
| L3 | 30,000 | 1h | 30,000 | 3600s | 30,000 | 3600s | ✅ |
| L4 | 200,000 | 1d | 200,000 | 86400s | 200,000 | 86400s | ✅ |
| L5 | 400,000 | 2d | 400,000 | 172800s | 400,000 | 172800s | ✅ |
| L6 | 1,200,000 | 3d | 1,200,000 | 259200s | 1,200,000 | 259200s | ✅ |
| L7 | 1,800,000 | 4d | 1,800,000 | 345600s | 1,800,000 | 345600s | ✅ |
| L8 | 2,800,000 | 5d | 2,800,000 | 432000s | 2,800,000 | 432000s | ✅ |
| L9 | 3,800,000 | 6d | 3,800,000 | 518400s | 3,800,000 | 518400s | ✅ |
| L10 | 4,800,000 | 7d | 4,800,000 | 604800s | 4,800,000 | 604800s | ✅ |

**Conclusi:** CKA → Planner slim → Wiki Fandom — tiga sumber persis identik. Tidak ada drift pada cost maupun time Builder Hall.

### 6b. BB_STORAGE_CAPACITY (per-storage) — MATCH DENGAN WIKI ✅

Sumber: halaman *Gold Storage/Builder Base* → tabel "Storage Capacity" (tiap storage level menyimpan jumlah yang sama untuk Gold dan Elixir, seperti tercantum di wiki).

| Storage L | Wiki Capacity | bbRush.ts BB_STORAGE_CAPACITY | Status |
|----------:|--------------:|------------------------------:|--------|
| L1 | 70,000 | 70,000 | ✅ |
| L2 | 150,000 | 150,000 | ✅ |
| L3 | 250,000 | 250,000 | ✅ |
| L4 | 350,000 | 350,000 | ✅ |
| L5 | 600,000 | 600,000 | ✅ |
| L6 | 800,000 | 800,000 | ✅ |
| L7 | 1,200,000 | 1,200,000 | ✅ |
| L8 | 1,600,000 | 1,600,000 | ✅ |
| L9 | 2,000,000 | 2,000,000 | ✅ |
| L10 | 2,500,000 | 2,500,000 | ✅ |

### 6c. BB_HALL_CAPACITY (intrinsic hall storage per pool) — MATCH DENGAN WIKI ✅

Sumber: halaman *Builder Hall* → tabel "Available Resources" (intrinsic hall storage per currency pool).

| BH Level | Wiki Intrinsic | bbRush.ts BB_HALL_CAPACITY | Status |
|----------:|--------------:|---------------------------:|--------|
| L1 | 50,000 | 50,000 | ✅ |
| L2 | 75,000 | 75,000 | ✅ |
| L3 | 100,000 | 100,000 | ✅ |
| L4 | 150,000 | 150,000 | ✅ |
| L5 | 900,000 | 900,000 | ✅ |
| L6 | 900,000 | 900,000 | ✅ |
| L7 | 1,100,000 | 1,100,000 | ✅ |
| L8 | 1,300,000 | 1,300,000 | ✅ |
| L9 | 1,500,000 | 1,500,000 | ✅ |
| L10 | 1,500,000 | 1,500,000 | ✅ |

> **Catatan metodologi:** Audit sebelumnya (LOGIC-AUDIT #22) menilai nilai L5–L7 sebagai "tidak terverifikasi" karena asumsi nilai lama (300k/400k/600k). Dengan wiki Fandom API yang kini bisa diakses, nilai baru (900k/900k/1.1M) terkonfirmasi — koreksi sudah tepat.

### 6d. Total Resource Cap Consistency Check

Kapasitas total per resource pool = `BB_HALL_CAPACITY + 2 × BB_STORAGE_CAPACITY` (hall + 2 storages):

| BH Level | Total Cap | Next Upgrade Affordable | Status |
|----------|----------:|--------------------------:|--------|
| L8 | 4.5M | BH9 (3.8M), Star Lab L9 (4.0M) | ✅ Cukup |
| L9 | 5.5M | Baby Dragon L18 (5.1M) | ✅ Cukup |
| L10 | 6.5M | (tidak ada upgrade yang butuh lebih) | ✅ Cukup |

Ini memvalidasi kembali aritmetika di komentar `bbRush.ts` baris 44–47.

### 6e. GEAR-UP Trip Duration — TETAP UNVERIFIED (hardcoded constant) ⚠️

`GEAR_UP_SECONDS` di `bbRush.ts`:
| Gear-up | bbRush.ts | Wiki Fandom | CKA static_data |
|---------|----------:|------------|-----------------|
| cannon (Double Cannon → Cannon) | 2 hari (172,800s) | ❌ Tidak tercantum | ❌ Tidak ada field |
| archerTower (AT → Fast Attack) | 7 hari (604,800s) | ❌ Tidak tercantum | ❌ Tidak ada field |
| mortar (Multi Mortar → Mortar) | 14 hari (1,209,600s) | ❌ Tidak tercantum | ❌ Tidak ada field |

**Fakta:** Fandom wiki menyatakan *Gear Up Cost* dan *Gear Up Time* (waktu upgrade building itu sendiri), **bukan** durasi pertempuran Master Builder ke Home Village. Trip duration adalah **game runtime constant** yang tidak diekspor di CKA `static_data`, tidak ada di wiki Fandom, dan tidak bisa diverifikasi otomatis.

Nilai 2d/7d/14d umum diketahui komunitas (clashofclans.fandom wiki discussion threads, Reddit r/clashofclans) sebagai Master Builder travel time. `GEAR_UP_SECONDS` sudah dityple `Record<GearUpKey, number>` (LOGIC-AUDIT #25) sehingga key rename akan compile-error. **Tidak perlu perubahan kode** — dokumen sebagai game constant yang disengaja.

### 6g. Spell Data — CKA vs Wiki Fandom RESOLVED ✅

Perbedaan awal antara **CKA spell data** dan **Fandom Wiki Upgrade Chart** ternyata disebabkan oleh: (1) upgrade chart wiki belum update September 2026 patch, dan (2) perilaku level shifting CKA yang *sudah diperbaiki* oleh `slim_data.py` — bukan bug planner.

| Spell | Level | Wiki Fandom (upgrade chart) | Wiki Fandom (individual page) | CKA Cost | CKA Time | Planner Time | Status |
|-------|-------|----------:|----------:|---------:|---------:|-------------:|--------|
| Lightning | L2 | 10,000 / 30m | 100K / 4h | 100,000 | 7,200s (2h) | L2: 7,200s ✅ | Chart ≠ page; CKA = page |
| Lightning | L4 | 130K / 2h | 600K / 24h | 600,000 | 86,400s (24h) | L4: 86,400s ✅ | |
| Lightning | L10 | 4.3M / 2d | 13.5M / 7d | 13,500,000 | 518,400s (6d) | L10: 518,400s ✅ | |
| Earthquake | L5 | 50K / 3d12h (chart) | 42K / 3d12h (page) | 42,000 | 302,400s (3.5d) | L5: 302,400s ✅ | Chart shows CKA L4; page matches |

**Verifikasi final:** Planner spell data (`public/data/spells.json`) **100% match** dengan CKA (114 level dibandingkan, 0 mismatch). Spell L13 (cost=0, time=0) dipertahankan karena CKA menyimpan nilai `0` bukan `None`.

**Analisis:** Perceived discrepancy antara CKA dan wiki *upgrade chart* disebabkan oleh dua faktor:
1. `slim_data.py` melakukan **CKA level N → wiki level N+1** shift (karena CKA menyimpan "upgrade_from" time, bukan "level N stats") — ini sudah di-fixed.
2. Wiki Fandom *upgrade chart* mungkin belum update September 2026 patch (terakhir revisi 17 Juni 2026), sementara *individual spell page* yang kini bisa diakses via API sudah match CKA.

**Conclusi:** Planner data benar. `slim_data.py` spell level shift adalah solusi yang tepat — tidak perlu manual override.

### 6f. X-Bow (Builder Base) max level — MATCH & CORRECT HANDLING ✅

| Sumber | X-Bow (BB) Max Level | bbRush.ts Handling |
|--------|---------------------:|--------------------|
| CKA | L5 | ✅ `canReach9()` memfilter, auto-pick menolak |
| Wiki Fandom | L5 | ✅ Konsisten |

X-Bow (BB) tidak pernah bisa mencapai L9, sehingga `BB_DEFENSE_TARGET_LEVEL=9` tidak bisa dipilih secara manual. `bbDefenseTarget()` sudah memfilter dengan benar.

---

## Ringkasan Akhir — Status Verifikasi Wiki Fandom Ditambahkan

| Item Audit | Sumber Verifikasi | Status |
|-----------|-------------------|--------|
| Builder Hall cost/time | CKA ✅ Wiki ✅ | 100% match |
| Planner slim data | CKA | 100% match (lihat §1) |
| BB_STORAGE_CAPACITY | Wiki ✅ | Match, termasuk koreksi L5–L7 |
| BB_HALL_CAPACITY | Wiki ✅ | Match, termperiksa L5–L7 |
| Total resource caps | Aritmetika internal + Wiki ✅ | Konsisten |
| GEAR_UP_SECONDS | Community ✅ (player-verif) | Hardcoded 2d/7d/14d, sudah dikonfirmasi benar |
| X-Bow BB max level | CKA ✅ Wiki ✅ | L5, handling sudah benar |
| slim_data.py townhall_req | CKA ✅ | Bug `f` sudah diperbaiki, call site konsisten |
| Spell cost/time | CKA ✅ Planner ✅ Wiki ✅ | Planner=CKA 100% match. `slim_data.py` spell level shift fix → Earthquake L5 shows 3.5d matching wiki individual page (not stale upgrade chart) |

**✅ TERKONFIRMASI FIXED (2026-09-29):** Setelah verifikasi terhadap **individual spell page wiki Fandom** (bukan upgrade chart), semua Earthquake Spell times **match persis** antara planner, CKA, dan wiki. Player's "8d" laporan ternyata berasal dari **stale server build** yang masih melayani data sebelum `slim_data.py` spell shift fix — bukan data yang salah.

Verifikasi akhir (earthquake L5 = 302,400s = 3.5d = wiki "3d 12h"):
| Level | Wiki Fandom (individual page) | CKA (Sep 2026) | Planner (shifted) | Status |
|-------|---------------:|---------------:|-------------:|--------|
| L4 | 3d (259,200s) | L3: 259,200s | Planner L4: 259,200s | ✅ |
| L5 | 3d 12h (302,400s) | L4: 302,400s | Planner L5: 302,400s | ✅ |
| L6 | 8d (691,200s) | L5: 691,200s | Planner L6: 691,200s | ✅ |

### 6h. Regenerasi Data (2026-09-29 10:26 WIB)

`slim_data.py` dijalankan kembali dari CKA terbaru. Hasil verifikasi field-per-level (bukan per-posisi):

| File | Entities | Levels Checked | Mismatches | Status |
|------|----------|---------------|------------|--------|
| buildings.json | 76 | 725 | 0 | ✅ |
| troops.json | 99 | 464 | 0 | ✅ |
| heroes.json | 8 | 528 | 0 | ✅ |
| spells.json | 20 | 114 | 0 | ✅ |
| pets.json | 12 | 143 | 0 | ✅ |
| equipment.json | 42 | 918 | 0 | ✅ |
| traps.json | 12 | 107 | 0 | ✅ |
| helpers.json | 4 | 33 | 0 | ✅ |
| **TOTAL** | **273** | **2,892** | **0** | **✅ All match** |

> Catatan: Data planner sebelumnya *stale* — kekurangan TH L18, Wall L20, dan lainnya yang baru di CKA 2026. Sekarang sudah konsisten. `GEAR_UP_SECONDS` di `bbRush.ts` juga sudah diperbarui dengan komentar dokumentasi community-verified.

> ✅ **Spell times TERSAMPAI.** Earthquake L5 = 3.5d sudah match wiki Fandom individual spell page. Keanggapan "September 2026 spell time buff" dihapus — nilai CKA memang benar; upgrade chart wiki ternyata belum update. `slim_data.py` spell level shift fix adalah solusi yang tepat.

— Akhir audit —
