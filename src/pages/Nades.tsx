import { useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '../components/ui';
import { copy, useAsync } from '../lib/hooks';
import { href, setQuery, useRoute } from '../lib/router';

type MapInfo = { id: string; name: string; pos_x: number; pos_y: number; scale: number; radar: string; active?: boolean; lower?: any };
/** library of lineups built by tools/demos/build_lineups.py from every parsed pro demo */
type Lineup = {
  id: string; type: string; side: 'T' | 'CT'; n: number; np: number;
  from: [number, number, number]; ang: [number, number]; land: [number, number, number];
  move: string; moves: Record<string, number>; time: number; traj: [number, number][];
  ex: [number, number, number][]; // [player, match, round]
};
type MapFile = { v: 2; map: string; updated: string; demos: number; throws: number; players: [string, string][]; matches: [string, string, string, string][]; lineups: Lineup[] };
type IndexFile = { updated: string; maps: { map: string; demos: number; throws: number; lineups: number }[] };

const BASE = import.meta.env.BASE_URL + 'data/nades/';
const TYPES: Record<string, { ru: string; color: string }> = {
  smoke: { ru: 'Дым', color: '#c9d1d9' },
  flash: { ru: 'Флешка', color: '#ffe066' },
  molotov: { ru: 'Молотов', color: '#ff7b3a' },
  he: { ru: 'Граната', color: '#ff4d6d' },
  decoy: { ru: 'Ложная', color: '#9aa5b1' },
};
const MOVES: Record<string, string> = { stand: 'Стоя', crouch: 'Присев', jump: 'Прыжок (jumpthrow)', run: 'На бегу', walk: 'Шагом', runjump: 'Разбег + прыжок' };

async function getJSON<T>(f: string): Promise<T> {
  const r = await fetch(BASE + f);
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function Nades({ map }: { map?: string }) {
  const maps = useAsync(() => getJSON<MapInfo[] | { maps: MapInfo[] }>('maps.json').then((j) => (Array.isArray(j) ? j : j.maps)), []);
  const index = useAsync(() => getJSON<IndexFile>('index.json').catch(() => null), []);
  if (maps.loading) return <Spinner />;
  const list = maps.data || [];
  const m = map ? list.find((x) => x.id === map) : null;
  if (map && m) return <MapView m={m} maps={list} />;
  const stat = (id: string) => index.data?.maps.find((x) => x.map === id);
  const total = index.data?.maps.reduce((a, x) => ({ demos: a.demos + x.demos, throws: a.throws + x.throws, lineups: a.lineups + x.lineups }), { demos: 0, throws: 0, lineups: 0 });
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1>Раскидки профи</h1>
        <p className="muted">Все гранаты из про-матчей HLTV, сгруппированные в раскидки: откуда кидали, куда упало, кто из профи так кидает и как часто. Для каждой — команда <span className="kbd">setpos</span>/<span className="kbd">setang</span>, чтобы встать в ту же точку на своём сервере.</p>
        {total && total.throws > 0 && <p className="small muted"><b className="num">{total.lineups.toLocaleString('ru-RU')}</b> раскидок из <b className="num">{total.throws.toLocaleString('ru-RU')}</b> бросков в <b className="num">{total.demos}</b> картах про-матчей · обновлено {new Date(index.data!.updated).toLocaleDateString('ru-RU')}</p>}
      </div>
      <div className="feature-grid">
        {[...list].sort((a, b) => Number(!!b.active) - Number(!!a.active)).map((x) => {
          const s = stat(x.id);
          return (
            <a key={x.id} className="feature" href={href(`/nades/${x.id}`)} style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ aspectRatio: '16 / 9', background: '#0b0d10', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
                <img src={x.radar} alt={x.name} loading="lazy" style={{ width: '70%', opacity: 0.9 }} />
              </div>
              <div style={{ padding: '12px 16px' }} className="stack" >
                <div className="row between"><h3>{x.name}</h3>{x.active ? <span className="badge gold">Active Duty</span> : <span className="badge">Резерв</span>}</div>
                <span className="tiny muted">{s ? `${s.lineups.toLocaleString('ru-RU')} раскидок · ${s.demos} матчей` : 'пока нет данных'}</span>
              </div>
            </a>
          );
        })}
      </div>
      <div className="card pad stack small">
        <h3>Откуда данные</h3>
        <p className="muted">Каждая турнирная демка разбирается целиком: игрок, команда, сторона, раунд, позиция и углы в момент броска, скорость (прыжок/бег), траектория и точка взрыва. Одинаковые броски (та же точка, то же место падения) объединяются в раскидку; разовые ситуативные броски в библиотеку не попадают.</p>
        <p className="muted">Демки: открытый датасет <a className="link" href="https://huggingface.co/datasets/blanchon/opencs2_dataset_demo" target="_blank" rel="noreferrer">OpenCS2</a> (CC BY 4.0, зеркало демок HLTV) и тестовые про-демки <a className="link" href="https://github.com/pnxenopoulos/awpy-fixtures" target="_blank" rel="noreferrer">awpy-fixtures</a>. Разбор — demoparser2 (MIT).</p>
      </div>
    </div>
  );
}

function project(m: MapInfo, x: number, y: number) {
  return { px: (x - m.pos_x) / m.scale, py: (m.pos_y - y) / m.scale };
}

function MapView({ m, maps }: { m: MapInfo; maps: MapInfo[] }) {
  const { query } = useRoute();
  const data = useAsync(() => getJSON<MapFile>(`${m.id}.json`).then((d) => (d.lineups ? d : null)).catch(() => null), [m.id]);
  const type = query.get('type') || '';
  const side = query.get('side') || '';
  const player = query.get('player') || '';
  const event = query.get('event') || '';
  const min = +(query.get('min') || 3);
  const sel = query.get('id') || '';
  const [anim, setAnim] = useState(0);
  const d = data.data;

  const playerIdx = useMemo(() => (d && player ? d.players.findIndex((p) => p[0] === player) : -1), [d, player]);
  const players = useMemo(() => {
    if (!d) return [];
    const c = new Map<number, number>();
    for (const l of d.lineups) for (const p of new Set(l.ex.map((e) => e[0]))) c.set(p, (c.get(p) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([i, n]) => ({ name: d.players[i][0], team: d.players[i][1], n }));
  }, [d]);
  const events = useMemo(() => (d ? [...new Set(d.matches.map((x) => x[1]).filter(Boolean))].sort() : []), [d]);
  const list = useMemo(() => {
    if (!d) return [];
    return d.lineups.filter((l) => {
      if (type && l.type !== type) return false;
      if (side && l.side !== side) return false;
      if (playerIdx >= 0 && !l.ex.some((e) => e[0] === playerIdx)) return false;
      if (event && !l.ex.some((e) => d.matches[e[1]][1] === event)) return false;
      if (playerIdx < 0 && l.n < min) return false;
      return true;
    });
  }, [d, type, side, playerIdx, event, min]);
  const selected = d?.lineups.find((l) => l.id === sel) || null;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row between">
        <div className="stack" style={{ gap: 4 }}>
          <div className="small muted"><a className="link" href="#/nades">Раскидки</a> / {m.name}</div>
          <h1>{m.name}</h1>
          {d && <span className="small muted">{d.lineups.length.toLocaleString('ru-RU')} раскидок · {d.throws.toLocaleString('ru-RU')} бросков · {d.demos} карт про-матчей</span>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          {maps.filter((x) => x.active).map((x) => <a key={x.id} className={'chip' + (x.id === m.id ? ' on' : '')} href={href(`/nades/${x.id}`)}>{x.name}</a>)}
        </div>
      </div>
      <div className="card pad row" style={{ gap: 10 }}>
        <div className="seg">
          <button className={!type ? 'on' : ''} onClick={() => setQuery({ type: null, id: null })}>Все</button>
          {['smoke', 'flash', 'molotov', 'he'].map((k) => <button key={k} className={type === k ? 'on' : ''} onClick={() => setQuery({ type: k, id: null })}>{TYPES[k].ru}</button>)}
        </div>
        <div className="seg">
          <button className={!side ? 'on' : ''} onClick={() => setQuery({ side: null })}>T и CT</button>
          <button className={side === 'T' ? 'on' : ''} onClick={() => setQuery({ side: 'T' })}>T</button>
          <button className={side === 'CT' ? 'on' : ''} onClick={() => setQuery({ side: 'CT' })}>CT</button>
        </div>
        <select className="select small" value={player} onChange={(e) => setQuery({ player: e.target.value, id: null })}>
          <option value="">Все игроки</option>
          {players.map((p) => <option key={p.name + p.team} value={p.name}>{p.name}{p.team ? ` (${p.team})` : ''} · {p.n}</option>)}
        </select>
        {events.length > 1 && (
          <select className="select small" value={event} onChange={(e) => setQuery({ event: e.target.value, id: null })}>
            <option value="">Все турниры</option>
            {events.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        )}
        {!player && (
          <label className="row small muted" style={{ gap: 6 }}>от
            <select className="select small" value={min} onChange={(e) => setQuery({ min: e.target.value })}>
              {[2, 3, 5, 10, 20].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>бросков
          </label>
        )}
        <span className="small muted">{list.length} раскидок</span>
      </div>

      {data.loading ? <Spinner /> : !d ? (
        <div className="notice">Для {m.name} раскидок пока нет — они появятся, когда в базу попадут про-демки на этой карте.</div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(300px, 1fr)', alignItems: 'start' }}>
          <Radar m={m} list={list} selected={selected} anim={anim} onPick={(id) => setQuery({ id })} />
          <div className="stack">
            {selected && <LineupCard l={selected} d={d} onReplay={() => setAnim((a) => a + 1)} onClose={() => setQuery({ id: null })} highlight={playerIdx} />}
            <div className="card">
              <div className="card-head"><h3>{player ? `Раскидки ${player}` : 'Популярные раскидки'}</h3><span className="small muted">нажмите, чтобы открыть</span></div>
              <div className="stack" style={{ gap: 0, maxHeight: selected ? 360 : 680, overflow: 'auto' }}>
                {list.slice(0, 200).map((l) => {
                  const who = [...new Set(l.ex.map((e) => d.players[e[0]][0]))];
                  return (
                    <button key={l.id} onClick={() => setQuery({ id: l.id })} className="row between" style={{ padding: '9px 16px', background: l.id === sel ? 'var(--surface-2)' : 'transparent', border: 0, borderBottom: '1px solid var(--border)', cursor: 'pointer', width: '100%', textAlign: 'left', flexWrap: 'nowrap' }}>
                      <span className="row" style={{ gap: 8, flexWrap: 'nowrap', minWidth: 0 }}>
                        <span className="rar-dot" style={{ background: TYPES[l.type]?.color }} />
                        <span style={{ minWidth: 0 }}>
                          <span style={{ fontWeight: 600 }}>{TYPES[l.type]?.ru} · {l.side}</span>
                          <span className="tiny muted" style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 260 }}>{who.slice(0, 4).join(', ')}{who.length > 4 ? ` и ещё ${who.length - 4}` : ''}</span>
                        </span>
                      </span>
                      <span className="small muted nowrap">{l.n} × · {MOVES[l.move]?.split(' ')[0] || l.move}</span>
                    </button>
                  );
                })}
                {!list.length && <div className="empty small">Нет раскидок под эти фильтры</div>}
              </div>
            </div>
          </div>
        </div>
      )}
      <style>{`@media (max-width: 1000px){ .grid[style*="1.25fr"]{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

function Radar({ m, list, selected, anim, onPick }: { m: MapInfo; list: Lineup[]; selected: Lineup | null; anim: number; onPick: (id: string) => void }) {
  const path = useRef<SVGPolylineElement>(null);
  const pts = selected ? (selected.traj?.length > 1 ? selected.traj.map(([x, y]) => project(m, x, y)) : [project(m, selected.from[0], selected.from[1]), project(m, selected.land[0], selected.land[1])]) : [];
  useEffect(() => {
    const el = path.current;
    if (!el) return;
    const len = el.getTotalLength?.() || 0;
    el.style.transition = 'none';
    el.style.strokeDasharray = `${len}`;
    el.style.strokeDashoffset = `${len}`;
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = 'stroke-dashoffset 1.6s ease-out'; el.style.strokeDashoffset = '0'; }));
  }, [selected?.id, anim]);
  const max = Math.max(1, ...list.map((l) => l.n));
  const shown = list.slice(0, 600);
  return (
    <div className="card" style={{ overflow: 'hidden', background: '#0b0d10' }}>
      <svg viewBox="0 0 1024 1024" style={{ width: '100%', display: 'block' }}>
        <image href={m.radar} x="0" y="0" width="1024" height="1024" />
        {shown.map((l) => {
          const p = project(m, l.land[0], l.land[1]);
          const r = 5 + 11 * Math.sqrt(l.n / max);
          const on = l.id === selected?.id;
          return (
            <circle key={l.id} cx={p.px} cy={p.py} r={on ? r + 3 : r} fill={TYPES[l.type]?.color} fillOpacity={on ? 0.95 : 0.5} stroke={on ? '#fff' : '#000'} strokeWidth={on ? 3 : 1.2} style={{ cursor: 'pointer' }} onClick={() => onPick(l.id)}>
              <title>{TYPES[l.type]?.ru} · {l.side} · {l.n} бросков</title>
            </circle>
          );
        })}
        {selected && pts.length > 1 && (
          <>
            <polyline ref={path} points={pts.map((p) => `${p.px},${p.py}`).join(' ')} fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 3px rgba(0,0,0,.8))' }} />
            {(() => {
              const f = project(m, selected.from[0], selected.from[1]);
              const a = (-selected.ang[1] * Math.PI) / 180;
              return (
                <>
                  <circle cx={f.px} cy={f.py} r="9" fill="#3ccf7a" stroke="#000" strokeWidth="2" />
                  <line x1={f.px} y1={f.py} x2={f.px + Math.cos(a) * 30} y2={f.py + Math.sin(a) * 30} stroke="#3ccf7a" strokeWidth="3" />
                </>
              );
            })()}
          </>
        )}
      </svg>
    </div>
  );
}

function LineupCard({ l, d, onReplay, onClose, highlight }: { l: Lineup; d: MapFile; onReplay: () => void; onClose: () => void; highlight: number }) {
  const setpos = `setpos ${l.from[0]} ${l.from[1]} ${l.from[2]}; setang ${l.ang[0]} ${l.ang[1]} 0`;
  const moves = Object.entries(l.moves).sort((a, b) => b[1] - a[1]);
  const byPlayer = new Map<number, { n: number; last: [number, number, number] }>();
  for (const e of l.ex) {
    const x = byPlayer.get(e[0]);
    if (x) x.n++;
    else byPlayer.set(e[0], { n: 1, last: e });
  }
  const rows = [...byPlayer.entries()].sort((a, b) => (b[0] === highlight ? 1 : 0) - (a[0] === highlight ? 1 : 0) || b[1].n - a[1].n);
  return (
    <div className="card pad stack" style={{ gap: 10 }}>
      <div className="row between">
        <div className="row" style={{ gap: 8 }}>
          <span className="rar-dot" style={{ background: TYPES[l.type]?.color, width: 12, height: 12 }} />
          <h3>{TYPES[l.type]?.ru} за {l.side === 'T' ? 'атаку (T)' : 'защиту (CT)'}</h3>
        </div>
        <button className="btn small ghost" onClick={onClose}>×</button>
      </div>
      <dl className="dl">
        <dt>Популярность</dt><dd><b>{l.n}</b> бросков · {l.np} {l.np === 1 ? 'игрок' : 'игроков'}</dd>
        <dt>Техника</dt><dd>{moves.map(([k, v], i) => <span key={k}>{i ? ', ' : ''}{MOVES[k] || k}{moves.length > 1 ? ` ${Math.round((v / l.n) * 100)}%` : ''}</span>)}</dd>
        <dt>Обычно</dt><dd>на {fmtTime(l.time)} от начала раунда</dd>
      </dl>
      <div className="code">{setpos}</div>
      <div className="row">
        <button className="btn small primary" onClick={() => copy(setpos, 'Скопировано — вставьте в консоль на сервере с sv_cheats 1')}>Копировать setpos</button>
        <button className="btn small" onClick={onReplay}>▶ Полёт</button>
        <a className="btn small ghost" href="#/tools?t=practice">Конфиг тренировки</a>
      </div>
      <div className="stack" style={{ gap: 0 }}>
        <div className="tiny muted" style={{ padding: '6px 0' }}>Кто так кидает</div>
        {rows.slice(0, 20).map(([pi, x]) => {
          const [name, team] = d.players[pi];
          const [match, event, date, url] = d.matches[x.last[1]];
          return (
            <div key={pi} className="row between small" style={{ padding: '6px 0', borderTop: '1px solid var(--border)', flexWrap: 'nowrap', background: pi === highlight ? 'var(--accent-soft)' : undefined }}>
              <span><b>{name}</b> <span className="muted">{team}</span>{x.n > 1 ? <span className="faint"> · {x.n}×</span> : null}</span>
              <span className="tiny muted" style={{ textAlign: 'right' }}>
                {url ? <a className="link" href={url} target="_blank" rel="noreferrer">{match}</a> : match}
                <span className="faint"> · {event}{date ? ` · ${new Date(date).toLocaleDateString('ru-RU')}` : ''} · р. {x.last[2]}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
