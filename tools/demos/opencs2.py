#!/usr/bin/env python3
"""Конвейер «вся база про-демок» для GitHub Actions (датасет OpenCS2, Hugging Face
blanchon/opencs2_dataset_demo, CC BY 4.0 — ~2000 карт HLTV, март–апрель 2026).

  plan   — выбрать ещё не разобранные демки (карты Active Duty, сначала крупные матчи),
           разбить на шарды:      python3 tools/demos/opencs2.py plan --limit 240 --shards 12
  shard  — скачать и разобрать свою часть, сложить компактные броски в store/nades-raw-new/:
                                  python3 tools/demos/opencs2.py shard --plan plan.json --index 3 --shards 12
  ingest — разобрать локальные .dem/архивы (urls.txt) в store/nades-raw/:
                                  python3 tools/demos/opencs2.py ingest --from-urls tools/demos/urls.txt
Сборка библиотеки раскидок — build_lineups.py.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from build_lineups import RAW_VERSION, write_raw  # noqa: E402

REPO = "blanchon/opencs2_dataset_demo"
# list of already parsed demos lives in the data-store release (store/nades-proc), not in git;
# demos parsed by an older extractor (other "v") are parsed again
PROCESSED = ROOT / "store" / "nades-proc" / "processed.json"


def load_done() -> set:
    if not PROCESSED.exists():
        return set()
    d = json.loads(PROCESSED.read_text())
    if not isinstance(d, dict) or d.get("v") != RAW_VERSION:
        return set()
    return set(d.get("done", []))


def save_done(done: set):
    PROCESSED.parent.mkdir(parents=True, exist_ok=True)
    PROCESSED.write_text(json.dumps({"v": RAW_VERSION, "done": sorted(done)}, ensure_ascii=False, indent=0))
MAPS = ["mirage", "inferno", "nuke", "ancient", "anubis", "dust2", "cache", "overpass", "train", "vertigo"]
ACTIVE = ["mirage", "inferno", "nuke", "ancient", "anubis", "dust2", "cache"]


def log(*a):
    print(*a, flush=True)


def map_of(name: str) -> str | None:
    n = name.rsplit("/", 1)[-1].lower()
    for m in MAPS:
        if re.search(rf"[-_]{m}(?:[-_.]|$)", n):
            return m
    if re.search(r"[-_]dust-?2", n):
        return "dust2"
    return None


def safe(s: str) -> str:
    return re.sub(r"[^a-z0-9._-]+", "-", s.lower()).strip("-")[:120]


def extract_to_raw(dem: Path, meta: dict, raw_dir: Path, name: str) -> int:
    """run extract_nades.py into a temp dir, then store compact per-demo raw file"""
    with tempfile.TemporaryDirectory(prefix="ex_") as out:
        cmd = [sys.executable, "-I", str(HERE / "extract_nades.py"), str(dem), "--out", out]
        for k in ("event", "match", "url"):
            if meta.get(k):
                cmd += [f"--{k}", str(meta[k])]
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(meta.get("date") or "")):
            cmd += ["--date", meta["date"]]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
        if r.returncode != 0:
            raise RuntimeError((r.stdout + r.stderr).strip().splitlines()[-1:])
        total = 0
        for f in Path(out).glob("de_*.json"):
            d = json.loads(f.read_text(encoding="utf-8"))
            raw_dir.mkdir(parents=True, exist_ok=True)
            write_raw(raw_dir / f"{name}.json", d["map"], {**{k: meta.get(k) or "" for k in ("event", "match", "date", "url")}, "demo": dem.name},
                      d["throws"], places=d.get("places"), players=d.get("players"))
            total += len(d["throws"])
        return total


def cmd_plan(a):
    import pandas as pd  # noqa: PLC0415
    from huggingface_hub import HfApi, hf_hub_download  # noqa: PLC0415

    api = HfApi()
    files = api.list_repo_files(REPO, repo_type="dataset")
    dems = {f.rsplit("/", 1)[-1]: f for f in files if f.endswith(".dem")}
    meta = pd.concat([pd.read_parquet(hf_hub_download(REPO, filename=p, repo_type="dataset")) for p in files if p.endswith(".parquet")], ignore_index=True)
    done = load_done()
    items = []
    for _, r in meta.iterrows():
        fn = str(r.get("file_name") or "")
        path = fn if fn in files else dems.get(fn.rsplit("/", 1)[-1])
        if not path or path in done:
            continue
        mp = (str(r.get("map_name") or "").replace("de_", "") or map_of(path) or "").lower()
        if mp not in ACTIVE:
            continue
        try:
            stars = int(r.get("stars") or 0)
        except (TypeError, ValueError):
            stars = 0
        items.append({"path": path, "map": mp, "event": str(r.get("event") or ""), "match": f"{r.get('team1') or ''} vs {r.get('team2') or ''}".strip(" vs"),
                      "date": str(r.get("match_date") or "")[:10], "url": str(r.get("match_url") or ""), "stars": stars,
                      "id": str(r.get("match_id") or "")})
    items.sort(key=lambda x: (x["stars"], x["date"]), reverse=True)
    plan = items[: a.limit]
    shards = max(1, min(a.shards, len(plan)))
    Path(a.out).write_text(json.dumps({"shards": shards, "items": plan}, ensure_ascii=False))
    log(f"не разобрано {len(items)} демок; в этот запуск {len(plan)} в {shards} шардах")
    gh = os.environ.get("GITHUB_OUTPUT")
    if gh:
        with open(gh, "a") as fh:
            fh.write(f"count={len(plan)}\n")
            fh.write("matrix=" + json.dumps({"shard": list(range(shards))}) + "\n")
            fh.write(f"remaining={len(items) - len(plan)}\n")


def cmd_shard(a):
    from huggingface_hub import hf_hub_download  # noqa: PLC0415

    plan = json.loads(Path(a.plan).read_text())
    items = plan["items"][a.index :: plan["shards"]]
    raw_dir = ROOT / "store" / "nades-raw-new"
    ok = 0
    for it in items:
        with tempfile.TemporaryDirectory(prefix="dem_") as tmp:
            try:
                local = Path(hf_hub_download(REPO, filename=it["path"], repo_type="dataset", local_dir=tmp))
                n = extract_to_raw(local, it, raw_dir, safe(f"{it['id']}-{local.stem}"))
                with (raw_dir / f"_done-{a.index}.txt").open("a") as fh:
                    fh.write(it["path"] + "\n")
                ok += 1
                log(f"✓ {it['match']} · {it['map']} · {it['event']} — {n} бросков")
            except Exception as e:  # noqa: BLE001
                log(f"! {it['path']}: {e}")
    log(f"шард {a.index}: {ok}/{len(items)}")


def cmd_ingest(a):
    """urls.txt / local files → store/nades-raw (uses extract_nades' downloader/unpacker)"""
    sys.path.insert(0, str(HERE))
    import extract_nades as X  # noqa: PLC0415

    raw_dir = ROOT / "store" / "nades-raw"
    jobs = []
    work = Path(tempfile.mkdtemp(prefix="ing_"))
    if a.from_urls:
        for i, (url, meta) in enumerate(X.read_url_list(Path(a.from_urls))):
            d = work / f"{i:03d}"
            d.mkdir()
            try:
                f = X.download(url, d)
                for dem in X.unpack(f, d):
                    jobs.append((dem, meta))
            except Exception as e:  # noqa: BLE001
                log(f"! {url}: {e}")
    for p in a.inputs:
        jobs.append((Path(p), {}))
    for dem, meta in jobs:
        name = safe(dem.stem)
        old = raw_dir / f"{name}.json"
        if old.exists() and json.loads(old.read_text(encoding="utf-8")).get("rv") == RAW_VERSION:
            log(f"= {dem.name} уже в базе")
            continue
        try:
            n = extract_to_raw(dem, meta, raw_dir, name)
            log(f"✓ {dem.name}: {n} бросков")
        except Exception as e:  # noqa: BLE001
            log(f"! {dem.name}: {e}")


def cmd_mark_done(a):
    """aggregate step: add paths from shard logs (_done-*.txt) to the processed list"""
    done = load_done()
    for f in a.files:
        done |= {l.strip() for l in Path(f).read_text().splitlines() if l.strip()}
    save_done(done)
    log(f"разобрано всего (формат v{RAW_VERSION}): {len(done)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan"); p.add_argument("--limit", type=int, default=240); p.add_argument("--shards", type=int, default=12); p.add_argument("--out", default="plan.json")
    s = sub.add_parser("shard"); s.add_argument("--plan", required=True); s.add_argument("--index", type=int, required=True)
    i = sub.add_parser("ingest"); i.add_argument("--from-urls"); i.add_argument("inputs", nargs="*")
    m = sub.add_parser("mark-done"); m.add_argument("files", nargs="*")
    a = ap.parse_args()
    {"plan": cmd_plan, "shard": cmd_shard, "ingest": cmd_ingest, "mark-done": cmd_mark_done}[a.cmd](a)

