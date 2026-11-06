#!/usr/bin/env node
// Everything in CS2 that is not a weapon skin, for the catalog's «Другое» section:
// agents, charms (incl. souvenir highlight charms), collectibles (pins, coins, trophies, medals),
// containers (cases, capsules, souvenir packages), gifts, graffiti, keys, music kits, passes, patches.
// Stickers are already in public/data/stickers.json (scripts/build-db.mjs) and are shown from there.
//
//   node scripts/build-items.mjs [--src dir-with-cached-json]      → public/data/items.json
//
// Sources: the open dataset https://github.com/ByMykel/CSGO-API (MIT) for the item lists and images, and the
// game's own Russian localisation + items_game (ByMykel/counter-strike-file-tracker) for official Russian names.

import fs from 'node:fs/promises';
import path from 'node:path';

const argv = process.argv.slice(2);
const SRC = (() => { const i = argv.indexOf('--src'); return i >= 0 ? argv[i + 1] : process.env.ITEMS_SRC || ''; })();
const OUT = path.join('public', 'data', 'items.json');
const API = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/';
const TRACKER = 'https://raw.githubusercontent.com/ByMykel/counter-strike-file-tracker/main/static/';

async function get(base, f) {
  if (SRC) { try { return JSON.parse(await fs.readFile(path.join(SRC, f), 'utf8')); } catch { /* download */ } }
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(base + f, { signal: AbortSignal.timeout(120000) });
      if (r.ok) return await r.json();
      console.warn(f, r.status);
    } catch (e) { console.warn(f, e.message); }
    await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
  }
  throw new Error('не скачался ' + f);
}

// same compaction as build-db.mjs (the site expands "<i>:<rest>" with imgPrefix[i])
const IMG_PREFIX = [
  'https://community.akamai.steamstatic.com/economy/image/',
  'https://cdn.steamstatic.com/apps/730/icons/',
  'https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/static/panorama/images/',
];
const img = (u) => {
  if (!u) return '';
  for (let i = 0; i < IMG_PREFIX.length; i++) if (u.startsWith(IMG_PREFIX[i])) return i + ':' + u.slice(IMG_PREFIX[i].length);
  return u;
};
// rarity_rare / rarity_rare_character / rarity_rare_weapon → 3 (same scale as skins: 1 common … 6 ancient, 7 contraband)
const RAR = { common: 1, uncommon: 2, rare: 3, mythical: 4, legendary: 5, ancient: 6, contraband: 7 };
const rarNum = (r) => RAR[/^rarity_([a-z]+)/.exec(r?.id || '')?.[1]] || 0;

const COLLECTIBLE = {
  Pin: 'Значок', 'Premier Season Coin': 'Монета Premier', 'Map Contributor Coin': 'Монета автора карты', "Pick'Em Coin": 'Монета Pick\'Em',
  'Operation Coin': 'Монета операции', 'Stars for Operation': 'Звёзды операции', 'Service Medal': 'Медаль за службу',
  'Tournament Finalist Trophy': 'Трофей финалиста', "Old Pick'Em Trophy": 'Трофей Pick\'Em', 'Fantasy Trophy': 'Трофей фэнтези',
};
const PASS = { 'Operation Pass': 'Пропуск операции', 'Tournament Pass': 'Зрительский пропуск', 'Souvenir Token': 'Сувенирный жетон' };
const CONTAINER = {
  Case: 'Кейс', Souvenir: 'Сувенирный набор', 'Sticker Capsule': 'Капсула с наклейками', 'Autograph Capsule': 'Капсула с автографами',
  'Music Kit Box': 'Коробка с наборами музыки', 'Patch Capsule': 'Капсула с нашивками', Pins: 'Капсула со значками',
  Graffiti: 'Коробка с граффити', 'Souvenir Highlight': 'Сувенирный набор с хайлайтами',
};

async function main() {
  const [agents, keychains, highlights, collectibles, crates, keys, graffiti, music, patches, base] = await Promise.all(
    ['agents', 'keychains', 'highlights', 'collectibles', 'crates', 'keys', 'graffiti', 'music_kits', 'patches', 'base_weapons'].map((f) => get(API, f + '.json')));

  // default-skin pictures of every weapon — the Statistics page draws them as silhouettes next to kill counts
  const w = {};
  for (const x of base) { const k = String(x.id || '').replace(/^base_weapon-weapon_/, ''); if (k && x.image) w[k] = img(x.image); }
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(path.join(path.dirname(OUT), 'weapon-icons.json'), JSON.stringify({ imgPrefix: IMG_PREFIX, w }));

  // official Russian strings
  let T = () => undefined, g = {};
  try {
    const [ru, ig] = await Promise.all([get(TRACKER, 'csgo_russian.json'), get(TRACKER, 'items_game.json')]);
    const tokens = new Map();
    for (const [k, v] of Object.entries(ru.lang?.Tokens || {})) if (typeof v === 'string') tokens.set(k.toLowerCase(), v);
    T = (key) => (key ? tokens.get(String(key).replace(/^#/, '').toLowerCase()) : undefined);
    g = ig.items_game || ig;
  } catch (e) { console.warn('русские названия недоступны:', e.message); }
  const kitName = new Map(Object.values(g.sticker_kits || {}).map((k) => [k.name, k.item_name]));
  const musicName = new Map(Object.values(g.music_definitions || {}).map((m) => [m.name, m.loc_name]));
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const rarRu = (r) => cap(T(r?.id)) || r?.name || '';

  const out = [];
  const add = (x, c, ru, extra = {}) => {
    const m = [].concat(extra.m ?? x.market_hash_name ?? []).filter((s) => s && s !== 'None');
    const e = { id: x.id, c, n: (ru || x.name).replace(/\s+/g, ' ').trim(), r: rarNum(x.rarity), i: img(x.image) };
    if (ru && ru !== x.name) e.en = x.name;
    if (x.rarity) e.rn = rarRu(x.rarity);
    if (m.length) e.m = m;
    if (extra.t) e.t = extra.t;
    if (extra.o) e.o = extra.o;
    if (extra.k) e.k = extra.k; // graffiti colours: 1 = all of `tints`, or a list of indices
    out.push(e);
  };
  const def = (x) => +x.def_index || 0;

  for (const x of agents) add(x, 'agent', T(g.items?.[x.def_index]?.item_name), { t: x.team?.id === 'terrorists' ? 'Террорист' : 'Спецназ', o: def(x) });
  for (const x of keychains) { const n = T(x.original?.loc_name); add(x, 'charm', n && 'Брелок | ' + n, { o: def(x) }); }
  for (const x of highlights) add(x, 'charm', x.name.replace(/^Souvenir Charm \| /, 'Сувенирный брелок | '), { t: 'Хайлайт ' + (x.tournament_event || ''), o: 10000 + def(x) });
  for (const x of collectibles) {
    const pass = PASS[x.type];
    add(x, pass ? 'pass' : 'collectible', T(x.original?.item_name), { t: pass || COLLECTIBLE[x.type] || 'Сувенир', o: def(x) });
  }
  for (const x of crates) {
    const gift = !x.type && /gift|present|parcel/i.test(x.name);
    const o = +(x.first_sale_date || '').replace(/\D/g, '') || def(x);
    add(x, gift ? 'gift' : 'container', T(x.original?.item_name), { t: gift ? 'Подарок' : CONTAINER[x.type] || 'Набор', o });
  }
  for (const x of keys) add(x, 'key', T(x.original?.item_name), { o: def(x) });
  for (const x of patches) { const n = T(kitName.get(x.original?.name)); add(x, 'patch', n && 'Нашивка | ' + n, { o: def(x) }); }

  // music kits: the StatTrak™ version is the same kit — one card, both market names
  const mk = new Map();
  for (const x of music) {
    const base = x.name.replace(/^StatTrak™ /, '');
    const e = mk.get(base) || { x: { ...x, name: base, market_hash_name: null }, m: [] };
    if (x.market_hash_name && x.market_hash_name !== 'None') e.m[x.name.startsWith('StatTrak') ? 'push' : 'unshift'](x.market_hash_name);
    if (!x.name.startsWith('StatTrak')) e.x = { ...x, market_hash_name: null };
    mk.set(base, e);
  }
  for (const { x, m } of mk.values()) {
    const n = T(musicName.get(x.original?.name));
    add(x, 'music', n && 'Набор музыки | ' + n, { m, o: def(x), t: m.length > 1 ? 'Есть StatTrak™' : undefined });
  }

  // graffiti: one card per pattern. Each colour is a separate market item «<pattern> (<colour>)»; to keep the file
  // small only the pattern name is stored, plus the colour list (indices into `tints` when not all of them)
  const tints = [];
  const gr = new Map();
  for (const x of graffiti) {
    const tint = x.tint?.name;
    const base = tint ? x.name.slice(0, -(tint.length + 3)) : x.name;
    const e = gr.get(base) || { x: { ...x, name: base }, tn: [], plain: false };
    if (tint) {
      let ti = tints.indexOf(tint);
      if (ti < 0) ti = tints.push(tint) - 1;
      if (x.market_hash_name) e.tn.push(ti);
    } else { e.x = x; e.plain = !!x.market_hash_name; }
    gr.set(base, e);
  }
  const colours = (k) => `${k} ${k % 10 === 1 && k % 100 !== 11 ? 'цвет' : k % 10 >= 2 && k % 10 <= 4 && (k % 100 < 10 || k % 100 >= 20) ? 'цвета' : 'цветов'}`;
  for (const [base, { x, tn, plain }] of gr) {
    const n = T(x.original?.item_name) || T(kitName.get(x.original?.name));
    add({ ...x, name: base }, 'graffiti', n && 'Граффити | ' + n, { m: plain || tn.length ? [base] : [], o: def(x), t: tn.length ? colours(tn.length) : undefined, k: tn.length ? (tn.length === tints.length ? 1 : tn.sort((a, b) => a - b)) : undefined });
  }

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify({ updated: new Date().toISOString(), src: 'ByMykel/CSGO-API (MIT), названия — из файлов игры', imgPrefix: IMG_PREFIX, tints, items: out }));
  const by = {};
  for (const e of out) by[e.c] = (by[e.c] || 0) + 1;
  console.log(`items.json: ${out.length} предметов`, by, `с русским названием: ${out.filter((e) => e.en).length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
