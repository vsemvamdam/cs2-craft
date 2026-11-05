#!/usr/bin/env node
// Long history of CS pro matches (S- and A-tier) and player birth dates from Liquipedia — raw
// wikitext for the astrology check (tools/astro/matches_astro.py parses it).
//
//   node scripts/fetch-matches-hist.mjs tournaments [--store store/matches-hist] [--from 2021-05-01] [--limit N]
//   node scripts/fetch-matches-hist.mjs players --players store/nades-site/players [--store store/matches-hist]
//
// Liquipedia MediaWiki API (CC BY-SA 3.0), https://liquipedia.net/api-terms-of-use : the shared client
// (scripts/lib/esports/liquipedia.mjs) sends a User-Agent with the repository as contact, gzip, ≥2 s between
// requests; only action=query is used here (no parse), up to 50 pages per request. Resumable: a tournament is
// fetched again only if it was not over yet when it was fetched; players only when not looked up yet.
// Store layout (data-store release asset matches-hist, scripts/store.sh):
//   tournaments.json  { at, cats: {cat: n}, list: {page: {t: infobox fields, lead_at}} }
//   raw/<slug>.json    { page, at, titles: { title: { rev, ts, content } } }  — the page and all its subpages
//   players.json      { at, q: { requested name: { title?, missing?, content? } }, extra: { title: content } }
// Env: HIST_BUDGET_MIN (default 300) — stop fetching after that many minutes (store stays consistent).

import fs from 'node:fs/promises';
import path from 'node:path';
import { liquipediaClient, parseInfobox, tournamentFromInfobox } from './lib/esports/liquipedia.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const STORE = arg('store', 'store/matches-hist');
const FROM = arg('from', '2021-05-01');
const LIMIT = +arg('limit', 0) || Infinity;
const BUDGET_MS = (+process.env.HIST_BUDGET_MIN || 300) * 60 * 1000;
const T0 = Date.now();
const overBudget = () => Date.now() - T0 > BUDGET_MS;
const TODAY = new Date().toISOString().slice(0, 10);
const log = (...a) => console.log(...a);
const readJSON = async (f, d = null) => { try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return d; } };
const writeJSON = async (f, v) => { await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f + '.tmp', JSON.stringify(v)); await fs.rename(f + '.tmp', f); };
const slug = (p) => p.replace(/[^\w.-]+/g, '_').slice(0, 150) + '_' + hash(p);
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
const lp = liquipediaClient({ log });
const contentOf = (p) => p.revisions?.[0]?.slots?.main?.content ?? p.revisions?.[0]?.content;

// query with continuation (categorymembers, generator=allpages, revisions)
async function queryAll(params, name, maxRounds = 40) {
  const pages = new Map();
  const lists = {};
  let cont = {};
  for (let round = 0; round < maxRounds; round++) {
    const j = await lp.call({ action: 'query', ...params, ...cont }, `${name}-${round}`);
    const q = j.query || {};
    for (const p of q.pages || []) {
      const prevP = pages.get(p.title);
      if (!prevP || (!contentOf(prevP) && contentOf(p))) pages.set(p.title, p);
    }
    for (const [k, v] of Object.entries(q)) if (Array.isArray(v) && k !== 'pages') (lists[k] ||= []).push(...v);
    if (!j.continue) break;
    cont = j.continue;
  }
  return { pages, lists };
}

// ───────────────────────── tournaments ─────────────────────────
const CATS = ['S-Tier Tournaments', 'A-Tier Tournaments', 'S-Tier Counter-Strike 2 Tournaments', 'A-Tier Counter-Strike 2 Tournaments',
  'S-Tier Counter-Strike: Global Offensive Tournaments', 'A-Tier Counter-Strike: Global Offensive Tournaments'];
const PORTALS = ['S-Tier Tournaments', 'A-Tier Tournaments'];

async function discover(state) {
  const found = new Set();
  state.cats ||= {};
  for (const c of CATS) {
    try {
      const { lists } = await queryAll({ list: 'categorymembers', cmtitle: 'Category:' + c, cmlimit: '500', cmnamespace: '0', cmtype: 'page' }, 'cat');
      const m = (lists.categorymembers || []).map((x) => x.title);
      state.cats[c] = m.length;
      log(`категория «${c}»: ${m.length}`);
      for (const t of m) found.add(t);
    } catch (e) {
      log(`категория «${c}»: ошибка ${e.message}`);
    }
  }
  // tier portal pages: plain [[links]] (if the lists are written out in wikitext)
  for (const p of PORTALS) {
    try {
      const { pages } = await queryAll({ prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: p, redirects: '1' }, 'portal', 1);
      for (const pg of pages.values()) {
        const c = contentOf(pg) || '';
        log(`портал «${pg.title}»: ${c.length} симв.; начало: ${JSON.stringify(c.slice(0, 600))}`);
        let n = 0;
        for (const m of c.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)) {
          const t = m[1].trim().replace(/_/g, ' ');
          if (/^(Category|File|Image|Template|Liquipedia|Help|Special):/i.test(t) || !t.includes('/')) continue;
          found.add(t); n++;
        }
        state.cats['portal:' + pg.title] = n;
      }
    } catch (e) {
      log(`портал «${p}»: ошибка ${e.message}`);
    }
  }
  return [...found];
}

async function infoboxes(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    try {
      const { pages } = await queryAll({ prop: 'revisions', rvprop: 'content', rvslots: 'main', rvsection: '0', titles: chunk.join('|') }, `ibox-${i / 50}`, 3);
      for (const p of pages.values()) {
        if (p.missing) continue;
        const args = parseInfobox(contentOf(p));
        const t = tournamentFromInfobox(args, p.title);
        if (t) {
          if (args?.type) t.typeRaw = args.type.slice(0, 40);
          if (args?.game) t.game = args.game.slice(0, 40);
          out.set(p.title, t);
        }
      }
    } catch (e) {
      log('инфобоксы:', e.message);
    }
  }
  return out;
}

async function fetchTree(page) {
  // the page itself and all its subpages, with content — one generator request (+ continuations)
  const { pages } = await queryAll({ generator: 'allpages', gapprefix: page, gapnamespace: '0', gapfilterredir: 'nonredirects', gaplimit: '50',
    prop: 'revisions', rvprop: 'content|ids|timestamp', rvslots: 'main' }, 'tree', 30);
  const titles = {};
  for (const p of pages.values()) {
    if (p.title !== page && !p.title.startsWith(page + '/')) continue;
    const c = contentOf(p);
    if (c == null) continue;
    titles[p.title] = { rev: p.revisions?.[0]?.revid, ts: p.revisions?.[0]?.timestamp, content: c };
  }
  return titles;
}

async function tournaments() {
  const statePath = path.join(STORE, 'tournaments.json');
  const state = await readJSON(statePath, { list: {} });
  state.list ||= {};
  const all = await discover(state);
  log(`кандидатов: ${all.length}`);
  // infobox of every candidate we have not seen or whose dates were still open (cheap: 50 per request)
  const need = all.filter((p) => {
    const x = state.list[p];
    if (!x) return true;
    if (!x.t) return false;
    return !x.t.end || x.t.end >= x.lead_at?.slice(0, 10);
  });
  const got = await infoboxes(need);
  for (const p of need) state.list[p] = { t: got.get(p) || null, lead_at: new Date().toISOString() };
  state.at = new Date().toISOString();
  await writeJSON(statePath, state);
  const sel = Object.entries(state.list)
    .filter(([, x]) => x.t && 'SA'.includes(x.t.tier || '-') && (x.t.end || x.t.start || '') >= FROM && (x.t.start || '9999') <= TODAY)
    .map(([p, x]) => ({ page: p, ...x.t }))
    .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  log(`S/A-турниров в периоде с ${FROM}: ${sel.length} (S: ${sel.filter((x) => x.tier === 'S').length}, A: ${sel.filter((x) => x.tier === 'A').length})`);
  let done = 0;
  let fetched = 0;
  for (const t of sel) {
    if (fetched >= LIMIT || overBudget()) break;
    const f = path.join(STORE, 'raw', slug(t.page) + '.json');
    const raw = await readJSON(f);
    const endDate = t.end || t.start;
    if (raw && raw.at.slice(0, 10) > addDays(endDate, 3)) { done++; continue; }
    if (raw && endDate >= TODAY && raw.at.slice(0, 10) === TODAY) { done++; continue; }
    try {
      const titles = await fetchTree(t.page);
      await writeJSON(f, { page: t.page, at: new Date().toISOString(), titles });
      fetched++;
      const size = Object.values(titles).reduce((s, x) => s + x.content.length, 0);
      log(`${t.start} ${t.tier} ${t.page}: ${Object.keys(titles).length} стр., ${(size / 1024).toFixed(0)} КБ`);
    } catch (e) {
      log(`${t.page}: ошибка ${e.message}`);
    }
  }
  log(`готово: ${done} уже было, загружено ${fetched}, осталось ${sel.length - done - fetched}; запросов ${lp.count}; ${((Date.now() - T0) / 60000).toFixed(1)} мин`);
}
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// ───────────────────────── players ─────────────────────────
const BAD_TITLE = /[#<>[\]|{}:]|^\s|\s$|^$/;

async function players() {
  const dir = arg('players', 'store/nades-site/players');
  const statePath = path.join(STORE, 'players.json');
  const state = await readJSON(statePath, { q: {}, extra: {} });
  state.q ||= {};
  state.extra ||= {};
  const names = new Set();
  const ix = await readJSON(path.join(dir, 'index.json'), { rows: [] });
  const cols = ix.cols || [];
  const iName = cols.indexOf('name');
  for (const r of ix.rows || []) if (r[iName]) names.add(String(r[iName]).trim());
  for (const f of await fs.readdir(dir)) {
    if (!/^\d+\.json$/.test(f)) continue;
    const j = await readJSON(path.join(dir, f), {});
    for (const n of j.names || []) if (n && String(n).trim()) names.add(String(n).trim());
  }
  const todo = [...names].filter((n) => !BAD_TITLE.test(n) && !(n in state.q));
  log(`имён игроков: ${names.size}, новых для поиска: ${todo.length}`);
  for (let i = 0; i < todo.length && !overBudget(); i += 50) {
    const chunk = todo.slice(i, i + 50);
    try {
      const j = await lp.call({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', rvsection: '0', redirects: '1', titles: chunk.join('|') }, `pl-${i / 50}`);
      const q = j.query || {};
      const step = new Map();
      for (const x of q.normalized || []) step.set(x.from, x.to);
      for (const x of q.redirects || []) step.set(x.from, x.to);
      const byTitle = new Map((q.pages || []).map((p) => [p.title, p]));
      for (const n of chunk) {
        let t = n;
        const chain = [];
        for (let k = 0; k < 4 && step.has(t); k++) { t = step.get(t); chain.push(t); }
        const p = byTitle.get(t);
        if (!p || p.missing || p.invalid) { state.q[n] = { missing: true }; continue; }
        state.q[n] = { title: p.title, ...(chain.length > 1 || (chain.length === 1 && chain[0].toLowerCase() !== n.toLowerCase()) ? { redirect: true } : {}) };
        state.extra[p.title] = contentOf(p) || '';
      }
    } catch (e) {
      log('игроки:', e.message);
    }
  }
  // spelling variants of names that were not found (wiki titles are case-sensitive after the first letter):
  // "MATYS" → "Matys", "matys"; "vinhy-" → "vinhy". The analysis accepts a page only if its steam64ID matches.
  const variants = new Set();
  for (const n of names) {
    if (BAD_TITLE.test(n) || !state.q[n]?.missing) continue;
    const core = n.replace(/^[-_.]+|[-_.]+$/g, '');
    for (const v of [n.toLowerCase(), n[0].toUpperCase() + n.slice(1).toLowerCase(), core, core.toLowerCase()]) {
      if (v && v !== n && !BAD_TITLE.test(v) && !(v in state.q)) variants.add(v);
    }
  }
  const vlist = [...variants];
  log(`вариантов написания для ненайденных: ${vlist.length}`);
  for (let i = 0; i < vlist.length && !overBudget(); i += 50) {
    const chunk = vlist.slice(i, i + 50);
    try {
      const j = await lp.call({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', rvsection: '0', redirects: '1', titles: chunk.join('|') }, `plv-${i / 50}`);
      const q = j.query || {};
      const step = new Map([...(q.normalized || []), ...(q.redirects || [])].map((x) => [x.from, x.to]));
      const byTitle = new Map((q.pages || []).map((p) => [p.title, p]));
      for (const n of chunk) {
        let t = n;
        for (let k = 0; k < 4 && step.has(t); k++) t = step.get(t);
        const p = byTitle.get(t);
        if (!p || p.missing || p.invalid) { state.q[n] = { missing: true, variant: true }; continue; }
        state.q[n] = { title: p.title, variant: true };
        state.extra[p.title] = contentOf(p) || '';
      }
    } catch (e) {
      log('варианты:', e.message);
    }
  }
  // disambiguation pages → fetch the linked player pages too (the analysis picks the one with the right steam64ID)
  const dis = new Set();
  for (const [t, c] of Object.entries(state.extra)) {
    if (!/\{\{\s*(disambig|disambiguation|dab)/i.test(c) && !/may refer to/i.test(c)) continue;
    for (const m of c.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)) {
      const x = m[1].trim().replace(/_/g, ' ');
      if (!/^(Category|File|Image|Template):/i.test(x) && !(x in state.extra)) dis.add(x);
    }
  }
  const extra = [...dis].filter((x) => !BAD_TITLE.test(x));
  log(`страниц-неоднозначностей ведут на ${extra.length} страниц`);
  for (let i = 0; i < extra.length && !overBudget(); i += 50) {
    const chunk = extra.slice(i, i + 50);
    try {
      const j = await lp.call({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', rvsection: '0', redirects: '1', titles: chunk.join('|') }, `pld-${i / 50}`);
      const q = j.query || {};
      const step = new Map([...(q.normalized || []), ...(q.redirects || [])].map((x) => [x.from, x.to]));
      const byTitle = new Map((q.pages || []).map((p) => [p.title, p]));
      for (const n of chunk) {
        let t = n;
        for (let k = 0; k < 4 && step.has(t); k++) t = step.get(t);
        const p = byTitle.get(t);
        state.extra[n] = p && !p.missing ? (t !== n ? `#REDIRECT [[${t}]]` : contentOf(p) || '') : '';
        if (p && !p.missing && t !== n) state.extra[t] = contentOf(p) || '';
      }
    } catch (e) {
      log('неоднозначности:', e.message);
    }
  }
  state.at = new Date().toISOString();
  await writeJSON(statePath, state);
  const found = Object.values(state.q).filter((x) => x.title).length;
  log(`игроков: найдено страниц ${found} из ${Object.keys(state.q).length}; запросов ${lp.count}`);
}

if (cmd === 'tournaments') await tournaments();
else if (cmd === 'players') await players();
else {
  console.error('usage: fetch-matches-hist.mjs tournaments|players');
  process.exit(2);
}
