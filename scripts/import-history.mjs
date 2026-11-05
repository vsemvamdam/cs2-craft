#!/usr/bin/env node
// Imports cs2-history.json.gz (made by scripts/collect-history.mjs on a home connection) into store/history,
// the same format fetch-history.mjs writes:  node scripts/import-history.mjs path/to/cs2-history.json.gz
// Then: scripts/store.sh push history  (the site's price charts and tools/astro use it).
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { DATA, STORE, readJSON, writeJSON, today, buildNameIndex } from './lib/common.mjs';
import { toDaily, currencyOf, cbrHistory } from './lib/steam-history.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/import-history.mjs cs2-history.json.gz'); process.exit(1); }
const H = path.join(STORE, 'history');
fs.mkdirSync(H, { recursive: true });
const src = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());
const db = await readJSON(path.join(DATA, 'db.json'));
const index = buildNameIndex(db);
const byId = new Map();
const curs = new Set();
let n = 0, unknown = 0, empty = 0;
for (const [name, it] of Object.entries(src.items || {})) {
  const hit = index.get(name);
  if (!hit) { unknown++; continue; }
  if (!it.p?.length) { empty++; continue; }
  const [prefix, suffix] = String(it.cur || '$|').split('|');
  const cur = currencyOf({ price_prefix: prefix, price_suffix: suffix });
  curs.add(cur);
  const upd = byId.get(hit.id) || {};
  upd[hit.vk] = { at: Date.parse(src.updated || new Date().toISOString()), cur, p: toDaily(it.p), src: 'home' };
  byId.set(hit.id, upd);
  n++;
}
for (const [id, upd] of byId) {
  const f = path.join(H, id + '.json');
  const j = (await readJSON(f)) || {};
  for (const [vk, v] of Object.entries(upd)) if (!j[vk]?.p?.length || j[vk].p.length < v.p.length) j[vk] = v;
  await writeJSON(f, j);
}
const others = [...curs].filter((c) => c !== 'USD');
if (others.length) {
  const rates = (await readJSON(path.join(H, '_rates.json'))) || {};
  rates.RUB = await cbrHistory('USD');
  if (others.includes('EUR')) rates.EUR_RUB = await cbrHistory('EUR');
  if (others.includes('CNY')) rates.CNY_RUB = await cbrHistory('CNY');
  rates.updated = today();
  await writeJSON(path.join(H, '_rates.json'), rates);
}
const meta = (await readJSON(path.join(H, '_meta.json'))) || { done: 0, failed: {} };
meta.imported = { at: new Date().toISOString(), items: n, unknown, empty, currencies: [...curs] };
await writeJSON(path.join(H, '_meta.json'), meta);
console.log(`imported ${n} variants into ${byId.size} skin files (unknown names ${unknown}, without history ${empty}; currencies ${[...curs].join(', ') || '—'})`);
