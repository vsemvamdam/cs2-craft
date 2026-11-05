#!/usr/bin/env node
// Builds the static item database (skins, collections, cases, stickers, charms)
// from the open dataset https://github.com/ByMykel/CSGO-API (MIT).
//
// Usage:
//   node scripts/build-db.mjs                 # download fresh data
//   node scripts/build-db.mjs --src ./raw     # use local copies (skins.json, ...)
//
// Output: public/data/db.json, public/data/stickers.json, public/data/charms.json,
//         public/data/market-names.json (all tradable market names, for price fetchers)

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public', 'data');
const BASE = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/';
const FILES = ['skins.json', 'skins_not_grouped.json', 'collections.json', 'crates.json', 'stickers.json', 'keychains.json'];

const args = process.argv.slice(2);
const srcIdx = args.indexOf('--src');
const SRC = srcIdx >= 0 ? path.resolve(args[srcIdx + 1]) : null;

async function load(name) {
  if (SRC) {
    const alt = { 'skins_not_grouped.json': 'skins_ng.json' };
    for (const n of [name, alt[name]].filter(Boolean)) {
      try { return JSON.parse(await fs.readFile(path.join(SRC, n), 'utf8')); } catch {}
    }
    throw new Error(`missing ${name} in ${SRC}`);
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const r = await fetch(BASE + name);
      if (!r.ok) throw new Error(`${r.status}`);
      return await r.json();
    } catch (e) {
      if (attempt === 4) throw new Error(`download ${name}: ${e.message}`);
      await new Promise((res) => setTimeout(res, attempt * 3000));
    }
  }
}

// --- image URL compaction -------------------------------------------------
const IMG_PREFIX = [
  'https://community.akamai.steamstatic.com/economy/image/',
  'https://cdn.steamstatic.com/apps/730/icons/',
  'https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/panorama/images/',
];
function img(u) {
  if (!u) return '';
  for (let i = 0; i < IMG_PREFIX.length; i++) if (u.startsWith(IMG_PREFIX[i])) return i + ':' + u.slice(IMG_PREFIX[i].length);
  return u;
}

const RARITY = {
  'Consumer Grade': 1, 'Industrial Grade': 2, 'Mil-Spec Grade': 3, Restricted: 4,
  Classified: 5, Covert: 6, Contraband: 7, Extraordinary: 6,
  // sticker / charm rarities
  'Base Grade': 1, 'High Grade': 3, Remarkable: 4, Exotic: 5, Default: 0,
};
const CAT = { Rifles: 'rifle', Pistols: 'pistol', SMGs: 'smg', Heavy: 'heavy', Knives: 'knife', Gloves: 'gloves', Equipment: 'equipment' };
const WEAR_NAMES = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'];

function marketName({ name, gold, st, sv, wear, vanilla }) {
  // name is like "★ Karambit | Fade" or "AK-47 | Redline" or "★ Karambit" (vanilla)
  let base = name;
  let star = '';
  if (base.startsWith('★ ')) { star = '★ '; base = base.slice(2); }
  let prefix = '';
  if (st) prefix = 'StatTrak™ ';
  if (sv) prefix = 'Souvenir ';
  const wearPart = vanilla || wear == null ? '' : ` (${WEAR_NAMES[wear]})`;
  return `${star}${prefix}${base}${wearPart}`;
}

/** Official Russian names from the game files (ByMykel/counter-strike-file-tracker, MIT). */
async function loadRussian() {
  const TRACKER = 'https://raw.githubusercontent.com/ByMykel/counter-strike-file-tracker/main/static/';
  try {
    const get = async (f) => {
      if (SRC) { try { return JSON.parse(await fs.readFile(path.join(SRC, f), 'utf8')); } catch {} }
      const r = await fetch(TRACKER + f);
      if (!r.ok) throw new Error(f + ' ' + r.status);
      return r.json();
    };
    const [ru, ig] = await Promise.all([get('csgo_russian.json'), get('items_game.json')]);
    const tokens = new Map();
    for (const [k, v] of Object.entries(ru.lang?.Tokens || {})) if (typeof v === 'string') tokens.set(k.toLowerCase(), v);
    const t = (key) => (key ? tokens.get(String(key).replace(/^#/, '').toLowerCase()) : undefined);
    const g = ig.items_game || ig;
    const paint = (pi) => t(g.paint_kits?.[String(pi)]?.description_tag);
    const itemName = (wid) => {
      let it = g.items?.[String(wid)];
      for (let depth = 0; it && depth < 6; depth++) {
        if (it.item_name) return t(it.item_name);
        const pf = String(it.prefab || '').split(' ')[0];
        it = pf ? g.prefabs?.[pf] : null;
      }
      return undefined;
    };
    console.log(`russian names: ${tokens.size} strings`);
    return { paint, itemName };
  } catch (e) {
    console.warn('russian names unavailable:', e.message);
    return null;
  }
}

async function main() {
  const [skins, ng, collections, crates, stickers, charms] = await Promise.all(FILES.map(load));
  const RU = await loadRussian();
  console.log(`loaded: skins ${skins.length}, variants ${ng.length}, collections ${collections.length}, crates ${crates.length}, stickers ${stickers.length}, charms ${charms.length}`);

  // ---- skins (merge Doppler phases into one entry) ----
  const byName = new Map();
  const idAlias = {}; // phase skin id -> merged skin id
  const outSkins = [];
  for (const s of skins) {
    const cat = CAT[s.category?.name] || 'other';
    const gold = cat === 'knife' || cat === 'gloves';
    const wears = (s.wears || []).map((w) => WEAR_NAMES.indexOf(w.name)).filter((i) => i >= 0).sort();
    const vanilla = gold && !s.pattern; // "★ Karambit"
    const rec = {
      id: s.id,
      name: s.name,
      wpn: s.weapon?.name || '',
      wid: s.weapon?.weapon_id || 0,
      fin: s.pattern?.name || (vanilla ? 'Vanilla' : ''),
      cat,
      rar: gold ? 8 : (RARITY[s.rarity?.name] ?? 0),
      gold: gold ? 1 : 0,
      mn: s.min_float ?? 0,
      mx: s.max_float ?? 1,
      wears,
      st: s.stattrak ? 1 : 0,
      sv: s.souvenir ? 1 : 0,
      col: (s.collections || []).map((c) => c.id),
      cr: (s.crates || []).map((c) => c.id),
      img: img(s.image),
      pi: s.paint_index ? Number(s.paint_index) : 0,
      team: s.team?.id || 'both',
    };
    if (RU) {
      const w = RU.itemName(rec.wid) || rec.wpn;
      const f = s.paint_index && !vanilla ? RU.paint(s.paint_index) : undefined;
      const ruName = (gold ? '★ ' : '') + w + (f ? ` | ${f}` : '');
      if (ruName !== rec.name) rec.ru = ruName;
    }
    if (vanilla) rec.vanilla = 1;
    if (s.legacy_model) rec.legacy = 1;
    if (s.special_notes?.length) rec.notes = s.special_notes.map((n) => n.text);
    if (s.phase) {
      const existing = byName.get(s.name);
      if (existing) {
        existing.phases.push({ ph: s.phase, id: s.id, img: img(s.image), pi: s.paint_index ? Number(s.paint_index) : 0 });
        idAlias[s.id] = existing.id;
        continue;
      }
      rec.phases = [{ ph: s.phase, id: s.id, img: img(s.image), pi: s.paint_index ? Number(s.paint_index) : 0 }];
    }
    byName.set(s.name, rec);
    outSkins.push(rec);
  }
  const PHASE_ORDER = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Ruby', 'Sapphire', 'Black Pearl', 'Emerald'];
  for (const s of outSkins) if (s.phases) s.phases.sort((a, b) => PHASE_ORDER.indexOf(a.ph) - PHASE_ORDER.indexOf(b.ph));
  const resolve = (id) => idAlias[id] || id;
  const skinIds = new Set(outSkins.map((s) => s.id));

  // ---- crates ----
  const outCrates = [];
  for (const c of crates) {
    if (!['Case', 'Souvenir'].includes(c.type)) continue;
    const contains = [...new Set((c.contains || []).map((x) => resolve(x.id)).filter((id) => skinIds.has(id)))];
    const rare = [...new Set((c.contains_rare || []).map((x) => resolve(x.id)).filter((id) => skinIds.has(id)))];
    if (!contains.length && !rare.length) continue;
    outCrates.push({ id: c.id, name: c.name, type: c.type === 'Case' ? 'case' : 'souvenir', img: img(c.image), date: c.first_sale_date || '', skins: contains, rare });
  }
  const crateById = new Map(outCrates.map((c) => [c.id, c]));

  // ---- collections ----
  const outCols = [];
  for (const c of collections) {
    const cr = (c.crates || []).map((x) => x.id).filter((id) => crateById.has(id));
    const skinsIn = [...new Set((c.contains || []).map((x) => resolve(x.id)).filter((id) => skinIds.has(id)))];
    if (!skinsIn.length) continue;
    const gold = new Set();
    let kind = 'other';
    for (const id of cr) {
      const k = crateById.get(id);
      if (k.type === 'case') kind = 'case';
      else if (kind !== 'case') kind = 'map';
      for (const g of k.rare) gold.add(g);
    }
    outCols.push({ id: c.id, name: c.name, img: img(c.image), date: c.release_date || '', kind, crates: cr, skins: skinsIn, gold: [...gold] });
  }

  // ---- verify market-name rules against the per-variant list ----
  const names = new Set();
  const nameIndex = new Map(outSkins.map((s) => [s.name, s]));
  let mismatches = 0;
  for (const v of ng) {
    const mh = v.market_hash_name;
    if (!mh) continue;
    names.add(mh);
  }
  const generated = new Set();
  for (const s of outSkins) {
    const flags = [[0, 0]];
    if (s.st) flags.push([1, 0]);
    if (s.sv) flags.push([0, 1]);
    for (const [st, sv] of flags) {
      if (s.vanilla) generated.add(marketName({ name: s.name, gold: 1, st, sv, vanilla: 1 }));
      else for (const w of s.wears) generated.add(marketName({ name: s.name, gold: s.gold, st, sv, wear: w }));
    }
  }
  for (const n of names) if (!generated.has(n)) { if (mismatches < 15) console.warn('  not generated:', n); mismatches++; }
  let extra = 0;
  for (const n of generated) if (!names.has(n)) extra++;
  console.log(`market names: dataset ${names.size}, generated ${generated.size}, missing ${mismatches}, extra ${extra}`);

  // ---- stickers & charms ----
  const outStickers = stickers
    .filter((s) => s.name)
    .map((s) => {
      const r = { id: s.id, d: +s.def_index || 0, n: s.name.replace(/^Sticker \| /, ''), img: img(s.image), r: RARITY[s.rarity?.name] ?? 0, t: s.type?.[0] || 'O', e: s.effect || 'Other' };
      if (s.tournament?.name) r.tour = s.tournament.name;
      if (s.market_hash_name && s.market_hash_name !== 'None') r.m = s.market_hash_name;
      if (s.team?.name) r.team = s.team.name;
      if (s.player?.name) r.pl = s.player.name;
      return r;
    });
  const outCharms = charms.map((k) => ({ id: k.id, d: +k.def_index || 0, n: k.name.replace(/^Charm \| /, ''), img: img(k.image), r: RARITY[k.rarity?.name] ?? 0, m: k.market_hash_name || k.name, col: k.collections?.[0]?.name || '' }));

  const db = {
    v: 1,
    generated: new Date().toISOString(),
    imgPrefix: IMG_PREFIX,
    skins: outSkins,
    collections: outCols,
    crates: outCrates,
  };
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, 'db.json'), JSON.stringify(db));
  await fs.writeFile(path.join(OUT, 'stickers.json'), JSON.stringify({ imgPrefix: IMG_PREFIX, stickers: outStickers }));
  await fs.writeFile(path.join(OUT, 'charms.json'), JSON.stringify({ imgPrefix: IMG_PREFIX, charms: outCharms }));
  // team logos for the matches page: Valve's own team-sticker art (latest paper sticker of each team)
  const logos = {};
  const pickLogo = new Map();
  for (const st of outStickers) {
    if (!st.team || st.pl || st.team === 'both') continue;
    if (st.e !== 'Other' && st.e !== 'Paper') continue;
    const cur = pickLogo.get(st.team);
    if (!cur || st.d > cur.d) pickLogo.set(st.team, st);
  }
  for (const [team, st] of [...pickLogo].sort((a, b) => a[1].d - b[1].d)) for (const k of teamKeys(team)) logos[k] = st.img;
  await fs.writeFile(path.join(OUT, 'team-logos.json'), JSON.stringify({ imgPrefix: IMG_PREFIX, source: 'Steam: наклейки команд CS2 (© Valve)', logos }));
  console.log(`team logos: ${pickLogo.size} teams`);
  // all market names we care about (skins + stickers + charms), used by the price fetchers
  const allNames = [...new Set([...generated, ...outStickers.filter((s) => s.m).map((s) => s.m), ...outCharms.map((c) => c.m)])].sort();
  await fs.writeFile(path.join(OUT, 'market-names.json'), JSON.stringify(allNames));
  for (const f of ['db.json', 'stickers.json', 'charms.json', 'market-names.json', 'team-logos.json']) {
    const st = await fs.stat(path.join(OUT, f));
    console.log(`  ${f}: ${(st.size / 1024).toFixed(0)} KB`);
  }
  console.log(`skins ${outSkins.length}, collections ${outCols.length} (with gold ${outCols.filter((c) => c.gold.length).length}), crates ${outCrates.length}, stickers ${outStickers.length}, charms ${outCharms.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

/** lookup keys of a team name: full normalized name and the name without filler words (Team, Esports, Gaming, Clan…).
 * The same function is used on the site (src/lib/teams.ts) — keep them in sync. */
export function teamKeys(name) {
  const words = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').split(/[^a-z0-9]+/).filter(Boolean);
  const full = words.join('');
  const base = words.filter((w) => !FILLER.has(w)).join('');
  return [...new Set([full, base].filter(Boolean))];
}
const FILLER = new Set(['team', 'esports', 'esport', 'e', 'sports', 'gaming', 'clan', 'club', 'gg']);
