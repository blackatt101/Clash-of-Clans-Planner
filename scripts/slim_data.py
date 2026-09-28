#!/usr/bin/env python3
"""Slim ClashKingAssets static data -> only fields the planner needs."""
import json, os

SRC = "/root/ClashKingAssets/assets/static_data"
OUT = "public/data"
FILES = ["buildings", "troops", "heroes", "spells", "pets", "equipment", "traps", "helpers"]

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


total = 0
for f in FILES:
    data = json.load(open(f"{SRC}/{f}.json"))
    out = []
    for it in data["items"]:
        levels = []
        for lv in it.get("levels", []):
            cost = cost_of(lv)
            # skip levels with no cost/time info (purely stat levels)
            if cost is None and time_of(lv) is None:
                continue
            levels.append({
                "l": lv.get("level"),
                "cost": cost,
                "time": time_of(lv),
                "th": townhall_req(it, lv),
                "lab": lv.get("required_lab_level"),
                "bs": lv.get("required_blacksmith_level"),
                "ph": lv.get("required_pet_house_level"),
            })
        entry = {
            "_id": it["_id"],
            "name": it.get("name"),
            "village": it.get("village"),
            "type": it.get("type"),
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
