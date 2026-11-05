// Team-name matching between sources (Liquipedia ↔ bookmakers ↔ Polymarket) and odds math.

const STOP = new Set(['team', 'esports', 'esport', 'gaming', 'club', 'gg', 'clan', 'the', 'cs', 'cs2', 'csgo', 'org']);
// spelled-out names that bookmakers and wikis write differently
const ALIAS = {
  natusvincere: 'navi', navi: 'navi',
  ninjasinpyjamas: 'nip', nip: 'nip',
  virtuspro: 'vp', vp: 'vp',
  mousesports: 'mouz', mouz: 'mouz',
  mongolz: 'mongolz',
  teamspirit: 'spirit',
  g2: 'g2',
  faze: 'faze',
  liquid: 'liquid',
  bigclan: 'big',
  '3dmax': '3dmax',
  sangal: 'sangal',
  eternalfire: 'eternalfire', ef: 'eternalfire',
  gamerlegion: 'gamerlegion', gl: 'gamerlegion',
  betboom: 'betboom', bb: 'betboom',
  rareatom: 'rareatom', ra: 'rareatom',
  imperial: 'imperial', imperialesports: 'imperial',
  pain: 'pain', paingaming: 'pain',
  m80: 'm80',
  nrg: 'nrg',
  furia: 'furia',
  mibr: 'mibr', madeinbrazil: 'mibr',
  falcons: 'falcons',
  heroic: 'heroic',
  astralis: 'astralis',
  vitality: 'vitality',
  aurora: 'aurora',
  tyloo: 'tyloo',
  lynnvision: 'lynnvision', lvg: 'lynnvision',
  thewildcard: 'wildcard', wildcard: 'wildcard',
};
const JUNIOR = /(academy|junior|juniors|youth|fe|female|women|ladies|young|next|blue|white|red|2)$/;

// spelled-out parts inside longer names ("Natus Vincere Junior" → "navijunior")
const REPL = [['natusvincere', 'navi'], ['ninjasinpyjamas', 'nip'], ['virtuspro', 'vp'], ['mousesports', 'mouz'], ['innercircle', 'ic']];
const WORD = { jr: 'junior', acad: 'academy', ac: 'academy' };

export function normTeam(s) {
  if (!s) return '';
  const words = s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9а-яё]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map((w) => WORD[w] || w);
  let k = words.join('');
  for (const [from, to] of REPL) k = k.replace(from, to);
  return k;
}

/** all comparable keys of a team: short name, full name, aliases */
export function teamKeys(...names) {
  const keys = new Set();
  for (const n of names) {
    const k = normTeam(n);
    if (!k) continue;
    keys.add(k);
    if (ALIAS[k]) keys.add(ALIAS[k]);
  }
  return keys;
}

export function sameTeam(a, b) {
  for (const x of a) {
    for (const y of b) {
      if (x === y) return true;
      const [s, l] = x.length < y.length ? [x, y] : [y, x];
      if (s.length >= 4 && l.startsWith(s) && !JUNIOR.test(l.slice(s.length))) return true;
    }
  }
  return false;
}

/**
 * Finds the match for an odds fixture. Returns { match, swap } or null.
 * matches: [{ keys1, keys2, start }] ; fixture: { keys1, keys2, start }
 */
export function findMatch(matches, fx, maxHours = 8) {
  let best = null;
  for (const m of matches) {
    let swap;
    if (sameTeam(m.keys1, fx.keys1) && sameTeam(m.keys2, fx.keys2)) swap = false;
    else if (sameTeam(m.keys1, fx.keys2) && sameTeam(m.keys2, fx.keys1)) swap = true;
    else continue;
    const dt = Math.abs(m.start - fx.start) / 3600;
    if (dt > maxHours) continue;
    if (!best || dt < best.dt) best = { match: m, swap, dt };
  }
  return best;
}

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;

/**
 * books: [{ b, o: [o1, o2], p?: [p1, p2] }] → { books, best, bestBy, prob, fav }
 * prob — consensus without bookmaker margin: mean of each book's normalised implied probabilities.
 */
export function summarizeOdds(books) {
  const ok = books.filter((x) => x.o && x.o[0] > 1 && x.o[1] > 1);
  if (!ok.length) return null;
  const best = [0, 0];
  const bestBy = ['', ''];
  let p1 = 0;
  for (const x of ok) {
    for (const i of [0, 1]) if (x.o[i] > best[i]) (best[i] = x.o[i]), (bestBy[i] = x.b);
    const q = x.p || [1 / x.o[0], 1 / x.o[1]];
    p1 += q[0] / (q[0] + q[1]);
  }
  p1 /= ok.length;
  const prob = [r3(p1), r3(1 - p1)];
  return {
    books: ok.map((x) => ({ b: x.b, o: [r2(x.o[0]), r2(x.o[1])], ...(x.at ? { at: x.at } : {}) })),
    best: [r2(best[0]), r2(best[1])],
    bestBy,
    prob,
    fav: Math.abs(prob[0] - prob[1]) < 0.02 ? null : prob[0] > prob[1] ? 0 : 1,
  };
}
