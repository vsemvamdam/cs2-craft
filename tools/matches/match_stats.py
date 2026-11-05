#!/usr/bin/env python3
"""
match_stats.py — статистика одного матча CS2 из демки для раздела «Мои матчи».

Вход: .dem или .dem.bz2 (как отдаёт replay*.valve.net), SteamID64 владельца.
Выход (stdout или --out): JSON одного матча — тот же формат, что элемент
`matches[]` в matches/<steamid>.json (см. scripts/my-matches.mjs), без полей,
которые знает только координатор игры (code, id, date):

  { map, mode, duration, rounds, score:[us,them], result:'W'|'L'|'T', rh,
    rating:{type, before, after, delta, pred, wins} | null,
    me:{ k,d,a,hs,mvp,score, adr,dmg,kast,ud,fa,ef,fk,fd,tk,
         mk:{"2":n,"3":n,"4":n,"5":n}, cl:{"1":[попыток,побед],...},
         shots,hits,hh,acc, weapons:{ak47:{k,hs,shots,hits,dmg},...} },
    players:[{sid,name,team,k,d,a,hs,adr,kast,mvp,score,fk,ud,rank}],
    demo:true }

Как считается (demoparser2, тот же подход, что в tools/demos/extract_nades.py):
  * раунды — round_freeze_end … round_end после round_announce_match_start;
    убийства после конца раунда (до следующего freeze_end) идут в тот же раунд;
  * K/D/A, HS, первые убийства/смерти, мультикиллы — player_death
    (тимкиллы и самоубийства не считаются убийствами, смерти считаются все);
  * урон и ADR — player_hurt, урон ограничен оставшимся HP жертвы (поле
    health), урон по своим не считается; урон гранатами — HE и огонь;
  * точность — выстрелы weapon_fire (без ножа, гранат, C4, зевса) против
    попаданий player_hurt по врагам (несколько дробин в один тик = одно попадание);
  * KAST — раунд с убийством, ассистом, выживанием или «разменом»
    (убийцу игрока убил союзник в течение 5 с);
  * клатчи — момент, когда игрок остался последним живым в команде против
    X ≥ 1 врагов; победа — если его команда выиграла раунд;
  * ослеплённые враги и MVP — счётчики игры из контроллера игрока
    (enemies_flashed_total, mvps) — в демках CS2 события player_blind часто нет;
  * рейтинг — rank (m_iCompetitiveRanking: для Premier это CS Rating, для
    обычного режима — звание на карте 1–18), rank_if_win/rank_if_loss/
    rank_if_tie (прогноз после матча), comp_rank_type (11 Premier,
    12 соревновательный, 7 напарники), comp_wins (число побед).

  python3 match_stats.py match.dem.bz2 --steamid 7656119… --out m.json
  python3 match_stats.py match.dem --dump-events ev.json.gz   # фикстура для тестов
"""
from __future__ import annotations

import argparse
import bz2
import gzip
import json
import math
import os
import re
import shutil
import sys
import tempfile
from collections import Counter, defaultdict
from pathlib import Path

EVENTS_VERSION = 1
TICKRATE = 64
TRADE_TICKS = 5 * TICKRATE

RANK_TYPES = {11: "premier", 12: "competitive", 6: "competitive", 7: "wingman"}
UTIL_DAMAGE = {"hegrenade", "molotov"}  # after norm_weapon(): inferno/incgrenade → molotov
NON_GUN = {"knife", "hegrenade", "flashbang", "smokegrenade", "molotov", "decoy", "c4", "taser",
           "world", "healthshot", "bumpmine", "breachcharge", "tablet", "fists", "melee", "axe",
           "hammer", "spanner", "shield", "snowball", "planted_c4", ""}
# player_hurt names some guns by their base class (M4A1-S → m4a1, USP-S → hkp2000, R8 → deagle…);
# the attacker's active weapon tells them apart.
AMBIGUOUS = {"m4a1", "hkp2000", "deagle", "mp7", "p250"}
ACTIVE_NAMES = {
    "M4A1-S": "m4a1_silencer", "M4A4": "m4a1", "USP-S": "usp_silencer", "P2000": "hkp2000",
    "R8 Revolver": "revolver", "Desert Eagle": "deagle", "MP5-SD": "mp5sd", "MP7": "mp7",
    "CZ75-Auto": "cz75a", "P250": "p250",
}
KNIFE_RE = re.compile(r"knife|bayonet")


def log(*a):
    print(*a, file=sys.stderr)


def fnum(v, default=0.0):
    try:
        f = float(v)
        return default if math.isnan(f) else f
    except (TypeError, ValueError):
        return default


def inum(v, default=0):
    return int(fnum(v, default))


def bval(v):
    try:
        if v is None or (isinstance(v, float) and math.isnan(v)):
            return False
    except TypeError:
        pass
    return bool(v)


def sval(v):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return ""
    s = str(v)
    return "" if s in ("nan", "None") else s


def norm_weapon(w, active=None):
    w = sval(w).lower()
    if w.startswith("weapon_"):
        w = w[7:]
    if KNIFE_RE.search(w):
        return "knife"
    if w in AMBIGUOUS and active in ACTIVE_NAMES:
        return ACTIVE_NAMES[active]
    if w in ("inferno", "incgrenade"):
        return "molotov"
    return w


def valid_sid(s):
    s = sval(s)
    return s if s.isdigit() and len(s) >= 15 else ""


# --------------------------------------------------------------------------- #
# demo → plain events (needs demoparser2)
# --------------------------------------------------------------------------- #
def open_demo(path: Path, work: Path) -> Path:
    with open(path, "rb") as f:
        head = f.read(8)
    if head.startswith(b"PBDEMS2"):
        return path
    if head.startswith(b"BZh"):
        out = work / (path.name.removesuffix(".bz2") or "demo.dem")
        with bz2.open(path, "rb") as src, open(out, "wb") as dst:
            shutil.copyfileobj(src, dst, length=1 << 20)
        return out
    if head.startswith(b"\x1f\x8b"):
        out = work / "demo.dem"
        with gzip.open(path, "rb") as src, open(out, "wb") as dst:
            shutil.copyfileobj(src, dst, length=1 << 20)
        return out
    if head.startswith(b"HL2DEMO"):
        raise ValueError("это демка CS:GO, а не CS2")
    raise ValueError("неизвестный формат демки")


def load_events(dem: Path) -> dict:
    """Everything compute() needs, as plain JSON-able lists (warmup already cut)."""
    from demoparser2 import DemoParser

    parser = DemoParser(str(dem))
    header = parser.parse_header()
    present = set(parser.list_game_events())

    def ev(name, **kw):
        if name not in present and name not in ("round_end", "round_start"):
            return None
        df = parser.parse_event(name, **kw)
        return df if hasattr(df, "columns") and len(df) else None

    ms = ev("round_announce_match_start")
    match_start = int(ms["tick"].max()) if ms is not None else 0
    fe = ev("round_freeze_end")
    freeze_ends = sorted(int(t) for t in fe["tick"]) if fe is not None else []
    re_df = ev("round_end")
    rounds = []
    if re_df is not None:
        seen = set()
        for _, r in re_df.sort_values("tick").iterrows():
            tick = int(r["tick"])
            win = sval(r.get("winner")).upper()
            winner = 3 if win in ("CT", "3") else 2 if win in ("T", "2", "TERRORIST") else 0
            if tick < match_start or not winner or tick in seen:
                continue
            seen.add(tick)
            prev_end = rounds[-1][1] if rounds else match_start - 1
            start = max((t for t in freeze_ends if prev_end < t <= tick), default=None)
            if start is None:
                start = max(prev_end + 1, match_start)
            rounds.append([start, tick, winner, sval(r.get("reason"))])
    if not rounds:
        raise ValueError("в демке не нашлось ни одного раунда")
    last_tick = rounds[-1][1]

    def in_match(df):
        return df[(df["tick"] >= match_start) & (df["tick"] <= last_tick + 5 * TICKRATE)] if df is not None else None

    # ---- who played which side, alive at round start / end --------------- #
    probe = sorted({r[0] for r in rounds} | {r[1] for r in rounds})
    tk = parser.parse_ticks(["team_num", "is_alive", "name"], ticks=probe)
    state = {}
    names = {}
    for _, r in tk.iterrows():
        sid = valid_sid(r["steamid"])
        if not sid:
            continue
        state[(sid, int(r["tick"]))] = (inum(r.get("team_num")), bval(r.get("is_alive")))
        if sval(r.get("name")):
            names[sid] = sval(r.get("name"))
    sids = sorted({k[0] for k in state})
    roster = {}
    for sid in sids:
        rows = []
        for (start, end, _w, _r) in rounds:
            t0 = state.get((sid, start), (0, False))
            t1 = state.get((sid, end), (t0[0], False))
            rows.append([t0[0], 1 if t0[1] else 0, 1 if t1[1] else 0])
        if any(x[0] in (2, 3) for x in rows):
            roster[sid] = rows

    # ---- per-player counters (game's own numbers) + rating --------------- #
    props = ["rank", "rank_if_win", "rank_if_loss", "rank_if_tie", "comp_rank_type", "comp_wins",
             "mvps", "score", "kills_total", "deaths_total", "assists_total", "headshot_kills_total",
             "damage_total", "utility_damage_total", "enemies_flashed_total", "3k_rounds_total",
             "4k_rounds_total", "ace_rounds_total", "team_num", "team_rounds_total",
             "is_matchmaking", "match_making_mode", "is_valve_dedicated_server"]
    first_tick = rounds[0][0]
    end_tick = last_tick + 2 * TICKRATE
    pt = parser.parse_ticks(props, ticks=[first_tick, last_tick, end_tick])
    players = {}
    mm = {}
    for _, r in pt.sort_values("tick").iterrows():
        sid = valid_sid(r["steamid"])
        if sid not in roster:
            continue
        p = players.setdefault(sid, {"name": names.get(sid, sval(r.get("name")))})
        if int(r["tick"]) == first_tick:
            p["r0"] = [inum(r.get("rank")), inum(r.get("rank_if_win")), inum(r.get("rank_if_loss")),
                       inum(r.get("rank_if_tie")), inum(r.get("comp_rank_type")), inum(r.get("comp_wins"))]
        else:
            p["r1"] = [inum(r.get("rank")), inum(r.get("rank_if_win")), inum(r.get("rank_if_loss")),
                       inum(r.get("rank_if_tie")), inum(r.get("comp_rank_type")), inum(r.get("comp_wins"))]
            p["c"] = {
                "k": inum(r.get("kills_total")), "d": inum(r.get("deaths_total")),
                "a": inum(r.get("assists_total")), "hs": inum(r.get("headshot_kills_total")),
                "dmg": inum(r.get("damage_total")), "ud": inum(r.get("utility_damage_total")),
                "ef": inum(r.get("enemies_flashed_total")), "mvp": inum(r.get("mvps")),
                "score": inum(r.get("score")), "3k": inum(r.get("3k_rounds_total")),
                "4k": inum(r.get("4k_rounds_total")), "5k": inum(r.get("ace_rounds_total")),
                "team": inum(r.get("team_num")), "tr": inum(r.get("team_rounds_total")),
            }
        mm = {"is_mm": bval(r.get("is_matchmaking")), "mode": inum(r.get("match_making_mode")),
              "valve_ds": bval(r.get("is_valve_dedicated_server"))}
    for sid in roster:
        players.setdefault(sid, {"name": names.get(sid, "")})

    # ---- events ----------------------------------------------------------- #
    deaths = []
    d = in_match(ev("player_death", player=["team_num"]))
    if d is not None:
        for _, e in d.sort_values("tick").iterrows():
            deaths.append([int(e["tick"]), valid_sid(e.get("attacker_steamid")), valid_sid(e.get("user_steamid")),
                           valid_sid(e.get("assister_steamid")), 1 if bval(e.get("headshot")) else 0,
                           1 if bval(e.get("assistedflash")) else 0, norm_weapon(e.get("weapon")),
                           inum(e.get("attacker_team_num")), inum(e.get("user_team_num")),
                           inum(e.get("assister_team_num"))])
    hurts = []
    h = in_match(ev("player_hurt", player=["team_num", "active_weapon_name"]))
    if h is not None:
        for _, e in h.sort_values("tick").iterrows():
            hurts.append([int(e["tick"]), valid_sid(e.get("attacker_steamid")), valid_sid(e.get("user_steamid")),
                          inum(e.get("dmg_health")), inum(e.get("health")), sval(e.get("hitgroup")),
                          norm_weapon(e.get("weapon"), sval(e.get("attacker_active_weapon_name"))),
                          inum(e.get("attacker_team_num")), inum(e.get("user_team_num"))])
    shots = []
    w = in_match(ev("weapon_fire"))
    if w is not None:
        for _, e in w.sort_values("tick").iterrows():
            wn = norm_weapon(e.get("weapon"))
            sid = valid_sid(e.get("user_steamid"))
            if sid and wn not in NON_GUN:
                shots.append([int(e["tick"]), sid, wn])
    blinds = []
    b = in_match(ev("player_blind", player=["team_num"]))
    if b is not None:
        for _, e in b.sort_values("tick").iterrows():
            blinds.append([int(e["tick"]), valid_sid(e.get("attacker_steamid")), valid_sid(e.get("user_steamid")),
                           round(fnum(e.get("blind_duration")), 2), inum(e.get("attacker_team_num")),
                           inum(e.get("user_team_num"))])

    return {
        "v": EVENTS_VERSION, "map": sval(header.get("map_name")).lower() or "unknown",
        "server": sval(header.get("server_name")), "tickrate": TICKRATE, "mm": mm,
        "start": match_start, "rounds": rounds, "roster": roster, "players": players,
        "deaths": deaths, "hurts": hurts, "shots": shots, "blinds": blinds,
    }


# --------------------------------------------------------------------------- #
# events → stats (pure python, unit-tested on tests/fixtures/*.events.json.gz)
# --------------------------------------------------------------------------- #
def round_of(rounds, tick):
    """index of the round an event belongs to: the last round that started at or before the tick
    (post-round kills before the next freeze end stay in the round that just ended)"""
    lo, hi, idx = 0, len(rounds) - 1, -1
    while lo <= hi:
        mid = (lo + hi) // 2
        if rounds[mid][0] <= tick:
            idx, lo = mid, mid + 1
        else:
            hi = mid - 1
    return idx


def new_stats():
    return {"k": 0, "d": 0, "a": 0, "hs": 0, "fa": 0, "fk": 0, "fd": 0, "tk": 0, "dmg": 0, "ud": 0,
            "shots": 0, "hits": 0, "hh": 0, "kast": 0, "ef": 0, "mk": Counter(), "cl": defaultdict(lambda: [0, 0]),
            "weapons": defaultdict(lambda: {"k": 0, "hs": 0, "shots": 0, "hits": 0, "dmg": 0})}


def compute(ev: dict, steamid: str) -> dict:
    rounds = ev["rounds"]
    roster = ev["roster"]
    n_rounds = len(rounds)
    tr = ev.get("tickrate") or TICKRATE
    trade_ticks = 5 * tr
    if steamid not in roster:
        raise KeyError(f"игрока {steamid} нет в этой демке")
    S = {sid: new_stats() for sid in roster}

    def side(sid, r):
        row = roster.get(sid)
        return row[r][0] if row and 0 <= r < len(row) else 0

    # owner's side per round (if he was away, the side of most of his final teammates)
    last = n_rounds - 1
    my_last = side(steamid, last) or next((side(steamid, r) for r in range(last, -1, -1) if side(steamid, r)), 0)
    mates = [s for s in roster if s != steamid and side(s, last) == my_last]
    my_side = []
    for r in range(n_rounds):
        s = side(steamid, r)
        if not s:
            votes = Counter(side(m, r) for m in mates if side(m, r))
            s = votes.most_common(1)[0][0] if votes else 0
        my_side.append(s)

    # ---- kills / deaths / assists, first kills, multikills, trades ------- #
    per_round_kills = defaultdict(Counter)       # r → sid → enemy kills
    involved = defaultdict(set)                  # r → sids with K/A/T
    died = defaultdict(dict)                     # r → sid → tick (deaths up to round end)
    first_done = set()
    deaths_by_round = defaultdict(list)
    for (tick, att, vic, ass, hs, fa, weapon, at, vt, ast) in ev["deaths"]:
        r = round_of(rounds, tick)
        if r < 0:
            continue
        start, end, _w, _reason = rounds[r]
        if vic in S:
            S[vic]["d"] += 1
            if tick <= end:
                died[r].setdefault(vic, tick)
        enemy = att in S and att != vic and at != vt and at in (2, 3)
        if enemy:
            a = S[att]
            a["k"] += 1
            a["hs"] += hs
            wpn = a["weapons"][weapon or "other"]
            wpn["k"] += 1
            wpn["hs"] += hs
            per_round_kills[r][att] += 1
            involved[r].add(att)
            if r not in first_done and start <= tick <= end:
                first_done.add(r)
                a["fk"] += 1
                if vic in S:
                    S[vic]["fd"] += 1
        if ass in S and ast != vt and ass != vic:
            S[ass]["a"] += 1
            S[ass]["fa"] += fa
            involved[r].add(ass)
        if tick <= end:
            deaths_by_round[r].append((tick, att, vic, at, vt, enemy))

    # trades: victim V killed by K; K killed by V's teammate within 5 s → V traded, teammate gets a trade kill
    for r, lst in deaths_by_round.items():
        for i, (tick, att, vic, at, vt, enemy) in enumerate(lst):
            if not enemy:
                continue
            for (t2, att2, vic2, at2, vt2, enemy2) in lst[i + 1:]:
                if t2 - tick > trade_ticks:
                    break
                if enemy2 and vic2 == att and at2 == vt:
                    involved[r].add(vic)
                    S[att2]["tk"] += 1
                    break

    for r, ks in per_round_kills.items():
        for sid, n in ks.items():
            if n >= 2:
                S[sid]["mk"][str(min(n, 5))] += 1

    # ---- KAST, clutches -------------------------------------------------- #
    for r, (start, end, winner, _reason) in enumerate(rounds):
        for sid in S:
            row = roster[sid][r]
            if row[0] not in (2, 3):
                continue
            survived = row[1] and row[2] and sid not in died[r]
            if survived or sid in involved[r]:
                S[sid]["kast"] += 1
        alive = {2: set(), 3: set()}
        for sid in S:
            row = roster[sid][r]
            if row[0] in (2, 3) and row[1]:
                alive[row[0]].add(sid)
        clutch = {}
        for (tick, att, vic, at, vt, enemy) in deaths_by_round.get(r, []):
            for t in (2, 3):
                alive[t].discard(vic)
            for t in (2, 3):
                other = 5 - t
                if t not in clutch and len(alive[t]) == 1 and alive[other]:
                    clutch[t] = (next(iter(alive[t])), len(alive[other]))
        for t, (sid, vs) in clutch.items():
            c = S[sid]["cl"][str(min(vs, 5))]
            c[0] += 1
            c[1] += 1 if winner == t else 0

    # ---- damage (capped at remaining HP), utility, hits ------------------ #
    hp = {}
    cur = None
    hit_keys = set()
    for (tick, att, vic, dmg, health, hitgroup, weapon, at, vt) in ev["hurts"]:
        r = round_of(rounds, tick)
        if r != cur:
            hp, cur = {}, r
        # dmg_health is the raw hit, truncated to an int (a 100-HP headshot can say 140, and float
        # damage makes HP drop by dmg_health+1 now and then). HP actually removed = HP before (tracked
        # per round from the previous events) − health after; if the chain looks broken, cap the raw hit.
        before = hp.get(vic, 100)
        removed = before - max(0, health)
        if health <= 0:
            real = min(dmg, before) if removed > dmg + 2 else removed
        else:
            real = removed if dmg <= removed <= dmg + 2 else dmg
        real = max(0, real)
        hp[vic] = max(0, health)
        if att not in S or att == vic or at == vt or at not in (2, 3):
            continue
        a = S[att]
        a["dmg"] += real
        if weapon in UTIL_DAMAGE:
            a["ud"] += real
        wpn = a["weapons"][weapon or "other"]
        wpn["dmg"] += real
        if weapon not in NON_GUN:
            key = (tick, att, vic)
            if key not in hit_keys:
                hit_keys.add(key)
                a["hits"] += 1
                wpn["hits"] += 1
                if hitgroup == "head":
                    a["hh"] += 1

    for (tick, sid, weapon) in ev["shots"]:
        if sid in S:
            S[sid]["shots"] += 1
            S[sid]["weapons"][weapon]["shots"] += 1

    # ---- enemies flashed: game counter, else player_blind ---------------- #
    players = ev.get("players", {})
    blinded = Counter()
    for (tick, att, vic, dur, at, vt) in ev.get("blinds", []):
        if att in S and vic != att and at != vt and dur >= 0.1:
            blinded[att] += 1
    for sid in S:
        c = players.get(sid, {}).get("c")
        S[sid]["ef"] = c["ef"] if c and "ef" in c else blinded[sid]

    # ---- score / result -------------------------------------------------- #
    us = sum(1 for r, x in enumerate(rounds) if my_side[r] and x[2] == my_side[r])
    them = sum(1 for r, x in enumerate(rounds) if my_side[r] and x[2] != my_side[r])
    rh = "".join("W" if my_side[r] and x[2] == my_side[r] else "L" for r, x in enumerate(rounds))
    result = "W" if us > them else "L" if us < them else "T"

    # ---- rating ---------------------------------------------------------- #
    def ranks(sid):
        p = players.get(sid, {})
        r0, r1 = p.get("r0") or [0] * 6, p.get("r1") or [0] * 6
        return r0 if r0[0] or r0[4] > 0 else r1
    types = Counter(ranks(s)[4] for s in roster if ranks(s)[4] and ranks(s)[4] > 0)
    rank_type = types.most_common(1)[0][0] if types else 0
    mode = RANK_TYPES.get(rank_type)
    if not mode:
        n_active = sum(1 for s in roster if side(s, last) in (2, 3))
        mm = ev.get("mm") or {}
        mode = "wingman" if n_active <= 4 and mm.get("is_mm") else "competitive" if mm.get("is_mm") else "other"
    rating = None
    mr = ranks(steamid)
    if mr[4] and mr[4] > 0 and (mr[0] or mr[1]):
        after = {"W": mr[1], "L": mr[2], "T": mr[3]}[result] or None
        before = mr[0] or None
        rating = {"type": RANK_TYPES.get(mr[4], str(mr[4])), "before": before, "after": after,
                  "delta": (after - before) if before and after else None, "pred": True, "wins": mr[5]}

    # ---- output ---------------------------------------------------------- #
    def pct(a, b, nd=1):
        return round(100.0 * a / b, nd) if b else 0.0

    def finish(sid, full):
        s = S[sid]
        out = {"k": s["k"], "d": s["d"], "a": s["a"], "hs": s["hs"],
               "mvp": (players.get(sid, {}).get("c") or {}).get("mvp", 0),
               "score": (players.get(sid, {}).get("c") or {}).get("score", 0),
               "adr": round(s["dmg"] / n_rounds, 1) if n_rounds else 0.0,
               "kast": pct(s["kast"], n_rounds), "fk": s["fk"], "ud": s["ud"]}
        if full:
            out.update({"dmg": s["dmg"], "fa": s["fa"], "ef": s["ef"], "fd": s["fd"], "tk": s["tk"],
                        "mk": {k: s["mk"].get(k, 0) for k in ("2", "3", "4", "5")},
                        "cl": {k: v for k, v in sorted(s["cl"].items())},
                        "shots": s["shots"], "hits": s["hits"], "hh": s["hh"], "acc": pct(s["hits"], s["shots"]),
                        "weapons": {w: v for w, v in sorted(s["weapons"].items(), key=lambda kv: (-kv[1]["k"], -kv[1]["dmg"]))
                                    if v["k"] or v["shots"] or v["dmg"]}})
        return out

    my_final = side(steamid, last) or my_last
    rows = []
    for sid in roster:
        sd = side(sid, last) or next((side(sid, r) for r in range(last, -1, -1) if side(sid, r)), 0)
        if not sd:
            continue
        team = 0 if sid == steamid or sd == my_final else 1
        p = finish(sid, False)
        p.update({"sid": sid, "name": players.get(sid, {}).get("name") or "", "team": team, "rank": ranks(sid)[0] or None})
        rows.append(p)
    rows.sort(key=lambda p: (p["team"], -p["score"], -p["k"]))
    me = finish(steamid, True)
    duration = round((rounds[-1][1] - ev.get("start", rounds[0][0])) / tr) if rounds else 0
    return {
        "map": ev.get("map") or "unknown", "mode": mode, "duration": duration, "rounds": n_rounds,
        "score": [us, them], "result": result, "rh": rh, "rating": rating,
        "me": me, "players": rows, "demo": True,
        "name": players.get(steamid, {}).get("name") or "",
    }


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main(argv=None):
    ap = argparse.ArgumentParser(description="CS2 demo → статистика матча (JSON)")
    ap.add_argument("demo", help=".dem / .dem.bz2 / .events.json.gz")
    ap.add_argument("--steamid", help="SteamID64 игрока, для которого считать «me»")
    ap.add_argument("--out", help="куда записать JSON (по умолчанию stdout)")
    ap.add_argument("--dump-events", help="сохранить разобранные события (фикстура для тестов) и выйти")
    args = ap.parse_args(argv)

    src = Path(args.demo)
    if src.name.endswith(".events.json.gz"):
        with gzip.open(src, "rt", encoding="utf-8") as f:
            ev = json.load(f)
    else:
        work = Path(tempfile.mkdtemp(prefix="match_"))
        try:
            ev = load_events(open_demo(src, work))
        finally:
            shutil.rmtree(work, ignore_errors=True)
    if args.dump_events:
        with gzip.open(args.dump_events, "wt", encoding="utf-8") as f:
            json.dump(ev, f, separators=(",", ":"))
        log(f"events → {args.dump_events}")
        return 0
    if not args.steamid:
        ap.error("нужен --steamid")
    res = compute(ev, args.steamid)
    text = json.dumps(res, ensure_ascii=False, separators=(",", ":"))
    if args.out:
        tmp = args.out + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, args.out)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
