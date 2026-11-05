#!/usr/bin/env node
// Downloads the FULL Steam Community Market price history (every day since the item was
// first sold) for each skin variant. Steam only serves this endpoint to a logged-in
// account, so the workflow needs ONE of these repository secrets:
//   STEAM_REFRESH_TOKEN  — long-lived token (≈200 days) from `npm run steam-login` (recommended)
//   STEAM_LOGIN_SECURE   — value of the steamLoginSecure cookie (expires quickly)
// Use a secondary Steam account: the token gives access to that account.
//
// Resumable: every run processes the items whose history is missing or oldest, within
// HISTORY_BUDGET_MIN minutes (default 300), so the first full pass takes ~1–2 days and
// afterwards every item is refreshed in rotation (daily snapshots fill the gaps).
//
// Store: store/history/<skinId>.json { vk: { at, cur, p: [[day, cents, volume], ...] } }
//        store/history/_meta.json   { done, failed, lastRun }
//        store/history/_rates.json  { RUB: [[day, rubPerUsd], ...], EUR: [...] }  (for non-USD wallets)

import path from 'node:path';
import fs from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { DATA, STORE, readJSON, writeJSON, sleep, dayOf, today, timeBudget, buildNameIndex } from './lib/common.mjs';

const H = path.join(STORE, 'history');
const BUDGET = +(process.env.HISTORY_BUDGET_MIN || 300);
const DELAY = +(process.env.HISTORY_DELAY_MS || 3200);

async function steamCookies() {
  if (process.env.STEAM_REFRESH_TOKEN) {
    const { LoginSession, EAuthTokenPlatformType } = await import('steam-session');
    const session = new LoginSession(EAuthTokenPlatformType.WebBrowser);
    session.refreshToken = process.env.STEAM_REFRESH_TOKEN.trim();
    const cookies = await session.getWebCookies();
    return cookies.map((c) => c.split(';')[0]).join('; ');
  }
  if (process.env.STEAM_LOGIN_SECURE) return `steamLoginSecure=${process.env.STEAM_LOGIN_SECURE.trim()}`;
  return null;
}

const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
/** "Jul 02 2014 01: +0" -> ms */
function parseSteamDate(s) {
  const m = /^(\w{3}) (\d{2}) (\d{4}) (\d{2})/.exec(s);
  if (!m) return NaN;
  return Date.UTC(+m[3], MONTHS[m[1]], +m[2], +m[4]);
}

/** Collapse Steam points (daily + hourly for the last month) into one point per day. */
function toDaily(prices) {
  const days = new Map();
  for (const [ds, price, vol] of prices) {
    const d = dayOf(parseSteamDate(ds));
    if (Number.isNaN(d)) continue;
    const v = Math.max(1, parseInt(vol, 10) || 0);
    const cur = days.get(d) || { pv: 0, v: 0, vol: 0 };
    cur.pv += price * v; cur.v += v; cur.vol += parseInt(vol, 10) || 0;
    days.set(d, cur);
  }
  return [...days.entries()].sort((a, b) => a[0] - b[0]).map(([d, x]) => [d, Math.round((x.pv / x.v) * 100), x.vol]);
}

function currencyOf(j) {
  const s = `${j.price_prefix || ''}|${j.price_suffix || ''}`;
  if (s.includes('$')) return 'USD';
  if (s.includes('€')) return 'EUR';
  if (/pуб|руб/i.test(s)) return 'RUB';
  if (s.includes('¥')) return 'CNY';
  return s.replace('|', '').trim() || 'USD';
}

/** CBR history of a currency in RUB, for converting non-USD wallets to USD. */
async function cbrHistory(code) {
  const ids = { USD: 'R01235', EUR: 'R01239', CNY: 'R01375' };
  const fmt = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
  const url = `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=01/01/2013&date_req2=${fmt(new Date())}&VAL_NM_RQ=${ids[code]}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  const xml = await r.text();
  const out = [];
  for (const m of xml.matchAll(/Date="(\d{2})\.(\d{2})\.(\d{4})"[\s\S]*?<Nominal>(\d+)<\/Nominal>\s*<Value>([\d,]+)<\/Value>/g)) {
    out.push([dayOf(Date.UTC(+m[3], +m[2] - 1, +m[1])), +(parseFloat(m[5].replace(',', '.')) / +m[4]).toFixed(4)]);
  }
  return out;
}

async function main() {
  const cookie = await steamCookies();
  if (!cookie) {
    console.log('No STEAM_REFRESH_TOKEN / STEAM_LOGIN_SECURE secret — skipping full history (daily snapshots still work).');
    return;
  }
  const db = await readJSON(path.join(DATA, 'db.json'));
  const index = buildNameIndex(db);
  const current = (await readJSON(path.join(STORE, 'prices', 'current.json'))) || { steam: {} };
  const meta = (await readJSON(path.join(H, '_meta.json'))) || { done: 0, failed: {} };

  // Load "fetched at" for every variant to build the queue
  const atOf = new Map();
  try {
    for (const f of await fs.readdir(H)) {
      if (!f.endsWith('.json') || f.startsWith('_')) continue;
      const j = await readJSON(path.join(H, f), {});
      const id = f.slice(0, -5);
      for (const [vk, v] of Object.entries(j)) atOf.set(`${id}/${vk}`, v.at || 0);
    }
  } catch {}

  const queue = [];
  for (const [name, { id, vk }] of index) {
    const at = atOf.get(`${id}/${vk}`) || 0;
    const fail = meta.failed[name] || 0;
    const listings = current.steam?.[name]?.[1] ?? -1;
    if (listings === 0 && at) continue; // nothing on the market and already fetched once
    queue.push({ name, id, vk, at, fail, listings });
  }
  // never fetched first (most listed first), then the stalest
  queue.sort((a, b) => (a.at === 0) !== (b.at === 0) ? (a.at === 0 ? -1 : 1) : a.at === 0 ? b.listings - a.listings : a.at - b.at);
  console.log(`history queue: ${queue.length} variants, ${queue.filter((q) => !q.at).length} never fetched`);

  const budget = timeBudget(BUDGET);
  const dirty = new Map();
  let ok = 0, empty = 0, errors = 0, delay = DELAY, consecutive429 = 0;
  const curSeen = new Set();

  async function flush() {
    for (const [id, upd] of dirty) {
      const file = path.join(H, id + '.json');
      const j = (await readJSON(file)) || {};
      Object.assign(j, upd);
      await writeJSON(file, j);
    }
    dirty.clear();
    meta.lastRun = new Date().toISOString();
    meta.lastStats = { ok, empty, errors, statuses, delay: Math.round(delay), at: meta.lastRun };
    await writeJSON(path.join(H, '_meta.json'), meta);
    // in CI: publish progress every ~40 minutes so charts fill in while the long run continues
    if (process.env.GITHUB_ACTIONS && process.env.GH_TOKEN && Date.now() - lastUpload > 40 * 60000) {
      lastUpload = Date.now();
      try {
        execSync('bash scripts/store.sh push history', { stdio: 'inherit' });
        execSync('gh workflow run site.yml -f quick=true', { stdio: 'inherit' });
      } catch (e) { console.warn('progress upload failed:', e.message); }
    }
  }
  let lastUpload = Date.now();
  const statuses = {};

  for (const q of queue) {
    if (budget.over()) break;
    const url = `https://steamcommunity.com/market/pricehistory/?appid=730&currency=1&market_hash_name=${encodeURIComponent(q.name)}`;
    let r;
    try {
      r = await fetch(url, { headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0 cs2-craft history bot', Accept: 'application/json' }, signal: AbortSignal.timeout(45000) });
    } catch (e) { errors++; await sleep(15000); continue; }
    statuses[r.status] = (statuses[r.status] || 0) + 1;
    if (r.status === 429) {
      consecutive429++;
      delay = Math.min(delay * 1.4, 15000);
      const wait = Math.min(60000 * consecutive429, 600000);
      console.warn(`429 — waiting ${wait / 1000}s (delay now ${Math.round(delay)}ms)`);
      await sleep(wait);
      continue;
    }
    consecutive429 = 0;
    if (r.status === 400 || r.status === 403) {
      // 400 = Steam has no history for this name; 403 = logged out
      if (r.status === 403) { console.error('403 from Steam — the token/cookie is not accepted any more. Re-run `npm run steam-login`.'); break; }
      meta.failed[q.name] = (meta.failed[q.name] || 0) + 1;
      const upd = dirty.get(q.id) || {}; upd[q.vk] = { at: Date.now(), cur: 'USD', p: [] }; dirty.set(q.id, upd);
      empty++;
    } else if (!r.ok) {
      errors++; await sleep(10000); continue;
    } else {
      let j;
      try { j = await r.json(); } catch { errors++; await sleep(5000); continue; }
      if (!j || j.success !== true) {
        if (Array.isArray(j) || (j && j.success === false)) { empty++; }
        const upd = dirty.get(q.id) || {}; upd[q.vk] = { at: Date.now(), cur: 'USD', p: [] }; dirty.set(q.id, upd);
      } else {
        const cur = currencyOf(j);
        curSeen.add(cur);
        const upd = dirty.get(q.id) || {};
        upd[q.vk] = { at: Date.now(), cur, p: toDaily(j.prices || []) };
        dirty.set(q.id, upd);
        delete meta.failed[q.name];
        ok++; meta.done = (meta.done || 0) + 1;
      }
    }
    if ((ok + empty) % 200 === 0) { await flush(); console.log(`history: ${ok} ok, ${empty} empty, ${errors} errors, ${Math.round(budget.left() / 60000)} min left`); }
    await sleep(delay + Math.random() * 800);
  }
  await flush();

  // Rates for converting non-USD wallet histories into USD on the site
  const others = [...curSeen].filter((c) => c !== 'USD');
  if (others.length) {
    const rates = (await readJSON(path.join(H, '_rates.json'))) || {};
    try {
      rates.RUB = await cbrHistory('USD'); // RUB per 1 USD
      if (others.includes('EUR')) rates.EUR_RUB = await cbrHistory('EUR');
      if (others.includes('CNY')) rates.CNY_RUB = await cbrHistory('CNY');
      rates.updated = today();
      await writeJSON(path.join(H, '_rates.json'), rates);
    } catch (e) { console.warn('rate history failed:', e.message); }
  }
  console.log(`history done: ${ok} ok, ${empty} empty, ${errors} errors; wallet currencies: ${[...curSeen].join(', ') || '—'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
