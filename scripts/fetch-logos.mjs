#!/usr/bin/env node
// Logos of every team (not only the Major teams that have Valve stickers) and icons of tournaments.
//
//   node scripts/fetch-logos.mjs [--store store/logos] [--hist store/matches-hist] [--out public/data]
//
// Source: Liquipedia (liquipedia.net/counterstrike), through its MediaWiki API only (no HTML pages):
//   * team → logo file: the team templates already downloaded by scripts/fetch-matches-hist.mjs
//     (store matches-hist/teams.json: {{Team|id}} expansions with [[File:… darkmode.png]]); teams not there are
//     looked up by page title (infobox image / imagedark, 50 pages per request);
//   * tournament → icon file: the «icon» / «icondark» field of its infobox (40 pages per request);
//   * file → small thumbnail URL: prop=imageinfo&iiurlwidth (50 files per request).
// Thumbnails are downloaded once, politely (one at a time, ≥1 s apart, User-Agent with the repository as contact)
// and kept in the «logos» store, so later runs only fetch logos of new teams. Teams that get no logo are retried
// after a week. Liquipedia text is CC BY-SA 3.0; logos belong to their teams and organisers and are shown only
// to identify them.
//
// Wanted teams: world ranking (rankings.json), teams of the matches page (esports-data branch), teams of our
// players (players/index.json). Output: <out>/logos.json { t: { teamKey: file }, e: { tournament page: file } }
// and the images in <out>/logos/.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { liquipediaClient, parseInfobox, UA } from './lib/esports/liquipedia.mjs';

// same keys as teamKeys() in scripts/build-db.mjs and src/lib/teams.ts (the site looks logos up by them)
const FILLER = new Set(['team', 'esports', 'esport', 'e', 'sports', 'gaming', 'clan', 'club', 'gg']);
function teamKeys(name) {
  const words = String(name).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean);
  return [...new Set([words.join(''), words.filter((w) => !FILLER.has(w)).join('')].filter(Boolean))];
}

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const STORE = arg('store', 'store/logos');
const HIST = arg('hist', 'store/matches-hist');
const OUT = arg('out', 'public/data');
const MAX_DL = +(process.env.LOGOS_MAX_DOWNLOADS || 400);
const REPO = process.env.GITHUB_REPOSITORY || 'vsemvamdam/cs2-craft';
const WEEK = 7 * 86400000;

const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = Date.now();
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const DEFAULT = /^Counter-Strike 2 default|^CS2 default|^Logo filler|^Liquipedia/i;

/** {{Team|…}} expansion → { page, display, file (dark mode first) } */
function fromTemplate(html) {
  const files = [...html.matchAll(/\[\[File:([^|\]]+)/g)].map((m) => m[1].trim()).filter((f) => !DEFAULT.test(f));
  const file = files.find((f) => /darkmode/i.test(f)) || files.find((f) => /allmode/i.test(f)) || files[0];
  const page = (/team-template-text">\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/.exec(html) || []);
  return { file, page: page[1], display: page[2] || page[1] };
}

async function main() {
  fs.mkdirSync(path.join(STORE, 'img'), { recursive: true });
  const idx = read(path.join(STORE, 'index.json')) || { files: {}, teams: {}, tours: {} };
  // idx.files: { liquipedia file: { img?: local name, url?, miss?: ts } }
  // idx.teams: { teamKey: { file?, miss?: ts } }   idx.tours: { page: { file?, miss?: ts } }

  // ---- which teams and tournaments the site shows ----
  const want = new Map(); // key → display name (first seen)
  const addTeam = (n) => { if (!n || /^(tbd|tba)$/i.test(n)) return; for (const k of teamKeys(n)) if (!want.has(k)) want.set(k, n); };
  for (const t of read(path.join(OUT, 'rankings.json'))?.teams || []) addTeam(t[2]);
  let esports = null;
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/esports-data/esports.json`, { signal: AbortSignal.timeout(30000) });
    if (r.ok) esports = await r.json();
  } catch { /* the matches page is optional here */ }
  for (const m of esports?.matches || []) for (const t of [m.t1, m.t2]) if (!t?.tbd) { addTeam(t.f); addTeam(t.n); }
  const ix = read(path.join(OUT, 'players', 'index.json'));
  if (ix?.cols) { const ti = ix.cols.indexOf('team'); for (const r of ix.rows) addTeam(r[ti]); }
  const tours = new Set((esports?.tournaments || []).map((t) => t.id).filter(Boolean));
  for (const m of esports?.matches || []) if (m.tp) tours.add(m.tp);
  console.log(`логотипы: нужно ${want.size} ключей команд, ${tours.size} турниров`);

  // ---- team → file from the stored team templates ----
  const tpl = read(path.join(HIST, 'teams.json'))?.ids || {};
  const byKey = new Map();
  for (const [id, html] of Object.entries(tpl)) {
    if (typeof html !== 'string') continue;
    const t = fromTemplate(html);
    if (!t.file) continue;
    for (const n of [t.display, t.page, id]) if (n) for (const k of teamKeys(n)) if (!byKey.has(k)) byKey.set(k, t.file);
  }
  for (const [k] of want) {
    const e = idx.teams[k];
    if (e?.file) continue;
    if (byKey.has(k)) idx.teams[k] = { file: byKey.get(k) };
  }

  const lp = liquipediaClient({ log: console.log });
  // ---- teams still without a file: page infobox by title («X», «Team X») ----
  const missing = [...want].filter(([k]) => !idx.teams[k]?.file && !(idx.teams[k]?.miss > now - WEEK));
  const titles = new Map(); // title → keys
  for (const [k, n] of missing) for (const t of [n, 'Team ' + n]) { const tt = t.trim(); if (tt) titles.set(tt, [...(titles.get(tt) || []), k]); }
  let looked = 0;
  for (const part of chunks([...titles.keys()], 50).slice(0, 12)) {
    let j;
    try { j = await lp.call({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', rvsection: '0', redirects: '1', titles: part.join('|') }, 'lp-team-pages'); } catch (e) { console.log('страницы команд:', e.message); break; }
    const q = j.query || {};
    const back = new Map();
    for (const x of [...(q.normalized || []), ...(q.redirects || [])]) back.set(x.to, x.from);
    for (const p of q.pages || []) {
      if (p.missing) continue;
      const content = p.revisions?.[0]?.slots?.main?.content || '';
      const ib = /\{\{\s*Infobox[ _]team/i.test(content) ? parseInfobox(content.replace(/Infobox[ _]team/i, 'Infobox league')) : null;
      const file = [ib?.imagedark, ib?.imagedarkmode, ib?.image].map((f) => (f || '').replace(/^(File|Image):/i, '').trim()).find((f) => f && !DEFAULT.test(f));
      if (!file) continue;
      let req = p.title;
      for (let i = 0; i < 3 && back.has(req); i++) req = back.get(req);
      for (const k of titles.get(req) || titles.get(p.title) || []) if (!idx.teams[k]?.file) idx.teams[k] = { file };
    }
    looked += part.length;
  }
  for (const [k] of missing) if (!idx.teams[k]?.file) idx.teams[k] = { miss: now };

  // ---- tournament → icon file ----
  const tourTodo = [...tours].filter((p) => !idx.tours[p]?.file && !(idx.tours[p]?.miss > now - WEEK));
  for (const part of chunks(tourTodo, 40)) {
    let j;
    try { j = await lp.call({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', rvsection: '0', redirects: '1', titles: part.join('|') }, 'lp-tour-icons'); } catch (e) { console.log('турниры:', e.message); break; }
    const q = j.query || {};
    const back = new Map();
    for (const x of [...(q.normalized || []), ...(q.redirects || [])]) back.set(x.to, x.from);
    for (const p of q.pages || []) {
      const ib = parseInfobox(p.revisions?.[0]?.slots?.main?.content || '');
      const file = [ib?.icondark, ib?.icondarkmode, ib?.icon].map((f) => (f || '').replace(/^(File|Image):/i, '').trim()).find((f) => f && !DEFAULT.test(f));
      let req = p.title;
      for (let i = 0; i < 3 && back.has(req); i++) req = back.get(req);
      idx.tours[req] = file ? { file } : { miss: now };
    }
  }
  for (const p of tourTodo) if (!idx.tours[p]) idx.tours[p] = { miss: now };

  // ---- file → thumbnail URL (only files we need and don't have yet) ----
  const needFiles = new Set();
  for (const [k] of want) { const f = idx.teams[k]?.file; if (f) needFiles.add(f); }
  for (const p of tours) { const f = idx.tours[p]?.file; if (f) needFiles.add(f); }
  const toResolve = [...needFiles].filter((f) => !idx.files[f]?.img && !idx.files[f]?.url && !(idx.files[f]?.miss > now - WEEK));
  for (const part of chunks(toResolve, 50)) {
    let j;
    try { j = await lp.call({ action: 'query', prop: 'imageinfo', iiprop: 'url', iiurlwidth: '64', iiurlheight: '64', titles: part.map((f) => 'File:' + f).join('|') }, 'lp-imageinfo'); } catch (e) { console.log('imageinfo:', e.message); break; }
    const q = j.query || {};
    const back = new Map();
    for (const x of q.normalized || []) back.set(x.to, x.from);
    for (const p of q.pages || []) {
      const name = (back.get(p.title) || p.title).replace(/^File:/, '');
      const ii = p.imageinfo?.[0];
      idx.files[name] = ii?.thumburl || ii?.url ? { url: ii.thumburl || ii.url } : { miss: now };
    }
  }

  // ---- download thumbnails (most wanted first: ranking order, then matches, then players) ----
  const order = [...needFiles].filter((f) => idx.files[f]?.url && !idx.files[f]?.img);
  let got = 0, fail = 0;
  for (const f of order.slice(0, MAX_DL)) {
    try {
      const r = await fetch(idx.files[f].url, { headers: { 'User-Agent': UA, Accept: 'image/*' }, signal: AbortSignal.timeout(30000) });
      if (r.status === 429) { console.log('Liquipedia просит подождать — остальное в следующий раз'); break; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      const ext = (/\.(png|jpe?g|webp|gif|svg)(?:$|\?)/i.exec(idx.files[f].url)?.[1] || 'png').toLowerCase().replace('jpeg', 'jpg');
      const name = crypto.createHash('sha1').update(f).digest('hex').slice(0, 12) + '.' + (ext === 'svg' ? 'svg' : ext);
      fs.writeFileSync(path.join(STORE, 'img', name), buf);
      idx.files[f] = { img: name };
      got++;
    } catch (e) {
      fail++;
      idx.files[f] = { url: idx.files[f].url, err: String(e.message).slice(0, 60), miss: now };
    }
    await sleep(1100);
  }

  idx.at = new Date().toISOString();
  fs.writeFileSync(path.join(STORE, 'index.json'), JSON.stringify(idx));

  // ---- site files ----
  const outDir = path.join(OUT, 'logos');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const t = {}, e = {};
  const used = new Set();
  for (const [k, v] of Object.entries(idx.teams)) { const img = v.file && idx.files[v.file]?.img; if (img) { t[k] = img; used.add(img); } }
  for (const [p, v] of Object.entries(idx.tours)) { const img = v.file && idx.files[v.file]?.img; if (img) { e[p] = img; used.add(img); } }
  for (const img of used) fs.copyFileSync(path.join(STORE, 'img', img), path.join(outDir, img));
  fs.writeFileSync(path.join(OUT, 'logos.json'), JSON.stringify({ src: 'Liquipedia', at: idx.at, t, e }));
  const haveWanted = [...want.keys()].filter((k) => t[k]).length;
  console.log(`логотипы: скачано ${got}${fail ? `, не удалось ${fail}` : ''}, в очереди ${Math.max(0, order.length - MAX_DL)}; у команд сайта: ${haveWanted}/${want.size} ключей, турниров с иконкой: ${[...tours].filter((p) => e[p]).length}/${tours.size}; запросов к API: ${lp.count}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
