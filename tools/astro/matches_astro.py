#!/usr/bin/env python3
"""Про-матчи CS и астрология: честная статистическая проверка.

Вход:
  store/matches-hist/     — сырой викитекст турниров S- и A-тира Liquipedia и страницы игроков
                            (scripts/fetch-matches-hist.mjs; разбор — tools/astro/lp_matches.py);
  store/nades-site/players — статистика игроков по картам из демок турниров (<steamid>.json).
Выход: <out>/results.json, <out>/*.png

Что проверяется (список исходов и факторов зафиксирован заранее, до просмотра результатов):
A. Матчи (ноябрь 2021 — сейчас; 2021-01…10 — только разогрев рейтинга):
   сила команд — рейтинг Эло по самим результатам (K подбирается по log-loss, вероятности калибруются
   отдельно для Bo1/Bo3/Bo5); исходы по дням:
     upset — «апсет»: победила команда с меньшим Эло; считается превышение над ожидаемой по Эло долей
             апсетов (чтобы день с равными соперниками не выглядел «днём сюрпризов»);
     close — доля близких карт: разница ≤ 3 раундов или овертайм;
     decider — доля Bo3, дошедших до третьей карты.
   Факторы — те же, что в анализе рынка (astrolib.astro_table): ретроградность планет, фазы Луны, затмения,
   смена знаков, точные мажорные аспекты, Луна и Солнце в каждом знаке. Тест — разница «дни с фактором минус
   остальные» с весом по числу матчей/карт; значимость — по всем циклическим сдвигам фактора по календарю
   (сохраняют автокорреляцию и сезонность): z = наблюдаемое / разброс по сдвигам, p — гауссов хвост
   (точный p по сдвигам не бывает меньше ~1/1200, а FDR на сотнях проверок требует меньше; калибровка гауссова
   p проверена на синтетике без эффекта). Поправка Бенджамини–Хохберга (q < 0.1) на все проверки сразу,
   воспроизводимость: p < 0.05 с тем же знаком и в первых 60%, и в последних 40% периода. MDE — минимальный
   эффект, который тест поймал бы в ~80% случаев.
   Для сравнения — реальные эффекты в тех же данных: Bo1 против Bo3, LAN против онлайна, S против A,
   калибровка Эло, MR12 против MR15 для близких карт. И контроль мощности на синтетике.
B. Игроки (демки; даты рождения с Liquipedia, игрок принимается только при совпадении steam64ID):
   (1) натальное Солнце / стихия / Луна (полуденная карта — время рождения неизвестно) против ADR, KPR, K/D —
       перестановочный тест разброса между знаками; (2) внутри игрока: Луна в его солнечном знаке, ±3 дня от дня
       рождения, ретроградный Меркурий, новолуние, полнолуние — отклонение от собственного среднего игрока.
C. Циклы: периодограмма Ломба–Скаргла дневного превышения апсетов против перестановочного нуля.

  python3 tools/astro/matches_astro.py --hist store/matches-hist --players store/nades-site/players --out store/astro-matches
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from astrolib import (  # noqa: E402
    DAY0, ELEMENTS_RU, SIGNS_RU, astro_table, bh, element_of, feature_label, natal_longitudes, shift_test, sign_of,
)
from lp_matches import parse_store, split_args, find_templates  # noqa: E402

ANALYSIS_FROM = dt.date(2021, 11, 1)
CS2_FROM = dt.date(2023, 9, 27)  # CS2 release: MR12 instead of MR15
MIN_PRIOR = 10                   # both teams need ≥ 10 rated matches before the match
SEED = 20261105

FEATURE_PREFIX = ("retro_", "moon_new", "moon_full", "moon_waxing", "ingress_", "asp_", "tense_day", "eclipse", "moon_sign_", "sun_sign_")
OUTCOMES = {"upset": "превышение доли апсетов над ожиданием по Эло", "close": "доля близких карт (≤3 раунда или овертайм)",
            "decider": "доля Bo3 до третьей карты"}


def dnum(d: dt.date) -> int:
    return (d - DAY0).days


# --------------------------------------------------------------------------- #
# A. matches: Elo and outcomes
# --------------------------------------------------------------------------- #
def run_elo(df: pd.DataFrame, K: float):
    R = defaultdict(lambda: 1500.0)
    N = defaultdict(int)
    p1 = np.empty(len(df))
    n1 = np.empty(len(df), int)
    n2 = np.empty(len(df), int)
    e1 = np.empty(len(df))
    e2 = np.empty(len(df))
    for i, (a, b, w) in enumerate(zip(df["t1"].to_numpy(), df["t2"].to_numpy(), df["winner"].to_numpy())):
        ra, rb = R[a], R[b]
        e = 1.0 / (1.0 + 10 ** ((rb - ra) / 400))
        p1[i], n1[i], n2[i], e1[i], e2[i] = e, N[a], N[b], ra, rb
        s = 1.0 if w == 1 else 0.0
        R[a] = ra + K * (s - e)
        R[b] = rb - K * (s - e)
        N[a] += 1
        N[b] += 1
    return p1, n1, n2, e1, e2


def logit(p):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return np.log(p / (1 - p))


def fit_calibration(x, y):
    """logistic recalibration P(fav wins) = σ(a + b·logit(p_elo)) — per match format"""
    from scipy.optimize import minimize

    def nll(t):
        z = t[0] + t[1] * x
        return np.sum(np.logaddexp(0, z) - y * z)
    r = minimize(nll, np.array([0.0, 1.0]), method="Nelder-Mead", options={"xatol": 1e-6, "fatol": 1e-8, "maxiter": 2000})
    return r.x


def map_flags(maps, date):
    """valid regulation/overtime maps → list of close flags"""
    reg = 30 if date < CS2_FROM else 24
    win = reg // 2 + 1
    out = []
    for m in maps:
        r1, r2 = m[0], m[1]
        ot = bool(m[2]) if len(m) > 2 else False
        hi, lo = max(r1, r2), min(r1, r2)
        total = r1 + r2
        if total > reg:
            ot = True
        if ot:
            if hi < win or hi - lo < 1:
                continue
        elif not (hi == win and lo <= win - 2):
            continue  # forfeits, unfinished maps, other formats
        out.append(ot or (hi - lo) <= 3)
    return out


def prepare_matches(hist: Path, log):
    df, stats = parse_store(hist)
    log(f"разбор: {stats}")
    df = df[~df["walkover"]].copy()
    show = df["tiertype"].fillna("").str.contains("show", case=False)
    stats["showmatches_dropped"] = int(show.sum())
    df = df[~show].sort_values("ts").reset_index(drop=True)
    # Elo over all parsed matches (also B-tier qualifier pages found under S/A tournaments): more information on teams
    period = (df["date"] >= ANALYSIS_FROM).to_numpy()
    best = None
    for K in (16, 20, 24, 32, 40, 48):
        p1, n1, n2, _, _ = run_elo(df, K)
        ok = period & (n1 >= MIN_PRIOR) & (n2 >= MIN_PRIOR)
        y = (df["winner"].to_numpy() == 1).astype(float)
        ll = -np.mean(y[ok] * np.log(p1[ok]) + (1 - y[ok]) * np.log(1 - p1[ok]))
        log(f"Эло K={K}: log-loss {ll:.4f} на {ok.sum()} матчах")
        if best is None or ll < best[1]:
            best = (K, ll)
    K = best[0]
    p1, n1, n2, e1, e2 = run_elo(df, K)
    df["p1"], df["n1"], df["n2"], df["elo1"], df["elo2"] = p1, n1, n2, e1, e2
    df["fav_p"] = np.maximum(p1, 1 - p1)
    df["fav"] = np.where(p1 >= 0.5, 1, 2)
    df["upset"] = (df["winner"] != df["fav"]).astype(float)
    df["gap"] = np.abs(df["elo1"] - df["elo2"])
    df["fmt"] = df["bo"].fillna(0).astype(int).map(lambda b: f"bo{b}" if b in (1, 3, 5) else "other")
    df["eligible"] = ((df["date"] >= ANALYSIS_FROM) & (df["n1"] >= MIN_PRIOR) & (df["n2"] >= MIN_PRIOR) & df["tier"].isin(["S", "A"])
                      & ~df["date_approx"] & (df["p1"] != 0.5))
    # calibration per format (no astrology involved — only Elo and the format)
    df["p_up"] = 1 - df["fav_p"]
    calib = {}
    for fmt, g in df[df["eligible"]].groupby("fmt"):
        if len(g) < 200:
            continue
        a, b = fit_calibration(logit(g["fav_p"].to_numpy()), 1 - g["upset"].to_numpy())
        calib[fmt] = [float(a), float(b)]
        m = df["fmt"] == fmt
        df.loc[m, "p_up"] = 1 - 1 / (1 + np.exp(-(a + b * logit(df.loc[m, "fav_p"].to_numpy()))))
    df["excess"] = df["upset"] - df["p_up"]
    stats.update({"elo_K": K, "elo_logloss": best[1], "calibration": calib})
    return df, stats


def daily_outcomes(df: pd.DataFrame, start: int, end: int):
    n = end - start + 1
    acc = {k: np.zeros(n) for k in ("up_n", "up_sum", "up_raw", "close_n", "close_sum", "dec_n", "dec_sum")}
    sa = df[df["tier"].isin(["S", "A"]) & (df["date"] >= ANALYSIS_FROM) & ~df["date_approx"]]
    for r in sa.itertuples():
        i = dnum(r.date) - start
        if i < 0 or i >= n:
            continue
        if r.eligible:
            acc["up_n"][i] += 1
            acc["up_sum"][i] += r.excess
            acc["up_raw"][i] += r.upset
        flags = map_flags(r.maps, r.date)
        acc["close_n"][i] += len(flags)
        acc["close_sum"][i] += sum(flags)
        if r.bo == 3 and max(r.s1, r.s2) == 2 and r.s1 + r.s2 in (2, 3):
            acc["dec_n"][i] += 1
            acc["dec_sum"][i] += (r.s1 + r.s2 == 3)
    days = np.arange(start, end + 1)
    out = pd.DataFrame({"day": days, **acc})
    out["date"] = [DAY0 + dt.timedelta(days=int(d)) for d in days]
    with np.errstate(invalid="ignore", divide="ignore"):
        out["upset"] = out["up_sum"] / out["up_n"]
        out["upset_raw"] = out["up_raw"] / out["up_n"]
        out["close"] = out["close_sum"] / out["close_n"]
        out["decider"] = out["dec_sum"] / out["dec_n"]
    return out


def center(y: pd.Series, w: pd.Series, groups: list[pd.Series]):
    """subtract weighted group means (weekday; CS:GO vs CS2 era) — known calendar effects out of the way"""
    y = y.copy()
    for g in groups:
        ok = y.notna() & (w > 0)
        m = (y[ok] * w[ok]).groupby(g[ok]).sum() / w[ok].groupby(g[ok]).sum()
        y = y - g.map(m)
    return y


def match_tests(days: pd.DataFrame, astro: pd.DataFrame, log, outcomes=tuple(OUTCOMES)):
    df = days.merge(astro, on="day", how="left")
    signs = {f"moon_sign_{m}": df["moon_sign"] == m for m in range(12)} | {f"sun_sign_{m}": df["sun_sign"] == m for m in range(12)}
    df = pd.concat([df, pd.DataFrame(signs)], axis=1)
    feats = [c for c in df.columns if c.startswith(FEATURE_PREFIX) and df[c].dtype == bool]
    wd = pd.Series([d.weekday() for d in df["date"]])
    era = pd.Series([d >= CS2_FROM for d in df["date"]])
    W = {"upset": df["up_n"], "close": df["close_n"], "decider": df["dec_n"]}
    Y = {k: center(df[k], W[k], [wd, era]) for k in OUTCOMES}
    rng = np.random.default_rng(SEED)
    res = []
    for k in outcomes:
        y, w = Y[k].to_numpy(), W[k].to_numpy()
        have = np.flatnonzero(w > 0)
        split = have[int(len(have) * 0.6)]
        for c in feats:
            f = df[c].to_numpy()
            full = shift_test(y, f, rng=rng, w=w)
            if not full:
                continue
            a = shift_test(y[:split], f[:split], n_perm=1000, rng=rng, w=w[:split])
            b = shift_test(y[split:], f[split:], n_perm=1000, rng=rng, w=w[split:])
            res.append({"outcome": k, "feature": c, "label": feature_label(c), **full,
                        "p_first": a["p"] if a else None, "diff_first": a["diff"] if a else None,
                        "p_last": b["p"] if b else None, "diff_last": b["diff"] if b else None})
    q = bh([r["p"] for r in res])
    for r, qq in zip(res, q):
        r["q"] = qq
        r["replicates"] = bool(r["p_first"] is not None and r["p_last"] is not None and r["p_first"] < 0.05 and r["p_last"] < 0.05
                               and np.sign(r["diff_first"]) == np.sign(r["diff_last"]))
    res.sort(key=lambda r: r["p"])
    split_date = str(df["date"].iloc[np.flatnonzero(W["upset"].to_numpy() > 0)[int((W["upset"] > 0).sum() * 0.6)]])
    return res, Y, W, df, split_date


def power_check(days_df, astro_df, matches, start, end, log, n_sim=200, n_null=100):
    """synthetic upsets with the real schedule and Elo probabilities: (a) no effect at all — how many tests pass
    FDR + replication by chance; (b) an injected effect on Mercury-retrograde / full-moon days — how often it is found"""
    rng = np.random.default_rng(SEED + 1)
    el = matches[matches["eligible"]].copy()
    di = np.array([dnum(d) - start for d in el["date"]])
    p = el["p_up"].to_numpy()
    n = end - start + 1
    w = np.bincount(di, minlength=n).astype(float)
    a = astro_df.set_index("day").reindex(range(start, end + 1))
    dates = [DAY0 + dt.timedelta(days=int(d)) for d in range(start, end + 1)]
    wd = pd.Series([d.weekday() for d in dates])
    out = {}
    for feat, deltas in (("retro_Mercury", (0.02, 0.03, 0.05)), ("moon_full", (0.03, 0.05, 0.08))):
        f = a[feat].fillna(False).to_numpy().astype(bool)
        fm = f[di]
        for dlt in deltas:
            hits = 0
            for _ in range(n_sim):
                u = (rng.random(len(p)) < np.clip(p + dlt * fm, 0, 1)).astype(float)
                y = np.bincount(di, weights=u - p, minlength=n)
                with np.errstate(invalid="ignore", divide="ignore"):
                    yy = pd.Series(y / w)
                yy = center(yy, pd.Series(w), [wd]).to_numpy()
                r = shift_test(yy, f, n_perm=400, rng=rng, w=w)
                hits += r is not None and r["p"] < 0.05 and r["diff"] > 0
            out[f"{feat}:+{dlt:.2f}"] = hits / n_sim
            log(f"мощность: {feat} +{dlt * 100:.0f} п.п. → найдено в {hits / n_sim:.0%} симуляций")
    # null battery: the whole family of upset tests on random upsets drawn from the Elo probabilities (no astro
    # effect by construction), repeated — how often does anything pass FDR, replication, both?
    reps = []
    for i in range(n_null):
        u = (rng.random(len(p)) < p).astype(float)
        syn = days_df.copy()
        y = np.bincount(di, weights=u - p, minlength=n)
        with np.errstate(invalid="ignore", divide="ignore"):
            syn["upset"] = y / w
        res, *_ = match_tests(syn, astro_df, log, outcomes=("upset",))
        q = bh([r["p"] for r in res])
        reps.append({"tests": len(res), "raw_p05": int(sum(r["p"] < 0.05 for r in res)), "fdr_q10": int(sum(x < 0.1 for x in q)),
                     "replicated": int(sum(r["replicates"] for r in res)), "both": int(sum(x < 0.1 and r["replicates"] for r, x in zip(res, q)))})
    out["null_battery"] = {"runs": n_null, "tests_per_run": reps[0]["tests"] if reps else 0,
                           "mean_raw_p05": float(np.mean([r["raw_p05"] for r in reps])),
                           "runs_with_fdr_hit": int(sum(r["fdr_q10"] > 0 for r in reps)),
                           "runs_with_replicated_hit": int(sum(r["replicated"] > 0 for r in reps)),
                           "runs_with_fdr_and_replicated": int(sum(r["both"] > 0 for r in reps)), "runs": reps}
    log(f"синтетика без эффекта ({n_null} прогонов): " + json.dumps({k: v for k, v in out["null_battery"].items() if k != "runs"}))
    return out


def cluster_ci(df, col, by="root", n_boot=2000, rng=None):
    """mean of col with a 95% CI from a bootstrap over tournaments (matches inside one event are not independent)"""
    rng = rng or np.random.default_rng(SEED + 2)
    g = df.groupby(by)[col].agg(["sum", "count"])
    s, c = g["sum"].to_numpy(), g["count"].to_numpy()
    idx = rng.integers(0, len(g), (n_boot, len(g)))
    boots = s[idx].sum(1) / c[idx].sum(1)
    return float(s.sum() / c.sum()), float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5)), int(c.sum()), int(len(g))


def diff_test(df, col, mask_a, mask_b, by="root", n_boot=2000, rng=None):
    """difference of means of two groups, CI and two-sided p from a bootstrap over tournaments"""
    rng = rng or np.random.default_rng(SEED + 3)
    A = df[mask_a].groupby(by)[col].agg(["sum", "count"])
    B = df[mask_b].groupby(by)[col].agg(["sum", "count"])
    ma, mb = A["sum"].sum() / A["count"].sum(), B["sum"].sum() / B["count"].sum()
    ia = rng.integers(0, len(A), (n_boot, len(A)))
    ib = rng.integers(0, len(B), (n_boot, len(B)))
    da = A["sum"].to_numpy()[ia].sum(1) / A["count"].to_numpy()[ia].sum(1)
    db = B["sum"].to_numpy()[ib].sum(1) / B["count"].to_numpy()[ib].sum(1)
    d = da - db
    p = 2 * min((d <= 0).mean(), (d >= 0).mean())
    return {"a": float(ma), "b": float(mb), "diff": float(ma - mb), "ci": [float(np.percentile(d, 2.5)), float(np.percentile(d, 97.5))],
            "p": float(max(p, 1 / n_boot)), "n_a": int(A["count"].sum()), "n_b": int(B["count"].sum())}


def real_effects(m: pd.DataFrame):
    el = m[m["eligible"]].copy()
    out = {}
    out["bo1_vs_bo3_upset"] = diff_test(el, "upset", el["fmt"] == "bo1", el["fmt"] == "bo3")
    lan = el[el["lan"].notna()]
    out["online_vs_lan_upset"] = diff_test(lan, "upset", lan["lan"] == False, lan["lan"] == True)  # noqa: E712
    out["online_vs_lan_excess"] = diff_test(lan, "excess", lan["lan"] == False, lan["lan"] == True)  # noqa: E712
    out["a_vs_s_upset"] = diff_test(el, "upset", el["tier"] == "A", el["tier"] == "S")
    out["a_vs_s_excess"] = diff_test(el, "excess", el["tier"] == "A", el["tier"] == "S")
    # the same Elo gap in Bo1 and Bo3: a longer series should favour the stronger team (a known, real effect)
    rng = np.random.default_rng(SEED + 7)
    pe = 0.65

    def fav_at(g):
        a_, b_ = fit_calibration(logit(g["fav_p"].to_numpy()), 1 - g["upset"].to_numpy())
        return 1 / (1 + np.exp(-(a_ + b_ * logit(pe))))
    b1, b3 = el[el["fmt"] == "bo1"], el[el["fmt"] == "bo3"]
    if len(b1) > 200 and len(b3) > 200:
        r1, r3 = sorted(b1["root"].unique()), sorted(b3["root"].unique())
        g1, g3 = dict(list(b1.groupby("root"))), dict(list(b3.groupby("root")))
        boots = []
        for _ in range(300):
            s1 = pd.concat([g1[r] for r in rng.choice(r1, len(r1))])
            s3 = pd.concat([g3[r] for r in rng.choice(r3, len(r3))])
            boots.append(fav_at(s3) - fav_at(s1))
        boots = np.array(boots)
        out["bo3_vs_bo1_same_gap"] = {"p_elo": pe, "bo1": float(fav_at(b1)), "bo3": float(fav_at(b3)), "diff": float(fav_at(b3) - fav_at(b1)),
                                      "ci": [float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))],
                                      "p": float(max(2 * min((boots <= 0).mean(), (boots >= 0).mean()), 1 / len(boots))),
                                      "n_bo1": int(len(b1)), "n_bo3": int(len(b3))}
    # Elo gap → favourite's win rate
    bins = [0, 25, 50, 100, 150, 200, 300, 2000]
    el["gapbin"] = pd.cut(el["gap"], bins, right=False)
    gb = []
    for b, g in el.groupby("gapbin", observed=True):
        gb.append({"gap": f"{int(b.left)}–{int(b.right) if b.right < 2000 else '…'}", "n": int(len(g)), "pred": float(g["fav_p"].mean()),
                   "obs": float(1 - g["upset"].mean())})
    out["elo_gap"] = gb
    # calibration by deciles of the calibrated probability
    el["pcal"] = 1 - el["p_up"]
    el["dec"] = pd.qcut(el["pcal"], 10, duplicates="drop")
    out["calibration"] = [{"pred": float(g["pcal"].mean()), "obs": float(1 - g["upset"].mean()), "n": int(len(g))} for _, g in el.groupby("dec", observed=True)]
    yb = 1 - el["upset"].to_numpy()
    out["brier_elo"] = float(np.mean((el["pcal"].to_numpy() - yb) ** 2))
    out["brier_coin"] = 0.25
    out["upset_rate"] = cluster_ci(el, "upset")
    # close maps: MR15 (CS:GO) vs MR12 (CS2)
    rows = []
    for r in m[m["tier"].isin(["S", "A"]) & (m["date"] >= ANALYSIS_FROM)].itertuples():
        for fl in map_flags(r.maps, r.date):
            rows.append({"root": r.root, "close": float(fl), "cs2": r.date >= CS2_FROM})
    mp = pd.DataFrame(rows)
    out["close_cs2_vs_csgo"] = diff_test(mp, "close", mp["cs2"], ~mp["cs2"])
    out["close_rate"] = cluster_ci(mp, "close")
    dec = m[m["tier"].isin(["S", "A"]) & (m["date"] >= ANALYSIS_FROM) & (m["bo"] == 3)]
    dec = dec[(dec[["s1", "s2"]].max(axis=1) == 2)].copy()
    dec["went3"] = ((dec["s1"] + dec["s2"]) == 3).astype(float)
    out["decider_rate"] = cluster_ci(dec, "went3")
    return out


# --------------------------------------------------------------------------- #
# C. cycles
# --------------------------------------------------------------------------- #
PERIODS = {"неделя": 7.0, "сидерический месяц (Луна проходит 12 знаков)": 27.32, "синодический месяц (фазы Луны)": 29.53,
           "синодический период Меркурия (ретроградность)": 115.88, "год": 365.25}


def lomb(t, y, w, periods):
    from scipy.signal import lombscargle
    om = 2 * np.pi / periods
    try:
        return lombscargle(t, y, om, normalize=True, weights=w, floating_mean=True)
    except TypeError:  # older scipy
        return lombscargle(t, y - np.average(y, weights=w), om, normalize=True)


def cycles(Y, W, days, n_perm=500):
    """Y["upset"] here is the daily excess of upsets WITHOUT weekday centering (the weekly period is a sanity check)"""
    rng = np.random.default_rng(SEED + 4)
    y, w = Y["upset"].to_numpy(), W["upset"].to_numpy()
    ok = (w > 0) & ~np.isnan(y)
    t = days["day"].to_numpy()[ok].astype(float)
    y, w = y[ok], w[ok]
    grid = np.unique(np.concatenate([np.geomspace(2.5, 400, 1500), list(PERIODS.values())]))
    obs = lomb(t, y, w, grid)
    null = np.empty((n_perm, len(grid)))
    for i in range(n_perm):
        j = rng.permutation(len(y))
        null[i] = lomb(t, y[j], w[j], grid)
    gmax = null.max(1)
    res = {}
    for name, per in PERIODS.items():
        k = int(np.argmin(np.abs(grid - per)))
        res[name] = {"period": per, "power": float(obs[k]), "p": float((np.sum(null[:, k] >= obs[k]) + 1) / (n_perm + 1))}
    q = bh([v["p"] for v in res.values()])
    for v, qq in zip(res.values(), q):
        v["q"] = qq
    top = np.argsort(obs)[::-1]
    peaks = []
    for k in top:
        if all(abs(np.log(grid[k] / p["period"])) > 0.05 for p in peaks):
            peaks.append({"period": float(grid[k]), "power": float(obs[k]), "p_global": float((np.sum(gmax >= obs[k]) + 1) / (n_perm + 1))})
        if len(peaks) >= 6:
            break
    return {"periods": res, "peaks": peaks, "days": int(ok.sum()), "max_null95": float(np.percentile(gmax, 95))}, (grid, obs, np.percentile(null, 95, axis=0), np.percentile(gmax, 95))


# --------------------------------------------------------------------------- #
# B. players
# --------------------------------------------------------------------------- #
def infobox_player(content: str):
    m = re.search(r"\{\{\s*Infobox[ _]player", content or "", re.I)
    if not m:
        return None
    from lp_matches import template_end
    _, _, kw = split_args(content[m.start():template_end(content, m.start())])
    return kw


def norm_team_name(s):
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]+)\]\]", r"\1", s or "").lower()
    s = re.sub(r"\b(esports?|gaming|team|club|academy|e-sports)\b", "", s)
    return re.sub(r"[^a-z0-9]", "", s)


def is_disambig(c):
    return bool(re.search(r"\{\{\s*(disambig|disambiguation|dab)", c or "", re.I))


def name_variants(n):
    core = re.sub(r"^[-_.]+|[-_.]+$", "", n)
    out = [n, n.lower(), n[:1].upper() + n[1:].lower(), core, core.lower()]
    return list(dict.fromkeys(v for v in out if v))


def match_players(players_dir: Path, pl_json: Path, log):
    st = json.loads(pl_json.read_text()) if pl_json.exists() else {"q": {}, "extra": {}}
    q, ex = st.get("q", {}), st.get("extra", {})
    ix = json.loads((players_dir / "index.json").read_text())
    counts = defaultdict(int)
    people = {}
    page_owner = defaultdict(set)
    for f in players_dir.glob("*.json"):
        if not re.fullmatch(r"\d+\.json", f.name):
            continue
        j = json.loads(f.read_text())
        sid = j.get("sid") or f.stem
        counts["players"] += 1
        names = [j.get("name", "")] + list(j.get("names") or [])
        titles = []
        for n in names:
            n = (n or "").strip()
            if not n:
                continue
            for v in name_variants(n):
                x = q.get(v)
                if x and x.get("title"):
                    titles.append(x["title"])
        titles = list(dict.fromkeys(titles))
        # expand disambiguation pages to their linked pages
        cand = []
        for t in titles:
            c = ex.get(t, "")
            if is_disambig(c) or re.search(r"may refer to", c, re.I):
                for m in re.finditer(r"\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]", c):
                    x = m.group(1).strip().replace("_", " ")
                    cc = ex.get(x, "")
                    r = re.match(r"#REDIRECT \[\[([^\]]+)\]\]", cc)
                    if r:
                        x = r.group(1)
                    cand.append((x, True))
            else:
                cand.append((t, False))
        if not titles:
            counts["not_found"] += 1
            continue
        best = None
        teams = {norm_team_name(t[0]) for t in (j.get("teams") or []) if t} | {norm_team_name(j.get("team", ""))}
        teams = {t for t in teams if len(t) >= 3}
        for t, via_dis in cand:
            kw = infobox_player(ex.get(t, ""))
            if not kw:
                continue
            sids = set(re.findall(r"\d{17}", " ".join(v for k, v in kw.items() if k.startswith("steam"))))
            if sid in sids:
                best = (t, kw, "steam64ID")
                break
            if not sids and best is None:
                hist = norm_team_name(" ".join([kw.get("team", ""), kw.get("team2", ""), kw.get("team_history", ""), kw.get("history", "")]))
                if teams and any(tm in hist for tm in teams):
                    best = (t, kw, "team")
        if not best:
            if any(infobox_player(ex.get(t, "")) for t, _ in cand):
                counts["page_other_person_or_unverified"] += 1
            else:
                counts["no_player_page"] += 1
            continue
        t, kw, how = best
        b = re.search(r"(\d{4})-(\d{2})-(\d{2})", kw.get("birth_date", ""))
        if not b:
            counts[f"verified_{how}_no_birthdate"] += 1
            continue
        try:
            bd = dt.date(int(b.group(1)), int(b.group(2)), int(b.group(3)))
        except ValueError:
            counts["bad_birthdate"] += 1
            continue
        if not (1975 <= bd.year <= 2012):
            counts["bad_birthdate"] += 1
            continue
        counts[f"matched_{how}"] += 1
        people[sid] = {"sid": sid, "name": j.get("name"), "page": t, "how": how, "birth": bd, "games": j.get("games") or []}
        page_owner[t].add(sid)
    # one wiki page claimed by two steam accounts: keep only steam64ID-verified ones
    for t, sids in page_owner.items():
        if len(sids) > 1:
            for s in sids:
                if people[s]["how"] != "steam64ID":
                    people.pop(s, None)
                    counts["dropped_shared_page"] += 1
    log(f"игроки: {dict(counts)}")
    return people, dict(counts)


def natal(bd: dt.date):
    L = natal_longitudes(bd)
    sun = sign_of(L["Sun"])
    moon = sign_of(L["Moon"])
    # Moon moves ~13°/day: with an unknown birth time the noon sign is uncertain near sign borders
    lm = L["Moon"] % 30
    return {"sun": sun, "moon": moon, "element": element_of(sun), "moon_uncertain": lm < 7.7 or lm > 22.3}  # ≤ 15.4°/day


def games_table(people):
    rows = []
    for sid, p in people.items():
        for g in p["games"]:
            if len(g) < 11 or not g[0]:
                continue
            try:
                d = dt.date.fromisoformat(g[0][:10])
            except ValueError:
                continue
            k, de, a, adr, r = g[6], g[7], g[8], g[9], g[10]
            if not r or r < 10 or adr is None:
                continue
            rows.append({"sid": sid, "date": d, "kills": k, "deaths": de, "adr": float(adr), "rounds": int(r), "match": g[2], "map": g[1]})
    return pd.DataFrame(rows)


def perm_anova(values, groups, k, n_perm, rng):
    """between-group sum of squares Σ n_c (mean_c − mean)²; null — group labels shuffled between players"""
    v, g = np.asarray(values, float), np.asarray(groups, int)
    N, tot = len(v), v.mean()

    def stat(gg):
        s = np.bincount(gg, v, k)
        c = np.bincount(gg, minlength=k)
        m = c > 0
        return float((s[m] ** 2 / c[m]).sum() - N * tot ** 2)
    obs = stat(g)
    null = np.array([stat(rng.permutation(g)) for _ in range(n_perm)])
    return obs, float((np.sum(null >= obs - 1e-12) + 1) / (n_perm + 1))


def mde_groups(n, k, sd, alpha=0.05, power=0.8):
    """smallest SD of true group means detectable by a one-way F test (noncentral F), in metric units"""
    from scipy.stats import f as fdist, ncf
    crit = fdist.ppf(1 - alpha, k - 1, n - k)
    lo, hi = 1e-4, 2.0
    for _ in range(60):
        mid = (lo + hi) / 2
        pw = 1 - ncf.cdf(crit, k - 1, n - k, n * mid ** 2)
        lo, hi = (lo, mid) if pw >= power else (mid, hi)
    return hi * sd  # Cohen's f × SD = SD of group means


def players_between(people, games, log, min_rounds=150):
    rng = np.random.default_rng(SEED + 5)
    agg = games.groupby("sid").agg(rounds=("rounds", "sum"), kills=("kills", "sum"), deaths=("deaths", "sum"), maps=("rounds", "size"))
    agg["dmg"] = (games["adr"] * games["rounds"]).groupby(games["sid"]).sum()
    agg = agg[agg["rounds"] >= min_rounds].copy()
    agg["ADR"] = agg["dmg"] / agg["rounds"]
    agg["KPR"] = agg["kills"] / agg["rounds"]
    agg["KD"] = agg["kills"] / agg["deaths"].clip(lower=1)
    nat = {sid: natal(people[sid]["birth"]) for sid in agg.index}
    agg["sun"] = [nat[s]["sun"] for s in agg.index]
    agg["element"] = [nat[s]["element"] for s in agg.index]
    agg["moon"] = [nat[s]["moon"] for s in agg.index]
    agg["moon_unc"] = [nat[s]["moon_uncertain"] for s in agg.index]
    res = []
    for grp, k in (("sun", 12), ("element", 4), ("moon", 12)):
        for met in ("ADR", "KPR", "KD"):
            v = agg[met].to_numpy()
            obs, p = perm_anova(v, agg[grp].to_numpy(), k, 5000, rng)  # players weighted equally (≥ min_rounds each)
            means = agg.groupby(grp)[met].agg(["mean", "count", "std"])
            sd = float(agg[met].std())
            res.append({"group": grp, "metric": met, "p": p, "players": int(len(agg)), "sd_players": sd,
                        "means": {int(i): [float(r["mean"]), int(r["count"])] for i, r in means.iterrows()},
                        "spread": float(means["mean"].max() - means["mean"].min()),
                        "mde_sd_of_means": float(mde_groups(len(agg), k, sd))})
    q = bh([r["p"] for r in res])
    for r, qq in zip(res, q):
        r["q"] = qq
    # sensitivity: the Moon sign only for players whose noon Moon is far enough from a sign border to hold for any birth time
    sure = agg[~agg["moon_unc"]]
    for met in ("ADR", "KPR", "KD"):
        _, p = perm_anova(sure[met].to_numpy(), sure["moon"].to_numpy(), 12, 5000, rng)
        res.append({"group": "moon_certain", "metric": met, "p": p, "players": int(len(sure)), "sensitivity": True})
    # null band of sign means (for the chart): 95% range of a random sign's mean under shuffled labels
    band = {}
    for met in ("ADR", "KPR", "KD"):
        v = agg[met].to_numpy()
        g = agg["sun"].to_numpy()
        sims = []
        for _ in range(2000):
            gg = rng.permutation(g)
            c = np.bincount(gg, minlength=12)
            sims.append(np.where(c > 0, np.bincount(gg, v, 12) / np.maximum(c, 1), np.nan))
        sims = np.array(sims)
        band[met] = {"lo": np.nanpercentile(sims, 2.5, axis=0).tolist(), "hi": np.nanpercentile(sims, 97.5, axis=0).tolist()}
    # distribution of Sun signs among pros vs days in each sign (birth seasonality / relative-age effect, not astrology)
    from scipy.stats import chisquare
    allp = [natal(p["birth"])["sun"] for p in people.values()]
    cnt = np.bincount(allp, minlength=12)
    days_in = np.zeros(12)
    for d in range(365 * 4 + 1):
        days_in[sign_of(natal_longitudes(dt.date(2000, 1, 1) + dt.timedelta(days=d))["Sun"])] += 1
    exp = days_in / days_in.sum() * cnt.sum()
    chi = chisquare(cnt, exp)
    months = np.bincount([p["birth"].month - 1 for p in people.values()], minlength=12)
    dist = {"counts": cnt.tolist(), "expected": exp.tolist(), "chi2": float(chi.statistic), "p": float(chi.pvalue), "n": int(cnt.sum()),
            "months": months.tolist()}
    log(f"между игроками: {len(agg)} игроков с ≥{min_rounds} раундов; знаки Солнца χ² p={chi.pvalue:.3f}")
    return res, agg, band, dist


def players_within(people, games, astro_full, log, n_perm=2000):
    rng = np.random.default_rng(SEED + 6)
    g = games.copy()
    g["KPR"] = g["kills"] / g["rounds"]
    g["KDR"] = (g["kills"] - g["deaths"]) / g["rounds"]  # (K−D) per round: per-map K/D is too noisy
    g["ADR"] = g["adr"]
    for met in ("ADR", "KPR", "KDR"):
        mu = (g[met] * g["rounds"]).groupby(g["sid"]).transform("sum") / g["rounds"].groupby(g["sid"]).transform("sum")
        g["d_" + met] = g[met] - mu
    nmaps = g.groupby("sid")["rounds"].transform("size")
    g = g[nmaps >= 3].reset_index(drop=True)
    sids = g["sid"].unique()
    births = {s: people[s]["birth"] for s in sids}
    sun = {s: natal(b)["sun"] for s, b in births.items()}
    g["day"] = [dnum(d) for d in g["date"]]
    a = astro_full.set_index("day")
    g["moon_sign"] = a.loc[g["day"], "moon_sign"].to_numpy()
    for c in ("retro_Mercury", "moon_new", "moon_full"):
        g[c] = a.loc[g["day"], c].to_numpy().astype(bool)
    doy = np.array([d.timetuple().tm_yday for d in g["date"]])

    sid_arr = list(births)
    code = pd.Index(sid_arr).get_indexer(g["sid"])
    sun_arr = np.array([sun[s] for s in sid_arr])
    bdoy_arr = np.array([min(births[s].timetuple().tm_yday, 365) for s in sid_arr])
    msign = g["moon_sign"].to_numpy()

    def bday_flag(perm):
        dd = np.abs(doy - bdoy_arr[perm][code])
        return np.minimum(dd, 365 - dd) <= 3

    def moon_flag(perm):
        return msign == sun_arr[perm][code]

    w = g["rounds"].to_numpy().astype(float)

    def wdiff(y, f):
        if f.sum() == 0 or (~f).sum() == 0:
            return np.nan
        return np.average(y[f], weights=w[f]) - np.average(y[~f], weights=w[~f])

    res = []
    ident = np.arange(len(sid_arr))
    for fac in ("moon_in_sun_sign", "birthday_pm3"):
        f_obs = moon_flag(ident) if fac == "moon_in_sun_sign" else bday_flag(ident)
        # null: birth dates shuffled between players (keeps every player's games and the calendar)
        nulls = [(moon_flag if fac == "moon_in_sun_sign" else bday_flag)(rng.permutation(len(sid_arr))) for _ in range(n_perm)]
        for met in ("ADR", "KPR", "KDR"):
            y = g["d_" + met].to_numpy()
            obs = wdiff(y, f_obs)
            nd = np.array([wdiff(y, nf) for nf in nulls])
            nd = nd[np.isfinite(nd)]
            p = float((np.sum(np.abs(nd) >= abs(obs)) + 1) / (len(nd) + 1))
            res.append({"factor": fac, "metric": met, "diff": float(obs), "p": p, "maps_on": int(f_obs.sum()), "maps": int(len(g)),
                        "players_on": int(g.loc[f_obs, "sid"].nunique()), "null_sd": float(nd.std()), "mde": float(2.8 * nd.std())})
    # day-level factors: deviations pooled per calendar day, circular shift of the factor over the calendar
    d0, d1 = int(g["day"].min()), int(g["day"].max())
    span = d1 - d0 + 1
    for fac in ("retro_Mercury", "moon_new", "moon_full"):
        f_day = a.loc[range(d0, d1 + 1), fac].to_numpy().astype(bool)
        for met in ("ADR", "KPR", "KDR"):
            ys = np.bincount(g["day"] - d0, weights=g["d_" + met] * w, minlength=span)
            ws = np.bincount(g["day"] - d0, weights=w, minlength=span)
            with np.errstate(invalid="ignore", divide="ignore"):
                yd = ys / ws
            r = shift_test(yd, f_day, n_perm=n_perm, min_shift=3, rng=rng, w=ws, min_days=3)  # < 3 days on/off: not testable
            fm = g[fac].to_numpy()
            res.append({"factor": fac, "metric": met, "diff": r["diff"] if r else None, "p": r["p"] if r else None,
                        "maps_on": int(fm.sum()), "maps": int(len(g)), "days_on": int(r["days"]) if r else int(f_day[ws > 0].sum()),
                        "null_sd": r["null_sd"] if r else None, "mde": r["mde"] if r else None})
    ok = [r for r in res if r["p"] is not None]
    q = bh([r["p"] for r in ok])
    for r, qq in zip(ok, q):
        r["q"] = qq
    info = {"players": int(len(sids)), "maps": int(len(g)), "from": str(g["date"].min()), "to": str(g["date"].max()),
            "days": int(g["date"].nunique())}
    log(f"внутри игроков: {info}")
    return res, info


# --------------------------------------------------------------------------- #
# charts
# --------------------------------------------------------------------------- #
ORANGE, BLUE, GREY, DARK = "#e8650c", "#4e8ddb", "#9aa5b1", "#3b4250"


def plots(out: Path, res, real, cyc, days, Y, W, between, agg, band, dist, within, matches=None):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False, "font.family": "DejaVu Sans"})
    # 1. forest: main factors on excess upsets
    main = [r for r in res if r["outcome"] == "upset" and (r["feature"].startswith(("retro_", "moon_new", "moon_full", "moon_waxing", "eclipse", "tense_day", "ingress_")))]
    main.sort(key=lambda r: r["label"])
    if main:
        fig, ax = plt.subplots(figsize=(8.5, 0.32 * len(main) + 1.4))
        yy = np.arange(len(main))
        ax.barh(yy, [3.92 * r["null_sd"] * 100 for r in main], left=[-1.96 * r["null_sd"] * 100 for r in main], color=GREY, alpha=0.35, height=0.6,
                label="разброс случайности (95%)")
        ax.scatter([r["diff"] * 100 for r in main], yy, color=[ORANGE if r["q"] < 0.1 else DARK for r in main], zorder=3, s=22, label="наблюдаемый эффект")
        ax.axvline(0, color="#666", lw=0.8)
        ax.set_yticks(yy, [f"{r['label']} ({r['days']} дн.)" for r in main], fontsize=8)
        ax.set_xlabel("изменение доли апсетов, п.п. (сверх ожидаемого по Эло)")
        ax.set_title("Апсеты в дни астрособытий и разброс случайности")
        ax.legend(frameon=False, fontsize=8, loc="lower right")
        fig.tight_layout()
        fig.savefig(out / "factors.png", dpi=150)
        plt.close(fig)
    # 2. p-values
    fig, ax = plt.subplots(figsize=(5.5, 3.4))
    ax.hist([r["p"] for r in res], bins=20, range=(0, 1), color=GREY, edgecolor="white")
    ax.axhline(len(res) / 20, color=ORANGE, ls="--", lw=1, label="ожидается при отсутствии связи")
    ax.set_title(f"p-значения всех {len(res)} проверок (матчи)")
    ax.legend(frameon=False, fontsize=8)
    fig.tight_layout()
    fig.savefig(out / "pvalues.png", dpi=150)
    plt.close(fig)
    # 3. real effects: Elo gap → favourite's win rate; differences with 95% CI — real factors next to astro ones
    fig, axs = plt.subplots(1, 2, figsize=(12, 4.4), gridspec_kw={"width_ratios": [1, 1.25]})
    gb = real["elo_gap"]
    x = np.arange(len(gb))
    obs = np.array([g["obs"] for g in gb])
    nn = np.array([g["n"] for g in gb])
    se = np.sqrt(obs * (1 - obs) / nn)
    axs[0].bar(x, obs * 100, color=BLUE, alpha=0.8, label="факт")
    axs[0].errorbar(x, obs * 100, yerr=1.96 * se * 100, fmt="none", ecolor=DARK, lw=1, capsize=3)
    axs[0].plot(x, [g["pred"] * 100 for g in gb], "_", color=ORANGE, ms=22, mew=2.5, label="прогноз Эло")
    axs[0].set_xticks(x, [g["gap"] for g in gb], fontsize=8)
    axs[0].set_ylim(40, 95)
    axs[0].set_xlabel("разница рейтингов Эло перед матчем")
    axs[0].set_ylabel("побед фаворита, %")
    axs[0].set_title("Настоящий эффект: сила команды")
    axs[0].legend(frameon=False, fontsize=8, loc="upper left")
    rows = []
    for key, lab in (("online_vs_lan_upset", "Онлайн − LAN: апсеты"), ("a_vs_s_upset", "A-тир − S-тир: апсеты"),
                     ("bo3_vs_bo1_same_gap", "Bo3 − Bo1: победы фаворита\nпри равной разнице Эло"), ("close_cs2_vs_csgo", "CS2 (MR12) − CS:GO (MR15):\nблизкие карты")):
        if key in real:
            rows.append((lab, real[key]["diff"], real[key]["ci"], "real"))
    for feat, outc in (("retro_Mercury", "upset"), ("moon_full", "upset"), ("moon_new", "upset"), ("eclipse", "upset"), ("retro_Mercury", "close"), ("moon_full", "close")):
        r = next((r for r in res if r["feature"] == feat and r["outcome"] == outc), None)
        if r:
            what = {"upset": "апсеты", "close": "близкие карты"}[outc]
            rows.append((f"{r['label'].replace(' (±1 день)', '')}: {what}", r["diff"], [r["diff"] - 1.96 * r["null_sd"], r["diff"] + 1.96 * r["null_sd"]], "astro"))
    y = np.arange(len(rows))[::-1]
    for yy, (lab, d, ci, kind) in zip(y, rows):
        c = DARK if kind == "real" else ORANGE
        axs[1].plot([ci[0] * 100, ci[1] * 100], [yy, yy], color=c, lw=2, alpha=0.6)
        axs[1].plot(d * 100, yy, "o", color=c, ms=6)
    axs[1].axvline(0, color="#666", lw=0.8)
    axs[1].set_yticks(y, [r[0] for r in rows], fontsize=8)
    axs[1].set_xlabel("разница, п.п. (95% интервал)")
    axs[1].set_title("Реальные факторы (тёмные) и астрология (оранжевые)")
    fig.tight_layout()
    fig.savefig(out / "real_effects.png", dpi=150)
    plt.close(fig)
    # 4. cycles
    grid, obs, n95, gmax95 = cyc
    fig, ax = plt.subplots(figsize=(10, 3.4))
    ax.semilogx(grid, obs, color=DARK, lw=0.8, label="периодограмма апсетов")
    ax.semilogx(grid, n95, color=GREY, lw=0.8, ls="--", label="95% случайности на этой частоте")
    ax.axhline(gmax95, color=GREY, lw=0.8, ls=":", label="95% для максимума по всем частотам")
    for lab, p in (("неделя", 7), ("Луна в знаках", 27.32), ("фазы Луны", 29.53), ("Меркурий", 115.88), ("год", 365.25)):
        ax.axvline(p, color=ORANGE, ls=":", lw=1)
        ax.text(p, ax.get_ylim()[1] * 0.95, lab, rotation=90, fontsize=8, color=ORANGE, ha="right", va="top")
    ax.set_xlabel("период, дней")
    ax.set_title("Циклы в доле апсетов (Ломб–Скаргл)")
    ax.legend(frameon=False, fontsize=8, loc="upper left")
    fig.tight_layout()
    fig.savefig(out / "cycles.png", dpi=150)
    plt.close(fig)
    # 5. timeline: rolling excess of upsets over the last 200 matches, Mercury retrograde bands
    if matches is not None:
        el = matches[matches["eligible"]].sort_values("ts")
        roll = el["excess"].rolling(200, min_periods=100).mean() * 100
        fig, ax = plt.subplots(figsize=(11, 3.4))
        ax.plot(el["date"], roll, color=ORANGE, lw=1.2)
        rb = days["retro_Mercury"].to_numpy() if "retro_Mercury" in days else np.zeros(len(days), bool)
        i = 0
        while i < len(rb):
            if rb[i]:
                j = i
                while j < len(rb) and rb[j]:
                    j += 1
                ax.axvspan(days["date"].iloc[i], days["date"].iloc[j - 1], color=BLUE, alpha=0.15, lw=0)
                i = j
            else:
                i += 1
        ax.axhline(0, color="#666", lw=0.8)
        ax.set_ylabel("п.п. сверх ожидания")
        ax.set_title("Апсеты сверх ожидаемого по Эло, скользящие 200 матчей · синие полосы — ретроградный Меркурий")
        fig.tight_layout()
        fig.savefig(out / "timeline.png", dpi=150)
        plt.close(fig)
    # 6. players: ADR by Sun sign with the chance band
    if agg is not None and len(agg):
        fig, axs = plt.subplots(1, 2, figsize=(11, 3.8))
        m = agg.groupby("sun")["ADR"].mean().reindex(range(12))
        x = np.arange(12)
        axs[0].fill_between(x, band["ADR"]["lo"], band["ADR"]["hi"], color=GREY, alpha=0.3, step="mid", label="95% случайности")
        axs[0].plot(x, m.to_numpy(), "o", color=ORANGE, label="средний ADR знака")
        axs[0].set_xticks(x, [s[:4] for s in SIGNS_RU], fontsize=8)
        axs[0].set_title(f"ADR по знаку Солнца ({len(agg)} игроков)")
        axs[0].legend(frameon=False, fontsize=8)
        axs[1].bar(x, dist["counts"], color=BLUE, alpha=0.8, label="игроков")
        axs[1].plot(x, dist["expected"], "_", color=DARK, ms=18, mew=2, label="ожидалось по числу дней")
        axs[1].set_xticks(x, [s[:4] for s in SIGNS_RU], fontsize=8)
        axs[1].set_title(f"Знаки Солнца у про-игроков (χ² p = {dist['p']:.2f})")
        axs[1].legend(frameon=False, fontsize=8)
        fig.tight_layout()
        fig.savefig(out / "players.png", dpi=150)
        plt.close(fig)


# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hist", default="store/matches-hist")
    ap.add_argument("--players", default="store/nades-site/players")
    ap.add_argument("--out", default="store/astro-matches")
    ap.add_argument("--no-power", action="store_true")
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    logs = []

    def log(*x):
        s = " ".join(str(v) for v in x)
        print(s, flush=True)
        logs.append(s)

    matches, mstats = prepare_matches(Path(a.hist), log)
    el = matches[matches["eligible"]]
    start = dnum(ANALYSIS_FROM)
    end = dnum(max(matches["date"]))
    log(f"матчей всего {len(matches)}, в анализе апсетов {len(el)} ({el['date'].min()} … {el['date'].max()}), K={mstats['elo_K']}")
    # astro table also covers the player games (2026) and a margin
    pl_dir = Path(a.players)
    astro = astro_table(start, max(end, dnum(dt.date.today())))
    days = daily_outcomes(matches, start, end)
    res, Y, W, dd, split_date = match_tests(days, astro, log)
    n_tests = len(res)
    summ = {
        "from": str(ANALYSIS_FROM), "to": str(days["date"].iloc[-1]), "split_date": split_date,
        "matches_total": int(len(matches)), "matches_sa_period": int((matches["tier"].isin(["S", "A"]) & (matches["date"] >= ANALYSIS_FROM)).sum()),
        "matches_upset": int(len(el)), "days_with_matches": int((W["upset"] > 0).sum()), "maps_close": int(W["close"].sum()), "bo3": int(W["decider"].sum()),
        "teams": int(pd.concat([el["t1"], el["t2"]]).nunique()), "tournaments": int(el["root"].nunique()),
        "by_year": {str(y): int(n) for y, n in el.groupby(el["date"].map(lambda d: d.year)).size().items()},
        "by_tier": {str(k): int(v) for k, v in el["tier"].value_counts().items()},
        "lan_share": float((el["lan"] == True).mean()),  # noqa: E712
        "tests": n_tests, "raw_p05": int(sum(r["p"] < 0.05 for r in res)), "expected_by_chance": round(n_tests * 0.05, 1),
        "fdr_q10": int(sum(r["q"] < 0.1 for r in res)), "replicated": int(sum(r["replicates"] for r in res)),
        "fdr_and_replicated": int(sum(r["q"] < 0.1 and r["replicates"] for r in res)),
        "mde_median": {k: float(np.median([r["mde"] for r in res if r["outcome"] == k])) for k in OUTCOMES},
        "mde_by_feature": {r["feature"]: r["mde"] for r in res if r["outcome"] == "upset" and r["feature"] in ("retro_Mercury", "moon_full", "moon_new", "eclipse", "retro_Mars", "moon_waxing")},
        "parse": mstats,
    }
    log(json.dumps({k: v for k, v in summ.items() if k != "parse"}, ensure_ascii=False))
    for r in res[:10]:
        log(f"{r['p']:.4f} q={r['q']:.2f} rep={r['replicates']} {r['outcome']:7s} {r['label']} ({r['days']} дн.) {r['diff'] * 100:+.2f} п.п. MDE {r['mde'] * 100:.1f}")
    real = real_effects(matches)
    log("реальные эффекты: " + json.dumps({k: v for k, v in real.items() if isinstance(v, dict)}, ensure_ascii=False)[:1500])
    power = {} if a.no_power else power_check(days, astro, matches, start, end, log)
    cyc, cyc_plot = cycles({"upset": dd["upset"]}, W, dd)
    # sensitivity: the plain daily upset share (not relative to Elo) as the outcome — a separate family
    raw_days = days.copy()
    raw_days["upset"] = raw_days["upset_raw"]
    sres, *_ = match_tests(raw_days, astro, log)
    sres = [r for r in sres if r["outcome"] == "upset"]
    sq = bh([r["p"] for r in sres])
    summ["sensitivity_raw_upset"] = {"tests": len(sres), "raw_p05": int(sum(r["p"] < 0.05 for r in sres)), "fdr_q10": int(sum(x < 0.1 for x in sq)),
                                     "replicated": int(sum(r["replicates"] for r in sres)),
                                     "fdr_and_replicated": int(sum(x < 0.1 and r["replicates"] for r, x in zip(sres, sq)))}
    log(f"чувствительность (сырая доля апсетов): {summ['sensitivity_raw_upset']}")
    log("циклы: " + json.dumps(cyc, ensure_ascii=False)[:800])
    # players
    between = within = None
    agg = band = dist = None
    pinfo = {}
    within_info = {}
    if (pl_dir / "index.json").exists():
        people, pcounts = match_players(pl_dir, Path(a.hist) / "players.json", log)
        pinfo = pcounts
        games = games_table(people)
        if len(games):
            between, agg, band, dist = players_between(people, games, log)
            within, within_info = players_within(people, games, astro, log)
    result = {
        "title": "Про-матчи CS и астрология",
        "summary": summ, "tests": res, "real_effects": real, "power": power, "cycles": cyc,
        "players": {"matching": pinfo, "between": between, "sun_sign_distribution": dist, "within": within, "within_info": within_info,
                    "between_players_n": int(len(agg)) if agg is not None else 0},
        "sources": {"matches": "Liquipedia Counter-Strike wiki (liquipedia.net/counterstrike), CC BY-SA 3.0",
                    "players": "демки турниров (OpenCS2 и др., CC BY 4.0) → nades-site; даты рождения — Liquipedia, CC BY-SA 3.0",
                    "ephemeris": "PyEphem (VSOP87/ELP), 12:00 UTC"},
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "log": logs,
    }
    (out / "results.json").write_text(json.dumps(result, ensure_ascii=False, indent=1, default=str))
    plots(out, res, real, cyc_plot, dd, Y, W, between, agg, band, dist, within, matches)
    log(f"готово → {out}")


if __name__ == "__main__":
    main()
