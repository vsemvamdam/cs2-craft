#!/usr/bin/env node
// Turns the price store into the static files the website reads:
//   public/data/prices.json      current prices for every skin variant, sticker and charm
//   public/data/h/<skinId>.json  all-time history (Steam) + daily snapshots for one skin
// Safe to run with an empty store: it then writes an empty prices.json.

import path from 'node:path';
import fs from 'node:fs/promises';
import { DATA, STORE, readJSON, writeJSON, today, buildNameIndex } from './lib/common.mjs';

const P = path.join(STORE, 'prices');
const H = path.join(STORE, 'history');
const OUT_H = path.join(DATA, 'h');
const DAILY_DAYS = 400; // older points are folded into weekly buckets

function rateAt(series, day) {
  // series: [[day, value]] ascending; nearest previous
  if (!series?.length) return null;
  let lo = 0, hi = series.length - 1;
  if (day <= series[0][0]) return series[0][1];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (series[mid][0] <= day) lo = mid; else hi = mid - 1;
  }
  return series[lo][1];
}

function toUSD(entry, rates) {
  if (!entry || entry.cur === 'USD' || !entry.p?.length) return entry;
  const rub = rates?.RUB;
  let conv;
  if (entry.cur === 'RUB' && rub) conv = (d, c) => c / rateAt(rub, d);
  else if (entry.cur === 'EUR' && rub && rates.EUR_RUB) conv = (d, c) => (c * rateAt(rates.EUR_RUB, d)) / rateAt(rub, d);
  else if (entry.cur === 'CNY' && rub && rates.CNY_RUB) conv = (d, c) => (c * rateAt(rates.CNY_RUB, d)) / rateAt(rub, d);
  if (!conv) return entry;
  return { ...entry, cur: 'USD', p: entry.p.map(([d, c, v]) => [d, Math.round(conv(d, c)), v]) };
}

function downsample(points) {
  const cutoff = today() - DAILY_DAYS;
  const out = [];
  let bucket = null;
  for (const [d, c, v] of points) {
    if (d >= cutoff) {
      if (bucket) { out.push([bucket.d, Math.round(bucket.pv / bucket.w), bucket.v]); bucket = null; }
      out.push([d, c, v]);
      continue;
    }
    const wk = d - ((d % 7) + 7) % 7;
    if (!bucket || bucket.d !== wk) {
      if (bucket) out.push([bucket.d, Math.round(bucket.pv / bucket.w), bucket.v]);
      bucket = { d: wk, pv: 0, w: 0, v: 0 };
    }
    const w = Math.max(1, v);
    bucket.pv += c * w; bucket.w += w; bucket.v += v;
  }
  if (bucket) out.push([bucket.d, Math.round(bucket.pv / bucket.w), bucket.v]);
  return out;
}

async function main() {
  const db = await readJSON(path.join(DATA, 'db.json'));
  const stickers = (await readJSON(path.join(DATA, 'stickers.json')))?.stickers || [];
  const charms = (await readJSON(path.join(DATA, 'charms.json')))?.charms || [];
  const current = (await readJSON(path.join(P, 'current.json'))) || { steam: {}, skinport: {}, phases: {} };
  const histRates = await readJSON(path.join(H, '_rates.json'));
  const index = buildNameIndex(db);

  const fresh = (st) => st && Date.now() - st[2] < 4 * 86400000;
  const row = (name) => {
    const st = current.steam?.[name];
    const sp = current.skinport?.[name];
    if (!st && !sp) return null;
    return [fresh(st) ? st[0] : null, st ? st[1] : null, sp?.[0] ?? null, sp?.[1] ?? null, sp?.[2] ?? null, sp?.[3] ?? null];
  };

  const s = {};
  for (const [name, { id, vk }] of index) {
    const r = row(name);
    if (!r) continue;
    (s[id] ||= {})[vk] = r;
  }
  // Doppler / Gamma Doppler phase prices (Skinport separates them, Steam does not)
  const ph = {};
  for (const [key, val] of Object.entries(current.phases || {})) {
    const [name, phase] = key.split('|');
    const hit = index.get(name);
    if (!hit) continue;
    ((ph[hit.id] ||= {})[phase] ||= {})[hit.vk] = val;
  }
  const st = {};
  for (const x of stickers) if (x.m) { const r = row(x.m); if (r) st[x.id] = r; }
  const ch = {};
  for (const x of charms) { const r = row(x.m); if (r) ch[x.id] = r; }

  await writeJSON(path.join(DATA, 'prices.json'), {
    updated: current.updated || null,
    rates: current.rates || { USD: 1 },
    s, ph, st, ch,
  });

  // ---- per-skin history files ----
  await fs.rm(OUT_H, { recursive: true, force: true });
  await fs.mkdir(OUT_H, { recursive: true });
  let files = 0, points = 0;
  for (const skin of db.skins) {
    const snap = (await readJSON(path.join(P, 'snap', skin.id + '.json'))) || {};
    const hist = (await readJSON(path.join(H, skin.id + '.json'))) || {};
    const out = {};
    for (const vk of new Set([...Object.keys(snap), ...Object.keys(hist)])) {
      const e = toUSD(hist[vk], histRates);
      const o = {};
      if (e?.p?.length) { o.cur = e.cur; o.p = downsample(e.p); points += o.p.length; }
      if (snap[vk]?.length) o.s = snap[vk];
      if (o.p || o.s) out[vk] = o;
    }
    if (Object.keys(out).length) { await writeJSON(path.join(OUT_H, skin.id + '.json'), out); files++; }
  }
  console.log(`prices.json: ${Object.keys(s).length} skins, ${Object.keys(st).length} stickers, ${Object.keys(ch).length} charms; history files: ${files} (${points} points)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
