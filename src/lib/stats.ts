/** «Статистика»: client for the Cloudflare Worker (worker/src/index.ts) that queries the Steam Web API */
export type Profile = {
  steamid: string; name: string; avatar: string; url: string; country: string | null; created: number | null; public: boolean;
  state: number; lastlogoff: number | null; ingame: string | null;
  level: number | null; xp: number | null; xpNext: number | null; xpCur: number | null; badges: number | null;
  games: { count: number; playtime: number; played: number; top: GameRow[]; recent: GameRow[] } | null;
  cs2: { m: number; m2: number; last: number } | null;
  stats: Record<string, number> | null; achievements: number | null;
  bans: { vac: number; game: number; days: number; community: boolean; economy: boolean } | null;
  friends: number | null;
  ranks: { total: number; xp?: number | null; games?: number | null; playtime?: number | null; cs2?: number | null; badges?: number | null; age?: number | null };
  fetched: number;
};
export type GameRow = { a: number; n: string; m: number; m2: number; last?: number };
export type LadderRow = { steamid: string; name: string; avatar: string; country: string | null; level: number | null; xp: number | null; badges: number | null; games: number | null; playtime: number | null; cs2: number | null; cs2_2w: number | null; created: number | null; vac: number | null; updated: number };
export type Ladder = { by: string; total: number; offset: number; rows: LadderRow[]; countries: { country: string; n: number }[] };
export type Inventory = { steamid: string; private: boolean; total?: number; items: { n: string; c: number; i: string; t: number; m: number; col?: string; type?: string }[]; fetched?: number };

let baseP: Promise<string | null> | null = null;
/** the Worker URL is written to data/api.json by .github/workflows/worker.yml after a deploy */
export function apiBase(): Promise<string | null> {
  if (!baseP) {
    const env = import.meta.env.VITE_STATS_API as string | undefined;
    baseP = env ? Promise.resolve(env) : fetch(import.meta.env.BASE_URL + 'data/api.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null)).then((j) => (j?.stats as string) || null).catch(() => null);
  }
  return baseP;
}
export class ApiError extends Error {}
export async function api<T>(path: string): Promise<T> {
  const base = await apiBase();
  if (!base) throw new ApiError('not-configured');
  const r = await fetch(base.replace(/\/$/, '') + path);
  const j = await r.json().catch(() => ({ error: `Ошибка ${r.status}` }));
  if (!r.ok) throw new ApiError(j.error || `Ошибка ${r.status}`);
  return j as T;
}

/** link / SteamID / vanity typed by the user → path for the profile page */
export function profilePath(input: string) {
  const s = input.trim();
  const m = s.match(/(?:^|\D)(7656119\d{10})(?:\D|$)/);
  if (m) return `/stats/${m[1]}`;
  const v = s.match(/steamcommunity\.com\/id\/([^/?#]+)/i);
  return `/stats/${encodeURIComponent(v ? v[1] : s)}`;
}

export const hours = (min: number | null | undefined) => (min == null ? '—' : Math.round(min / 60).toLocaleString('ru-RU'));
export const hoursFmt = (min: number | null | undefined) => (min == null ? '—' : `${hours(min)} ч`);
export const num = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('ru-RU'));
export function years(created: number | null) {
  if (!created) return '—';
  const y = (Date.now() / 1000 - created) / (365.25 * 86400);
  return y >= 1 ? `${y.toFixed(1).replace('.', ',')} ${plural(Math.floor(y), 'год', 'года', 'лет')}` : `${Math.round(y * 12)} мес.`;
}
export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
/** Steam level badge colour (changes every 10 levels, repeats each 100) */
export function levelColor(level: number | null) {
  const c = ['#9b9b9b', '#c02942', '#d95b43', '#fecc23', '#467a3c', '#4e8ddb', '#7652c9', '#c252c9', '#542437', '#997c52'];
  return c[Math.floor(((level || 0) % 100) / 10)];
}
export const flag = (cc: string | null) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '');
export const gameImg = (appid: number) => `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/capsule_184x69.jpg`;
export const STATE = ['Не в сети', 'В сети', 'Занят', 'Отошёл', 'Спит', 'Ищет обмен', 'Хочет играть'];

/** lifetime CS stats keys (Steam: ISteamUserStats/GetUserStatsForGame, app 730) */
export const WEAPONS: [string, string][] = [
  ['ak47', 'AK-47'], ['m4a1', 'M4A4 / M4A1-S'], ['awp', 'AWP'], ['deagle', 'Desert Eagle'], ['hkp2000', 'P2000 / USP-S'], ['glock', 'Glock-18'],
  ['p250', 'P250'], ['fiveseven', 'Five-SeveN'], ['tec9', 'Tec-9'], ['elite', 'Dual Berettas'], ['aug', 'AUG'], ['sg556', 'SG 553'], ['famas', 'FAMAS'],
  ['galilar', 'Galil AR'], ['ssg08', 'SSG 08'], ['scar20', 'SCAR-20'], ['g3sg1', 'G3SG1'], ['mac10', 'MAC-10'], ['mp9', 'MP9'], ['mp7', 'MP7'],
  ['ump45', 'UMP-45'], ['p90', 'P90'], ['bizon', 'PP-Bizon'], ['nova', 'Nova'], ['xm1014', 'XM1014'], ['mag7', 'MAG-7'], ['sawedoff', 'Sawed-Off'],
  ['m249', 'M249'], ['negev', 'Negev'], ['taser', 'Zeus x27'],
];
export const MAPS: [string, string][] = [
  ['de_dust2', 'Dust II'], ['de_inferno', 'Inferno'], ['de_nuke', 'Nuke'], ['de_train', 'Train'], ['de_vertigo', 'Vertigo'], ['de_cbble', 'Cobblestone'],
  ['de_dust', 'Dust'], ['de_aztec', 'Aztec'], ['cs_office', 'Office'], ['cs_italy', 'Italy'], ['cs_assault', 'Assault'], ['de_lake', 'Lake'],
  ['de_safehouse', 'Safehouse'], ['de_shorttrain', 'Shorttrain'], ['de_sugarcane', 'Sugarcane'], ['de_stmarc', 'St. Marc'], ['de_bank', 'Bank'],
  ['ar_baggage', 'Baggage'], ['ar_shoots', 'Shoots'], ['ar_monastery', 'Monastery'], ['cs_militia', 'Militia'], ['de_house', 'House'],
];
export const WEAPON_BY_ID: Record<number, string> = {
  1: 'Desert Eagle', 2: 'Dual Berettas', 3: 'Five-SeveN', 4: 'Glock-18', 7: 'AK-47', 8: 'AUG', 9: 'AWP', 10: 'FAMAS', 11: 'G3SG1', 13: 'Galil AR', 14: 'M249',
  16: 'M4A4', 17: 'MAC-10', 19: 'P90', 23: 'MP5-SD', 24: 'UMP-45', 25: 'XM1014', 26: 'PP-Bizon', 27: 'MAG-7', 28: 'Negev', 29: 'Sawed-Off', 30: 'Tec-9',
  31: 'Zeus x27', 32: 'P2000', 33: 'MP7', 34: 'MP9', 35: 'Nova', 36: 'P250', 38: 'SCAR-20', 39: 'SG 553', 40: 'SSG 08', 60: 'M4A1-S', 61: 'USP-S', 63: 'CZ75-Auto', 64: 'R8 Revolver',
};
