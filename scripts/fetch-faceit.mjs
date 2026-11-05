#!/usr/bin/env node
// FACEIT nickname, level and ELO of pro players — official FACEIT Data API (https://developers.faceit.com).
//
//   FACEIT_API_KEY=… node scripts/fetch-faceit.mjs [--hist store/matches-hist] [--players public/data/players/index.json] [--store store/faceit]
//
// Players with a FACEIT id on their Liquipedia page are looked up by that id, the rest by SteamID64
// (GET /players?game=cs2&game_player_id=…). Results are cached in store/faceit/faceit.json and refreshed
// weekly (not found: monthly), so a run makes only a few requests. Without the key it does nothing.

import fs from 'node:fs';
import path from 'node:path';
import { infobox } from './build-player-links.mjs';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const HIST = arg('hist', 'store/matches-hist');
const PLAYERS = arg('players', 'public/data/players/index.json');
const STORE = arg('store', 'store/faceit');
const KEY = process.env.FACEIT_API_KEY;
const BUDGET_MS = (+process.env.FACEIT_BUDGET_MIN || 10) * 60000;
const DAY = 86400000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

async function get(url) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch('https://open.faceit.com/data/v4' + url, { headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (r.status === 404) return null;
    if (r.status === 429 || r.status >= 500) { await sleep(5000 * (a + 1)); continue; }
    if (r.status === 401 || r.status === 403) throw new Error(`FACEIT API ответил ${r.status}: проверьте ключ FACEIT_API_KEY (Server side key)`);
    if (!r.ok) return null;
    return r.json();
  }
  return null;
}

async function main() {
  if (!KEY) { console.log('FACEIT_API_KEY не задан — FACEIT-профили пропущены'); return; }
  const file = path.join(STORE, 'faceit.json');
  const db = read(file) || { p: {}, miss: {} };
  db.p ||= {}; db.miss ||= {};
  const fdb = {};
  for (const text of Object.values(read(path.join(HIST, 'players.json'))?.extra || {})) {
    const f = typeof text === 'string' ? infobox(text) : null;
    const sid = (f?.steam64id || '').replace(/\D/g, '');
    if (sid.length === 17 && f.faceitdb) fdb[sid] = f.faceitdb;
  }
  const ix = read(PLAYERS);
  const sids = (ix?.rows || []).map((r) => r[0]);
  const now = Date.now();
  const todo = sids.filter((s) => {
    const p = db.p[s], m = db.miss[s];
    if (p) return now - p.at > 7 * DAY;
    if (m) return now - m > 30 * DAY;
    return true;
  });
  // known FACEIT ids first: those are exact
  todo.sort((a, b) => (fdb[b] ? 1 : 0) - (fdb[a] ? 1 : 0));
  console.log(`FACEIT: игроков ${sids.length}, обновить ${todo.length}`);
  const t0 = Date.now();
  let ok = 0, miss = 0;
  for (const sid of todo) {
    if (Date.now() - t0 > BUDGET_MS) break;
    const j = fdb[sid] ? await get(`/players/${fdb[sid]}`) : await get(`/players?game=cs2&game_player_id=${sid}`);
    // the id from Liquipedia must belong to this SteamID (accounts get re-linked)
    const steam = j?.games?.cs2?.game_player_id || j?.steam_id_64;
    if (j?.nickname && (!fdb[sid] || !steam || steam === sid)) {
      const g = j.games?.cs2 || {};
      db.p[sid] = { nick: j.nickname, lvl: g.skill_level || null, elo: g.faceit_elo || null, at: now };
      delete db.miss[sid];
      ok++;
    } else { db.miss[sid] = now; delete db.p[sid]; miss++; }
    await sleep(150);
  }
  db.at = new Date().toISOString();
  fs.mkdirSync(STORE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(db));
  console.log(`FACEIT: найдено ${ok}, нет профиля ${miss}; всего в кэше ${Object.keys(db.p).length}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
