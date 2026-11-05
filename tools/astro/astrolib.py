"""Общая часть астро-анализов (рынок скинов, матчи): эфемериды по дням и статистические тесты.

astro_table(start, end) — таблица астрофакторов на каждый день (12:00 UTC, PyEphem):
  retro_<Planet>, moon_new / moon_full / moon_waxing, moon_sign, sun_sign, ingress_<Planet>,
  asp_<A>_<B>_<angle> (точные мажорные аспекты, орбис 1.5°), hard_aspects, tense_day, eclipse.
natal_longitudes(date) — долготы планет на дату рождения (полдень UTC, время рождения обычно неизвестно).
shift_test(y, f[, w=веса]) — разница средних «дни с фактором − остальные» и p-значение по циклическим сдвигам
  (с весами — взвешенные средние, например по числу матчей в день).
bh(p) — поправка Бенджамини–Хохберга.
Дни считаются от 2013-01-01, как во всех данных сайта.
"""
from __future__ import annotations

import datetime as dt
import math

import numpy as np
import pandas as pd

DAY0 = dt.date(2013, 1, 1)
SIGNS_RU = ["Овен", "Телец", "Близнецы", "Рак", "Лев", "Дева", "Весы", "Скорпион", "Стрелец", "Козерог", "Водолей", "Рыбы"]
BODIES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"]
BODY_RU = {"Sun": "Солнце", "Moon": "Луна", "Mercury": "Меркурий", "Venus": "Венера", "Mars": "Марс", "Jupiter": "Юпитер",
           "Saturn": "Сатурн", "Uranus": "Уран", "Neptune": "Нептун", "Pluto": "Плутон"}
ASPECTS = {0: "соединение", 60: "секстиль", 90: "квадрат", 120: "трин", 180: "оппозиция"}
ORB = 1.5  # degrees: "exact" aspect day (Moon excluded from pair aspects — it moves 13°/day)


def day_to_date(d: int) -> dt.date:
    return DAY0 + dt.timedelta(days=int(d))


# --------------------------------------------------------------------------- #
# astrology
# --------------------------------------------------------------------------- #
def ecl_lon(body, when) -> tuple[float, float]:
    import ephem
    b = getattr(ephem, body)()
    b.compute(when, epoch=when)
    e = ephem.Ecliptic(b, epoch=when)
    return math.degrees(e.lon) % 360, math.degrees(e.lat)


def astro_table(start: int, end: int) -> pd.DataFrame:
    import ephem
    rows = []
    lon_prev = None
    days = range(start - 1, end + 2)
    lons = {}
    for d in days:
        date = day_to_date(d)
        when = ephem.Date(dt.datetime(date.year, date.month, date.day, 12))
        lons[d] = {b: ecl_lon(b, when) for b in BODIES}
    for d in range(start, end + 1):
        L = {b: lons[d][b][0] for b in BODIES}
        Ln = {b: lons[d + 1][b][0] for b in BODIES}
        Lp = {b: lons[d - 1][b][0] for b in BODIES}
        r = {"day": d}
        for b in ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"]:
            r[f"retro_{b}"] = ((Ln[b] - L[b] + 540) % 360 - 180) < 0
        elong = (L["Moon"] - L["Sun"]) % 360
        r["moon_elong"] = elong
        r["moon_new"] = min(elong, 360 - elong) < 12
        r["moon_full"] = abs(elong - 180) < 12
        r["moon_waxing"] = elong < 180
        r["moon_sign"] = int(L["Moon"] // 30)
        r["sun_sign"] = int(L["Sun"] // 30)
        r["moon_void_like"] = False
        for b in ["Sun", "Mercury", "Venus", "Mars"]:
            r[f"ingress_{b}"] = int(Lp[b] // 30) != int(L[b] // 30)
        hard = 0
        for i, a in enumerate(BODIES):
            if a == "Moon":
                continue
            for bb in BODIES[i + 1:]:
                if bb == "Moon":
                    continue
                sep = abs((L[a] - L[bb] + 540) % 360 - 180)
                for ang, name in ASPECTS.items():
                    if abs(sep - ang) <= ORB:
                        r[f"asp_{a}_{bb}_{ang}"] = True
                        if ang in (0, 90, 180):
                            hard += 1
        r["hard_aspects"] = hard
        r["tense_day"] = hard >= 3
        rows.append(r)
    df = pd.DataFrame(rows).fillna(False)
    # eclipses: new/full moon with the Moon close to the ecliptic (node)
    ecl = set()
    when = ephem.Date(day_to_date(start - 20).isoformat())
    stop = ephem.Date(day_to_date(end + 20).isoformat())
    for fn, lim in ((ephem.next_new_moon, 1.5), (ephem.next_full_moon, 1.0)):
        w = when
        while True:
            w = fn(w)
            if w > stop:
                break
            m = ephem.Moon()
            m.compute(w, epoch=w)
            lat = math.degrees(ephem.Ecliptic(m, epoch=w).lat)
            if abs(lat) < lim:
                ed = (w.datetime().date() - DAY0).days
                for k in range(-1, 2):
                    ecl.add(ed + k)
            w = ephem.Date(w + 1)
    df["eclipse"] = df["day"].isin(ecl)
    for c in df.columns:
        if c.startswith(("retro_", "moon_new", "moon_full", "moon_waxing", "ingress_", "asp_", "tense_day", "eclipse", "moon_void")):
            df[c] = df[c].astype(bool)
    return df


def feature_label(c: str) -> str:
    if c.startswith("retro_"):
        return f"{BODY_RU[c[6:]]} ретроградный"
    if c.startswith("ingress_"):
        return f"{BODY_RU[c[8:]]} меняет знак"
    if c.startswith("asp_"):
        _, a, b, ang = c.split("_")
        return f"{BODY_RU[a]} — {BODY_RU[b]}: {ASPECTS[int(ang)]}"
    if c.startswith("moon_sign_"):
        return f"Луна в знаке {SIGNS_RU[int(c.split('_')[-1])]}"
    if c.startswith("sun_sign_"):
        return f"Солнце в знаке {SIGNS_RU[int(c.split('_')[-1])]}"
    return {"moon_new": "Новолуние (±1 день)", "moon_full": "Полнолуние (±1 день)", "moon_waxing": "Растущая Луна",
            "eclipse": "Затмение (±1 день)", "tense_day": "День с ≥3 напряжёнными аспектами"}.get(c, c)


# --------------------------------------------------------------------------- #
# statistics
# --------------------------------------------------------------------------- #
def adjust_weekday(s: pd.Series, dates) -> pd.Series:
    wd = pd.Series([d.weekday() for d in dates], index=s.index)
    return s - s.groupby(wd).transform("mean")


def shift_test(y: np.ndarray, f: np.ndarray, n_perm=2000, min_shift=30, rng=None, w: np.ndarray | None = None, min_days=15):
    """difference of means (f days − other days) with a circular-shift null distribution.
    w (optional): weights per day (e.g. number of matches) — then weighted means, i.e. the difference between
    all events on f days and all events on other days; computed for every shift at once via FFT."""
    if w is not None:
        return _shift_test_w(y, f, w, n_perm, min_shift, rng, min_days)
    ok = ~np.isnan(y)
    y, f = y[ok], f[ok].astype(bool)
    n = len(y)
    k = f.sum()
    if k < 15 or n - k < 15:
        return None
    obs = y[f].mean() - y[~f].mean()
    rng = rng or np.random.default_rng(1)
    shifts = rng.integers(min_shift, n - min_shift, n_perm)
    null = np.empty(n_perm)
    for i, s in enumerate(shifts):
        g = np.roll(f, s)
        null[i] = y[g].mean() - y[~g].mean()
    p = (np.sum(np.abs(null) >= abs(obs)) + 1) / (n_perm + 1)
    # smallest effect this test would catch ~80% of the time at p < 0.05: (1.96 + 0.84) × spread of the null
    return {"diff": float(obs), "p": float(p), "days": int(k), "null_sd": float(null.std()), "mde": float(2.8 * null.std())}


def _shift_test_w(y, f, w, n_perm, min_shift, rng, min_days):
    ok = ~np.isnan(y) & (np.asarray(w) > 0)
    y, f, w = np.asarray(y, float)[ok], np.asarray(f)[ok].astype(bool), np.asarray(w, float)[ok]
    n = len(y)
    k = int(f.sum())
    if k < min_days or n - k < min_days or n < 2 * min_shift + 2:
        return None
    a = w * y
    fa, fw, ff = np.fft.rfft(a), np.fft.rfft(w), np.fft.rfft(f.astype(float))
    # c[s] = Σ_i a[i]·f[i−s] — the sums over "factor days" when the factor is rolled by s
    s1 = np.fft.irfft(fa * np.conj(ff), n)
    n1 = np.fft.irfft(fw * np.conj(ff), n)
    tot_a, tot_w = a.sum(), w.sum()
    with np.errstate(divide="ignore", invalid="ignore"):
        diff_all = s1 / n1 - (tot_a - s1) / (tot_w - n1)
    obs = float(a[f].sum() / w[f].sum() - a[~f].sum() / w[~f].sum())
    rng = rng or np.random.default_rng(1)
    shifts = rng.integers(min_shift, n - min_shift, n_perm)
    null = diff_all[shifts]
    null = null[np.isfinite(null)]
    p = (np.sum(np.abs(null) >= abs(obs)) + 1) / (len(null) + 1)
    return {"diff": obs, "p": float(p), "days": k, "events": float(w[f].sum()), "null_sd": float(null.std()), "mde": float(2.8 * null.std())}


def bh(pvals: list[float]) -> list[float]:
    p = np.asarray(pvals)
    order = np.argsort(p)
    m = len(p)
    q = np.empty(m)
    prev = 1.0
    for rank, i in enumerate(order[::-1]):
        r = m - rank
        prev = min(prev, p[i] * m / r)
        q[i] = prev
    return q.tolist()


def periodogram(y: np.ndarray):
    y = y[~np.isnan(y)]
    y = y - y.mean()
    n = len(y)
    f = np.fft.rfftfreq(n, 1.0)[1:]
    pw = np.abs(np.fft.rfft(y))[1:] ** 2
    per = 1 / f
    return per, pw / pw.mean()




def natal_longitudes(date: dt.date) -> dict[str, float]:
    import ephem
    when = ephem.Date(dt.datetime(date.year, date.month, date.day, 12))
    return {b: ecl_lon(b, when)[0] for b in BODIES}


def sign_of(lon: float) -> int:
    return int(lon // 30) % 12


ELEMENTS_RU = ["Огонь", "Земля", "Воздух", "Вода"]  # Овен=огонь, Телец=земля, Близнецы=воздух, Рак=вода, …
def element_of(sign: int) -> int:
    return sign % 4
