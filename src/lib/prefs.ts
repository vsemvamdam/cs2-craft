import { useSyncExternalStore } from 'react';
import type { PriceRow, Prices, Skin } from './data';
import { WEARS } from './labels';

export type Currency = 'USD' | 'RUB' | 'EUR' | 'CNY';
export type Source = 'steam' | 'skinport' | 'best';
export type Prefs = { currency: Currency; source: Source; theme: 'auto' | 'dark' | 'light' };

const KEY = 'cs2craft.prefs';
const DEFAULT: Prefs = { currency: 'RUB', source: 'steam', theme: 'auto' };
let state: Prefs = DEFAULT;
try {
  const raw = localStorage.getItem(KEY);
  if (raw) state = { ...DEFAULT, ...JSON.parse(raw) };
} catch {}
const subs = new Set<() => void>();
export function setPrefs(p: Partial<Prefs>) {
  state = { ...state, ...p };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  applyTheme();
  subs.forEach((f) => f());
}
export function usePrefs(): Prefs {
  return useSyncExternalStore((cb) => (subs.add(cb), () => subs.delete(cb)), () => state);
}
export function getPrefs() {
  return state;
}
export function applyTheme() {
  const t = state.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

const SYMBOL: Record<Currency, string> = { USD: '$', RUB: '₽', EUR: '€', CNY: '¥' };

/** cents (USD) -> formatted string in the chosen currency */
export function money(cents: number | null | undefined, prices: Prices | null, cur: Currency, opts: { compact?: boolean } = {}): string {
  if (cents == null || Number.isNaN(cents)) return '—';
  const rate = cur === 'USD' ? 1 : prices?.rates?.[cur];
  if (!rate) return money(cents, prices, 'USD', opts);
  const v = (cents / 100) * rate;
  const a = Math.abs(v);
  const digits = cur === 'RUB' ? (a >= 100 ? 0 : 2) : a >= 1000 ? 0 : 2;
  let s: string;
  if (opts.compact && a >= 10000) s = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  else s = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
  return cur === 'USD' || cur === 'EUR' ? `${SYMBOL[cur]}${s}` : `${s} ${SYMBOL[cur]}`;
}
export const currencySymbol = (c: Currency) => SYMBOL[c];
/** value typed by the user in the chosen currency -> USD cents */
export function toCentsUSD(value: number, prices: Prices | null, cur: Currency): number {
  const rate = cur === 'USD' ? 1 : prices?.rates?.[cur] || 1;
  return Math.round((value / rate) * 100);
}
export function fromCentsUSD(cents: number, prices: Prices | null, cur: Currency): number {
  const rate = cur === 'USD' ? 1 : prices?.rates?.[cur] || 1;
  return (cents / 100) * rate;
}

/** choose one price from a price row according to the user's source */
export function pick(row: PriceRow | undefined | null, source: Source): number | null {
  if (!row) return null;
  const steam = row[0];
  const sp = row[2] ?? row[3] ?? row[5];
  if (source === 'steam') return steam ?? sp ?? null;
  if (source === 'skinport') return sp ?? steam ?? null;
  const c = [steam, sp].filter((x): x is number => x != null);
  return c.length ? Math.min(...c) : null;
}

// ---- variants & market names ----
export type Flag = '' | 's' | 'v';
export const vkey = (flag: Flag, wear: number | 'x') => `${flag}${wear}`;
export function marketName(s: Skin, flag: Flag, wear: number | 'x') {
  let base = s.name;
  let star = '';
  if (base.startsWith('★ ')) { star = '★ '; base = base.slice(2); }
  const prefix = flag === 's' ? 'StatTrak™ ' : flag === 'v' ? 'Souvenir ' : '';
  const w = wear === 'x' ? '' : ` (${WEARS[wear].en})`;
  return `${star}${prefix}${base}${w}`;
}
export const steamUrl = (name: string) => `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}`;
export const skinportUrl = (name: string) => `https://skinport.com/market?search=${encodeURIComponent(name)}&cat=&sort=price&order=asc`;

/** price of a skin variant; handles vanilla knives ('x') */
export function skinPrice(prices: Prices | null, s: Skin, flag: Flag, wear: number, source: Source, phase?: string): number | null {
  if (!prices) return null;
  const vk = s.vanilla ? vkey(flag, 'x') : vkey(flag, wear);
  if (phase) {
    // Steam mixes all phases under one name, so a phase-specific price (Skinport) wins when known
    const p = prices.ph?.[s.id]?.[phase]?.[vk];
    if (p && (p[0] ?? p[2]) != null) return (p[0] ?? p[2]) as number;
  }
  return pick(prices.s[s.id]?.[vk], source);
}
/** price range of a skin across wears (normal quality unless flag) */
export function priceRange(prices: Prices | null, s: Skin, source: Source, flag: Flag = ''): [number, number] | null {
  if (!prices) return null;
  const rows = prices.s[s.id];
  if (!rows) return null;
  let lo = Infinity, hi = -Infinity;
  const wears: (number | 'x')[] = s.vanilla ? ['x'] : s.wears;
  for (const w of wears) {
    const p = pick(rows[vkey(flag, w)], source);
    if (p == null) continue;
    lo = Math.min(lo, p);
    hi = Math.max(hi, p);
  }
  return lo === Infinity ? null : [lo, hi];
}
