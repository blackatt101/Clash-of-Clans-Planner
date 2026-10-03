#!/usr/bin/env python3
"""Regenerate planner slim data from coc-data-test (CDT), keeping the app's
existing entity identity (_id / village / type / resource / rarity / hero /
flying) from the current public/data baseline. Levels come from CDT; a Fandom
wiki gap-fill covers entities CDT does not ship.

Output: the same 10 public/data/*.json files the app loads.

CDT stores a free L1 "initial state" row for troops/heroes/pets/equipment/
guardians/siege/spells that has no cost and no time; the planner convention
numbers levels from the first *paid* upgrade, so we drop that free L1 row
(offset). Buildings, traps and helpers have no such free row in the planner
convention, so their levels map 1:1 by level number. Crafted-defenses have no
top-level `levels` — their rows come from `modules[].upgrades[]`.
"""
import json, os, re, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CDT = "/home/ubuntu/coc-data-test/data"
CDT_IMG = "/home/ubuntu/coc-data-test"
CKA = "/home/ubuntu/ClashKingAssets/assets/static_data"  # last-resort fallback
BASE = os.path.join(HERE, "public", "data")
OUT = os.environ.get("SLIM_OUT", BASE)  # allow writing to a temp dir for diffing

API = "https://clashofclans.fandom.com/api.php"
CACHE = os.path.join(HERE, ".fandom-cache")

# ---------------------------------------------------------------------------
# Output categories and how each maps to CDT files on disk
#   (out_file, [ (cdt_rel_path, village, type_override) ... ])
# type_override is used only when the baseline has no entity to copy from.
# ---------------------------------------------------------------------------
CATEGORIES = {
    "buildings": [
        ("home/defenses", "home", "Defense"),
        ("home/army-buildings", "home", "Army"),
        ("home/resource-buildings", "home", "Resource"),
        ("home/town-hall", "home", "Town Hall"),
        ("home/walls", "home", "Wall"),
        ("home/other", "home", "Helper"),
        ("builder/defenses", "builderBase", "Defense"),
        ("builder/army-buildings", "builderBase", "Army"),
        ("builder/resource-buildings", "builderBase", "Resource"),
        ("builder/other", "builderBase", "BB Builder Hall"),
        ("builder/builder-hall", "builderBase", "BB Builder Hall"),
        ("builder/walls", "builderBase", "Wall"),
    ],
    "traps": [
        ("home/traps", "home", "Trap"),
        ("builder/traps", "builderBase", "Trap"),
    ],
    "troops": [
        ("home/troops", "home", None),
        ("home/siege-machines", "home", "Siege"),
        ("builder/troops", "builderBase", None),
    ],
    "heroes": [
        ("home/heroes", "home", None),
        ("builder/heroes", "builderBase", None),
    ],
    "spells": [("home/spells", None, "Spell")],
    "pets": [("home/pets", None, "Pet")],
    "equipment": [("home/hero-equipment", None, "Equipment")],
    "helpers": [("home/other/helpers", None, "Helper")],
    "guardians": [("home/guardians", "home", "guardian")],
    "crafted-defenses": [("home/crafted-defenses", "home", "Defense")],
}

# Planner convention: drop the free L1 "initial state" row for these files.
DROP_FREE_L1 = {"troops", "heroes", "spells", "pets", "equipment", "guardians"}

# Guardian combat stats we must carry through per level.
GUARDIAN_STATS = ("hitpoints", "dps", "damagePerShot")


def sec(v):
    """Duration -> seconds. Accepts a {days,hours,minutes,seconds} dict or int."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return int(v)
    return (int(v.get("days", 0)) * 86400
            + int(v.get("hours", 0)) * 3600
            + int(v.get("minutes", 0)) * 60
            + int(v.get("seconds", 0)))


def norm(name):
    n = (name or "").lower().replace("'", "").replace(".", "").replace(" ", "")
    return re.sub(r"[^a-z0-9]", "", n)


# ---------------------------------------------------------------------------
# Load the current baseline: identity + static fields keyed by
# (out_file, village, normname). This is the id space the app runs on.
# ---------------------------------------------------------------------------
def load_baseline():
    base = {}
    for f in os.listdir(BASE):
        if not f.endswith(".json") or f == "images.json":
            continue
        out = f[:-5]
        try:
            data = json.load(open(os.path.join(BASE, f)))
        except (json.JSONDecodeError, FileNotFoundError):
            continue
        for it in data.get("items", []):
            key = (out, it.get("village"), norm(it.get("name")))
            base[key] = it
    return base


# ---------------------------------------------------------------------------
# Load CDT entities grouped by output category.
# ---------------------------------------------------------------------------
def load_cdt():
    from collections import defaultdict
    bycat = defaultdict(list)
    for out, dirs in CATEGORIES.items():
        for rel, village, typ in dirs:
            path = os.path.join(CDT, rel)
            if not os.path.isdir(path):
                continue
            for fn in sorted(os.listdir(path)):
                if not fn.endswith(".json") or fn == "index.json":
                    continue
                try:
                    d = json.load(open(os.path.join(path, fn)))
                except (json.JSONDecodeError, OSError):
                    continue
                if not isinstance(d, dict) or "name" not in d:
                    continue
                d["_out"] = out
                d["_village"] = village
                d["_type"] = typ
                d["_super"] = d.get("superTroop") if isinstance(d.get("superTroop"), dict) else None
                bycat[out].append(d)
    return bycat


def level_cost(lv, out):
    """Cost value for a CDT level, in the planner's Cost shape."""
    if out == "equipment":
        return {
            "shiny_ore": lv.get("upgradeShinyOre", 0),
            "glowy_ore": lv.get("upgradeGlowingOre", 0),
            "starry_ore": lv.get("upgradeStarryOre", 0),
        }
    for k in ("researchCost", "upgradeCost", "buildCost"):
        if k in lv:
            return lv.get(k)
    return None


def level_time(lv):
    for k in ("researchTime", "upgradeTime", "buildTime"):
        if k in lv:
            return sec(lv.get(k))
    return None


def gate(lv):
    """Return (th, lab, bs, ph) requirement columns for a CDT level."""
    # CDT spells the two hall gates differently: `townHallRequired` on home
    # entities, `builderHallLevelRequired` on Builder Base heroes. The old
    # CKA data called the builder one `builderHallRequired` — keep that as a
    # fallback so both sources map onto the planner's `th` column.
    #
    # NOTE: home heroes carry only `heroHallLevelRequired` (a Hero Hall
    # level, which the app does not model). It is deliberately NOT part of
    # this chain — home hero rows get their `th` gate from the baseline
    # instead (see inherit_hero_th).
    th = lv.get("townHallRequired", lv.get("builderHallLevelRequired",
           lv.get("builderHallRequired")))
    lab = lv.get("laboratoryRequired", lv.get("starLabRequired"))
    bs = lv.get("blacksmithLevelRequired")
    ph = lv.get("petHouseLevelRequired")
    return th, lab, bs, ph


def build_levels(d, out):
    """Turn a CDT entity's `levels` into planner rows. Returns (levels, resource)."""
    raw = d.get("levels") or []
    drop = out in DROP_FREE_L1
    rows = []
    resource = None
    prev = 0
    for lv in raw:
        lvl = lv.get("level")
        # Some CDT home defense / resource-building files append a gear-up tail
        # block after the main upgrade chain (level numbers restart at 1). The
        # planner models gear-ups separately (bbRush.GEAR_UPS), and the old CKA
        # data carried only the main chain, so stop at the first level that
        # does not increase — that drops the whole tail block.
        if lvl is not None and lvl <= prev:
            break
        cost = level_cost(lv, out)
        t = level_time(lv)
        if drop and lvl == 1 and (cost in (0, None)) and (t in (0, None)):
            if lvl is not None:
                prev = lvl
            continue  # free initial-state row; planner starts at first paid upgrade
        th, lab, bs, ph = gate(lv)
        row = {"l": lvl, "cost": cost, "time": t,
               "th": th, "lab": lab, "bs": bs, "ph": ph}
        if out == "guardians":
            for s in GUARDIAN_STATS:
                if s in lv:
                    row[s] = lv[s]
        rows.append(row)
        if lvl is not None:
            prev = lvl
        # entity resource = first level that names one
        if resource is None:
            for k in ("researchCostResource", "upgradeCostResource", "buildCostResource"):
                if lv.get(k):
                    resource = lv.get(k)
                    break
    return rows, resource


def inherit_hero_th(levels, base):
    """Home-village heroes: CDT carries no Town Hall gate, only a Hero Hall
    level the app does not model, so their rows come out with `th=None`.
    Inherit the TH gate from the baseline, matched on upgrade cost. Cost
    tiers are stable across data revisions even when the old CKA levels were
    numbered one behind the CDT in-game levels, so matching on cost (not
    level number) aligns them. An unmatched cost forward-fills the last
    seen TH — the gate only ever increases down the chain, so that is the
    next row's gate."""
    if not base or not levels:
        return
    c2th = {}
    for r in base.get("levels", []):
        c = r.get("cost")
        if c not in (0, None):
            c2th[c] = r.get("th")
    last = None
    for r in levels:
        c = r.get("cost")
        if c in c2th:
            r["th"] = c2th[c]
            last = c2th[c]
        elif c not in (0, None) and last is not None:
            r["th"] = last


def build_crafted_levels(d):
    """Crafted defenses: rows come from modules[].upgrades[] (one row per module level)."""
    rows = []
    resource = None
    for mod in d.get("modules", []):
        for up in mod.get("upgrades", []):
            lvl = up.get("level")
            if lvl is None:
                continue
            th, lab, bs, ph = gate(up)
            row = {"l": lvl, "cost": up.get("buildCost"), "time": sec(up.get("buildTime")),
                   "th": 18, "lab": None, "bs": None, "ph": None}
            stat_name = mod.get("statName") or mod.get("name")
            if mod.get("name", "").lower() == "hitpoints" and "stat" in up:
                row["hitpoints"] = up["stat"]
            elif mod.get("name", "").lower() in ("damage", "dps") and "stat" in up:
                row["dps"] = up["stat"]
            # merge stat fields present on the crafted level object itself
            for s in ("hitpoints", "dps"):
                if s in d and s not in row:
                    row[s] = d[s]
            if resource is None and up.get("buildCostResource"):
                resource = up["buildCostResource"]
            rows.append(row)
    # de-dup by level, prefer the row that carries a stat; keep max level set
    seen = {}
    for r in rows:
        k = r["l"]
        if k not in seen:
            seen[k] = r
        else:
            base_r = seen[k]
            for s in ("hitpoints", "dps"):
                if s not in base_r and s in r:
                    base_r[s] = r[s]
    return [seen[k] for k in sorted(seen)], resource


# ---------------------------------------------------------------------------
# Fandom wiki gap-fill (reuses audit_fandom_full.py's helpers by re-implementing
# the same parser so this script is self-contained).
# ---------------------------------------------------------------------------
def _clean(v):
    v = re.sub(r"<[^>]+>", "", v)
    v = re.sub(r"\{\{[^{}]*\}\}", "", v)
    v = re.sub(r"\[\[([^]|]+)(?:\|[^]]+)?\]\]", r"\1", v)
    v = re.sub(r"<!--.*?-->", "", v, flags=re.S)
    return re.sub(r"[^0-9A-Za-z.,:/+ -]", "", v).strip()


def _seconds(v):
    v = _clean(v).lower()
    total, found = 0, False
    for amt, unit in re.findall(r"(\d+(?:\.\d+)?)\s*(s|m|h|d)", v):
        found = True
        total += int(float(amt) * {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit])
    return total if found else None


def _wiki_tables(text):
    out = []
    for table in re.findall(r"\{\|.*?\n\|\}", text, flags=re.S):
        rows, cur = [], []
        for line in table.splitlines():
            line = line.strip()
            if line.startswith("|-"):
                if cur:
                    rows.append(cur)
                cur = []
            elif line.startswith("|") and not line.startswith("||"):
                cur.extend(_clean(x) for x in line[1:].split("||"))
            elif line.startswith("!") and not line.startswith("!!"):
                cur.extend(_clean(x) for x in line[1:].split("!!"))
        if cur:
            rows.append(cur)
        out.append(rows)
    return out


def _extract(text):
    """Return [{level, cost, time}] from Fandom cost/time tables."""
    for table in re.findall(r"\{\|.*?\n\|\}", text, flags=re.S):
        if not re.search(r"(?:bCost|rCost)", table) or not re.search(r"(?:bTime|rTime)", table):
            continue
        result = []
        for block in re.split(r"\n\|-", table):
            lm = re.search(r"(?:^|\n)\|\s*(\d+)\s*(?:\n|$)", block)
            cm = re.search(r"(?:bCost|rCost)[^|]*\|\s*([^\n|]+)", block)
            tm = re.search(r"(?:bTime|rTime)[^|]*\|\s*([^\n|]+)", block)
            if not (lm and cm and tm):
                continue
            level = int(lm.group(1))
            if level <= 100:
                result.append({"level": level,
                               "cost": _num(cm.group(1)),
                               "time": _seconds(tm.group(1))})
        if result:
            return result
    return []


def _num(v):
    v = _clean(v).replace(",", "").replace(" ", "")
    m = re.search(r"\d+", v)
    return int(m.group()) if m else None


def _fetch(title):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, re.sub(r"[^A-Za-z0-9_.-]", "_", title) + ".json")
    if os.path.exists(path):
        try:
            return json.load(open(path)).get("text")
        except (json.JSONDecodeError, OSError):
            pass
    url = API + "?" + "&".join(
        urllib.parse.quote(k) + "=" + urllib.parse.quote(v)
        for k, v in {"action": "parse", "page": title, "prop": "wikitext",
                    "format": "json", "formatversion": "2"}.items())
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "coc-planner-slim/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            payload = json.load(r)
        text = payload.get("parse", {}).get("wikitext") or payload.get("parse", {}).get("wikitext", {}).get("*")
        json.dump({"title": title, "text": text}, open(path, "w"))
        time.sleep(0.08)
        return text
    except Exception:
        return None


def wiki_rows(name, village):
    """Fetch Fandom page for a missing entity; return planner rows or None."""
    cand = []
    if village == "home":
        cand.append(f"{name}/Home Village")
    elif village == "builderBase":
        cand.append(f"{name}/Builder Base")
    cand += [name, name.replace(" ", "_")]
    for title in cand:
        text = _fetch(title)
        if not text:
            continue
        rows = _extract(text)
        if rows:
            out = []
            for r in rows:
                out.append({"l": r["level"], "cost": r["cost"], "time": r["time"],
                            "th": None, "lab": None, "bs": None, "ph": None})
            return out, title
    return None, None


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
def main():
    baseline = load_baseline()
    cdt = load_cdt()
    gap_filled = []
    for out in CATEGORIES:
        items = []
        for d in cdt.get(out, []):
            village = d.get("_village")
            name = d["name"]
            key = (out, village, norm(name))
            base = baseline.get(key)

            if out == "crafted-defenses":
                levels, resource = build_crafted_levels(d)
            else:
                levels, resource = build_levels(d, out)

            # Home heroes: CDT carries only a Hero Hall gate, which the app does
            # not model, so their rows came out with th=None. Recover the real
            # Town Hall gate from the baseline (matched on upgrade cost).
            if out == "heroes" and village == "home":
                inherit_hero_th(levels, base)

            # Super-troop companion (only in troops): add it as its own entity
            # so the planner keeps the Super <unit> entries it ships today.
            # _id / static fields come from the baseline when available.
            # CDT resolves an entity's id from the baseline when there is one,
            # otherwise from its own `dataId`. Some CDT cosmetic files (e.g. the
            # Hero Banner post) carry neither and no upgrade levels — they are
            # not representable in the app's `_id: number` contract, so drop them
            # rather than emit a null id.
            eid = (base or {}).get("_id") or d.get("dataId")
            if eid is None and not levels:
                continue
            ent = {
                "_id": eid,
                "name": name,
                "village": (base or {}).get("village", village),
                "type": (base or {}).get("type", d.get("_type")),
                "resource": (base or {}).get("resource", resource),
                "rarity": (base or {}).get("rarity"),
                "hero": (base or {}).get("hero"),
            }
            if "flying" in (base or {}) :
                ent["flying"] = base["flying"]
            ent["levels"] = levels
            items.append(ent)

            # super-troop companion
            st = d.get("_super")
            if st and st.get("levels") and out == "troops":
                skey = (out, village, norm(st["name"]))
                sbase = baseline.get(skey)
                srows, sres = [], None
                for lv in st["levels"]:
                    srows.append({"l": lv.get("level"), "cost": 0, "time": 0,
                                  "th": None, "lab": None, "bs": None, "ph": None})
                sent = {
                    "_id": (sbase or {}).get("_id", st.get("dataId", d.get("dataId"))),
                    "name": st["name"],
                    "village": (sbase or {}).get("village", village),
                    "type": (sbase or {}).get("type"),
                    "resource": (sbase or {}).get("resource", st.get("boostCostResource")),
                    "rarity": (sbase or {}).get("rarity"),
                    "hero": (sbase or {}).get("hero"),
                }
                if "flying" in (sbase or {}):
                    sent["flying"] = sbase["flying"]
                sent["levels"] = srows
                items.append(sent)

        # ---- gap fill: baseline entities missing from CDT for this category ----
        cdt_names = {norm(x["name"]) for x in items}
        for (b_out, b_vil, b_n), bit in baseline.items():
            if b_out != out:
                continue
            if b_n in cdt_names:
                continue
            wrows, title = wiki_rows(bit["name"], b_vil)
            if wrows:
                levels, src = wrows, title
            else:
                # Event-only troops / removed spells: no wiki table. Keep the
                # previous (CKA-derived) levels verbatim so nothing ships
                # empty, and flag it in the report.
                levels, src = bit.get("levels", []), "FALLBACK-CKA-BASELINE"
            gitm = {
                "_id": bit.get("_id"), "name": bit["name"], "village": bit.get("village"),
                "type": bit.get("type"), "resource": bit.get("resource"),
                "rarity": bit.get("rarity"), "hero": bit.get("hero"),
            }
            if "flying" in bit:
                gitm["flying"] = bit["flying"]
            gitm["levels"] = levels
            gitm["_fallback"] = True
            items.append(gitm)
            gap_filled.append((out, bit["name"], src))

        # De-dup by _id: a CDT-provided entity wins over a wiki/CKA fallback
        # that happens to share the id (CDT renamed e.g. "Battle Machine" ->
        # "Battle Machine Altar", both 1000053).
        deduped = []
        seen = set()
        for e in sorted(items, key=lambda e: 0 if not e.get("_fallback") else 1):
            k = e.get("_id")
            if k is not None:
                if k in seen:
                    continue
                seen.add(k)
            e.pop("_fallback", None)
            deduped.append(e)
        deduped.sort(key=lambda e: (str(e.get("village")), e.get("_id") or 0, e["name"]))
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, f"{out}.json"), "w") as fh:
            json.dump({"items": deduped}, fh, separators=(",", ":"))
        print(f"{out}.json: {len(deduped)} entities, {os.path.getsize(os.path.join(OUT, f'{out}.json'))//1024} KB")

    if gap_filled:
        print(f"\nWIKI GAP-FILL ({len(gap_filled)} entities not in CDT):")
        for out, name, src in gap_filled:
            print(f"  [{out}] {name} <- {src}")


if __name__ == "__main__":
    main()
