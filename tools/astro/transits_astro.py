#!/usr/bin/env python3
"""Транзиты к натальным картам игроков в день матча: есть ли связь с игрой и результатом карты.

Гипотеза (как её формулируют в астрологии): в день матча у игрока «хорошие» транзиты — благоприятные
аспекты Юпитера, Венеры и Солнца к его натальным Солнцу, Марсу и Меркурию — он играет лучше, а «тяжёлые» —
квадраты и оппозиции Сатурна, Марса, Урана, Нептуна, Плутона (и соединение Сатурна) — хуже. Команда, у которой
сумма транзитов лучше, чаще выигрывает карту.

Данные: демки OpenCS2 (кто играл каждую карту, убийства, ADR), даты рождения с Liquipedia (только игроки,
у которых steam64ID на странице совпадает с аккаунтом в демке — их отбирает matches_astro.match_players).
Время рождения неизвестно → натальная Луна не используется; время матча — полдень дня (транзитная Луна тоже
не используется: за 12 часов она уходит на 6–7°).

Заранее зафиксированные проверки (список не меняется после взгляда на данные):
  T1 ADR игрока относительно его собственного среднего ~ индекс транзитов S = хорошие − тяжёлые
  T2 убийства за раунд относительно своего среднего ~ S
  T3 разница убийств команд на карте (поправка на силу команд) ~ разница средних S команд
  T4 «выигрыш» карты (у кого больше убийств) ~ знак разницы S
  T5 Марс в соединении с натальным Марсом → убийства за раунд
  T6 тяжёлый транзит Сатурна к натальному Солнцу → ADR
  T7 благоприятный транзит Юпитера к натальному Солнцу → ADR
Ноль: даты рождения случайно переставляются между игроками (5000 раз) — сохраняется всё (кто, когда и как
играл, распределение транзитов), разрывается только связь «эта карта рождения — этот игрок».
Поправка Бенджамини–Хохберга на 7 проверок; минимальный обнаружимый эффект = 2.8 × разброс нуля.

  python3 tools/astro/transits_astro.py --players store/nades-site/players --pl store/matches-hist/players.json --out store/astro-transits
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from astrolib import bh, natal_longitudes  # noqa: E402
from matches_astro import match_players  # noqa: E402

NATAL = ["Sun", "Mercury", "Mars"]
NATAL_ALL = ["Sun", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"]
TRANSIT = ["Sun", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"]
GOOD_T, GOOD_A = {"Jupiter", "Venus", "Sun"}, {0, 60, 120}
BAD_T, BAD_A = {"Saturn", "Mars", "Uranus", "Neptune", "Pluto"}, {90, 180}
ORB = 3.0


def asp(a: float, b: float):
    sep = abs((a - b + 540) % 360 - 180)
    for ang in (0, 60, 90, 120, 180):
        if abs(sep - ang) <= ORB:
            return ang
    return None


def transit_features(nat: dict, tr: dict):
    good = bad = 0
    mars_mars = sat_sun_hard = jup_sun_soft = 0
    for t in TRANSIT:
        for n in NATAL:
            a = asp(tr[t], nat[n])
            if a is None:
                continue
            if t in GOOD_T and a in GOOD_A:
                good += 1
            if (t in BAD_T and a in BAD_A) or (t == "Saturn" and a == 0):
                bad += 1
        if t == "Mars" and asp(tr["Mars"], nat["Mars"]) == 0:
            mars_mars = 1
    a = asp(tr["Saturn"], nat["Sun"])
    sat_sun_hard = int(a in (0, 90, 180))
    a = asp(tr["Jupiter"], nat["Sun"])
    jup_sun_soft = int(a in (0, 60, 120))
    return good - bad, mars_mars, sat_sun_hard, jup_sun_soft


def load_all_games(players_dir: Path):
    rows = []
    for f in players_dir.glob("7656*.json"):
        j = json.loads(f.read_text())
        for g in j.get("games") or []:
            if len(g) < 11 or not g[0] or not g[10] or g[10] < 10:
                continue
            rows.append({"sid": j["sid"], "date": dt.date.fromisoformat(g[0][:10]), "map": g[1], "match": g[2], "team": g[5] or "",
                         "k": g[6], "d": g[7], "adr": float(g[9] or 0), "rounds": int(g[10])})
    df = pd.DataFrame(rows)
    df["mkey"] = df["date"].astype(str) + "|" + df["map"] + "|" + df["match"]
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--players", default="store/nades-site/players")
    ap.add_argument("--pl", default="store/matches-hist/players.json")
    ap.add_argument("--out", default="store/astro-transits")
    ap.add_argument("--perms", type=int, default=5000)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    log = lambda *x: print(*x, flush=True)  # noqa: E731
    people, counts = match_players(Path(a.players), Path(a.pl), log)
    games = load_all_games(Path(a.players))
    games = games[games.groupby("mkey")["sid"].transform("count") == 10]  # complete maps only (5 vs 5)
    games["kpr"] = games["k"] / games["rounds"]
    sids = sorted(people)
    pidx = {s: i for i, s in enumerate(sids)}
    dates = sorted(games["date"].unique())
    didx = {d: i for i, d in enumerate(dates)}
    natals = [natal_longitudes(people[s]["birth"]) for s in sids]
    trans = [natal_longitudes(d) for d in dates]  # same ephemeris call: planets at noon UTC of that day
    F = np.zeros((4, len(sids), len(dates)))
    for i, n in enumerate(natals):
        for j, t in enumerate(trans):
            F[:, i, j] = transit_features(n, t)
    log(f"игроков с датой рождения: {len(sids)}, дней с матчами: {len(dates)}, карт 5×5: {games['mkey'].nunique()}")

    # player-map table for players with birth dates; outcomes as deviations from the player's own mean
    g = games[games["sid"].isin(pidx)].copy()
    g["pi"] = g["sid"].map(pidx)
    g["di"] = g["date"].map(didx)
    g["adr_dev"] = g["adr"] - g.groupby("sid")["adr"].transform("mean")
    g["kpr_dev"] = g["kpr"] - g.groupby("sid")["kpr"].transform("mean")
    g = g[g.groupby("sid")["sid"].transform("count") >= 3]
    pi, di = g["pi"].to_numpy(), g["di"].to_numpy()
    adr_dev, kpr_dev = g["adr_dev"].to_numpy(), g["kpr_dev"].to_numpy()

    # team level: kill differential per map, adjusted for team strength (mean differential of that team in the sample)
    games["pi"] = games["sid"].map(pidx)
    teams_maps = []
    for mk, x in games.groupby("mkey"):
        ts = x.groupby("team")
        if len(ts) != 2:
            continue
        (ta, xa), (tb, xb) = list(ts)
        if len(xa) != 5 or len(xb) != 5:
            continue
        teams_maps.append({"mkey": mk, "di": didx[x["date"].iloc[0]], "ta": ta, "tb": tb, "kd": int(xa["k"].sum() - xb["k"].sum()),
                           "pa": [int(v) for v in xa["pi"].dropna()], "pb": [int(v) for v in xb["pi"].dropna()]})
    tm = pd.DataFrame(teams_maps)
    strength = defaultdict(list)
    for r in tm.itertuples():
        strength[r.ta].append(r.kd)
        strength[r.tb].append(-r.kd)
    st = {t: np.mean(v) for t, v in strength.items()}
    tm["kd_adj"] = tm["kd"] - (tm["ta"].map(st) - tm["tb"].map(st)) / 2
    tm = tm[(tm["pa"].map(len) >= 3) & (tm["pb"].map(len) >= 3)].reset_index(drop=True)
    log(f"карт, где у обеих команд ≥3 игроков с датой рождения: {len(tm)}")

    def stats(perm):
        S = F[0][perm]  # perm: natal chart of player i := chart of player perm[i]
        s = S[pi, di]
        res = {
            "T1": np.polyfit(s, adr_dev, 1)[0],
            "T2": np.polyfit(s, kpr_dev, 1)[0],
        }
        dS = np.array([S[r.pa, r.di].mean() - S[r.pb, r.di].mean() for r in tm.itertuples()])
        res["T3"] = np.corrcoef(dS, tm["kd_adj"])[0, 1] if dS.std() > 0 else 0.0
        nz = dS != 0
        res["T4"] = (np.sign(dS[nz]) == np.sign(tm["kd"].to_numpy()[nz])).mean() - 0.5 if nz.any() else 0.0
        mm, sat, jup = F[1][perm][pi, di], F[2][perm][pi, di], F[3][perm][pi, di]
        res["T5"] = kpr_dev[mm == 1].mean() - kpr_dev[mm == 0].mean() if (mm == 1).sum() >= 10 else 0.0
        res["T6"] = adr_dev[sat == 1].mean() - adr_dev[sat == 0].mean() if (sat == 1).sum() >= 10 else 0.0
        res["T7"] = adr_dev[jup == 1].mean() - adr_dev[jup == 0].mean() if (jup == 1).sum() >= 10 else 0.0
        return res

    ident = np.arange(len(sids))
    obs = stats(ident)
    rng = np.random.default_rng(20261105)
    null = defaultdict(list)
    for _ in range(a.perms):
        for k, v in stats(rng.permutation(len(sids))).items():
            null[k].append(v)
    S0 = F[0][pi, di]
    labels = {
        "T1": "ADR игрока ~ индекс транзитов (ADR на +1 балл)",
        "T2": "убийств за раунд ~ индекс транзитов (на +1 балл)",
        "T3": "разница убийств команд ~ разница транзитов команд (корреляция)",
        "T4": "карту «выигрывает» команда с лучшими транзитами (доля сверх 50%)",
        "T5": "Марс в соединении с натальным Марсом → убийства за раунд",
        "T6": "тяжёлый Сатурн к натальному Солнцу → ADR",
        "T7": "благоприятный Юпитер к натальному Солнцу → ADR",
    }
    n_ev = {"T5": int((F[1][pi, di] == 1).sum()), "T6": int((F[2][pi, di] == 1).sum()), "T7": int((F[3][pi, di] == 1).sum())}
    rows = []
    for k in labels:
        nv = np.array(null[k])
        p = (np.sum(np.abs(nv - nv.mean()) >= abs(obs[k] - nv.mean())) + 1) / (len(nv) + 1)
        rows.append({"test": k, "label": labels[k], "obs": float(obs[k]), "null_mean": float(nv.mean()), "null_sd": float(nv.std()),
                     "mde": float(2.8 * nv.std()), "p": float(p), "events": n_ev.get(k)})
    for r, q in zip(rows, bh([r["p"] for r in rows])):
        r["q"] = q
    summary = {
        "players_with_birthdate": len(sids), "match_days": len(dates), "maps": int(games["mkey"].nunique()),
        "player_maps": int(len(g)), "team_maps": int(len(tm)), "window": [str(dates[0]), str(dates[-1])],
        "S_distribution": {int(k): int(v) for k, v in zip(*np.unique(S0, return_counts=True))},
        "adr_sd": float(g["adr_dev"].std()), "perms": a.perms, "match_counts": counts,
    }
    (out / "results.json").write_text(json.dumps({"summary": summary, "tests": rows}, ensure_ascii=False, indent=1, default=str))
    log(json.dumps(summary, ensure_ascii=False))
    for r in rows:
        log(f"{r['test']} p={r['p']:.3f} q={r['q']:.2f} obs={r['obs']:+.4f} (ноль {r['null_mean']:+.4f} ± {r['null_sd']:.4f}, порог {r['mde']:.4f}) {r['label']}" + (f" [{r['events']} карт-игроков]" if r["events"] else ""))
    plot(rows, summary, out)


def plot(rows, summary, out: Path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
    fig, ax = plt.subplots(figsize=(10, 4.4))
    y = np.arange(len(rows))[::-1]
    ax.axvspan(-1.96, 1.96, color="#e3e6ea", lw=0)
    for yy, r in zip(y, rows):
        z = (r["obs"] - r["null_mean"]) / r["null_sd"] if r["null_sd"] else 0
        ax.plot(z, yy, "o", ms=8, color="#e8650c" if r["q"] < 0.1 else "#3a4150")
        ax.text(3.45, yy, f"p = {r['p']:.2f}", va="center", ha="right", fontsize=8, color="#6b7380")
    ax.set_yticks(y)
    ax.set_yticklabels([r["label"] for r in rows], fontsize=8.5)
    ax.axvline(0, color="#888", lw=0.8)
    ax.set_xlim(-3.5, 3.5)
    ax.set_xlabel("эффект в единицах случайного разброса (серое — 95% при переставленных датах рождения)")
    ax.set_title(f"Транзиты к натальным картам в день матча: {summary['players_with_birthdate']} игроков, {summary['player_maps']} карт", fontsize=11)
    fig.tight_layout()
    fig.savefig(out / "transits.png", dpi=150)
    plt.close(fig)


if __name__ == "__main__":
    main()
