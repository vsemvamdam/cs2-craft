#!/usr/bin/env python3
"""Берёт свежие про-демки из открытого датасета CounterQuant CS2 Demos (Hugging Face,
CC BY 4.0, демки HLTV Tier 1) и прогоняет их через extract_nades.py.

  python3 tools/demos/fetch_hf.py --per-map 4 --years 2026

* Выбирает самые новые матчи (по id матча HLTV) на картах Active Duty, по N на карту.
* Пропускает уже разобранные демки (tools/demos/processed.json).
* Каждую демку скачивает, разбирает и сразу удаляет — диска нужно на одну демку.
* Итог пишет в tools/demos/last_run.json (что нашлось, что разобрано, ошибки).

Датасет: https://huggingface.co/datasets/KEDevO/CounterQuant-CS2-Demos (автор Eimantas Kulbe).
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

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
REPO = "KEDevO/CounterQuant-CS2-Demos"
PROCESSED = HERE / "processed.json"
LAST_RUN = HERE / "last_run.json"
ACTIVE = ["mirage", "inferno", "nuke", "ancient", "anubis", "dust2", "cache"]
NAME_RE = re.compile(r"^data/(\d{4})/(tier[12])/(\d+)/([^/]+)\.dem$")


def log(*a):
    print(*a, flush=True)


def title(slug: str) -> str:
    teams = slug.split("-vs-")
    return " vs ".join(t.replace("-", " ").title() for t in teams) if len(teams) == 2 else slug.replace("-", " ").title()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default="2026", help="годы через запятую, по умолчанию 2026")
    ap.add_argument("--tier", default="tier1")
    ap.add_argument("--per-map", type=int, default=4, help="сколько новых демок на карту за запуск")
    ap.add_argument("--maps", default=",".join(ACTIVE))
    args = ap.parse_args(argv)

    from huggingface_hub import HfApi, hf_hub_download  # noqa: PLC0415

    api = HfApi()
    report: dict = {"started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "repo": REPO, "listed": 0, "candidates": 0, "done": [], "errors": [], "sample_paths": [], "other_files": []}
    processed = set(json.loads(PROCESSED.read_text())) if PROCESSED.exists() else set()
    maps = [m.strip() for m in args.maps.split(",") if m.strip()]

    entries = []
    for year in [y.strip() for y in args.years.split(",") if y.strip()]:
        base = f"data/{year}/{args.tier}"
        try:
            for f in api.list_repo_tree(REPO, path_in_repo=base, repo_type="dataset", recursive=True):
                p = getattr(f, "path", "")
                report["listed"] += 1
                if len(report["sample_paths"]) < 15:
                    report["sample_paths"].append(p)
                m = NAME_RE.match(p)
                if not m:
                    if not p.endswith("/") and "." in p.rsplit("/", 1)[-1] and len(report["other_files"]) < 20:
                        report["other_files"].append(p)
                    continue
                slug = m.group(4)
                mp = slug.rsplit("-", 1)[-1].lower()
                if mp == "2":  # "...-dust-2"
                    mp = "dust2"
                entries.append({"path": p, "year": m.group(1), "match_id": int(m.group(3)), "slug": slug, "map": mp, "size": getattr(f, "size", None)})
        except Exception as e:  # noqa: BLE001
            report["errors"].append(f"list {base}: {type(e).__name__}: {e}")
            log("! листинг не удался:", e)

    picked = []
    for mp in maps:
        fresh = sorted((e for e in entries if e["map"] == mp and e["path"] not in processed), key=lambda e: -e["match_id"])
        picked += fresh[: args.per_map]
    report["candidates"] = len(picked)
    log(f"в датасете {len(entries)} демок {args.tier}; выбрано {len(picked)}")

    for e in sorted(picked, key=lambda e: -e["match_id"]):
        slug_no_map = e["slug"].rsplit("-", 1)[0] if e["map"] != "dust2" else re.sub(r"-dust-?2$", "", e["slug"])
        meta_url = f"https://www.hltv.org/matches/{e['match_id']}/{slug_no_map}"
        with tempfile.TemporaryDirectory(prefix="hfdemo_") as tmp:
            try:
                log(f"↓ {e['path']} ({(e['size'] or 0) / 1e6:.0f} МБ)")
                local = hf_hub_download(REPO, filename=e["path"], repo_type="dataset", local_dir=tmp)
                cmd = [sys.executable, "-I", str(HERE / "extract_nades.py"), local,
                       "--match", title(slug_no_map), "--url", meta_url,
                       "--event", f"HLTV {args.tier.replace('tier', 'Tier ')} · {e['year']}"]
                r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
                tail = (r.stdout + r.stderr).strip().splitlines()[-3:]
                if r.returncode != 0:
                    raise RuntimeError(" | ".join(tail))
                processed.add(e["path"])
                report["done"].append({"path": e["path"], "map": e["map"], "match": title(slug_no_map), "log": tail})
                log("  ✓", " | ".join(tail))
            except Exception as ex:  # noqa: BLE001
                report["errors"].append(f"{e['path']}: {type(ex).__name__}: {str(ex)[:300]}")
                log("  !", ex)

    PROCESSED.write_text(json.dumps(sorted(processed), ensure_ascii=False, indent=0))
    report["finished"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    LAST_RUN.write_text(json.dumps(report, ensure_ascii=False, indent=1))
    log(f"готово: разобрано {len(report['done'])}, ошибок {len(report['errors'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
