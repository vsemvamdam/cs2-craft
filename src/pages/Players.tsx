import { useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '../components/ui';
import { copy, useAsync } from '../lib/hooks';
import { href, setQuery, useRoute } from '../lib/router';
import { decodeCode } from '../lib/crosshair';
import { paintCrosshair } from '../lib/crosshair-draw';
import { useTeamLogos } from '../lib/teams';
import '../styles/players.css';

let avatarsP: Promise<Record<string, string>> | null = null;
function useAvatars() {
  const [a, setA] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!avatarsP) avatarsP = fetch(import.meta.env.BASE_URL + 'data/players/avatars.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    avatarsP.then(setA);
  }, []);
  return a;
}
const HUE = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };
/** Steam avatar of the player (if the site has it) or initials */
function PlayerAvatar({ sid, name, size = 32, avatars }: { sid: string; name: string; size?: number; avatars: Record<string, string> }) {
  const [bad, setBad] = useState(false);
  const h = avatars[sid];
  if (h && !bad) return <img className="pl-ava" src={`https://avatars.steamstatic.com/${h}_${size > 64 ? 'full' : 'medium'}.jpg`} alt="" width={size} height={size} loading="lazy" onError={() => setBad(true)} />;
  return <span className="pl-ava pl-ini" style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${HUE(name)} 35% 32%)` }}>{name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?'}</span>;
}
function TeamLogo({ team, size = 22, logo }: { team: string; size?: number; logo: ReturnType<typeof useTeamLogos> }) {
  const src = team ? logo(team) : null;
  if (src) return <img className="pl-team-logo" src={src} alt="" width={size} height={size} loading="lazy" />;
  return <span className="pl-team-logo pl-ini" style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${HUE(team || '?')} 30% 30%)` }}>{(team || '?').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase()}</span>;
}

/** players/index.json and players/<steamid>.json, built from tournament demos by tools/demos/build_lineups.py */
type Index = { updated: string; cols: string[]; rows: (string | number)[][] };
type Row = { sid: string; name: string; team: string; maps: number; rounds: number; k: number; d: number; a: number; hs: number; adr: number; ud: number; fk: number; fd: number; fa: number; awp: number; xhair: string; last: string };
type Game = [string, string, string, string, string, string, number, number, number, number, number]; // date, map, match, event, url, team, k, d, a, adr, rounds
type Profile = { sid: string; name: string; names: string[]; team: string; teams: [string, number][]; xhair: string; xhairs: [string, string][]; maps: Record<string, number>; games: Game[] };

const BASE = import.meta.env.BASE_URL + 'data/players/';

// ---- official pages / channels (Liquipedia infobox, FACEIT API) — built by scripts/build-player-links.mjs ----
type PlayerInfo = { lp?: string; id?: string; name?: string; rn?: string; c?: string; b?: string; r?: string; st?: string; l: Record<string, string>; fl?: number; fe?: number };
let linksP: Promise<Record<string, PlayerInfo>> | null = null;
function useLinks() {
  const [v, setV] = useState<Record<string, PlayerInfo> | null>(null);
  useEffect(() => {
    linksP ||= fetch(BASE + 'links.json').then((r) => (r.ok ? r.json() : { p: {} })).then((j) => j.p || {}).catch(() => ({}));
    let live = true;
    linksP.then((x) => live && setV(x));
    return () => { live = false; };
  }, []);
  return v;
}
const LINK_META: Record<string, { ru: string; url: (v: string) => string; color: string }> = {
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
const linkUrl = (k: string, v: string) => (/^https?:\/\//.test(v) ? v : LINK_META[k]?.url(v) || '');
const COUNTRY: Record<string, string> = {
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
function countryRu(c: string) {
  const code = COUNTRY[c];
  if (!code || code === 'XK') return c === 'Kosovo' ? 'Косово' : c;
  try { regionNames ||= new Intl.DisplayNames(['ru'], { type: 'region' }); return regionNames.of(code) || c; } catch { return c; }
}
const ROLE_RU: Record<string, string> = { igl: 'капитан (IGL)', awp: 'снайпер (AWP)', entry: 'энтри', lurk: 'люркер', support: 'саппорт', rifle: 'райфлер', coach: 'тренер' };
function age(b: string) {
  const d = new Date(b + 'T00:00:00Z'), n = new Date();
  let a = n.getUTCFullYear() - d.getUTCFullYear();
  if (n.getUTCMonth() < d.getUTCMonth() || (n.getUTCMonth() === d.getUTCMonth() && n.getUTCDate() < d.getUTCDate())) a--;
  return a;
}
const yearsRu = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'год' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'года' : 'лет');

function PlayerLinks({ sid, info }: { sid: string; info: PlayerInfo | undefined }) {
  const keys = Object.keys(LINK_META).filter((k) => info?.l?.[k]);
  return (
    <div className="pl-links">
      {keys.map((k) => {
        const m = LINK_META[k];
        const extra = k === 'faceit' && info?.fl ? ` · ${info.fl} ур.${info.fe ? ` · ${info.fe} ELO` : ''}` : '';
        return (
          <a key={k} className="pl-link" href={linkUrl(k, info!.l[k])} target="_blank" rel="noreferrer" title={`${m.ru}: ${info!.l[k]}`}>
            <i style={{ background: m.color }} />{m.ru}{extra}
          </a>
        );
      })}
      <a className="pl-link" href={`https://steamcommunity.com/profiles/${sid}`} target="_blank" rel="noreferrer"><i style={{ background: '#66c0f4' }} />Steam</a>
      {info?.lp && <a className="pl-link" href={`https://liquipedia.net/counterstrike/${encodeURIComponent(info.lp.replace(/ /g, '_'))}`} target="_blank" rel="noreferrer"><i style={{ background: '#3d8ee6' }} />Liquipedia</a>}
    </div>
  );
}
const MAP_RU: Record<string, string> = { mirage: 'Mirage', inferno: 'Inferno', nuke: 'Nuke', ancient: 'Ancient', anubis: 'Anubis', dust2: 'Dust II', cache: 'Cache', overpass: 'Overpass', train: 'Train', vertigo: 'Vertigo' };
const f1 = (x: number) => x.toFixed(1);
const f2 = (x: number) => x.toFixed(2);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + '%' : '—');

function useIndex() {
  return useAsync(() => fetch(BASE + 'index.json').then((r) => (r.ok ? (r.json() as Promise<Index>) : null)).catch(() => null), []);
}
function toRows(ix: Index | null): Row[] {
  if (!ix) return [];
  return ix.rows.map((r) => Object.fromEntries(ix.cols.map((c, i) => [c, r[i]])) as unknown as Row);
}

type SortKey = 'name' | 'maps' | 'kd' | 'adr' | 'hs' | 'kpr' | 'open' | 'awp' | 'ud';
const SORTS: { k: SortKey; ru: string; v: (r: Row) => number | string; title?: string }[] = [
  { k: 'maps', ru: 'Карт', v: (r) => r.maps },
  { k: 'kd', ru: 'K/D', v: (r) => r.k / Math.max(r.d, 1) },
  { k: 'adr', ru: 'ADR', v: (r) => r.adr, title: 'Средний урон за раунд' },
  { k: 'kpr', ru: 'Убийств/раунд', v: (r) => r.k / Math.max(r.rounds, 1) },
  { k: 'hs', ru: 'HS', v: (r) => r.hs / Math.max(r.k, 1), title: 'Доля убийств в голову' },
  { k: 'open', ru: 'Первые', v: (r) => r.fk / Math.max(r.fk + r.fd, 1), title: 'Доля выигранных первых дуэлей раунда' },
  { k: 'awp', ru: 'AWP', v: (r) => r.awp / Math.max(r.k, 1), title: 'Доля убийств с AWP' },
  { k: 'ud', ru: 'Урон гранатами', v: (r) => r.ud / Math.max(r.rounds, 1), title: 'Урон HE и молотовами за раунд' },
];

export default function Players({ sid }: { sid?: string }) {
  if (sid) return <PlayerPage sid={sid} key={sid} />;
  return <PlayerList />;
}

function PlayerList() {
  const ix = useIndex();
  const { query } = useRoute();
  const q = query.get('q') || '';
  const team = query.get('team') || '';
  const min = +(query.get('min') || 3);
  const sort = (query.get('sort') || 'maps') as SortKey;
  const tab = query.get('tab') || 'players';
  const rows = useMemo(() => toRows(ix.data), [ix.data]);
  const avatars = useAvatars();
  const logo = useTeamLogos();
  const teams = useMemo(() => {
    const c = new Map<string, Row[]>();
    for (const r of rows) if (r.team) c.set(r.team, [...(c.get(r.team) || []), r]);
    return [...c.entries()].map(([t, ps]) => ({ team: t, players: ps.sort((a, b) => b.maps - a.maps), maps: Math.max(...ps.map((p) => p.maps)) })).sort((a, b) => b.maps - a.maps);
  }, [rows]);
  const list = useMemo(() => {
    const nq = q.trim().toLowerCase();
    const s = SORTS.find((x) => x.k === sort) || SORTS[0];
    return rows
      .filter((r) => (!nq || r.name.toLowerCase().includes(nq) || r.team.toLowerCase().includes(nq)) && (!team || r.team === team) && r.maps >= (nq ? 1 : min))
      .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : (s.v(b) as number) - (s.v(a) as number)));
  }, [rows, q, team, min, sort]);
  if (ix.loading) return <Spinner />;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1>Профессиональные игроки</h1>
        <p className="muted">Статистика, прицелы и раскидки профи — посчитаны напрямую из турнирных демок: каждое убийство, урон и граната. Прицел — тот, с которым игрок играл в матче.</p>
        {ix.data && <p className="small muted">{rows.length.toLocaleString('ru-RU')} игроков · обновлено {new Date(ix.data.updated).toLocaleDateString('ru-RU')}</p>}
      </div>
      {!ix.data ? (
        <div className="notice">Профили игроков появятся после разбора про-демок — архив сейчас обрабатывается, загляните чуть позже.</div>
      ) : (
        <>
          <div className="card pad row" style={{ gap: 10 }}>
            <div className="tabs" style={{ borderBottom: 0 }}>
              <button className={tab === 'players' ? 'on' : ''} style={tab === 'players' ? { color: 'var(--text)', borderBottomColor: 'var(--accent)' } : undefined} onClick={() => setQuery({ tab: null })}>Игроки</button>
              <button className={tab === 'teams' ? 'on' : ''} style={tab === 'teams' ? { color: 'var(--text)', borderBottomColor: 'var(--accent)' } : undefined} onClick={() => setQuery({ tab: 'teams' })}>Команды</button>
            </div>
            <input className="input small" placeholder="Поиск: ник или команда" value={q} onChange={(e) => setQuery({ q: e.target.value })} style={{ width: 220 }} />
            {tab === 'players' && (
              <>
                <select className="select small" value={team} onChange={(e) => setQuery({ team: e.target.value })}>
                  <option value="">Все команды</option>
                  {teams.map((t) => <option key={t.team} value={t.team}>{t.team}</option>)}
                </select>
                <label className="row small muted" style={{ gap: 6 }}>от
                  <select className="select small" value={min} onChange={(e) => setQuery({ min: e.target.value })}>
                    {[1, 3, 5, 10, 20].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>карт
                </label>
                <span className="small muted">{list.length}</span>
              </>
            )}
          </div>
          {tab === 'teams' ? (
            <div className="feature-grid">
              {teams.filter((t) => !q || t.team.toLowerCase().includes(q.toLowerCase()) || t.players.some((p) => p.name.toLowerCase().includes(q.toLowerCase()))).map((t) => (
                <div key={t.team} className="card pad stack" style={{ gap: 8 }}>
                  <div className="row between" style={{ flexWrap: 'nowrap' }}>
                    <span className="row" style={{ gap: 10, flexWrap: 'nowrap', minWidth: 0 }}><TeamLogo team={t.team} size={34} logo={logo} /><h3 className="pl-ell">{t.team}</h3></span>
                    <span className="tiny muted nowrap">{t.maps} карт</span>
                  </div>
                  <div className="stack" style={{ gap: 2 }}>
                    {t.players.slice(0, 7).map((p) => (
                      <a key={p.sid} className="pl-trow small" href={href(`/player/${p.sid}`)}>
                        <PlayerAvatar sid={p.sid} name={p.name} size={24} avatars={avatars} />
                        <b className="pl-ell">{p.name}</b>
                        <span className="muted num nowrap">K/D {f2(p.k / Math.max(p.d, 1))} · ADR {f1(p.adr)}</span>
                      </a>
                    ))}
                  </div>
                  <a className="link small" href={href(`/players?team=${encodeURIComponent(t.team)}`)}>Статистика состава →</a>
                </div>
              ))}
            </div>
          ) : (
            <div className="card table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ cursor: 'pointer' }} onClick={() => setQuery({ sort: 'name' })}>Игрок{sort === 'name' ? ' ↓' : ''}</th>
                    <th>Команда</th>
                    {SORTS.map((s) => <th key={s.k} className="r" title={s.title} style={{ cursor: 'pointer', color: sort === s.k ? 'var(--text)' : undefined }} onClick={() => setQuery({ sort: s.k })}>{s.ru}{sort === s.k ? ' ↓' : ''}</th>)}
                    <th>Прицел</th>
                  </tr>
                </thead>
                <tbody>
                  {list.slice(0, 400).map((r) => (
                    <tr key={r.sid} className="click" onClick={() => { location.hash = `#/player/${r.sid}`; }}>
                      <td><span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}><PlayerAvatar sid={r.sid} name={r.name} size={32} avatars={avatars} /><b>{r.name}</b></span></td>
                      <td className="muted small"><span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>{r.team ? <TeamLogo team={r.team} size={22} logo={logo} /> : null}<span className="nowrap">{r.team}</span></span></td>
                      <td className="r num">{r.maps}</td>
                      <td className="r num">{f2(r.k / Math.max(r.d, 1))}</td>
                      <td className="r num">{f1(r.adr)}</td>
                      <td className="r num">{f2(r.k / Math.max(r.rounds, 1))}</td>
                      <td className="r num">{pct(r.hs, r.k)}</td>
                      <td className="r num" title={`${r.fk} побед / ${r.fd} поражений`}>{pct(r.fk, r.fk + r.fd)}</td>
                      <td className="r num">{pct(r.awp, r.k)}</td>
                      <td className="r num">{f1(r.ud / Math.max(r.rounds, 1))}</td>
                      <td>{r.xhair ? <XhairThumb code={r.xhair} size={36} /> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!list.length && <div className="empty small">Никого не нашли</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function XhairThumb({ code, size = 120, zoom = 1, bg = '#6b6f76' }: { code: string; size?: number; zoom?: number; bg?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const res = decodeCode(code, 1080);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const px = Math.round(size / zoom);
    c.width = px; c.height = px;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, px, px);
    if (res.ok) paintCrosshair(ctx, res.ch, 1080, Math.floor(px / 2), Math.floor(px / 2));
  }, [code, size, zoom, bg]);
  return <canvas ref={ref} style={{ width: size, height: size, imageRendering: 'pixelated', borderRadius: 6, display: 'block' }} />;
}

function PlayerPage({ sid }: { sid: string }) {
  const p = useAsync(() => fetch(BASE + sid + '.json').then((r) => (r.ok ? (r.json() as Promise<Profile>) : null)).catch(() => null), [sid]);
  const ix = useIndex();
  const row = useMemo(() => toRows(ix.data).find((r) => r.sid === sid) || null, [ix.data, sid]);
  const [allGames, setAllGames] = useState(false);
  const avatars = useAvatars();
  const logo = useTeamLogos();
  const links = useLinks();
  const info = links?.[sid];
  if (p.loading || ix.loading) return <Spinner />;
  const d = p.data;
  if (!d || !row) return <div className="notice">Игрок не найден. <a className="link" href="#/players">Все игроки</a></div>;
  const r = row;
  const kd = r.k / Math.max(r.d, 1);
  const stats: [string, string, string?][] = [
    ['Карт', String(r.maps)], ['Раундов', String(r.rounds)], ['K/D', f2(kd), `${r.k} / ${r.d}`], ['ADR', f1(r.adr), 'урон за раунд'],
    ['Убийств/раунд', f2(r.k / Math.max(r.rounds, 1))], ['HS', pct(r.hs, r.k), 'убийств в голову'],
    ['Первые дуэли', pct(r.fk, r.fk + r.fd), `${r.fk} выиграно / ${r.fd} проиграно`], ['С AWP', pct(r.awp, r.k), `${r.awp} убийств`],
    ['Ассисты флешкой', String(r.fa)], ['Урон гранатами', f1(r.ud / Math.max(r.rounds, 1)), 'за раунд'],
  ];
  const maps = Object.entries(d.maps).sort((a, b) => b[1] - a[1]);
  const games = allGames ? d.games : d.games.slice(0, 15);
  const xhDate = d.xhairs[0]?.[0];
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="small muted"><a className="link" href="#/players">Игроки</a> / {d.name}</div>
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <div className="stack" style={{ gap: 4 }}>
          <div className="row" style={{ gap: 14, flexWrap: 'nowrap' }}>
            <PlayerAvatar sid={d.sid} name={d.name} size={72} avatars={avatars} />
            <h1>{d.name}</h1>
          </div>
          <div className="muted row" style={{ gap: 8 }}>{d.team ? <TeamLogo team={d.team} size={22} logo={logo} /> : null}{d.team || 'Без команды'}{d.teams.length > 1 ? <span className="small"> · ранее: {d.teams.filter(([t]) => t !== d.team).map(([t]) => t).join(', ')}</span> : null}</div>
          {(info?.name || info?.c || info?.b || info?.r) && (
            <div className="small muted row" style={{ gap: 6 }}>
              {[
                info.rn ? `${info.rn}${info.name && info.name !== info.rn ? ` (${info.name})` : ''}` : info.name,
                info.c ? countryRu(info.c) : '',
                info.b ? `${age(info.b)} ${yearsRu(age(info.b))}` : '',
                info.r ? info.r.split(',').map((x) => ROLE_RU[x] || x).join(', ') : '',
              ].filter(Boolean).join(' · ')}
            </div>
          )}
          {d.names.length > 1 && <div className="tiny faint">другие ники в демках: {d.names.slice(1).join(', ')}</div>}
        </div>
      </div>
      <PlayerLinks sid={d.sid} info={info} />
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(280px, 1fr)', alignItems: 'start' }}>
        <div className="stack" style={{ gap: 16 }}>
          <div className="card pad">
            <div className="pl-stats">
              {stats.map(([k, v, t]) => <div key={k} className="pl-stat" title={t}><span className="tiny muted">{k}</span><b className="num">{v}</b>{t ? <span className="tiny faint">{t}</span> : null}</div>)}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h3>Матчи</h3><span className="small muted">{d.games.length}</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Дата</th><th>Карта</th><th>Матч</th><th className="r">K–D–A</th><th className="r">ADR</th><th /></tr></thead>
                <tbody>
                  {games.map((g, i) => (
                    <tr key={i}>
                      <td className="small muted nowrap">{g[0] ? new Date(g[0]).toLocaleDateString('ru-RU') : ''}</td>
                      <td className="small">{MAP_RU[g[1]] || g[1]}</td>
                      <td className="small">{g[2]}<div className="tiny faint">{g[3]}</div></td>
                      <td className="r num" style={{ color: g[6] > g[7] ? 'var(--good)' : g[6] < g[7] ? 'var(--bad)' : undefined }}>{g[6]}–{g[7]}–{g[8]}</td>
                      <td className="r num">{f1(g[9])}</td>
                      <td>{g[4] ? <a className="link small" href={g[4]} target="_blank" rel="noreferrer" title="Матч на HLTV">↗</a> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {d.games.length > 15 && !allGames && <div className="pad"><button className="btn small" onClick={() => setAllGames(true)}>Показать все {d.games.length}</button></div>}
          </div>
        </div>
        <div className="stack" style={{ gap: 16 }}>
          <div className="card pad stack" style={{ gap: 10 }}>
            <h3>Прицел</h3>
            {d.xhair ? (
              <>
                <div className="row" style={{ gap: 12, alignItems: 'center' }}>
                  <XhairThumb code={d.xhair} size={132} zoom={3} />
                  <div className="stack" style={{ gap: 6, minWidth: 0 }}>
                    <span className="tiny muted">из демки матча{xhDate ? ` ${new Date(xhDate).toLocaleDateString('ru-RU')}` : ''}; масштаб ×3</span>
                    <a className="btn small primary" href={href(`/crosshair?c=${encodeURIComponent(d.xhair)}`)}>Открыть в генераторе</a>
                  </div>
                </div>
                <div className="code small">{d.xhair}</div>
                <button className="btn small" onClick={() => copy(d.xhair, 'Код прицела скопирован')}>Копировать код</button>
                <p className="tiny muted">Код старого формата (матчи до обновления прицелов 30.09.2026). CS2 принимает его через импорт, генератор пересчитает его в новый формат.</p>
                {d.xhairs.length > 1 && new Set(d.xhairs.map((x) => x[1])).size > 1 && (
                  <details className="small"><summary className="link">Менял прицел ({new Set(d.xhairs.map((x) => x[1])).size} разных)</summary>
                    <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                      {[...new Map(d.xhairs.map((x) => [x[1], x[0]])).entries()].map(([code, date]) => (
                        <div key={code} className="row" style={{ gap: 8 }}><XhairThumb code={code} size={40} /><span className="tiny muted">{date ? new Date(date).toLocaleDateString('ru-RU') : ''}</span><a className="link tiny" href={href(`/crosshair?c=${encodeURIComponent(code)}`)}>открыть</a></div>
                      ))}
                    </div>
                  </details>
                )}
              </>
            ) : <p className="small muted">В демках прицел не найден.</p>}
          </div>
          <div className="card pad stack" style={{ gap: 8 }}>
            <h3>Раскидки {d.name}</h3>
            <p className="tiny muted">Гранаты игрока из этих матчей — с 3D-повтором каждого броска.</p>
            <div className="row" style={{ gap: 6 }}>
              {maps.map(([m, n]) => <a key={m} className="chip" href={href(`/nades/${m}?player=${encodeURIComponent(d.name)}`)}>{MAP_RU[m.replace('de_', '')] || m} · {n}</a>)}
            </div>
          </div>
        </div>
      </div>
      <p className="tiny muted">{info?.lp ? <>Имя, страна, роль и ссылки на соцсети — <a className="link" href="https://liquipedia.net/counterstrike/" target="_blank" rel="noreferrer">Liquipedia</a> (CC BY-SA 3.0){info.fl ? ', уровень FACEIT — FACEIT API' : ''}. </> : null}Статистика посчитана по турнирным демкам из открытого архива (OpenCS2, CC BY 4.0) — это не полная карьерная статистика, а только матчи, попавшие в базу.</p>
    </div>
  );
}
