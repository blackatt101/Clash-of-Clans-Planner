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


def extract(text: str) -> list[dict[str, int | None]]:
    """Extract only rows using Fandom's explicit cost/time cell classes."""
    for table in re.findall(r"\{\|.*?\n\|\}", text, flags=re.S):
        if not re.search(r"(?:bCost|rCost)", table) or not re.search(r"(?:bTime|rTime)", table):
            continue
        result = []
        for block in re.split(r"\n\|-", table):
            level_match = re.search(r"(?:^|\n)\|\s*(\d+)\s*(?:\n|$)", block)
            cost_match = re.search(r"(?:bCost|rCost)[^|]*\|\s*([^\n|]+)", block)
            time_match = re.search(r"(?:bTime|rTime)[^|]*\|\s*([^\n|]+)", block)
            if not (level_match and cost_match and time_match):
                continue
            level = int(level_match.group(1))
            if level <= 100:
                result.append({"level": level, "cost": number(cost_match.group(1)), "time": seconds(time_match.group(1))})
        if result:
            return result
    return []


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
    totals = {"match": 0, "mismatch": 0, "unverified": 0}
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
            wiki = extract(text or "")
            planner = item.get("levels", [])
            comparable = []
            # Fandom unit/hero/pet pages label the first paid upgrade as L1;
            # planner data keeps the free starting state as L1. Align by the
            # paid-step sequence when the wiki has exactly one fewer row.
            wiki_offset = 1 if len(wiki) == len(planner) - 1 else 0
            for row in wiki:
                p = next((x for x in planner if x.get("l") == row["level"] + wiki_offset), None)
                if p and row["cost"] is not None and row["time"] is not None:
                    comparable.append((row, p))
            mismatches = [
                {"level": w["level"], "wiki": w, "planner": p}
                for w, p in comparable
                if w["cost"] != p.get("cost") or w["time"] != p.get("time")
            ]
            if mismatches:
                status = "mismatch"
            elif comparable:
                status = "match" if len(comparable) == len(planner) else "unverified"
            else:
                status = "unverified"
            totals[status] += 1
            report.append({"file": filename, "id": item["_id"], "name": item["name"], "page": title, "planner_levels": len(planner), "wiki_rows": len(wiki), "compared": len(comparable), "status": status, "mismatches": mismatches})
    output = {"totals": totals, "entities": report}
    print(json.dumps(output, indent=2, ensure_ascii=False))
    return 1 if totals["mismatch"] else 0


if __name__ == "__main__":
    sys.exit(main())
