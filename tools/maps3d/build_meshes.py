#!/usr/bin/env python3
"""Коллизионная геометрия карт CS2 → компактные файлы для 3D-повтора раскидок на сайте.

Источник: awpy-data (https://github.com/pnxenopoulos/awpy-data, релиз geometry.zip — меши,
извлечённые из файлов карт CS2; карты © Valve Corporation). Формат входа AWMH:
  b"AWMH", u32 version=1, u32 n_verts, u32 n_tris, f32 xyz × n_verts, u32 idx × 3·n_tris (little-endian).

Выход: public/maps3d/<map>.bin.gz —
  b"M3D1", u32 n_verts, u32 n_tris, f32 min[3], f32 max[3],
  u16 xyz × n_verts (квантовано в bbox), затем индексы: u16 (если вершин < 65536) или u32,
  дельта-кодированные (idx[i] - idx[i-1], по модулю 2^16 / 2^32) — так gzip жмёт в 2–3 раза лучше.

  python3 tools/maps3d/build_meshes.py <папка с .mesh или geometry.zip> [карты...]
"""
from __future__ import annotations

import gzip
import io
import struct
import sys
import zipfile
from array import array
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "public" / "maps3d"
ACTIVE = ["de_mirage", "de_inferno", "de_nuke", "de_ancient", "de_anubis", "de_dust2", "de_cache"]


def read_awmh(b: bytes):
    magic, ver, nv, nt = struct.unpack_from("<4sIII", b, 0)
    if magic != b"AWMH" or ver != 1:
        raise ValueError(f"не AWMH v1: {magic!r} {ver}")
    pos = array("f")
    pos.frombytes(b[16:16 + nv * 12])
    idx = array("I")
    idx.frombytes(b[16 + nv * 12:16 + nv * 12 + nt * 12])
    if sys.byteorder != "little":
        pos.byteswap()
        idx.byteswap()
    return nv, nt, pos, idx


def convert(b: bytes) -> bytes:
    nv, nt, pos, idx = read_awmh(b)
    mn = [min(pos[i::3]) for i in range(3)]
    mx = [max(pos[i::3]) for i in range(3)]
    q = array("H", bytes(2 * 3 * nv))
    for a in range(3):
        span = (mx[a] - mn[a]) or 1.0
        k = 65535.0 / span
        for i in range(nv):
            q[i * 3 + a] = int(round((pos[i * 3 + a] - mn[a]) * k))
    small = nv < 65536
    mod = 1 << (16 if small else 32)
    d = array("H" if small else "I", bytes((2 if small else 4) * len(idx)))
    prev = 0
    for i, v in enumerate(idx):
        d[i] = (v - prev) % mod
        prev = v
    if sys.byteorder != "little":
        q.byteswap()
        d.byteswap()
    out = io.BytesIO()
    out.write(struct.pack("<4sII6f", b"M3D1", nv, nt, *mn, *mx))
    out.write(q.tobytes())
    out.write(d.tobytes())
    return gzip.compress(out.getvalue(), 9, mtime=0)


def main():
    src = Path(sys.argv[1])
    maps = sys.argv[2:] or ACTIVE
    OUT.mkdir(parents=True, exist_ok=True)
    zf = zipfile.ZipFile(src) if src.suffix == ".zip" else None
    for m in maps:
        if zf:
            name = next(n for n in zf.namelist() if n.endswith(f"{m}.mesh"))
            b = zf.read(name)
        else:
            b = (src / f"{m}.mesh").read_bytes()
        data = convert(b)
        (OUT / f"{m}.bin.gz").write_bytes(data)
        print(f"{m}: {len(b) // 1024} KB → {len(data) // 1024} KB")


if __name__ == "__main__":
    main()
