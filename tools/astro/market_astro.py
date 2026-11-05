#!/usr/bin/env python3
"""Рынок скинов CS2 и астрология: честная статистическая проверка.

Вход:  store/history/<skin>.json — дневная история сделок Steam Market (scripts/fetch-history.mjs):
       { <variant>: { cur, p: [[day, price_cents, volume], ...] } }, day = дни с 2013-01-01;
       store/history/_rates.json — курс ЦБ (RUB за USD по дням), если кошелёк был не в долларах.
Выход: <out>/results.json, <out>/*.png, <out>/report.md

Что делается:
1. Рыночный индекс: медиана дневных лог-доходностей всех ликвидных вариантов (робастно к выбросам),
   суммарный объём продаж; из всего вычитается эффект дня недели.
2. Астрофакторы на каждый день (эфемериды PyEphem, 12:00 UTC): ретроградность планет, фазы Луны,
   затмения, Луна и Солнце в знаках, смена знаков, точные мажорные аспекты между планетами.
3. Для каждого фактора и показателя (доходность, волатильность |доходность|, изменение объёма) —
   разница «дни с фактором минус остальные дни». Значимость: тест циклическими сдвигами (фактор
   сдвигается по календарю на случайное число дней ≥ 30, 2000 раз — это сохраняет автокорреляцию
   рынка и самого фактора), поправка Бенджамини–Хохберга на множественные сравнения, и проверка
   воспроизводимости: эффект, найденный в первых 60% периода, должен повториться в последних 40%.
4. Циклы: периодограмма индекса и объёма — какие периоды (7 дней, ~29.5 дня, 365 дней…) реально есть.

  python3 tools/astro/market_astro.py --history store/history --out store/astro --years 5
  python3 tools/astro/market_astro.py --synthetic   # проверка мощности на данных с подмешанным эффектом
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from astrolib import (  # noqa: E402
    ASPECTS, BODIES, BODY_RU, DAY0, ORB, SIGNS_RU, adjust_weekday, astro_table, bh, day_to_date, feature_label, periodogram, shift_test,
)


# --------------------------------------------------------------------------- #
# market index
# --------------------------------------------------------------------------- #
def load_rates(hist_dir: Path):
    f = hist_dir / "_rates.json"
    if not f.exists():
        return {}
    j = json.loads(f.read_text())
    out = {}
    for k in ("RUB", "EUR_RUB", "CNY_RUB"):
        if j.get(k):
            s = pd.Series({d: v for d, v in j[k]}).sort_index()
            out[k] = s.reindex(range(int(s.index.min()), int(s.index.max()) + 1)).ffill()
    return out


def to_usd(cur: str, days: np.ndarray, prices: np.ndarray, rates) -> np.ndarray | None:
    if cur == "USD":
        return prices
    rub = rates.get("RUB")
    if rub is None:
        return None
    r = rub.reindex(days).ffill().bfill().to_numpy()
    if cur == "RUB":
        return prices / r
    cross = rates.get(f"{cur}_RUB")
    if cross is None:
        return None
    return prices * cross.reindex(days).ffill().bfill().to_numpy() / r


def build_index(hist_dir: Path, start: int, end: int, min_items=40):
    rates = load_rates(hist_dir)
    n_days = end - start + 1
    ret_lists: list[list[float]] = [[] for _ in range(n_days)]
    vol = np.zeros(n_days)
    used = 0
    for f in sorted(hist_dir.glob("*.json")):
        if f.name.startswith("_"):
            continue
        try:
            j = json.loads(f.read_text())
        except json.JSONDecodeError:
            continue
        for vk, v in j.items():
            p = v.get("p") or []
            if len(p) < 120:
                continue
            a = np.asarray(p, dtype=float)
            days, price, vols = a[:, 0].astype(int), a[:, 1], a[:, 2]
            usd = to_usd(v.get("cur", "USD"), days, price, rates)
            if usd is None:
                continue
            m = (days >= start) & (days <= end) & (usd > 0)
            if m.sum() < 60:
                continue
            days, usd, vols = days[m], usd[m], vols[m]
            used += 1
            np.add.at(vol, days - start, vols)
            consec = np.diff(days) == 1
            lr = np.diff(np.log(usd))[consec]
            lr = np.clip(lr, -0.5, 0.5)
            for d, r in zip(days[1:][consec], lr):
                ret_lists[d - start].append(r)
    idx = pd.DataFrame({"day": np.arange(start, end + 1)})
    idx["n"] = [len(x) for x in ret_lists]
    idx["ret"] = [float(np.median(x)) if len(x) >= min_items else np.nan for x in ret_lists]
    idx["vol"] = vol
    idx["date"] = [day_to_date(d) for d in idx["day"]]
    return idx, used


def synthetic_index(start: int, end: int, astro: pd.DataFrame, inject: str | None, effect=0.0015, seed=7):
    """random market with weekly seasonality, volatility clustering and an optional injected astro effect"""
    rng = np.random.default_rng(seed)
    n = end - start + 1
    sig = np.empty(n)
    s = 0.01
    for i in range(n):
        s = 0.94 * s + 0.06 * 0.01 * (1 + 2 * rng.random())
        sig[i] = s
    ret = rng.standard_t(4, n) * sig / math.sqrt(2)
    wd = np.array([day_to_date(d).weekday() for d in range(start, end + 1)])
    ret += np.where(wd >= 5, 0.001, -0.0004)
    if inject:
        ret += effect * astro[inject].to_numpy().astype(float)
    vol = np.exp(9 + 0.3 * np.sin(2 * np.pi * np.arange(n) / 365.25) + 0.15 * (wd >= 5) + rng.normal(0, 0.1, n))
    return pd.DataFrame({"day": np.arange(start, end + 1), "n": 500, "ret": ret, "vol": vol, "date": [day_to_date(d) for d in range(start, end + 1)]})


def analyze(idx: pd.DataFrame, astro: pd.DataFrame, out: Path, title: str):
    out.mkdir(parents=True, exist_ok=True)
    df = idx.merge(astro, on="day", how="inner")
    df = df[df["ret"].notna()].reset_index(drop=True)
    dates = df["date"].tolist()
    lv = np.log(df["vol"].replace(0, np.nan))
    y = {
        "ret": adjust_weekday(df["ret"], dates),
        "absret": adjust_weekday(df["ret"].abs(), dates),
        "dvol": adjust_weekday(lv.diff(), dates),
    }
    signs = {f"moon_sign_{m}": df["moon_sign"] == m for m in range(12)} | {f"sun_sign_{m}": df["sun_sign"] == m for m in range(12)}
    df = pd.concat([df, pd.DataFrame(signs)], axis=1)
    feats = [c for c in df.columns if c.startswith(("retro_", "moon_new", "moon_full", "moon_waxing", "ingress_", "asp_", "tense_day", "eclipse", "moon_sign_", "sun_sign_"))]
    feats = [c for c in feats if 15 <= df[c].sum() <= len(df) - 15]
    split = int(len(df) * 0.6)
    rng = np.random.default_rng(42)
    res = []
    for c in feats:
        f = df[c].to_numpy()
        for k, s in y.items():
            yy = s.to_numpy()
            full = shift_test(yy, f, rng=rng)
            if not full:
                continue
            a = shift_test(yy[:split], f[:split], n_perm=1000, rng=rng)
            b = shift_test(yy[split:], f[split:], n_perm=1000, rng=rng)
            res.append({"feature": c, "label": feature_label(c), "metric": k, **full,
                        "p_first": a["p"] if a else None, "diff_first": a["diff"] if a else None,
                        "p_last": b["p"] if b else None, "diff_last": b["diff"] if b else None})
    q = bh([r["p"] for r in res])
    for r, qq in zip(res, q):
        r["q"] = qq
        r["replicates"] = bool(r["p_first"] is not None and r["p_last"] is not None and r["p_first"] < 0.05 and r["p_last"] < 0.05
                               and np.sign(r["diff_first"]) == np.sign(r["diff_last"]))
    res.sort(key=lambda r: r["p"])
    n_tests = len(res)
    n_raw = sum(r["p"] < 0.05 for r in res)
    n_fdr = sum(r["q"] < 0.1 for r in res)
    n_rep = sum(r["replicates"] for r in res)
    # weekday effect, for comparison with a known real effect
    wd = pd.Series([d.weekday() for d in dates])
    weekday = {int(k): float(v) for k, v in df["ret"].groupby(wd).mean().items()}
    wd_vol = {int(k): float(v) for k, v in lv.diff().groupby(wd).mean().items()}
    per_r, pw_r = periodogram(y["absret"].to_numpy())
    per_v, pw_v = periodogram(lv.diff().to_numpy())

    def peaks(per, pw, n=8):
        m = (per >= 2.5) & (per <= 400)
        i = np.argsort(pw[m])[::-1][:n]
        return [{"period": float(per[m][j]), "power": float(pw[m][j])} for j in i]

    summary = {
        "title": title, "from": str(dates[0]), "to": str(dates[-1]), "days": len(df),
        "tests": n_tests, "raw_p05": n_raw, "expected_by_chance": round(n_tests * 0.05, 1), "fdr_q10": n_fdr, "replicated": n_rep,
        "weekday_ret": weekday, "weekday_dvol": wd_vol,
        "peaks_absret": peaks(per_r, pw_r), "peaks_dvol": peaks(per_v, pw_v),
        "items_median": float(df["n"].median()),
    }
    (out / "results.json").write_text(json.dumps({"summary": summary, "tests": res}, ensure_ascii=False, indent=1, default=str))
    plots(df, y, res, per_r, pw_r, per_v, pw_v, out)
    return summary, res


def plots(df, y, res, per_r, pw_r, per_v, pw_v, out: Path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
    # 1. index with Mercury retrograde bands
    fig, ax = plt.subplots(figsize=(11, 3.6))
    level = np.exp(np.nancumsum(df["ret"].fillna(0)))
    ax.plot(df["date"], level, color="#e8650c", lw=1.4)
    rb = df["retro_Mercury"].to_numpy()
    i = 0
    while i < len(rb):
        if rb[i]:
            j = i
            while j < len(rb) and rb[j]:
                j += 1
            ax.axvspan(df["date"].iloc[i], df["date"].iloc[j - 1], color="#4e8ddb", alpha=0.15, lw=0)
            i = j
        else:
            i += 1
    ax.set_title("Индекс рынка скинов (медианная доходность) · синие полосы — ретроградный Меркурий")
    ax.set_yscale("log")
    fig.tight_layout()
    fig.savefig(out / "index.png", dpi=150)
    plt.close(fig)
    # 2. p-value histogram: under "no effect" it is flat
    fig, ax = plt.subplots(figsize=(5.5, 3.4))
    ax.hist([r["p"] for r in res], bins=20, range=(0, 1), color="#9aa5b1", edgecolor="white")
    ax.axhline(len(res) / 20, color="#e8650c", ls="--", lw=1, label="ожидается при отсутствии связи")
    ax.set_title("Распределение p-значений всех проверок")
    ax.legend(frameon=False, fontsize=8)
    fig.tight_layout()
    fig.savefig(out / "pvalues.png", dpi=150)
    plt.close(fig)
    # 3. periodograms
    fig, axs = plt.subplots(1, 2, figsize=(11, 3.4))
    for ax, per, pw, t in ((axs[0], per_r, pw_r, "Волатильность (|доходность|)"), (axs[1], per_v, pw_v, "Объём продаж (изменение)")):
        m = (per >= 2.5) & (per <= 400)
        ax.semilogx(per[m], pw[m], color="#4e5562", lw=0.8)
        for p, lab in ((7, "неделя"), (29.53, "лунный месяц"), (365.25, "год")):
            ax.axvline(p, color="#e8650c", ls=":", lw=1)
            ax.text(p, ax.get_ylim()[1] * 0.92, lab, rotation=90, fontsize=8, color="#e8650c", ha="right")
        ax.set_title(t)
        ax.set_xlabel("период, дней")
    fig.tight_layout()
    fig.savefig(out / "cycles.png", dpi=150)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--history", default="store/history")
    ap.add_argument("--out", default="store/astro")
    ap.add_argument("--years", type=float, default=5)
    ap.add_argument("--synthetic", action="store_true")
    a = ap.parse_args()
    end = (dt.date.today() - DAY0).days - 1
    start = end - int(a.years * 365.25)
    astro = astro_table(start, end)
    if a.synthetic:
        for inject in (None, "retro_Mercury"):
            idx = synthetic_index(start, end, astro, inject)
            s, res = analyze(idx, astro, Path(a.out) / f"synthetic-{inject or 'none'}", f"синтетика, подмешано: {inject}")
            top = [(r["label"], r["metric"], round(r["p"], 4), round(r["q"], 3), r["replicates"]) for r in res[:5]]
            print(json.dumps({k: s[k] for k in ("tests", "raw_p05", "expected_by_chance", "fdr_q10", "replicated")}, ensure_ascii=False), top)
        return
    idx, used = build_index(Path(a.history), start, end)
    print(f"вариантов в индексе: {used}, дней с индексом: {idx['ret'].notna().sum()}")
    s, res = analyze(idx, astro, Path(a.out), "Рынок скинов CS2 (Steam Market)")
    print(json.dumps({k: v for k, v in s.items() if not k.startswith("peaks")}, ensure_ascii=False, indent=1))
    for r in res[:12]:
        print(f"{r['p']:.4f} q={r['q']:.2f} rep={r['replicates']} {r['metric']:6s} {r['label']} ({r['days']} дн.) diff={r['diff']:+.5f}")


if __name__ == "__main__":
    main()
