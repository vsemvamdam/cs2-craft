// Polymarket (prediction market) — public Gamma API, no key: https://docs.polymarket.com
// Match-winner ("moneyline") markets of CS2 events → prices (0..1) → decimal odds 1/price.

export const PM = 'https://gamma-api.polymarket.com';

const parseList = (v) => {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v || '[]'); } catch { return []; }
};
const ts = (s) => {
  if (!s) return NaN;
  // "2026-11-05 16:00:00+00" → ISO
  const t = Date.parse(String(s).replace(' ', 'T').replace(/\+00$/, 'Z'));
  return Number.isFinite(t) ? Math.round(t / 1000) : NaN;
};

const isCS = (s) => /counter[\s-]?strike|\bcs2\b|\bcs:?go\b|\bcsgo\b/i.test(s || '');

/** finds CS2 series ids / tag ids in /sports output */
export function csSports(sports) {
  const series = new Set();
  const tags = new Set();
  for (const s of Array.isArray(sports) ? sports : []) {
    const name = String(s.sport || s.slug || s.label || '');
    if (!/^(cs2|csgo|cs|counter-?strike.*)$/i.test(name) && !isCS(name)) continue;
    for (const id of String(s.series ?? '').split(',').map((x) => x.trim()).filter(Boolean)) series.add(id);
    for (const id of String(s.tags ?? '').split(',').map((x) => x.trim()).filter(Boolean)) if (id !== '1' && id !== '100639') tags.add(id);
  }
  return { series: [...series], tags: [...tags] };
}

/** event list → [{ id, t1, t2, start, live, o:[o1,o2], p:[p1,p2], title }] */
export function parseEvents(events, now = Date.now() / 1000) {
  const out = [];
  const seen = new Set();
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || seen.has(e.id)) continue;
    seen.add(e.id);
    const title = String(e.title || '');
    const tagText = (e.tags || []).map((t) => t.slug + ' ' + t.label).join(' ');
    if (!isCS(title) && !isCS(tagText) && !isCS(e.slug) && !/^cs2-/.test(e.slug || '')) continue;
    if (e.closed || e.ended || e.archived) continue;
    const markets = (e.markets || []).filter((m) => !m.closed && m.active !== false);
    // match winner: explicit moneyline, else a 2-outcome market whose outcomes are not Yes/No and whose question has "vs"
    let mk = markets.find((m) => m.sportsMarketType === 'moneyline');
    if (!mk) {
      mk = markets.find((m) => {
        const o = parseList(m.outcomes);
        return o.length === 2 && !/^(yes|no|over|under)$/i.test(o[0]) && /\bvs\.?\b/i.test(m.question || title) && !/map|game \d|handicap|total|o\/u/i.test((m.groupItemTitle || '') + ' ' + (m.question || ''));
      });
    }
    if (!mk) continue;
    const names = parseList(mk.outcomes).map(String);
    const prices = parseList(mk.outcomePrices).map(Number);
    if (names.length !== 2 || prices.length !== 2) continue;
    if (!(prices[0] > 0.01 && prices[1] > 0.01 && prices[0] < 0.99 && prices[1] < 0.99)) continue;
    const start = ts(mk.gameStartTime) || ts(e.startTime) || ts(e.eventDate) || ts(e.endDate);
    if (!Number.isFinite(start) || start < now - 12 * 3600) continue;
    const sum = prices[0] + prices[1];
    out.push({
      id: String(e.id),
      title,
      t1: names[0],
      t2: names[1],
      start,
      live: !!e.live,
      p: [prices[0] / sum, prices[1] / sum],
      o: [1 / prices[0], 1 / prices[1]],
      vol: Math.round(+mk.volume || +e.volume || 0),
    });
  }
  return out;
}

/** fetches open CS2 events: discovery through /sports, then events by series/tag, with fallbacks */
export async function fetchPolymarket(get, log = console.log) {
  const events = [];
  let sports = null;
  try { sports = await get('pm-sports', PM + '/sports'); } catch (e) { log('polymarket /sports:', e.message); }
  const { series, tags } = csSports(sports);
  log(`polymarket: series=${series.join(',') || '—'} tags=${tags.join(',') || '—'}`);
  const tryList = async (name, url) => {
    try {
      const j = await get(name, url);
      const arr = Array.isArray(j) ? j : j?.events || j?.data || [];
      events.push(...arr);
      return arr.length;
    } catch (e) {
      log(`polymarket ${name}:`, e.message);
      return 0;
    }
  };
  for (const s of series.slice(0, 3)) {
    let cursor = '';
    for (let page = 0; page < 3; page++) {
      const url = `${PM}/events/keyset?series_id=${s}&closed=false&limit=100` + (cursor ? `&after_cursor=${encodeURIComponent(cursor)}` : '');
      let j;
      try { j = await get(`pm-series-${s}-${page}`, url); } catch (e) { log('polymarket series', s, e.message); break; }
      const arr = Array.isArray(j) ? j : j?.events || j?.data || [];
      events.push(...arr);
      cursor = j?.next_cursor || j?.nextCursor || '';
      if (!cursor || arr.length < 100) break;
    }
  }
  if (!events.length) for (const t of tags.slice(0, 2)) await tryList(`pm-tag-${t}`, `${PM}/events?tag_id=${t}&closed=false&limit=200`);
  if (!events.length) for (const slug of ['counter-strike-2', 'cs2', 'counter-strike']) if (await tryList(`pm-tagslug-${slug}`, `${PM}/events?tag_slug=${slug}&closed=false&limit=200`)) break;
  return parseEvents(events);
}
