// Steam Market price-history helpers shared by fetch-history.mjs (CI) and import-history.mjs (home collection)
import { dayOf } from './common.mjs';

export const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
/** "Jul 02 2014 01: +0" -> ms */
export function parseSteamDate(s) {
  const m = /^(\w{3}) (\d{2}) (\d{4}) (\d{2})/.exec(s);
  if (!m) return NaN;
  return Date.UTC(+m[3], MONTHS[m[1]], +m[2], +m[4]);
}

/** Collapse Steam points (daily + hourly for the last month) into one point per day. */
export function toDaily(prices) {
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

export function currencyOf(j) {
  const s = `${j.price_prefix || ''}|${j.price_suffix || ''}`;
  if (s.includes('$')) return 'USD';
  if (s.includes('€')) return 'EUR';
  if (/pуб|руб/i.test(s)) return 'RUB';
  if (s.includes('¥')) return 'CNY';
  return s.replace('|', '').trim() || 'USD';
}

/** CBR history of a currency in RUB, for converting non-USD wallets to USD. */
export async function cbrHistory(code) {
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

