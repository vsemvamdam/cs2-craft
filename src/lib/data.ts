// Data loading + indices for the static JSON files in /data.
export type Skin = {
  id: string;
  name: string; // "AK-47 | Redline", "★ Karambit | Fade", "★ Karambit"
  wpn: string;
  wid: number;
  fin: string;
  cat: 'rifle' | 'pistol' | 'smg' | 'heavy' | 'knife' | 'gloves' | 'equipment' | 'other';
  rar: number; // 1..7, 8 = knife/gloves
  gold: number;
  mn: number;
  mx: number;
  wears: number[];
  st: number;
  sv: number;
  col: string[];
  cr: string[];
  img: string;
  pi: number;
  team: string;
  vanilla?: number;
  legacy?: number;
  notes?: string[];
  phases?: { ph: string; id: string; img: string; pi: number }[];
};
export type Collection = { id: string; name: string; img: string; date: string; kind: 'case' | 'map' | 'other'; crates: string[]; skins: string[]; gold: string[] };
export type Crate = { id: string; name: string; type: 'case' | 'souvenir'; img: string; date: string; skins: string[]; rare: string[] };
export type DB = { v: number; generated: string; imgPrefix: string[]; skins: Skin[]; collections: Collection[]; crates: Crate[] };
export type Sticker = { id: string; d: number; n: string; img: string; r: number; t: string; e: string; tour?: string; m?: string; team?: string; pl?: string };
export type Charm = { id: string; d: number; n: string; img: string; r: number; m: string; col: string };
/** [steamLowest, steamListings, skinportMin, skinportMedian7d, skinportVolume7d, skinportMedian30d] in USD cents */
export type PriceRow = [number | null, number | null, number | null, number | null, number | null, number | null];
export type Prices = {
  updated: string | null;
  rates: Record<string, number>;
  s: Record<string, Record<string, PriceRow>>;
  ph: Record<string, Record<string, Record<string, [number | null, number, number | null, number]>>>;
  st: Record<string, PriceRow>;
  ch: Record<string, PriceRow>;
};
export type HistoryFile = Record<string, { cur?: string; p?: [number, number, number][]; s?: [number, number | null, number | null][] }>;

const BASE = import.meta.env.BASE_URL + 'data/';

const cache = new Map<string, Promise<any>>();
function getJSON<T>(file: string): Promise<T> {
  if (!cache.has(file)) {
    cache.set(
      file,
      fetch(BASE + file).then((r) => {
        if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
        return r.json();
      }),
    );
  }
  return cache.get(file)!;
}

export type Indexed = DB & {
  byId: Map<string, Skin>;
  colById: Map<string, Collection>;
  crateById: Map<string, Crate>;
  /** collection id -> rarity -> skins (weapons only) */
  colTiers: Map<string, Map<number, Skin[]>>;
  /** skin id (incl. Doppler phase ids) -> merged skin */
  alias: Map<string, Skin>;
  weapons: string[];
};

let dbPromise: Promise<Indexed> | null = null;
export function loadDB(): Promise<Indexed> {
  if (!dbPromise) {
    dbPromise = getJSON<DB>('db.json').then((db) => {
      setImgPrefix(db.imgPrefix);
      const byId = new Map(db.skins.map((s) => [s.id, s]));
      const alias = new Map(byId);
      for (const s of db.skins) for (const p of s.phases || []) alias.set(p.id, s);
      const colById = new Map(db.collections.map((c) => [c.id, c]));
      const crateById = new Map(db.crates.map((c) => [c.id, c]));
      const colTiers = new Map<string, Map<number, Skin[]>>();
      for (const c of db.collections) {
        const m = new Map<number, Skin[]>();
        for (const id of c.skins) {
          const s = alias.get(id);
          if (!s || s.gold) continue;
          if (!m.has(s.rar)) m.set(s.rar, []);
          if (!m.get(s.rar)!.includes(s)) m.get(s.rar)!.push(s);
        }
        colTiers.set(c.id, m);
      }
      const weapons = [...new Set(db.skins.map((s) => s.wpn))].sort();
      return { ...db, byId, alias, colById, crateById, colTiers, weapons };
    });
  }
  return dbPromise;
}

const EMPTY_PRICES: Prices = { updated: null, rates: { USD: 1 }, s: {}, ph: {}, st: {}, ch: {} };
export function loadPrices(): Promise<Prices> {
  return getJSON<Prices>('prices.json').catch(() => EMPTY_PRICES);
}
export function loadStickers(): Promise<Sticker[]> {
  return getJSON<{ imgPrefix: string[]; stickers: Sticker[] }>('stickers.json').then((j) => (setImgPrefix(j.imgPrefix), j.stickers));
}
export function loadCharms(): Promise<Charm[]> {
  return getJSON<{ imgPrefix: string[]; charms: Charm[] }>('charms.json').then((j) => (setImgPrefix(j.imgPrefix), j.charms));
}
export function loadHistory(id: string): Promise<HistoryFile | null> {
  return getJSON<HistoryFile>(`h/${id}.json`).catch(() => null);
}

let IMG: string[] = [];
function setImgPrefix(p: string[]) {
  if (p?.length) IMG = p;
}
/** expand compact "0:hash" image references; `size` asks the Steam CDN for a resized image */
export function imgUrl(ref: string, size?: number): string {
  if (!ref) return '';
  const i = ref.indexOf(':');
  if (i > 0 && i < 3 && /^\d+$/.test(ref.slice(0, i))) {
    const pre = IMG[+ref.slice(0, i)] || '';
    const url = pre + ref.slice(i + 1);
    if (size && +ref.slice(0, i) === 0) return `${url}/${size}fx${size}f`;
    return url;
  }
  return ref;
}

