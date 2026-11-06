// Pro players' profile helpers shared by the player and team pages.

export const LINK_META: Record<string, { ru: string; url: (v: string) => string; color: string }> = {
  faceit: { ru: 'FACEIT', url: (v) => `https://www.faceit.com/ru/players/${v}`, color: '#ff5500' },
  twitter: { ru: 'X (Twitter)', url: (v) => `https://x.com/${v.replace(/^@/, '')}`, color: '#8b98a5' },
  instagram: { ru: 'Instagram', url: (v) => `https://www.instagram.com/${v.replace(/^@/, '')}`, color: '#e1306c' },
  twitch: { ru: 'Twitch', url: (v) => `https://www.twitch.tv/${v}`, color: '#9146ff' },
  youtube: { ru: 'YouTube', url: (v) => `https://www.youtube.com/${v.replace(/^\/+/, '')}`, color: '#ff3d3d' },
  telegram: { ru: 'Telegram', url: (v) => `https://t.me/${v.replace(/^@/, '')}`, color: '#2aabee' },
  vk: { ru: 'ВКонтакте', url: (v) => `https://vk.com/${v}`, color: '#4c75a3' },
  tiktok: { ru: 'TikTok', url: (v) => `https://www.tiktok.com/@${v.replace(/^@/, '')}`, color: '#25f4ee' },
  kick: { ru: 'Kick', url: (v) => `https://kick.com/${v}`, color: '#53fc18' },
  facebook: { ru: 'Facebook', url: (v) => `https://www.facebook.com/${v}`, color: '#1877f2' },
  bilibili: { ru: 'Bilibili', url: (v) => `https://space.bilibili.com/${v}`, color: '#00a1d6' },
  weibo: { ru: 'Weibo', url: (v) => `https://weibo.com/${v}`, color: '#e6162d' },
  douyin: { ru: 'Douyin', url: (v) => `https://www.douyin.com/user/${v}`, color: '#fe2c55' },
  reddit: { ru: 'Reddit', url: (v) => `https://www.reddit.com/user/${v}`, color: '#ff4500' },
  esea: { ru: 'ESEA', url: (v) => `https://play.esea.net/users/${v}`, color: '#2ecc71' },
  gamersclub: { ru: 'Gamers Club', url: (v) => `https://gamersclub.com.br/player/${v}`, color: '#00c7ff' },
  '5ewin': { ru: '5E Arena', url: (v) => `https://arena.5eplay.com/data/player/${v}`, color: '#f5c518' },
};
export const linkUrl = (k: string, v: string) => (/^https?:\/\//.test(v) ? v : LINK_META[k]?.url(v) || '');
export const COUNTRY: Record<string, string> = {
  Albania: 'AL', Argentina: 'AR', Australia: 'AU', Azerbaijan: 'AZ', Belarus: 'BY', Belgium: 'BE', 'Bosnia and Herzegovina': 'BA', Brazil: 'BR',
  Bulgaria: 'BG', Canada: 'CA', Chile: 'CL', China: 'CN', Croatia: 'HR', 'Czech Republic': 'CZ', Czechia: 'CZ', Denmark: 'DK', Estonia: 'EE',
  Finland: 'FI', France: 'FR', Georgia: 'GE', Germany: 'DE', Guatemala: 'GT', 'Hong Kong': 'HK', Hungary: 'HU', Iceland: 'IS', India: 'IN',
  Indonesia: 'ID', Ireland: 'IE', Israel: 'IL', Italy: 'IT', Jordan: 'JO', Kazakhstan: 'KZ', Kosovo: 'XK', Latvia: 'LV', Lebanon: 'LB',
  Lithuania: 'LT', Luxembourg: 'LU', Malaysia: 'MY', Mexico: 'MX', Mongolia: 'MN', Montenegro: 'ME', 'New Zealand': 'NZ', 'North Macedonia': 'MK',
  Norway: 'NO', Pakistan: 'PK', Peru: 'PE', Philippines: 'PH', Poland: 'PL', Portugal: 'PT', Romania: 'RO', Russia: 'RU', Serbia: 'RS',
  Singapore: 'SG', Slovakia: 'SK', Slovenia: 'SI', 'South Africa': 'ZA', Spain: 'ES', Sweden: 'SE', Switzerland: 'CH', Taiwan: 'TW',
  Tajikistan: 'TJ', Thailand: 'TH', Turkey: 'TR', Ukraine: 'UA', 'United Arab Emirates': 'AE', 'United Kingdom': 'GB', 'United States': 'US',
  Uruguay: 'UY', Uzbekistan: 'UZ', Venezuela: 'VE', Vietnam: 'VN', Netherlands: 'NL', Austria: 'AT', Greece: 'GR', Japan: 'JP', 'South Korea': 'KR',
  Kyrgyzstan: 'KG', Armenia: 'AM', Moldova: 'MD', Colombia: 'CO', Ecuador: 'EC', Paraguay: 'PY', Bolivia: 'BO', Egypt: 'EG', Morocco: 'MA',
};
let regionNames: Intl.DisplayNames | null = null;
export function countryRu(c: string) {
  const code = COUNTRY[c];
  if (!code || code === 'XK') return c === 'Kosovo' ? 'Косово' : c;
  try { regionNames ||= new Intl.DisplayNames(['ru'], { type: 'region' }); return regionNames.of(code) || c; } catch { return c; }
}
export const ROLE_RU: Record<string, string> = { igl: 'капитан (IGL)', awp: 'снайпер (AWP)', entry: 'энтри', lurk: 'люркер', support: 'саппорт', rifle: 'райфлер', coach: 'тренер' };

/** country name as Liquipedia writes it → flag image (emoji flags don't render on Windows) */
// Liquipedia flag codes that are not ISO 3166 / flagcdn names
const FLAG_FIX: Record<string, string> = { uk: 'gb', en: 'gb-eng', sc: 'gb-sct', wa: 'gb-wls', nir: 'gb-nir', xk: 'xk' };
export function flagUrl(country?: string) {
  if (!country) return '';
  const low = country.toLowerCase();
  const code = FLAG_FIX[low] || (COUNTRY[country] || (/^[a-z]{2}$/i.test(country) ? country : '')).toLowerCase();
  return code ? `https://flagcdn.com/h20/${code}.png` : '';
}
/** «fr» / «uk» / «France» → country name in Russian */
export function countryFromFlag(flag?: string) {
  if (!flag) return '';
  const code = FLAG_FIX[flag.toLowerCase()]?.slice(0, 2).toUpperCase() || flag.toUpperCase();
  try { return new Intl.DisplayNames(['ru'], { type: 'region' }).of(code === 'UK' ? 'GB' : code) || flag; } catch { return flag; }
}
