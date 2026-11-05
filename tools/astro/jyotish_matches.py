#!/usr/bin/env python3
"""Джйотиш (ведическая астрология) против 6 тысяч про-матчей CS (S/A-тир, ноябрь 2021 – ноябрь 2026).

Ведическая система: сидерический зодиак (айанамша Лахири), управители знаков без высших планет, дома «знак =
дом» от асцендента, достоинства по Парашаре (экзальтация, свой знак, дружественный/вражеский, падение),
сожжённость Солнцем; накшатры, титхи, Раху и Кету (средний лунный узел), Раху-кала.

A. Прашна (карта на момент начала матча) — прямой прогноз победителя. Только LAN-матчи с известным городом
   (асцендент зависит от места). 1-й дом — первая команда, 7-й — вторая; сила управителя дома =
   достоинство + дом (кендра +2, трикона +1, дустхана −2) − сожжённость (−2) ± правило «управитель 1-го в 7-м /
   управитель 7-го в 1-м». Побеждает команда с более сильным управителем. Две заранее заданные привязки:
   (i) 1-й дом = команда, записанная первой на Liquipedia; (ii) 1-й дом = фаворит по Эло.
   Метрики: точность прогноза против перестановочного нуля (прогнозы перемешаны между матчами — сохраняется
   доля побед первой команды и доля прогнозов) и вклад сверх Эло (знак прогноза против остатка «победа −
   вероятность по Эло»), проверка воспроизводимости на первых 60% / последних 40% периода.
B. Мухурта (качество времени) — симметричные исходы, как в прошлой проверке: доля апсетов сверх ожидания по
   Эло и доля близких карт. Факторы: группы титхи (Нанда, Бхадра, Джайя, Рикта, Пурна), амавасья, накшатра
   Луны (27) и её класс по природе (7), Луна в сидерическом знаке (12), Луна в соединении с Раху/Кету,
   Раху-кала в городе турнира (LAN), управитель дня недели (7). Ноль — перестановка значений фактора между
   матчами внутри одного турнира; поправка Бенджамини–Хохберга; воспроизводимость.

  python3 tools/astro/jyotish_matches.py --hist store/matches-hist --out store/astro-jyotish
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from astrolib import bh  # noqa: E402
from matches_astro import map_flags, prepare_matches  # noqa: E402

PLANETS = ["Sun", "Moon", "Mars", "Mercury", "Jupiter", "Venus", "Saturn"]
PL_RU = {"Sun": "Солнце", "Moon": "Луна", "Mars": "Марс", "Mercury": "Меркурий", "Jupiter": "Юпитер", "Venus": "Венера", "Saturn": "Сатурн"}
SIGNS_RU = ["Меша (Овен)", "Вришабха (Телец)", "Митхуна (Близнецы)", "Карка (Рак)", "Симха (Лев)", "Канья (Дева)", "Тула (Весы)",
            "Вришчика (Скорпион)", "Дхану (Стрелец)", "Макара (Козерог)", "Кумбха (Водолей)", "Мина (Рыбы)"]
LORD = ["Mars", "Venus", "Mercury", "Moon", "Sun", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Saturn", "Jupiter"]
EXALT = {"Sun": 0, "Moon": 1, "Mars": 9, "Mercury": 5, "Jupiter": 3, "Venus": 11, "Saturn": 6}
FRIENDS = {"Sun": {"Moon", "Mars", "Jupiter"}, "Moon": {"Sun", "Mercury"}, "Mars": {"Sun", "Moon", "Jupiter"}, "Mercury": {"Sun", "Venus"},
           "Jupiter": {"Sun", "Moon", "Mars"}, "Venus": {"Mercury", "Saturn"}, "Saturn": {"Mercury", "Venus"}}
ENEMIES = {"Sun": {"Venus", "Saturn"}, "Moon": set(), "Mars": {"Mercury"}, "Mercury": {"Moon"}, "Jupiter": {"Mercury", "Venus"},
           "Venus": {"Sun", "Moon"}, "Saturn": {"Sun", "Moon", "Mars"}}
COMBUST = {"Moon": 12, "Mars": 17, "Mercury": 14, "Jupiter": 11, "Venus": 10, "Saturn": 15}
NAK_RU = ["Ашвини", "Бхарани", "Криттика", "Рохини", "Мригашира", "Ардра", "Пунарвасу", "Пушья", "Ашлеша", "Магха", "Пурва-пхалгуни",
          "Уттара-пхалгуни", "Хаста", "Читра", "Свати", "Вишакха", "Анурадха", "Джйештха", "Мула", "Пурва-ашадха", "Уттара-ашадха",
          "Шравана", "Дхаништха", "Шатабхиша", "Пурва-бхадрапада", "Уттара-бхадрапада", "Ревати"]
# nature of nakshatras (Muhurta): fixed, movable, fierce, mixed, light/swift, soft, sharp
NAK_CLASS = {0: "Лагху", 1: "Угра", 2: "Мишра", 3: "Дхрува", 4: "Мриду", 5: "Тикшна", 6: "Чара", 7: "Лагху", 8: "Тикшна", 9: "Угра",
             10: "Угра", 11: "Дхрува", 12: "Лагху", 13: "Мриду", 14: "Чара", 15: "Мишра", 16: "Мриду", 17: "Тикшна", 18: "Тикшна",
             19: "Угра", 20: "Дхрува", 21: "Чара", 22: "Чара", 23: "Чара", 24: "Угра", 25: "Дхрува", 26: "Мриду"}
TITHI_GROUP = ["Нанда", "Бхадра", "Джайя", "Рикта", "Пурна"]
VARA = ["Луна (понедельник)", "Марс (вторник)", "Меркурий (среда)", "Юпитер (четверг)", "Венера (пятница)", "Сатурн (суббота)", "Солнце (воскресенье)"]
RAHU_PART = {0: 1, 1: 6, 2: 4, 3: 5, 4: 3, 5: 2, 6: 7}  # weekday (Mon=0) → which eighth of daylight is Rahu kala (0-based)
CITY = {
    "Bucharest": (44.43, 26.10), "Saint Julian's": (35.92, 14.49), "St. Julian's": (35.92, 14.49), "Copenhagen": (55.68, 12.57),
    "Katowice": (50.26, 19.02), "Cologne": (50.94, 6.96), "Shanghai": (31.23, 121.47), "Dallas": (32.78, -96.80), "Belgrade": (44.79, 20.45),
    "Stockholm": (59.33, 18.07), "Rio de Janeiro": (-22.91, -43.17), "Barcelona": (41.39, 2.17), "Astana": (51.17, 71.45),
    "Naxxar": (35.91, 14.44), "Melbourne": (-37.81, 144.96), "Abu Dhabi": (24.45, 54.38), "Paris": (48.86, 2.35), "Düsseldorf": (51.23, 6.77),
    "Atlanta": (33.75, -84.39), "Espoo": (60.21, 24.66), "Chengdu": (30.57, 104.07), "Riyadh": (24.71, 46.68), "Kraków": (50.06, 19.94),
    "Attard": (35.89, 14.44), "Lisbon": (38.72, -9.14), "Cluj-Napoca": (46.77, 23.60), "Rotterdam": (51.92, 4.48), "Guangzhou": (23.13, 113.26),
    "Budapest": (47.50, 19.04), "Sydney": (-33.87, 151.21), "Porto": (41.15, -8.61), "Suzhou": (31.30, 120.59), "Warsaw": (52.23, 21.01),
    "Jönköping": (57.78, 14.16), "Ulaanbaatar": (47.89, 106.91), "Beijing": (39.90, 116.41), "Valencia": (39.47, -0.38), "Mumbai": (19.08, 72.88),
    "Monterrey": (25.69, -100.32), "Dubai": (25.20, 55.27), "London": (51.51, -0.13), "Washington, D.C.": (38.91, -77.04),
    "Buenos Aires": (-34.60, -58.38), "Sentosa": (1.25, 103.83), "Chek Lap Kok": (22.31, 113.92), "Fort Worth": (32.76, -97.33),
    "Lund": (55.70, 13.19), "Yancheng": (33.35, 120.16), "Malta": (35.90, 14.48), "Berlin": (52.52, 13.40), "Hamburg": (53.55, 9.99),
    "Leipzig": (51.34, 12.37), "Austin": (30.27, -97.74), "Antwerp": (51.22, 4.40), "Montreal": (45.50, -73.57), "Malmö": (55.60, 13.00),
    "Las Vegas": (36.17, -115.14), "Tallinn": (59.44, 24.75), "Riga": (56.95, 24.11), "Kyiv": (50.45, 30.52), "Moscow": (55.76, 37.62),
}


def ayanamsa(when: dt.datetime) -> float:
    """Lahiri ayanamsa, degrees (23°51′11″ at J2000, precession 50.29″/year — accurate to ~0.01° for these years)"""
    yrs = (when - dt.datetime(2000, 1, 1, 12)).total_seconds() / (365.25 * 86400)
    return 23.8531 + 0.0139689 * yrs


def mean_node(when: dt.datetime) -> float:
    T = ((when - dt.datetime(2000, 1, 1, 12)).total_seconds() / 86400) / 36525
    return (125.0445479 - 1934.1362891 * T + 0.0020754 * T * T) % 360


def chart(when: dt.datetime, lat=None, lon=None):
    import ephem
    d = ephem.Date(when)
    ay = ayanamsa(when)
    pos = {}
    for p in PLANETS:
        b = getattr(ephem, p)()
        b.compute(d, epoch=d)
        pos[p] = (math.degrees(ephem.Ecliptic(b, epoch=d).lon) - ay) % 360
    pos["Rahu"] = (mean_node(when) - ay) % 360
    pos["Ketu"] = (pos["Rahu"] + 180) % 360
    asc = None
    if lat is not None:
        o = ephem.Observer()
        o.lat, o.lon, o.date = str(lat), str(lon), d
        ramc = float(o.sidereal_time())
        T = ((when - dt.datetime(2000, 1, 1, 12)).total_seconds() / 86400) / 36525
        eps = math.radians(23.4392911 - 0.0130042 * T)
        phi = math.radians(lat)
        a = math.degrees(math.atan2(math.cos(ramc), -(math.sin(ramc) * math.cos(eps) + math.tan(phi) * math.sin(eps))))
        asc = (a - ay) % 360
    return pos, asc


def dignity(p: str, sign: int) -> int:
    if EXALT[p] == sign:
        return 4
    if (EXALT[p] + 6) % 12 == sign:
        return -4
    lord = LORD[sign]
    if lord == p:
        return 3
    if lord in FRIENDS[p]:
        return 1
    if lord in ENEMIES[p]:
        return -1
    return 0


def lord_strength(p: str, pos: dict, asc_sign: int, house_from_asc: int) -> int:
    sign = int(pos[p] // 30)
    h = (sign - asc_sign) % 12 + 1
    s = dignity(p, sign)
    s += 2 if h in (1, 4, 7, 10) else 1 if h in (5, 9) else -2 if h in (6, 8, 12) else 0
    if p != "Sun" and abs((pos[p] - pos["Sun"] + 540) % 360 - 180) < COMBUST[p]:
        s -= 2
    return s


def prashna(pos: dict, asc: float) -> int:
    """>0: 1st-house side wins, <0: 7th-house side wins, 0: no verdict"""
    a = int(asc // 30)
    l1, l7 = LORD[a], LORD[(a + 6) % 12]
    s1, s7 = lord_strength(l1, pos, a, 1), lord_strength(l7, pos, a, 7)
    h1 = (int(pos[l1] // 30) - a) % 12 + 1
    h7 = (int(pos[l7] // 30) - a) % 12 + 1
    if h1 == 7:
        s1 -= 2  # lord of the 1st in the opponent's house: «отдаётся во власть соперника»
    if h7 == 1:
        s1 += 2  # lord of the 7th comes to the 1st: the opponent «приходит сдаваться»
    return int(np.sign(s1 - s7))


def rahu_kala(when: dt.datetime, lat, lon) -> bool:
    import ephem
    o = ephem.Observer()
    o.lat, o.lon = str(lat), str(lon)
    local = when + dt.timedelta(hours=lon / 15)  # mean solar time at the venue
    o.date = ephem.Date(dt.datetime(local.year, local.month, local.day) - dt.timedelta(hours=lon / 15))  # local midnight, UTC
    try:
        rise = o.next_rising(ephem.Sun()).datetime()
        o.date = ephem.Date(rise)
        sset = o.next_setting(ephem.Sun()).datetime()
    except (ephem.AlwaysUpError, ephem.NeverUpError):
        return False
    local_day = local.weekday()
    part = (sset - rise) / 8
    start = rise + part * RAHU_PART[local_day]
    return start <= when < start + part


def perm_p(obs, null):
    null = np.asarray(null)
    return float((np.sum(np.abs(null - null.mean()) >= abs(obs - null.mean())) + 1) / (len(null) + 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hist", default="store/matches-hist")
    ap.add_argument("--out", default="store/astro-jyotish")
    ap.add_argument("--perms", type=int, default=5000)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    log = lambda *x: print(*x, flush=True)  # noqa: E731
    df, st = prepare_matches(Path(a.hist), log)
    tl = json.loads((Path(a.hist) / "tournaments.json").read_text())["list"]

    def tinfo(page):
        x = tl.get(page) or tl.get(page.split("/")[0]) or {}
        return x.get("t") or {}
    m = df[df["eligible"] & df["ts"].notna()].copy().sort_values("ts").reset_index(drop=True)
    m["when"] = [dt.datetime(1970, 1, 1) + dt.timedelta(seconds=float(t)) for t in m["ts"]]
    m["city"] = [tinfo(p).get("city") for p in m["tour"]]
    m["root"] = [p.split("/")[0] for p in m["tour"]]
    coords = [CITY.get(c) if (isinstance(c, str) and l is True) else None for c, l in zip(m["city"], m["lan"])]
    log(f"матчей: {len(m)}, LAN с известным городом: {sum(c is not None for c in coords)}")

    rows = []
    for i, r in m.iterrows():
        c = coords[i]
        pos, asc = chart(r["when"], *(c if c else (None, None)))
        elong = (pos["Moon"] - pos["Sun"]) % 360
        tithi = int(elong // 12)  # 0..29
        nak = int(pos["Moon"] // (360 / 27))
        node_sep = min(abs((pos["Moon"] - pos["Rahu"] + 540) % 360 - 180), abs((pos["Moon"] - pos["Ketu"] + 540) % 360 - 180))
        rows.append({
            "prashna": prashna(pos, asc) if asc is not None else 0, "has_asc": asc is not None,
            "tithi": tithi, "tithi_group": TITHI_GROUP[tithi % 15 % 5] if tithi % 15 != 14 else "Пурна",
            "amavasya": tithi == 29, "nak": nak, "nak_class": NAK_CLASS[nak], "moon_sign": int(pos["Moon"] // 30),
            "moon_node": node_sep < 12, "rahu_kala": rahu_kala(r["when"], *c) if c else None,
            "vara": ((r["when"] + dt.timedelta(hours=(c[1] / 15 if c else 0))).weekday()),
        })
    J = pd.DataFrame(rows)
    m = pd.concat([m, J], axis=1)
    m["y1"] = (m["winner"] == 1).astype(float)
    m["close"] = [np.mean(f) if (f := map_flags(mp, d)) else np.nan for mp, d in zip(m["maps"], m["date"])]
    split = int(len(m) * 0.6)
    rng = np.random.default_rng(20261105)

    # ---------------- A. prashna -----------------------------------------------------------------------------
    A = []
    lanm = m[m["has_asc"] & (m["prashna"] != 0)].reset_index(drop=True)
    for mode in ("first", "favorite"):
        pred = lanm["prashna"].to_numpy().astype(float)  # +1 → 1st house wins
        if mode == "first":
            win1 = lanm["y1"].to_numpy()
            p_elo = lanm["p1"].to_numpy()
        else:  # 1st house = Elo favourite
            win1 = (lanm["winner"] == lanm["fav"]).astype(float).to_numpy()
            p_elo = lanm["fav_p"].to_numpy()
        hit = ((pred > 0) == (win1 == 1)).astype(float)
        acc = hit.mean()
        resid = win1 - p_elo
        beyond = float(np.mean(pred * resid))
        nullacc, nullbey = [], []
        for _ in range(a.perms):
            pp = rng.permutation(pred)
            nullacc.append(((pp > 0) == (win1 == 1)).mean())
            nullbey.append(np.mean(pp * resid))
        n = len(pred)
        h1, h2 = hit[: int(n * 0.6)].mean(), hit[int(n * 0.6):].mean()
        A.append({"mode": mode, "n": n, "acc": float(acc), "acc_null": float(np.mean(nullacc)), "acc_null_sd": float(np.std(nullacc)),
                  "p_acc": perm_p(acc, nullacc), "beyond_elo": beyond, "beyond_null_sd": float(np.std(nullbey)), "p_beyond": perm_p(beyond, nullbey),
                  "acc_first60": float(h1), "acc_last40": float(h2), "elo_acc": float(((p_elo > 0.5) == (win1 == 1)).mean()),
                  "mde_acc": float(2.8 * np.std(nullacc))})
    log("прашна:", json.dumps(A, ensure_ascii=False))

    # ---------------- B. muhurta factors (symmetric outcomes) ---------------------------------------------------
    feats = {}
    for g in TITHI_GROUP:
        feats[f"Титхи группы {g}"] = (m["tithi_group"] == g).to_numpy()
    feats["Амавасья (новолуние)"] = m["amavasya"].to_numpy()
    for k in range(27):
        feats[f"Луна в накшатре {NAK_RU[k]}"] = (m["nak"] == k).to_numpy()
    for c in sorted(set(NAK_CLASS.values())):
        feats[f"Накшатра класса {c}"] = (m["nak_class"] == c).to_numpy()
    for s in range(12):
        feats[f"Луна в знаке {SIGNS_RU[s]}"] = (m["moon_sign"] == s).to_numpy()
    feats["Луна рядом с Раху/Кету (≤12°)"] = m["moon_node"].to_numpy()
    for v in range(7):
        feats[f"День {VARA[v]}"] = (m["vara"] == v).to_numpy()
    rk = m["rahu_kala"]
    roots = m["root"].to_numpy()
    groups = defaultdict(list)
    for i, r in enumerate(roots):
        groups[r].append(i)
    gidx = [np.array(v) for v in groups.values()]

    def within_perm(f):
        g = f.copy()
        for ix in gidx:
            g[ix] = f[rng.permutation(ix)]
        return g

    B = []
    outcomes = {"upset": m["excess"].to_numpy(), "close": m["close"].to_numpy()}
    tests = list(feats.items()) + [("Начало матча в Раху-калу (LAN)", None)]
    for name, f in tests:
        for oname, y in outcomes.items():
            if f is None:
                ok = rk.notna().to_numpy() & ~np.isnan(y)
                ff = rk.fillna(False).to_numpy().astype(bool)
            else:
                ok = ~np.isnan(y)
                ff = f.astype(bool)
            k = int(ff[ok].sum())
            if k < 30 or ok.sum() - k < 30:
                continue

            def stat(fv, sl=slice(None)):
                yy, okk, fvv = y[sl], ok[sl], fv[sl]
                a_, b_ = yy[okk & fvv], yy[okk & ~fvv]
                return (a_.mean() - b_.mean()) if len(a_) >= 10 and len(b_) >= 10 else np.nan
            obs = stat(ff)
            null = [stat(within_perm(ff)) for _ in range(1000)]
            null = [x for x in null if x == x]
            first, last = slice(0, split), slice(split, None)
            o1, o2 = stat(ff, first), stat(ff, last)
            n1 = [stat(within_perm(ff), first) for _ in range(300)]
            n2 = [stat(within_perm(ff), last) for _ in range(300)]
            p1_ = perm_p(o1, [x for x in n1 if x == x]) if o1 == o1 else 1.0
            p2_ = perm_p(o2, [x for x in n2 if x == x]) if o2 == o2 else 1.0
            B.append({"factor": name, "outcome": oname, "n": k, "diff": float(obs), "null_sd": float(np.std(null)), "mde": float(2.8 * np.std(null)),
                      "p": perm_p(obs, null), "p_first": p1_, "p_last": p2_,
                      "replicates": bool(p1_ < 0.05 and p2_ < 0.05 and np.sign(o1) == np.sign(o2))})
    for r, q in zip(B, bh([r["p"] for r in B])):
        r["q"] = q
    B.sort(key=lambda r: r["p"])
    summary = {
        "matches": len(m), "lan_with_city": int(m["has_asc"].sum()), "prashna_verdicts": int(len(lanm)),
        "period": [str(m["date"].min()), str(m["date"].max())], "tests_muhurta": len(B),
        "raw_p05": sum(r["p"] < 0.05 for r in B), "expected": round(len(B) * 0.05, 1), "fdr_q10": sum(r["q"] < 0.1 for r in B),
        "replicated": sum(r["replicates"] for r in B), "upset_rate": float(m["upset"].mean()), "close_rate": float(np.nanmean(m["close"])),
        "rahu_kala_matches": int(rk.fillna(False).sum()), "first_team_win": float(m["y1"].mean()),
    }
    (out / "results.json").write_text(json.dumps({"summary": summary, "prashna": A, "muhurta": B}, ensure_ascii=False, indent=1, default=str))
    log(json.dumps(summary, ensure_ascii=False))
    for r in B[:10]:
        log(f"{r['p']:.4f} q={r['q']:.2f} rep={r['replicates']} {r['outcome']:6s} {r['factor']} (n={r['n']}) diff={r['diff']:+.4f} порог {r['mde']:.4f}")
    plot(A, B, summary, out)


def plot(A, B, summary, out: Path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
    fig, axs = plt.subplots(1, 2, figsize=(13, 4.6), gridspec_kw={"width_ratios": [1, 1.5]})
    ax = axs[0]
    labels, vals, nulls, sds, elo = [], [], [], [], []
    for r in A:
        labels.append("1-й дом = первая\nкоманда" if r["mode"] == "first" else "1-й дом =\nфаворит по Эло")
        vals.append(r["acc"] * 100)
        nulls.append(r["acc_null"] * 100)
        sds.append(r["acc_null_sd"] * 100)
        elo.append(r["elo_acc"] * 100)
    x = np.arange(len(A))
    ax.bar(x - 0.2, vals, 0.38, color="#e8650c", label="прашна (джйотиш)")
    ax.bar(x + 0.2, elo, 0.38, color="#4e8ddb", label="рейтинг Эло")
    ax.errorbar(x - 0.2, nulls, yerr=[1.96 * s for s in sds], fmt="_", color="#222", ms=22, lw=1.2, label="случайный прогноз (95%)")
    ax.set_xticks(x)
    ax.set_xticklabels(labels)
    ax.set_ylim(40, 75)
    ax.set_ylabel("угадано победителей, %")
    ax.set_title(f"Прогноз победителя по карте начала матча\n{A[0]['n']} LAN-матчей")
    ax.legend(frameon=False, fontsize=8, loc="upper left")
    ax = axs[1]
    top = [r for r in B if r["outcome"] == "upset"]
    top = sorted(top, key=lambda r: r["p"])[:14]
    y = np.arange(len(top))[::-1]
    ax.axvspan(-1.96, 1.96, color="#e3e6ea", lw=0)
    for yy, r in zip(y, top):
        z = r["diff"] / r["null_sd"] if r["null_sd"] else 0
        ax.plot(z, yy, "o", color="#e8650c" if r["q"] < 0.1 else "#3a4150")
        ax.text(4.4, yy, f"q = {r['q']:.2f}", va="center", ha="right", fontsize=8, color="#6b7380")
    ax.set_yticks(y)
    ax.set_yticklabels([f"{r['factor']} ({r['n']})" for r in top], fontsize=8)
    ax.set_xlim(-4.5, 4.5)
    ax.axvline(0, color="#888", lw=0.8)
    ax.set_xlabel("апсеты сверх Эло, в единицах случайного разброса (серое — 95%)")
    ax.set_title(f"Мухурта: 14 самых «значимых» из {summary['tests_muhurta']} проверок")
    fig.tight_layout()
    fig.savefig(out / "jyotish.png", dpi=150)
    plt.close(fig)


if __name__ == "__main__":
    main()
