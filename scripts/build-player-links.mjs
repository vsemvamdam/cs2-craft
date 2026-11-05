#!/usr/bin/env node
// Profiles of pro players for the player pages: real name, country, birth date, role and official
// pages / channels (X, Instagram, Twitch, YouTube, Telegram, VK, FACEIT, …).
//
//   node scripts/build-player-links.mjs [--hist store/matches-hist] [--faceit store/faceit/faceit.json] [--out public/data/players/links.json]
//
// Source: player pages from Liquipedia (CC BY-SA 3.0), already downloaded by scripts/fetch-matches-hist.mjs
// into the matches-hist store (players.json → extra: { page title: wikitext }). A page is attached to one of
// our players only by the exact SteamID64 from its infobox (steam64ID) — nicknames repeat and change.
// FACEIT nickname / level come from scripts/fetch-faceit.mjs (official FACEIT Data API) when it has run.

import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const HIST = arg('hist', 'store/matches-hist');
const FACEIT = arg('faceit', 'store/faceit/faceit.json');
const OUT = arg('out', 'public/data/players/links.json');

const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** {{Infobox player …}} → { field (lower case): value } — one field per line, empty fields skipped */
export function infobox(wikitext) {
  const i = wikitext.indexOf('{{Infobox player');
  if (i < 0) return null;
  const body = wikitext.slice(i, i + 10000).replace(/<!--[\s\S]*?-->/g, '');
  const f = {};
  for (const m of body.matchAll(/^\|[ \t]*([A-Za-z0-9_]+)[ \t]*=[ \t]*(.*)$/gm)) {
    const k = m[1].toLowerCase();
    const v = m[2].replace(/<ref[\s\S]*?(\/>|<\/ref>)/g, '').trim();
    if (v && !v.startsWith('{{') && !v.startsWith('|') && !(k in f)) f[k] = v;
  }
  return f;
}

// link fields we show, in this order; the value is the handle / id as Liquipedia stores it
export const LINKS = ['faceit', 'twitter', 'instagram', 'twitch', 'youtube', 'telegram', 'vk', 'tiktok', 'kick', 'facebook',
  'bilibili', 'weibo', 'douyin', 'reddit', 'esea', 'gamersclub', '5ewin'];
const clean = (v) => v.replace(/^\[+|\]+$/g, '').replace(/\s+/g, '');

function roleOf(v) {
  if (!v) return '';
  const r = new Set(v.toLowerCase().split(/[,/]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
    if (x.startsWith('igl') || x.includes('in-game')) return 'igl';
    if (x.startsWith('awp')) return 'awp';
    if (x.startsWith('entry')) return 'entry';
    if (x.startsWith('lurk')) return 'lurk';
    if (x.startsWith('support')) return 'support';
    if (x.startsWith('rifle')) return 'rifle';
    if (x.startsWith('coach')) return 'coach';
    return x;
  }));
  return [...r].join(',');
}

function main() {
  const pl = read(path.join(HIST, 'players.json'));
  if (!pl?.extra) { console.log(`нет ${HIST}/players.json — профили игроков пропущены`); return; }
  const fc = read(FACEIT)?.p || {};
  // keep only players that have a page on the site (when the list is there)
  const ix = read(path.join(path.dirname(OUT), 'index.json'));
  const ours = ix?.rows ? new Set(ix.rows.map((r) => r[0])) : null;
  const out = {};
  let n = 0, links = 0;
  for (const [title, text] of Object.entries(pl.extra)) {
    if (typeof text !== 'string') continue;
    const f = infobox(text);
    const sid = (f?.steam64id || '').replace(/\D/g, '');
    if (!f || sid.length !== 17 || out[sid] || (ours && !ours.has(sid))) continue;
    const l = {};
    for (const k of LINKS) if (f[k]) l[k] = clean(f[k]);
    const e = {
      lp: title,
      id: f.id || title,
      name: f.name || '',
      rn: f.romanized_name && f.romanized_name !== f.name ? f.romanized_name : '',
      c: f.country && f.country !== 'Non-representing' ? f.country : '',
      b: /^\d{4}-\d\d-\d\d$/.test(f.birth_date || '') ? f.birth_date : '',
      r: roleOf(f.roles),
      st: f.status || '',
      l,
    };
    if (f.faceitdb) e.fdb = f.faceitdb;
    const fx = fc[sid];
    if (fx?.nick) { e.l.faceit = fx.nick; if (fx.lvl) e.fl = fx.lvl; if (fx.elo) e.fe = fx.elo; }
    out[sid] = e;
    n++;
    links += Object.keys(e.l).length;
  }
  // players without a Liquipedia page but found on FACEIT by SteamID
  for (const [sid, fx] of Object.entries(fc)) {
    if (out[sid] || !fx?.nick || (ours && !ours.has(sid))) continue;
    out[sid] = { l: { faceit: fx.nick }, ...(fx.lvl ? { fl: fx.lvl } : {}), ...(fx.elo ? { fe: fx.elo } : {}) };
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), src: 'Liquipedia (CC BY-SA 3.0)', p: out }));
  console.log(`профили игроков: ${n} со страницей Liquipedia, ${links} ссылок, FACEIT: ${Object.keys(fc).length} → ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
