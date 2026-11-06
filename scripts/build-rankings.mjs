#!/usr/bin/env node
// World ranking of CS2 teams — Valve Regional Standings (VRS), the official ranking Valve uses for Major invites.
// Valve publishes it in https://github.com/ValveSoftware/counter-strike_regional_standings (updated monthly):
// live/<year>/standings_<global|europe|americas|asia>_<YYYY_MM_DD>.md
//
//   git clone --depth 1 https://github.com/ValveSoftware/counter-strike_regional_standings /tmp/vrs
//   node scripts/build-rankings.mjs --dir /tmp/vrs            → public/data/rankings.json

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const DIR = arg('dir', '/tmp/vrs');
const OUT = arg('out', 'public/data/rankings.json');

/** markdown table rows → [{ rank, pts, name, roster }] */
export function parseStandings(md) {
  const out = [];
  for (const line of md.split('\n')) {
    const c = line.split('|').map((x) => x.trim());
    if (c.length < 6 || !/^\d+$/.test(c[1])) continue;
    out.push({ rank: +c[1], pts: +c[2], name: c[3], roster: c[4].split(',').map((x) => x.trim()).filter(Boolean) });
  }
  return out;
}

function files() {
  const live = path.join(DIR, 'live');
  const all = [];
  for (const y of fs.readdirSync(live)) {
    const d = path.join(live, y);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const f of fs.readdirSync(d)) {
      const m = /^standings_(global|europe|americas|asia)_(\d{4}_\d\d_\d\d)\.md$/.exec(f);
      if (m) all.push({ region: m[1], date: m[2], file: path.join(d, f) });
    }
  }
  return all;
}

function main() {
  if (!fs.existsSync(path.join(DIR, 'live'))) { console.log(`нет ${DIR}/live — рейтинг пропущен`); return; }
  const all = files();
  const dates = [...new Set(all.filter((x) => x.region === 'global').map((x) => x.date))].sort();
  const date = dates.at(-1), prev = dates.at(-2);
  if (!date) { console.log('глобального рейтинга нет'); return; }
  const read = (region, d) => { const f = all.find((x) => x.region === region && x.date === d); return f ? parseStandings(fs.readFileSync(f.file, 'utf8')) : []; };
  const key = (t) => t.name.toLowerCase() + '|' + [...t.roster].map((x) => x.toLowerCase()).sort().join(',');
  const byName = (list) => new Map(list.map((t) => [t.name.toLowerCase(), t]));
  const global = read('global', date);
  const before = byName(read('global', prev));
  const regions = { europe: 'EU', americas: 'AM', asia: 'AS' };
  const reg = new Map();
  for (const [r, code] of Object.entries(regions)) for (const t of read(r, date)) reg.set(key(t), [code, t.rank]);
  // [world rank, points, name, roster, region, rank in region, world rank a month ago (0 = new)]
  const teams = global.map((t) => {
    const [code, rr] = reg.get(key(t)) || ['', 0];
    return [t.rank, t.pts, t.name, t.roster, code, rr, before.get(t.name.toLowerCase())?.rank || 0];
  });
  const iso = (d) => d.replace(/_/g, '-');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ src: 'Valve Regional Standings', date: iso(date), prev: prev ? iso(prev) : null, teams }));
  console.log(`рейтинг VRS ${iso(date)}: ${teams.length} команд, с регионом ${teams.filter((t) => t[4]).length} → ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
