import { useEffect, useState } from 'react';

/** callout names: official in-game place names (m_szLastPlaceName from demos) + Russian comms names */
export type CalloutLang = 'en' | 'ru';
export type PlaceName = { en: string; en_community?: string; ru: string; ru_game?: string; ru_alt?: string[]; note?: string; confidence?: string; id_status?: string };
export type ExtraCallout = { en: string; ru: string; ru_alt?: string[]; near: string; where?: string; confidence?: string };
export type NamesFile = Record<string, { places: Record<string, PlaceName>; extra?: ExtraCallout[]; sources?: string[] }>;
/** grid of player positions with the most common place name, built by tools/demos/build_lineups.py */
export type CalloutGrid = { map: string; updated: string; cell: number; demos: number; names: string[]; centers: Record<string, [number, number, number, number]>; cells: [number, number, number, number][] };

const BASE = import.meta.env.BASE_URL + 'data/callouts/';
let namesP: Promise<NamesFile> | null = null;
export function loadNames(): Promise<NamesFile> {
  if (!namesP) namesP = fetch(BASE + 'names.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return namesP;
}
const grids = new Map<string, Promise<CalloutGrid | null>>();
export function loadGrid(map: string): Promise<CalloutGrid | null> {
  let p = grids.get(map);
  if (!p) {
    p = fetch(BASE + map + '.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    grids.set(map, p);
  }
  return p;
}

const SPECIAL: Record<string, string> = {
  CTSpawn: 'CT Spawn', TSpawn: 'T Spawn', BombsiteA: 'A Site', BombsiteB: 'B Site', BombsiteC: 'C Site',
  TopofMid: 'Top of Mid', SnipersNest: "Sniper's Nest", TRamp: 'T Ramp', CTRamp: 'CT Ramp',
};
/** "TopofMid" → "Top of Mid", "PalaceAlley" → "Palace Alley" */
export function prettyPlace(id: string) {
  if (!id) return '';
  if (SPECIAL[id]) return SPECIAL[id];
  return id
    .replace(/([a-z])of([A-Z])/g, '$1 of $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim();
}

export function placeName(names: NamesFile | null, map: string, id: string, lang: CalloutLang) {
  if (!id) return '';
  const p = names?.[map]?.places?.[id];
  if (lang === 'ru') return p?.ru || p?.en_community || p?.en || prettyPlace(id);
  return p?.en_community || p?.en || prettyPlace(id);
}

const KEY = 'callout-lang';
export function useCalloutLang(): [CalloutLang, (l: CalloutLang) => void] {
  const [lang, setLang] = useState<CalloutLang>(() => {
    try { return (localStorage.getItem(KEY) as CalloutLang) || 'en'; } catch { return 'en'; }
  });
  useEffect(() => {
    const f = (e: Event) => setLang((e as CustomEvent).detail);
    window.addEventListener('callout-lang', f);
    return () => window.removeEventListener('callout-lang', f);
  }, []);
  return [lang, (l) => {
    try { localStorage.setItem(KEY, l); } catch { /* private mode */ }
    window.dispatchEvent(new CustomEvent('callout-lang', { detail: l }));
  }];
}

export function useNames() {
  const [n, setN] = useState<NamesFile | null>(null);
  useEffect(() => { loadNames().then(setN); }, []);
  return n;
}
