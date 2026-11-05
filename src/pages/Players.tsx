import { useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '../components/ui';
import { copy, useAsync } from '../lib/hooks';
import { href, setQuery, useRoute } from '../lib/router';
import { decodeCode } from '../lib/crosshair';
import { paintCrosshair } from '../lib/crosshair-draw';

/** players/index.json and players/<steamid>.json, built from tournament demos by tools/demos/build_lineups.py */
type Index = { updated: string; cols: string[]; rows: (string | number)[][] };
type Row = { sid: string; name: string; team: string; maps: number; rounds: number; k: number; d: number; a: number; hs: number; adr: number; ud: number; fk: number; fd: number; fa: number; awp: number; xhair: string; last: string };
type Game = [string, string, string, string, string, string, number, number, number, number, number]; // date, map, match, event, url, team, k, d, a, adr, rounds
type Profile = { sid: string; name: string; names: string[]; team: string; teams: [string, number][]; xhair: string; xhairs: [string, string][]; maps: Record<string, number>; games: Game[] };

const BASE = import.meta.env.BASE_URL + 'data/players/';
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
                  <div className="row between"><h3>{t.team}</h3><span className="tiny muted">{t.maps} карт</span></div>
                  <div className="stack" style={{ gap: 4 }}>
                    {t.players.slice(0, 7).map((p) => (
                      <a key={p.sid} className="row between small" href={href(`/player/${p.sid}`)}>
                        <span><b>{p.name}</b></span>
                        <span className="muted num">K/D {f2(p.k / Math.max(p.d, 1))} · ADR {f1(p.adr)}</span>
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
                      <td><b>{r.name}</b></td>
                      <td className="muted small">{r.team}</td>
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
          <h1>{d.name}</h1>
          <div className="muted">{d.team || 'Без команды'}{d.teams.length > 1 ? <span className="small"> · ранее: {d.teams.filter(([t]) => t !== d.team).map(([t]) => t).join(', ')}</span> : null}</div>
          {d.names.length > 1 && <div className="tiny faint">другие ники в демках: {d.names.slice(1).join(', ')}</div>}
        </div>
        <a className="btn small ghost" href={`https://steamcommunity.com/profiles/${d.sid}`} target="_blank" rel="noreferrer">Профиль Steam ↗</a>
      </div>
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
      <p className="tiny muted">Статистика посчитана по турнирным демкам из открытого архива (OpenCS2, CC BY 4.0) — это не полная карьерная статистика, а только матчи, попавшие в базу.</p>
      <style>{`.pl-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}.pl-stat{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border-radius:10px;background:var(--surface-2)}.pl-stat b{font-size:22px}@media (max-width:900px){.grid[style*="1.4fr"]{grid-template-columns:1fr !important}}`}</style>
    </div>
  );
}
