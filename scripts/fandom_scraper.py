#!/usr/bin/env python3
"""Scrape the Clash of Clans Fandom wiki via its MediaWiki API.

Plain page URLs (https://clashofclans.fandom.com/wiki/...) are Cloudflare
gated, so a plain HTTP GET returns 403 "Just a moment...". The MediaWiki
API, however, is open and returns full wikitext:

    https://clashofclans.fandom.com/api.php?action=parse&page=TITLE
        &prop=wikitext&format=json&formatversion=2

This module wraps that endpoint (with a local `.fandom-cache`, matching the
convention in audit_fandom_full.py) and exposes:

  * fetch_wikitext(title)   -> str | None        (cached)
  * parse_tables(wikitext)  -> list[(headers, rows)]
  * requirement_ladder(title) -> {level: {"th":..,"lab":..,"bs":..,"ph":..}}
                                  for pages whose stat table carries a
                                  "Town Hall / Builder Hall / Laboratory /
                                  Blacksmith / Pet House Level Required"
                                  column; {} when the page has no such column
                                  (home heroes Archer Queen / Grand Warden
                                  today only list "Hero Hall Level Required",
                                  so their Town Hall gate must be recovered
                                  from the patch history instead).

CLI:
    python3 scripts/fandom_scraper.py Barbarian_King          # dump ladder
    python3 scripts/fandom_scraper.py Barbarian_King --diff   # vs public/data
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
API = "https://clashofclans.fandom.com/api.php"
CACHE = ROOT / ".fandom-cache"

# Which cleaned header text marks a requirement column, and what planner key it
# maps to. "town hall" (home) and "builder hall"/"builder base" (builder
# heroes) both feed the planner's `th` column.
REQ_COLUMNS = [
    ("town hall", "th"),
    ("builder hall", "th"),
    ("builder base", "th"),
    ("laboratory", "lab"),
    ("blacksmith", "bs"),
    ("pet house", "ph"),
]


def _clean_cell(text: str) -> str:
    """Strip wiki markup from one cell down to readable text.

    Removes {{templates}} (their inner `|` are args, not cell separators),
    resolves [[link|display]] -> display and [[link]] -> link, and drops HTML
    tags and attribute tokens like class="..."."""
    text = re.sub(r"\{\{.*?\}\}", "", text, flags=re.S)
    text = re.sub(r"\[\[([^\[\]|]*)(?:\|([^\[\]]*))?\]\]", lambda m: m.group(2) or m.group(1), text)
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()


def _cells(line: str) -> list[str]:
    """Split one wikitext table line into cells.

    Fandom rows are `|v1||v2||v3` (cells joined by `||`, i.e. a single `|`
    followed by an empty segment). Attribute cells like
    `|class="change-highlight"|5` fold their value into the following token."""
    text = _clean_cell(line)
    # A header cell is written as `!attr="..."|value` (or `!value`); the leading
    # `!` is just the marker, and the attribute still applies to the value.
    # Drop it so `attr|value` collapses to a single cell and header columns
    # line up with data rows.
    text = text.lstrip("!")
    parts = text.split("|")
    # A leading `|` leaves the first split token empty; drop it.
    if parts and parts[0].strip() == "":
        parts = parts[1:]
    out: list[str] = []
    i = 0
    while i < len(parts):
        tok = parts[i].strip()
        if tok == "":
            i += 1
            continue
        # An `attr="..."` token is followed by the real value.
        if re.match(r'^[A-Za-z-]+="', tok):
            val = parts[i + 1].strip() if i + 1 < len(parts) else ""
            out.append(val)
            i += 2
        else:
            out.append(tok)
            i += 1
    return out


def parse_tables(wikitext: str) -> list[tuple[list[str], list[list[str]]]]:
    """Return every {| ... |} table as (header_cells, data_rows).

    Header rows are `!` lines, `|-` ends a row, `|`/`||` are data cells."""
    tables: list[tuple[list[str], list[list[str]]]] = []
    in_table = False
    header: list[str] = []
    rows: list[list[str]] = []
    cur: list[str] = []
    for raw in wikitext.splitlines():
        s = raw.strip()
        if s.startswith("{|"):
            in_table = True
            header, rows, cur = [], [], []
            continue
        if not in_table:
            continue
        if s == "|}":
            in_table = False
            if cur:
                rows.append(cur)
            tables.append((header, rows))
            continue
        if s.startswith("!"):
            header.extend(_cells(s))
        elif s == "|-":
            if cur:
                rows.append(cur)
            cur = []
        elif s.startswith("|"):
            cur.extend(_cells(s))
    return tables


def _req_column(header: list[str]) -> tuple[int, str] | None:
    """Index + planner key of the first requirement column, else None."""
    for i, h in enumerate(header):
        hl = h.lower()
        for phrase, key in REQ_COLUMNS:
            if phrase in hl and "required" in hl:
                return i, key
    return None


def requirement_ladder(wikitext: str) -> dict[int, dict[str, int | None]]:
    """Per-level requirement map from a stat table that has one.

    The wiki writes a requirement only at the top of each band (the rest of
    the band leaves the cell blank), so the last seen value is carried
    forward. Returns {} when no stat table carries a requirement column."""
    ladder: dict[int, dict[str, int | None]] = {}
    for header, rows in parse_tables(wikitext):
        if len(rows) < 10:
            continue
        hit = _req_column(header)
        if not hit:
            continue
        ridx, key = hit
        carry: dict[str, int] = {}
        for row in rows:
            if not row:
                continue
            m = re.fullmatch(r"(\d+)", row[0].strip())
            if not m:
                continue
            level = int(m.group(1))
            cell = row[ridx].strip() if ridx < len(row) else ""
            rm = re.fullmatch(r"(\d+)", cell)
            if rm:
                carry[key] = int(rm.group(1))
            ladder[level] = {
                "th": carry.get("th"),
                "lab": carry.get("lab"),
                "bs": carry.get("bs"),
                "ph": carry.get("ph"),
            }
        # only the first qualifying table is authoritative
        break
    return ladder


def api(params: dict[str, str]) -> dict:
    url = API + "?" + "&".join(
        f"{quote(str(k))}={quote(str(v))}" for k, v in params.items()
    )
    last: Exception | None = None
    for attempt in range(4):
        try:
            req = Request(url, headers={"User-Agent": "coc-planner-fandom-audit/1.0"})
            with urlopen(req, timeout=30) as response:
                return json.load(response)
        except Exception as exc:  # noqa: BLE001 - retry transient / Cloudflare blips
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise last


def fetch_wikitext(title: str) -> str | None:
    """Cached wikitext for `title`, fetched from the Fandom API if missing."""
    CACHE.mkdir(exist_ok=True)
    path = CACHE / (re.sub(r"[^A-Za-z0-9_.-]", "_", title) + ".json")
    if path.exists():
        cached = json.loads(path.read_text())
        text = cached.get("wikitext") or cached.get("text")
        if text:
            return text
    try:
        payload = api({"action": "parse", "page": title, "prop": "wikitext",
                       "format": "json", "formatversion": 2})
    except Exception as exc:  # noqa: BLE001 - report and fall through
        print(f"  ! API error for {title}: {exc}", file=sys.stderr)
        return None
    text = payload.get("parse", {}).get("wikitext")
    if isinstance(text, str) and text:
        path.write_text(json.dumps({"title": title, "wikitext": text}, ensure_ascii=False))
    return text


def _diff(title: str, ladder: dict[int, dict[str, int | None]],
          data: dict[str, dict]) -> int:
    """Compare the wiki ladder against a heroes.json entry. Returns exit code."""
    name = re.sub(r"[-_]", " ", title).title()
    entry = next((e for e in data["items"] if e["name"].lower() == name.lower()), None)
    if entry is None:
        print(f"  ! no matching entity {name!r} in heroes.json")
        return 1
    ours = {r["l"]: (r.get("th"), r.get("lab"), r.get("bs"), r.get("ph"))
            for r in entry["levels"]}
    bad = 0
    print(f"{name}: wiki {len(ladder)} levels vs data {len(ours)} levels")
    for level, req in sorted(ladder.items()):
        if level not in ours:
            continue
        oth, olab, obs, oph = ours[level]
        for k, wv in (("th", req.get("th")), ("lab", req.get("lab")),
                      ("bs", req.get("bs")), ("ph", req.get("ph"))):
            ov = {"th": oth, "lab": olab, "bs": obs, "ph": oph}[k]
            if wv is not None and wv != ov:
                bad += 1
                print(f"  L{level:<4} {k}: wiki={wv} data={ov}")
    print("  MATCH" if bad == 0 else f"  {bad} field mismatches")
    return 1 if bad else 0


def main(argv: list[str]) -> int:
    if len(argv) < 1:
        print(__doc__.strip())
        return 2
    title = argv[0]
    do_diff = "--diff" in argv
    wikitext = fetch_wikitext(title)
    if wikitext is None:
        return 1
    ladder = requirement_ladder(wikitext)
    if do_diff:
        data = json.loads((ROOT / "public" / "data" / "heroes.json").read_text())
        return _diff(title, ladder, data)
    if not ladder:
        print(f"{title}: no requirement column found "
              f"(page lists only Hero Hall Level Required; recover Town Hall "
              f"gate from patch history)")
        return 0
    print(json.dumps({str(k): v for k, v in sorted(ladder.items())}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
