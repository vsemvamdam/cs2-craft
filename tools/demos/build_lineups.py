#!/usr/bin/env python3
"""Собирает библиотеку раскидок из всех разобранных про-демок.

Вход:  store/nades-raw/<demo>.json — броски каждой демки (пишет opencs2_shard.py)
Выход: public/data/nades/<map>.json — раскидки (повторяющиеся броски), формат v2:
  { v: 2, map, updated, demos, throws, players: [[name, team]], matches: [[match, event, date, url]],
    lineups: [ { id, type, side, n, np, from:[x,y,z], ang:[pitch,yaw], land:[x,y,z], move, moves:{...},
                 time, traj:[[x,y],...], ex:[[player, match, round], ...] } ] }

«Раскидка» = броски одного типа и стороны, сделанные с одной точки (±56 юнитов) в одну
точку (±96 юнитов). Броски, которые за всю базу встретились один раз, считаются
ситуативными и в библиотеку не попадают (кроме --keep-single).

  python3 tools/demos/build_lineups.py [--seed-from-public]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "store" / "nades-raw"
SEED = Path(__file__).resolve().parent / "seed"  # raw files committed to git (first demos), merged into RAW
OUT = ROOT / "public" / "data" / "nades"
FROM_R, LAND_R, CELL = 56.0, 96.0, 64.0
MAX_EX = 60


def seed_from_public():
    """First run: convert the old per-throw public files into per-demo raw files."""
    RAW.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in OUT.glob("de_*.json"):
        d = json.loads(f.read_text(encoding="utf-8"))
        if "throws" not in d:
            continue
        by_demo = defaultdict(list)
        for t in d["throws"]:
            by_demo[t.get("demo") or "unknown"].append(t)
        for demo, ts in by_demo.items():
            out = RAW / (Path(demo).stem + ".json")
            if out.exists():
                continue
            t0 = ts[0]
            write_raw(out, d["map"], {"event": t0.get("event", ""), "match": t0.get("match", ""), "date": t0.get("date", ""), "url": t0.get("url") or "", "demo": demo}, ts)
            n += 1
    print(f"seed: {n} демок из старых файлов")


def write_raw(out: Path, mp: str, meta: dict, throws: list):
    """compact per-demo file: throws as arrays, trajectory downsampled to ≤12 points (x, y only)"""
    rows = []
    for t in throws:
        tr = t.get("traj") or []
        if len(tr) > 12:
            step = (len(tr) - 1) / 11
            tr = [tr[round(i * step)] for i in range(12)]
        rows.append([
            t["player"], t.get("team") or t["side"], t["side"], t["type"], t.get("round", 0), round(t.get("time") or 0, 1),
            round(t["throw"]["x"], 1), round(t["throw"]["y"], 1), round(t["throw"]["z"], 1),
            round(t["throw"]["pitch"], 2), round(t["throw"]["yaw"], 2),
            round(t["land"]["x"], 1), round(t["land"]["y"], 1), round(t["land"]["z"], 1),
            t.get("move", ""), [[round(p[0]), round(p[1])] for p in tr],
        ])
    out.write_text(json.dumps({"map": mp, **meta, "rows": rows}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


class Cluster:
    __slots__ = ("type", "side", "fx", "fy", "lx", "ly", "items")

    def __init__(self, typ, side, r):
        self.type, self.side = typ, side
        self.fx, self.fy, self.lx, self.ly = r["fx"], r["fy"], r["lx"], r["ly"]
        self.items = [r]

    def add(self, r):
        self.items.append(r)
        k = len(self.items)
        self.fx += (r["fx"] - self.fx) / k
        self.fy += (r["fy"] - self.fy) / k
        self.lx += (r["lx"] - self.lx) / k
        self.ly += (r["ly"] - self.ly) / k


def build(keep_single=False):
    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    for f in SEED.glob("*.json"):
        if not (RAW / f.name).exists():
            (RAW / f.name).write_bytes(f.read_bytes())
    per_map = defaultdict(list)
    for f in sorted(RAW.glob("*.json")):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        per_map[d["map"]].append(d)
    index = []
    for mp, demos in per_map.items():
        players, pidx = [], {}
        matches, midx = [], {}
        rows = []
        for d in demos:
            mk = (d.get("match", ""), d.get("event", ""), d.get("date", ""), d.get("url", ""))
            if mk not in midx:
                midx[mk] = len(matches)
                matches.append(list(mk))
            mi = midx[mk]
            for r in d["rows"]:
                pk = (r[0], r[1])
                if pk not in pidx:
                    pidx[pk] = len(players)
                    players.append([r[0], r[1]])
                rows.append({"p": pidx[pk], "m": mi, "side": r[2], "type": r[3], "round": r[4], "time": r[5],
                             "fx": r[6], "fy": r[7], "fz": r[8], "pitch": r[9], "yaw": r[10],
                             "lx": r[11], "ly": r[12], "lz": r[13], "move": r[14], "traj": r[15]})
        # greedy clustering with a spatial hash on the throw position
        clusters: list[Cluster] = []
        grid = defaultdict(list)
        for r in sorted(rows, key=lambda r: (r["type"], r["side"], r["fx"], r["fy"])):
            cx, cy = int(r["fx"] // CELL), int(r["fy"] // CELL)
            best, bd = None, 1e18
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for c in grid[(r["type"], r["side"], cx + dx, cy + dy)]:
                        df = math.hypot(c.fx - r["fx"], c.fy - r["fy"])
                        dl = math.hypot(c.lx - r["lx"], c.ly - r["ly"])
                        if df <= FROM_R and dl <= LAND_R and df + dl < bd:
                            best, bd = c, df + dl
            if best:
                best.add(r)
            else:
                c = Cluster(r["type"], r["side"], r)
                clusters.append(c)
                grid[(r["type"], r["side"], cx, cy)].append(c)
        lineups = []
        for c in clusters:
            n = len(c.items)
            if n < 2 and not keep_single:
                continue
            rep = min(c.items, key=lambda r: math.hypot(r["fx"] - c.fx, r["fy"] - c.fy) + math.hypot(r["lx"] - c.lx, r["ly"] - c.ly))
            moves = Counter(r["move"] for r in c.items)
            times = sorted(r["time"] for r in c.items)
            ex = sorted(c.items, key=lambda r: (-r["m"], r["round"]))[:MAX_EX]
            lid = hashlib.sha1(f"{mp}|{c.type}|{c.side}|{round(rep['fx'])}|{round(rep['fy'])}|{round(rep['lx'])}|{round(rep['ly'])}".encode()).hexdigest()[:10]
            lineups.append({
                "id": lid, "type": c.type, "side": c.side, "n": n, "np": len({r["p"] for r in c.items}),
                "from": [rep["fx"], rep["fy"], rep["fz"]], "ang": [rep["pitch"], rep["yaw"]],
                "land": [round(c.lx, 1), round(c.ly, 1), rep["lz"]],
                "move": moves.most_common(1)[0][0], "moves": dict(moves), "time": times[len(times) // 2],
                "traj": rep["traj"], "ex": [[r["p"], r["m"], r["round"]] for r in ex],
            })
        lineups.sort(key=lambda l: -l["n"])
        out = {"v": 2, "map": mp, "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "demos": len(demos), "throws": len(rows),
               "players": players, "matches": matches, "lineups": lineups}
        (OUT / f"{mp}.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        index.append({"map": mp, "demos": len(demos), "throws": len(rows), "lineups": len(lineups)})
        print(f"{mp}: {len(demos)} демок, {len(rows)} бросков → {len(lineups)} раскидок")
    (OUT / "index.json").write_text(json.dumps({"updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "maps": index}, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed-from-public", action="store_true")
    ap.add_argument("--keep-single", action="store_true")
    a = ap.parse_args()
    if a.seed_from_public:
        seed_from_public()
    build(a.keep_single)
