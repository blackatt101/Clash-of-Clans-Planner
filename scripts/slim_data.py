#!/usr/bin/env python3
"""Slim ClashKingAssets static data -> only fields the planner needs."""
import json, os

SRC = "/root/ClashKingAssets/assets/static_data"
OUT = "public/data"
FILES = ["buildings", "troops", "heroes", "spells", "pets", "equipment", "traps", "helpers", "guardians"]


def cost_of(level):
    if "upgrade_cost" in level:
        return level["upgrade_cost"]  # number or {shiny_ore,...}
    if "build_cost" in level:
        return level["build_cost"]
    return None


def time_of(level):
    if "upgrade_time" in level:
        return level["upgrade_time"]
    if "build_time" in level:
        return level["build_time"]
    return None


def townhall_req(it, lv, fname):
    """The village level a level needs — with one upstream correction.

    For Builder Base *research* (troops, spells) ClashKingAssets stores
    `required_townhall` as `required_lab_level + 2`, uniformly: all 162 rows
    match, and it runs past the game's ceiling (Baby Dragon 18 asks for Builder
    Hall 11, and the highest Builder Hall is 10). Left alone, every Builder Base
    troop level above BH 8 is locked for ever in the planner — including the
    level-18 troop that B.O.B requires.

    The real gate is the Star Laboratory level, and it is already in the same
    row: Star Laboratory level N itself requires Builder Hall N, so gating on it
    is both correct and sufficient. Builder Base *buildings* are not affected —
    their `required_townhall` values are ordinary Builder Hall levels (walls 2–10,
    O.T.T.O's Outpost 6–10).
    """
    th = lv.get("required_townhall")
    lab = lv.get("required_lab_level")
    if it.get("village") == "builderBase" and fname in ("troops", "spells") and lab:
        return lab
    return th


def slim_levels_for_spell(it, fname):
    """Build slim levels for spells with CKA→wiki level-numbering correction.

    CKA stores spell upgrade data shifted by one level: its level 1 row contains
    the cost/time to upgrade *from* level 1 *to* level 2 (which wiki labels as
    "level 2" — the destination level).  The wiki Fandom upgrade charts and
    individual spell pages number levels by destination, so wiki L2 = CKA L1.

    This function shifts every CKA level N → output level N+1 to match wiki,
    and prepends a free level 1 (cost=0, time=0) which represents the spell's
    initial unlock (no upgrade needed, same as wiki).
    """
    raw_levels = it.get("levels", [])
    out_levels = []

    # L1 is the free unlock — no cost or time to "upgrade" to level 1
    out_levels.append({
        "l": 1,
        "cost": 0,
        "time": 0,
        "th": townhall_req(it, raw_levels[0] if raw_levels else {}, fname) if raw_levels else None,
        "lab": raw_levels[0].get("required_lab_level") if raw_levels else None,
        "bs": raw_levels[0].get("required_blacksmith_level") if raw_levels else None,
        "ph": raw_levels[0].get("required_pet_house_level") if raw_levels else None,
    })

    for lv in raw_levels:
        cost = cost_of(lv)

        # skip levels with no cost/time info (purely stat levels, e.g. CKA max level L13 with cost=0/time=0)
        if cost is None and time_of(lv) is None:
            continue
        # Also skip the trailing CKA "max level" row (cost=0, time=0) — wiki doesn't have it
        if cost == 0 and time_of(lv) == 0:
            continue

        cka_lvl = lv.get("level")
        wiki_lvl = cka_lvl + 1  # shift to wiki numbering

        th = townhall_req(it, lv, fname)
        out_levels.append({
            "l": wiki_lvl,
            "cost": cost,
            "time": time_of(lv),
            "th": th,
            "lab": lv.get("required_lab_level"),
            "bs": lv.get("required_blacksmith_level"),
            "ph": lv.get("required_pet_house_level"),
        })

    return out_levels


total = 0
for f in FILES:
    data = json.load(open(f"{SRC}/{f}.json"))
    out = []
    for it in data["items"]:
        levels = []
        if f == "spells":
            # Spells: CKA level N → wiki level N+1, add free L1
            levels = slim_levels_for_spell(it, f)
        else:
            for lv in it.get("levels", []):
                cost = cost_of(lv)
                # skip levels with no cost/time info (purely stat levels)
                if cost is None and time_of(lv) is None:
                    continue
                # Also skip the trailing CKA "max level" row (cost=0, time=0) — wiki doesn't have it
                # (guardians carry a trailing L5 with cost=0, time=0 in CKA)
                if cost == 0 and time_of(lv) == 0:
                    continue
                level_entry = {
                    "l": lv.get("level"),
                    "cost": cost,
                    "time": time_of(lv),
                    "th": townhall_req(it, lv, f),
                    "lab": lv.get("required_lab_level"),
                    "bs": lv.get("required_blacksmith_level"),
                    "ph": lv.get("required_pet_house_level"),
                }
                # Guardians carry per-level combat stats we need to preserve
                if f == "guardians":
                    for stat in ("hitpoints", "dps", "damagePerShot"):
                        if stat in lv:
                            level_entry[stat] = lv[stat]
                levels.append(level_entry)
        entry = {
            "_id": it["_id"],
            "name": it.get("name"),
            "village": it.get("village") if it.get("village") else ("home" if f == "guardians" else None),
            "type": it.get("type") if it.get("type") else ("guardian" if f == "guardians" else None),
            "resource": it.get("upgrade_resource"),
            "rarity": it.get("rarity"),
            "hero": it.get("hero"),
        }
        if "is_flying" in it:
            entry["flying"] = bool(it["is_flying"])
        entry["levels"] = levels
        out.append(entry)
    with open(f"{OUT}/{f}.json", "w") as fh:
        json.dump({"items": out}, fh, separators=(",", ":"))
    sz = os.path.getsize(f"{OUT}/{f}.json")
    total += sz
    print(f"{f}.json: {sz//1024} KB")

print(f"\nTOTAL: {total//1024} KB")
