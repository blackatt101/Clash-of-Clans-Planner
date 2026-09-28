#!/usr/bin/env python3
"""Map static-data entity IDs -> images from ClashKingAssets, copy to public/icons."""
import json, os, shutil

ASSETS = "/root/ClashKingAssets/assets"
OUT_DIR = "public/icons"
os.makedirs(OUT_DIR, exist_ok=True)

def slug(name):
    return name.replace(".", "").lower().replace(" ", "_")

def village_dir(v):
    return "home-village" if v == "home" else "builder-base"

# Building IDs whose image lives at a non-standard path (relative to ASSETS):
#   * Battle Machine / Battle Copter "building" entries are the hero altars —
#     the hero icon is the closest visual match (the upgrade itself lives under
#     the hero IDs 28000003 / 28000005).
#   * Sour Elixir Cauldron's image is filed under decorations in ClashKingAssets.
BUILDING_OVERRIDES = {
    1000053: "heroes/battle_machine/icon.webp",     # Battle Machine altar
    1000080: "heroes/battle_copter/icon.webp",      # Battle Copter altar
    1000083: "decorations/home-village/sour_elixir_cauldron.webp",
}

# Icons not present in ClashKingAssets at all, sourced elsewhere on disk.
# (e.g. NotAmti/Clash-of-Clans-Datamine CDN scrapes). Extension is preserved.
EXTRA_ICONS = {
    90000061: "/root/datamine/reports/assets/2026-08-31_95c0ae5e9529/icon_gear_MP_CosmicPortal.png",
}

# category -> (data file, template function)
def templates(cat, name, village):
    s = slug(name)
    vd = village_dir(village)
    if cat == "building":
        return f"buildings/{vd}/{s}/level_1.webp"
    if cat == "trap":
        return f"traps/{vd}/{s}/level_1.webp"
    if cat == "troop":
        return f"troops/{s}/icon.webp"
    if cat == "hero":
        return f"heroes/{s}/icon.webp"
    if cat == "pet":
        return f"pets/{s}/icon.webp"
    if cat == "spell":
        return f"spells/{s}.webp"
    if cat == "equipment":
        return f"equipment/{s}.webp"
    if cat == "helper":
        return f"helpers/{s}.webp"
    return None

CATS = [
    ("buildings", "building"), ("traps", "trap"), ("troops", "troop"),
    ("heroes", "hero"), ("spells", "spell"), ("pets", "pet"),
    ("equipment", "equipment"), ("helpers", "helper"),
]

images = {}   # id -> "/icons/<id>.<ext>"
matched = 0
missed = []

for fname, cat in CATS:
    data = json.load(open(f"public/data/{fname}.json"))["items"]
    for it in data:
        eid = it["_id"]
        if eid in EXTRA_ICONS:
            continue  # handled by the extra-icons pass below
        if cat == "building" and eid in BUILDING_OVERRIDES:
            src = BUILDING_OVERRIDES[eid]
        else:
            src = templates(cat, it["name"], it.get("village") or "home")
        if not src:
            missed.append((eid, it["name"], "no-template"))
            continue
        full = os.path.join(ASSETS, src)
        if not os.path.exists(full):
            missed.append((eid, it["name"], src))
            continue
        dst = f"{OUT_DIR}/{eid}.webp"
        shutil.copy(full, dst)
        images[str(eid)] = f"/icons/{eid}.webp"
        matched += 1

# Extra icons sourced outside ClashKingAssets (keep their own extension).
for eid, src in EXTRA_ICONS.items():
    if not os.path.exists(src):
        missed.append((eid, "<extra>", src))
        continue
    ext = os.path.splitext(src)[1]  # e.g. ".png"
    dst = f"{OUT_DIR}/{eid}{ext}"
    shutil.copy(src, dst)
    images[str(eid)] = f"/icons/{eid}{ext}"
    matched += 1

with open("public/data/images.json", "w") as f:
    json.dump(images, f, separators=(",", ":"))

print(f"matched: {matched}, missed: {len(missed)}")
for eid, name, src in missed:
    print(f"  MISS {eid} {name} -> {src}")
