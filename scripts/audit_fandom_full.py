#!/usr/bin/env python3
"""Compare planner slim data with Clash of Clans Fandom page tables.

This is deliberately conservative: a row is only marked as matching when the
wiki page exposes a parseable cost/time/requirement triple. Missing or
ambiguous wiki data is reported as unverified rather than treated as a match.
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"
API = "https://clashofclans.fandom.com/api.php"
FILES = ("buildings", "troops", "heroes", "spells", "pets", "equipment", "traps", "helpers", "guardians", "crafted-defenses")
CACHE = ROOT / ".fandom-cache"


def api(params: dict[str, str]) -> dict:
    url = API + "?" + "&".join(f"{quote(k)}={quote(v)}" for k, v in params.items())
    req = Request(url, headers={"User-Agent": "coc-planner-fandom-audit/1.0"})
    with urlopen(req, timeout=30) as response:
        return json.load(response)


def clean(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    value = re.sub(r"\{\{[^{}]*\}\}", "", value)
    value = re.sub(r"\[\[([^]|]+)(?:\|[^]]+)?\]\]", r"\1", value)
    value = re.sub(r"<!--.*?-->", "", value, flags=re.S)
    return re.sub(r"[^0-9A-Za-z.,:/+ -]", "", value).strip()


def number(value: str) -> int | None:
    value = clean(value).replace(",", "").replace(" ", "")
    match = re.search(r"\d+", value)
    return int(match.group()) if match else None


def seconds(value: str) -> int | None:
    value = clean(value).lower().replace("&nbsp;", " ")
    total = 0
    found = False
    for amount, unit in re.findall(r"(\d+(?:\.\d+)?)\s*(s|m|h|d)", value):
        found = True
        n = float(amount)
        total += int(n * {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit])
    return total if found else None


def tables(text: str) -> list[list[list[str]]]:
    output = []
    for table in re.findall(r"\{\|.*?\n\|\}", text, flags=re.S):
        rows: list[list[str]] = []
        current: list[str] = []
        for line in table.splitlines():
            line = line.strip()
            if line.startswith("|-"):
                if current:
                    rows.append(current)
                current = []
            elif line.startswith("|") and not line.startswith("||"):
                current.extend(clean(x) for x in line[1:].split("||"))
            elif line.startswith("!") and not line.startswith("!!"):
                current.extend(clean(x) for x in line[1:].split("!!"))
        if current:
            rows.append(current)
        output.append(rows)
    return output


def _level_cell(block: str) -> int | None:
    """The block's leading level cell. Tolerates `|3`, `|3|` and `|3||class=...`."""
    m = re.match(r"\s*\|{1,2}\s*(\d+)\s*(?:\||\n|$)", block)
    return int(m.group(1)) if m else None


def _cost_time_cells(block: str) -> tuple[int | None, int | None]:
    """Return (cost, time) seconds for a level row.

    The time is anchored to the *first* time cell that follows the cost cell,
    so rows containing several time-bearing cells (e.g. a troop's lifetime
    column plus its build time) read the build time, not the lifetime.
    """
    cost_m = re.search(r"(?:bCost|rCost)[^|\n]*\|\s*([^\n|]+)", block)
    if not cost_m:
        return None, None
    time_m = re.search(r"(?:bTime|rTime)[^|\n]*\|\s*([^\n|]+)", block[cost_m.end():])
    cost = number(cost_m.group(1))
    time = seconds(time_m.group(1)) if time_m else None
    return cost, time


def extract(text: str) -> list[list[dict[str, int | None]]]:
    """Extract the cost/time rows of *every* cost/time table on the page.

    A page can carry several such tables (a main level table plus gear-up,
    supercharge/charge, boost, or per-module/per-resource variant tables).
    Returning them separately lets the caller match a planner entity against
    whichever table is the authoritative one instead of blending them.
    """
    tables_out: list[list[dict[str, int | None]]] = []
    for table in re.findall(r"\{\|.*?\n\|\}", text, flags=re.S):
        if not re.search(r"(?:bCost|rCost)", table) or not re.search(r"(?:bTime|rTime)", table):
            continue
        result = []
        for block in re.split(r"\n\|-", table):
            level = _level_cell(block)
            if level is None or level > 100:
                continue
            cost, time = _cost_time_cells(block)
            result.append({"level": level, "cost": cost, "time": time})
        if result:
            tables_out.append(result)
    return tables_out


def page_candidates(item: dict) -> list[str]:
    name = item["name"]
    village = item.get("village")
    item_type = item.get("type")
    candidates = []
    if village == "home":
        candidates.append(f"{name}/Home Village")
    elif village == "builderBase":
        candidates.append(f"{name}/Builder Base")
    # Guardians may be titled "Name/Guardian" on Fandom
    if item_type == "guardian":
        candidates.append(f"{name}/Guardian")
    # The name itself may be a disambiguation page that routes to village sub-pages
    # (spells, pets, equipment, helpers carry no village field in the slim data).
    if village is None:
        candidates.extend((f"{name}/Home Village", f"{name}/Builder Base"))
    candidates.extend((name, name.replace(" ", "_")))
    return list(dict.fromkeys(candidates))


def fetch_page(title: str) -> str | None:
    CACHE.mkdir(exist_ok=True)
    path = CACHE / (re.sub(r"[^A-Za-z0-9_.-]", "_", title) + ".json")
    if path.exists():
        return json.loads(path.read_text()).get("text")
    try:
        payload = api({"action": "parse", "page": title, "prop": "wikitext", "format": "json"})
    except Exception:
        return None
    text = payload.get("parse", {}).get("wikitext", {}).get("*")
    path.write_text(json.dumps({"title": title, "text": text}, ensure_ascii=False))
    time.sleep(0.08)
    return text


def main() -> int:
    totals = {"match": 0, "mismatch": 0, "unverified": 0, "partial": 0}
    report = []
    for filename in FILES:
        source = json.loads((DATA / f"{filename}.json").read_text())
        for item in source["items"]:
            title = None
            text = None
            for candidate in page_candidates(item):
                text = fetch_page(candidate)
                if text:
                    title = candidate
                    break
            wiki_tables = extract(text or "")
            planner = item.get("levels", [])
            planner_by_level = {lvl.get("l"): lvl for lvl in planner}

            # A planner entity is verified against the wiki when, for *some*
            # cost/time table on the page, every overlapping level agrees.
            # (Wikitext pages carry multiple tables: main level, gear-up,
            # supercharge/charge, boost, and per-module/per-resource variants.)
            comparable_total = 0
            matched_table = False
            best_mismatch = None
            best = None
            for wiki in wiki_tables:
                comparable = []
                mismatches = []
                for row in wiki:
                    p = planner_by_level.get(row["level"])
                    if p and row["cost"] is not None and row["time"] is not None:
                        comparable.append(row["level"])
                        if row["cost"] != p.get("cost") or row["time"] != p.get("time"):
                            mismatches.append({"level": row["level"], "wiki": row, "planner": p})
                comparable_total = max(comparable_total, len(comparable))
                if not mismatches and comparable:
                    matched_table = True
                    break
                if best is None or len(mismatches) < len(best[1]):
                    best = (len(comparable), mismatches)
                    best_mismatch = mismatches
            if matched_table:
                status = "match"
                mismatches = []
            elif best_mismatch:
                status = "mismatch"
                mismatches = best_mismatch
            else:
                status = "unverified"
                mismatches = []
            if status == "match" and matched_table and comparable_total < len(planner):
                status = "partial"
            totals[status] += 1
            report.append({"file": filename, "id": item["_id"], "name": item["name"], "page": title, "planner_levels": len(planner), "wiki_tables": len(wiki_tables), "compared": comparable_total, "status": status, "mismatches": mismatches})
    output = {"totals": totals, "entities": report}
    print(json.dumps(output, indent=2, ensure_ascii=False))
    return 1 if totals["mismatch"] else 0


if __name__ == "__main__":
    sys.exit(main())
