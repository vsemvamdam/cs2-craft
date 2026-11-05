#!/usr/bin/env python3
"""Про-демки из открытого датасета OpenCS2 (Hugging Face: blanchon/opencs2_dataset_demo,
CC BY 4.0) — ~2000 карт HLTV за март–апрель 2026 — через extract_nades.py.

  python3 tools/demos/fetch_opencs2.py --per-map 3

* Читает parquet с метаданными, выбирает карты Active Duty с самых крупных турниров
  (IEM, BLAST, PGL, ESL Pro League, Major…), по N новых демок на карту за запуск.
* Метаданные матча (турнир, команды, дата, ссылка HLTV) берёт из meta.json рядом с демкой.
* Каждую демку скачивает, разбирает и удаляет. Итог — tools/demos/last_run.json.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = "blanchon/opencs2_dataset_demo"
PROCESSED = HERE / "processed.json"
LAST_RUN = HERE / "last_run.json"
ACTIVE = ["mirage", "inferno", "nuke", "ancient", "anubis", "dust2", "cache"]
TOP = re.compile(r"IEM|Intel Extreme|BLAST|PGL|ESL Pro League|Pro League|Major|StarSeries|Thunderpick|Perfect World|Esports World Cup|EWC|FISSURE|CCT Global|Cologne|Katowice|Austin|Atlanta", re.I)


def log(*a):
    print(*a, flush=True)


def map_of(path: str) -> str | None:
    name = path.rsplit("/", 1)[-1].lower()
    for m in ACTIVE:
        if re.search(rf"[-_]{m}(?:[-_.]|$)", name) or (m == "dust2" and re.search(r"[-_]dust-?2", name)):
            return m
    return None


def pick_col(cols, *needles):
    for n in needles:
        for c in cols:
            if n in c.lower():
                return c
    return None


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-map", type=int, default=3)
    args = ap.parse_args(argv)

    import pandas as pd  # noqa: PLC0415
    from huggingface_hub import HfApi, hf_hub_download  # noqa: PLC0415

    api = HfApi()
    report: dict = {"started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "repo": REPO, "errors": [], "done": []}
    processed = set(json.loads(PROCESSED.read_text())) if PROCESSED.exists() else set()

    # 1) metadata
    try:
        files = api.list_repo_files(REPO, repo_type="dataset")
    except Exception as e:  # noqa: BLE001
        report["errors"].append(f"list: {type(e).__name__}: {str(e)[:300]}")
        LAST_RUN.write_text(json.dumps(report, ensure_ascii=False, indent=1))
        return 0
    dems = [f for f in files if f.endswith(".dem")]
    report["files"] = len(files)
    report["dems"] = len(dems)
    rows = []
    for pq in [f for f in files if f.endswith(".parquet")][:20]:
        try:
            df = pd.read_parquet(hf_hub_download(REPO, filename=pq, repo_type="dataset"))
            rows.append(df)
        except Exception as e:  # noqa: BLE001
            report["errors"].append(f"parquet {pq}: {e}")
    meta = pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()
    cols = list(meta.columns)
    report["columns"] = cols
    path_col = next((c for c in cols if meta[c].astype(str).str.endswith(".dem").any()), None)
    ev_col = pick_col(cols, "event", "tournament")
    date_col = pick_col(cols, "match_date", "date")
    report["path_col"], report["event_col"], report["date_col"] = path_col, ev_col, date_col

    # 2) candidates: active-duty maps, prefer top events, newest first
    cand = []
    by_name = {d.rsplit("/", 1)[-1]: d for d in dems}
    if path_col:
        for _, r in meta.iterrows():
            p = str(r[path_col])
            full = p if p in files else by_name.get(p.rsplit("/", 1)[-1])
            if not full or full in processed:
                continue
            mp = map_of(full)
            if not mp:
                continue
            ev = str(r[ev_col]) if ev_col else ""
            try:
                stars = int(r["stars"]) if "stars" in cols and str(r["stars"]) not in ("", "nan", "None") else 0
            except (TypeError, ValueError):
                stars = 0
            top = bool(TOP.search(ev)) and not re.search(r"qualifier|academy|series \d", ev, re.I)
            cand.append({"path": full, "map": mp, "event": ev, "date": str(r[date_col])[:10] if date_col else "", "top": top, "stars": stars})
    else:  # no usable metadata: fall back to file paths only
        for d in dems:
            mp = map_of(d)
            if mp and d not in processed:
                cand.append({"path": d, "map": mp, "event": "", "date": "", "top": False})
    if ev_col:
        report["top_events"] = sorted({c["event"] for c in cand if c["top"]})[:40]
    picked = []
    for mp in ACTIVE:
        # HLTV "stars" = how big the match is; then tier-1 events; then newest
        pool = sorted((c for c in cand if c["map"] == mp), key=lambda c: (c.get("stars", 0), c["top"], c["date"]), reverse=True)
        picked += pool[: args.per_map]
    report["candidates"] = len(cand)
    report["picked"] = [p["path"] for p in picked]
    log(f"демок {len(dems)}, кандидатов {len(cand)}, выбрано {len(picked)}")

    # 3) download + extract
    for c in picked:
        with tempfile.TemporaryDirectory(prefix="opencs2_") as tmp:
            try:
                info = {}
                mj = c["path"].rsplit("/", 1)[0] + "/meta.json"
                if mj in files:
                    try:
                        info = json.loads(Path(hf_hub_download(REPO, filename=mj, repo_type="dataset", local_dir=tmp)).read_text(encoding="utf-8"))
                    except Exception:  # noqa: BLE001
                        info = {}
                def g(*keys):
                    for k in keys:
                        v = info.get(k) if isinstance(info, dict) else None
                        if isinstance(v, dict):
                            v = v.get("name")
                        if v:
                            return str(v)
                    return ""
                event = g("event", "event_name", "tournament") or c["event"]
                t1, t2 = g("team1", "team1_name", "team_a"), g("team2", "team2_name", "team_b")
                stem = c["path"].rsplit("/", 1)[-1][:-4]
                match = f"{t1} vs {t2}" if t1 and t2 else re.sub(r"-m\d+-\w+$", "", stem).replace("-vs-", " vs ").replace("-", " ").title()
                url = g("url", "hltv_url", "match_url")
                mid = c["path"].split("/")[-2]
                if not url and mid.isdigit():
                    url = f"https://www.hltv.org/matches/{mid}/{re.sub(r'-m\d+-.*$', '', stem)}"
                date = (g("date", "match_date") or c["date"])[:10]
                log(f"↓ {c['path']}")
                local = hf_hub_download(REPO, filename=c["path"], repo_type="dataset", local_dir=tmp)
                cmd = [sys.executable, "-I", str(HERE / "extract_nades.py"), local, "--match", match, "--url", url, "--event", event or "HLTV · 2026"]
                if re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
                    cmd += ["--date", date]
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
                tail = (r.stdout + r.stderr).strip().splitlines()[-2:]
                if r.returncode != 0:
                    raise RuntimeError(" | ".join(tail))
                processed.add(c["path"])
                report["done"].append({"path": c["path"], "map": c["map"], "event": event, "match": match, "date": date, "log": tail})
                log("  ✓", match, "|", event)
            except Exception as ex:  # noqa: BLE001
                report["errors"].append(f"{c['path']}: {type(ex).__name__}: {str(ex)[:300]}")
                log("  !", ex)
        PROCESSED.write_text(json.dumps(sorted(processed), ensure_ascii=False, indent=0))

    report["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    LAST_RUN.write_text(json.dumps(report, ensure_ascii=False, indent=1))
    log(f"готово: {len(report['done'])} разобрано, {len(report['errors'])} ошибок")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
