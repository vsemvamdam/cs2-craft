"""Liquipedia wikitext (Match2) → table of matches. Raw pages come from scripts/fetch-matches-hist.mjs.

parse_store(store_dir) → (matches DataFrame, stats dict)
  columns: key, date (UTC, datetime.date), ts (UTC epoch s or NaN), t1, t2, winner (1/2), s1, s2 (maps won),
           bo, maps (list of (rounds1, rounds2)), walkover, tour (tournament page), tier (S/A/…), tiertype,
           lan (True / False / None for mixed), page (the wiki page the match is on)
Only matches with two real opponents and a decided winner are kept; duplicates (same teams, same day,
same map scores — a match shown on two pages) are dropped.
"""
from __future__ import annotations

import datetime as dt
import json
import re
from pathlib import Path

import pandas as pd

# --------------------------------------------------------------------------- #
# generic template parsing
# --------------------------------------------------------------------------- #
_TOK = re.compile(r"\{\{|\}\}|\[\[|\]\]")


def template_end(s: str, i: int) -> int:
    """s[i:i+2] == '{{' → index right after the matching '}}' (or len(s))"""
    depth = 0
    for m in _TOK.finditer(s, i):
        t = m.group()
        if t == "{{":
            depth += 1
        elif t == "}}":
            depth -= 1
            if depth == 0:
                return m.end()
    return len(s)


def split_args(body: str) -> tuple[str, list[str], dict[str, str]]:
    """'{{Name|a|k=v}}' → ('Name', ['a'], {'k': 'v'}); splits on | outside nested templates/links"""
    inner = body[2:-2] if body.startswith("{{") and body.endswith("}}") else body
    parts, cur, d, k = [], [], 0, 0
    n = len(inner)
    while k < n:
        two = inner[k:k + 2]
        if two in ("{{", "[["):
            d += 1
            cur.append(two)
            k += 2
            continue
        if two in ("}}", "]]"):
            d -= 1
            cur.append(two)
            k += 2
            continue
        c = inner[k]
        if c == "|" and d == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(c)
        k += 1
    parts.append("".join(cur))
    name = parts[0].strip()
    pos, kw = [], {}
    for p in parts[1:]:
        eq = p.find("=")
        # a '=' inside a nested template does not make a named argument
        if eq >= 0 and "{{" not in p[:eq] and "[[" not in p[:eq]:
            key = p[:eq].strip().lower()
            kw[key] = re.sub(r"<!--.*?-->", "", p[eq + 1:], flags=re.S).strip()
        else:
            pos.append(p.strip())
    return name, pos, kw


def find_templates(s: str, pattern: str):
    """yield the full text of every template whose name matches the regex (case-insensitive first letter)"""
    rx = re.compile(r"\{\{\s*(" + pattern + r")\s*(?=[|}\n])", re.I)
    i = 0
    while True:
        m = rx.search(s, i)
        if not m:
            return
        e = template_end(s, m.start())
        yield s[m.start():e]
        i = m.start() + 2  # nested ones (a Match inside a Bracket) are found too


def strip_comments(s: str) -> str:
    return re.sub(r"<!--.*?-->", "", s, flags=re.S)


# --------------------------------------------------------------------------- #
# dates
# --------------------------------------------------------------------------- #
TZ = {"UTC": 0, "GMT": 0, "WET": 0, "WEST": 1, "BST": 1, "CET": 1, "CEST": 2, "EET": 2, "EEST": 3, "MSK": 3, "TRT": 3, "AST": 3,
      "GST": 4, "IRST": 3.5, "PKT": 5, "IST": 5.5, "ICT": 7, "WIB": 7, "SGT": 8, "PHT": 8, "HKT": 8, "AWST": 8, "KST": 9, "JST": 9,
      "ACST": 9.5, "AEST": 10, "AEDT": 11, "NZST": 12, "NZDT": 13, "BRT": -3, "ART": -3, "CLT": -4, "CLST": -3, "EST": -5, "EDT": -4,
      "CST": -6, "CDT": -5, "MST": -7, "MDT": -6, "PST": -8, "PDT": -7, "AKST": -9, "AKDT": -8, "HST": -10, "BRST": -2, "SAST": 2,
      "EAT": 3, "WAT": 1, "CAT": 2, "ALMT": 6, "UZT": 5, "AMT": 4, "GET": 4, "AZT": 4, "MYT": 8, "CST(CHINA)": 8}
MONTHS = {m: i + 1 for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august", "september",
                                           "october", "november", "december"])}
MONTHS.update({k[:3]: v for k, v in list(MONTHS.items())})
MONTHS["sept"] = 9


def parse_date(raw: str):
    """Liquipedia match date → (UTC datetime | None, has_time). Accepts 'February 8, 2024 - 13:30 {{Abbr/CET}}',
    '2024-02-08 13:30 {{Abbr/CET}}', '2024-02-08', '<abbr data-tz="+1:00">' …"""
    if not raw:
        return None, False
    s = strip_comments(raw)
    off = None
    m = re.search(r"data-tz=\"([+-])(\d{1,2}):(\d{2})\"", s)
    if m:
        off = (1 if m.group(1) == "+" else -1) * (int(m.group(2)) + int(m.group(3)) / 60)
    m = re.search(r"\{\{\s*Abbr/([A-Za-z]+)\s*\}\}", s) or re.search(r">\s*([A-Z]{2,5})\s*<", s) or re.search(r"\b([A-Z]{2,5})\s*$", s.strip())
    if off is None and m and m.group(1).upper() in TZ:
        off = TZ[m.group(1).upper()]
    s2 = re.sub(r"\{\{.*?\}\}|<[^>]+>", " ", s)
    y = mo = d = None
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", s2)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    else:
        m = re.search(r"([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})", s2)
        if m and m.group(1).lower() in MONTHS:
            y, mo, d = int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2))
        else:
            m = re.search(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", s2)
            if m and m.group(2).lower() in MONTHS:
                y, mo, d = int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1))
    if not y:
        return None, False
    rest = s2[m.end():]
    t = re.search(r"(\d{1,2}):(\d{2})", rest)
    try:
        base = dt.datetime(y, mo, d, int(t.group(1)) if t else 12, int(t.group(2)) if t else 0)
    except ValueError:
        return None, False
    if t and off is not None:
        base -= dt.timedelta(hours=off)
    return base, bool(t)


# --------------------------------------------------------------------------- #
# opponents and maps
# --------------------------------------------------------------------------- #
def norm_team(x: str) -> str:
    x = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", x or "")
    x = re.sub(r"\s*\((?:[^)]*team|[^)]*)\)$", "", x.strip())
    return re.sub(r"\s+", " ", x).strip().lower()


def opponent(raw: str):
    """'{{TeamOpponent|navi|score=2}}' → (team id, declared score | None, walkover/forfeit flag)"""
    raw = (raw or "").strip()
    if not raw.startswith("{{"):
        return None
    name, pos, kw = split_args(raw)
    nl = name.lower()
    if "literal" in nl or nl in ("tbdopponent",):
        return None
    if "team" not in nl:
        return None
    tid = kw.get("template") or kw.get("team") or kw.get("1") or (pos[0] if pos else "")
    tid = re.sub(r"\s+", " ", tid).strip().lower()  # team-template id; resolved to the team page via teams.json
    if not tid or tid in ("tbd", "tba", "bye", "&nbsp;", "definitions"):
        return None
    score = kw.get("score")
    sc = int(score) if score and re.fullmatch(r"\d+", score) else None
    wo = (score or "").upper() in ("W", "FF", "L", "DQ") or bool(kw.get("walkover"))
    return tid, sc, wo, (score or "").upper()


def map_result(raw: str):
    """'{{Map|map=Mirage|score1=13|score2=10|finished=true}}' → (map name, r1, r2, winner) or None"""
    if not raw or not raw.strip().startswith("{{"):
        return None
    name, pos, kw = split_args(raw.strip())
    fin = (kw.get("finished") or "").lower()
    if fin in ("skip", "notplayed", "np"):
        return None
    s1, s2 = kw.get("score1", ""), kw.get("score2", "")
    w = kw.get("winner", "")
    ot = any(re.fullmatch(r"o\d+t[12](t|ct)", k) and re.fullmatch(r"\d+", v) for k, v in kw.items())
    if not (re.fullmatch(r"\d+", s1) and re.fullmatch(r"\d+", s2)):
        # CS wiki: half scores t1t/t1ct/t2t/t2ct plus overtime halves o<k>t1t/o<k>t1ct/…
        half = {k: int(v) for k, v in kw.items() if re.fullmatch(r"(o\d+)?t[12](t|ct)", k) and re.fullmatch(r"\d+", v)}
        if any(k in half for k in ("t1t", "t1ct")) and any(k in half for k in ("t2t", "t2ct")):
            s1 = str(sum(v for k, v in half.items() if re.fullmatch(r"(o\d+)?t1(t|ct)", k)))
            s2 = str(sum(v for k, v in half.items() if re.fullmatch(r"(o\d+)?t2(t|ct)", k)))
    if re.fullmatch(r"\d+", s1) and re.fullmatch(r"\d+", s2):
        r1, r2 = int(s1), int(s2)
        if r1 == r2 == 0:
            return None
        win = 1 if r1 > r2 else 2 if r2 > r1 else (int(w) if w in ("1", "2") else 0)
        return (kw.get("map", "").strip(), r1, r2, win, ot)
    if w in ("1", "2") and fin in ("true", "1"):
        return (kw.get("map", "").strip(), None, None, int(w), ot)
    return None


def parse_match(raw: str, ctx_date=None):
    name, pos, kw = split_args(raw)
    o1, o2 = opponent(kw.get("opponent1", "")), opponent(kw.get("opponent2", ""))
    if not o1 or not o2 or o1[0] == o2[0]:
        return None
    maps = []
    for k in sorted((k for k in kw if re.fullmatch(r"map\d+", k)), key=lambda k: int(k[3:])):
        r = map_result(kw[k])
        if r:
            maps.append(r)
    slots = sum(1 for k in kw if re.fullmatch(r"map\d+", k))
    bo = int(kw["bestof"]) if re.fullmatch(r"\d+", kw.get("bestof", "")) else (slots if slots in (1, 3, 5) else None)
    w1 = sum(1 for m in maps if m[3] == 1)
    w2 = sum(1 for m in maps if m[3] == 2)
    s1 = o1[1] if o1[1] is not None else w1
    s2 = o2[1] if o2[1] is not None else w2
    walkover = o1[2] or o2[2] or bool(kw.get("walkover"))
    winner = kw.get("winner", "")
    if winner in ("1", "2"):
        winner = int(winner)
    elif s1 != s2:
        winner = 1 if s1 > s2 else 2
    elif o1[3] == "W" or o2[3] in ("FF", "L", "DQ"):
        winner = 1
    elif o2[3] == "W" or o1[3] in ("FF", "L", "DQ"):
        winner = 2
    else:
        return None
    if not maps and not walkover and s1 == s2 == 0:
        return None
    when, has_time = parse_date(kw.get("date", ""))
    if when is None and ctx_date is not None:
        when, has_time = ctx_date, False
    return {"t1": o1[0], "t2": o2[0], "winner": winner, "s1": s1, "s2": s2, "bo": bo,
            "maps": [(m[1], m[2], m[4]) for m in maps if m[1] is not None], "mapnames": [m[0].lower() for m in maps],
            "walkover": bool(walkover and not maps), "when": when, "has_time": has_time}


INFOBOX = re.compile(r"\{\{\s*(Infobox[ _]league|HiddenDataBox)", re.I)


def page_infobox(content: str):
    m = INFOBOX.search(content or "")
    if not m:
        return None
    _, _, kw = split_args(content[m.start():template_end(content, m.start())])
    return kw


TIER_NAMES = {"1": "S", "2": "A", "3": "B", "4": "C", "5": "D", "s": "S", "a": "A", "b": "B", "c": "C", "d": "D",
              "s-tier": "S", "a-tier": "A", "b-tier": "B", "c-tier": "C", "d-tier": "D"}


def tier_of(kw):
    return TIER_NAMES.get((kw.get("liquipediatier") or "").strip().lower())


def lan_of(kw):
    t = (kw.get("type") or "").lower()
    if "online" in t and "offline" in t:
        return None
    if "online" in t:
        return False
    if "offline" in t or "lan" in t:
        return True
    return None


def team_pages(store: Path) -> dict[str, str]:
    """team-template id → team wiki page, from the expanded {{Team|id}} output (teams.json)"""
    f = store / "teams.json"
    if not f.exists():
        return {}
    out = {}
    for tid, html in json.loads(f.read_text()).get("ids", {}).items():
        m = (re.search(r"team-template-text[^>]*>\s*\[\[([^\]|#]+)", html) or re.search(r"\|link=([^\]|]+)\]\]", html)
             or re.search(r"\[\[(?!File:|Image:|Category:)([^\]|#]+)", html))
        if m and "error" not in html[:200].lower():
            out[tid] = m.group(1).strip().replace("_", " ")
    return out


def parse_store(store: str | Path):
    store = Path(store)
    tl = json.loads((store / "tournaments.json").read_text())
    info = {p: x.get("t") for p, x in tl.get("list", {}).items() if x.get("t")}
    rows = []
    stats = {"raw_files": 0, "pages": 0, "match_templates": 0, "parsed": 0, "no_date": 0, "legacy_pages": 0}
    for f in sorted((store / "raw").glob("*.json")):
        j = json.loads(f.read_text())
        stats["raw_files"] += 1
        root = j["page"]
        titles = j["titles"]
        # tier/type of each page = its own infobox or the nearest ancestor's
        own = {t: page_infobox(c["content"]) for t, c in titles.items()}
        for t, c in titles.items():
            stats["pages"] += 1
            anc = t
            meta = None
            while True:
                if own.get(anc):
                    meta = own[anc]
                    break
                if anc == root or "/" not in anc:
                    break
                anc = anc.rsplit("/", 1)[0]
            tinfo = info.get(anc) or info.get(root) or {}
            tier = tier_of(meta) if meta else None
            tier = tier or tinfo.get("tier")
            lan = lan_of(meta) if meta else None
            if meta is None or (meta and not meta.get("type")):
                lan = {"lan": True, "online": False}.get(tinfo.get("type"))
            tiertype = (meta or {}).get("liquipediatiertype") or tinfo.get("tiertype") or ""
            sdate = (meta or {}).get("sdate") or (meta or {}).get("date") or tinfo.get("start")
            ctx = None
            if sdate:
                m = re.search(r"(\d{4})-(\d{2})-(\d{2})", sdate)
                if m:
                    ctx = dt.datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), 12)
            content = strip_comments(c["content"])
            if re.search(r"\{\{\s*(MatchMaps|BracketMatchSummary|LegacyBracket|[0-9]+SE\w*Bracket|[0-9]+DE\w*Bracket)", content):
                stats["legacy_pages"] += 1
            for raw in find_templates(content, r"Match"):
                stats["match_templates"] += 1
                m = parse_match(raw, ctx)
                if not m:
                    continue
                if m["when"] is None:
                    stats["no_date"] += 1
                    continue
                if not m["has_time"] and m["when"] == ctx:
                    stats["no_date"] += 1  # only the tournament start date: kept for Elo, flagged
                    m["date_approx"] = True
                stats["parsed"] += 1
                rows.append({**m, "tour": anc, "root": root, "page": t, "tier": tier, "lan": lan, "tiertype": tiertype})
    df = pd.DataFrame(rows)
    if df.empty:
        return df, stats
    tp = team_pages(store)
    stats["team_ids"] = int(pd.concat([df["t1"], df["t2"]]).nunique())
    df["t1"] = [tp.get(t, t) for t in df["t1"]]
    df["t2"] = [tp.get(t, t) for t in df["t2"]]
    df = df[df["t1"] != df["t2"]]
    stats["team_pages_known"] = len(tp)
    stats["teams"] = int(pd.concat([df["t1"], df["t2"]]).nunique())
    df["date"] = [w.date() for w in df["when"]]
    df["ts"] = [w.replace(tzinfo=dt.timezone.utc).timestamp() for w in df["when"]]
    df["date_approx"] = df["date_approx"].fillna(False).astype(bool) if "date_approx" in df else False
    # same match on two pages (possibly with the opponents in the other order): same teams, day and map scores
    def mkey(a, b, d, ms):
        sw = a > b
        return f"{min(a, b)}|{max(a, b)}|{d}|{sorted((m[1], m[0]) if sw else (m[0], m[1]) for m in ms)}"
    df["key"] = [mkey(a, b, d, ms) for a, b, d, ms in zip(df["t1"], df["t2"], df["date"], df["maps"])]
    before = len(df)
    df = df.sort_values(["date_approx", "ts"]).drop_duplicates("key").sort_values("ts").reset_index(drop=True)
    stats["duplicates"] = before - len(df)
    stats["matches"] = len(df)
    return df, stats
