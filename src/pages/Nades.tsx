import { useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '../components/ui';
import { copy, useAsync } from '../lib/hooks';
import { href, setQuery, useRoute } from '../lib/router';

type MapInfo = { id: string; name: string; pos_x: number; pos_y: number; scale: number; radar: string; active?: boolean; lower?: any };
type P3 = { x: number; y: number; z: number };
type Throw = {
  id: string; player: string; steamid: string; team: string; side: 'T' | 'CT'; type: 'smoke' | 'flash' | 'he' | 'molotov' | 'decoy';
  round: number; tick: number; time: number; throw: P3 & { pitch: number; yaw: number }; land: P3; traj?: number[][];
  move: string; speed?: number; event: string; match: string; date: string; demo?: string; url?: string | null; vod?: string | null;
};
type MapFile = { map: string; updated?: string; throws: Throw[] };

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

export default function Nades({ map }: { map?: string }) {
  const maps = useAsync(() => getJSON<MapInfo[] | { maps: MapInfo[] }>('maps.json').then((j) => (Array.isArray(j) ? j : j.maps)), []);
  if (maps.loading) return <Spinner />;
  const list = maps.data || [];
  const m = map ? list.find((x) => x.id === map) : null;
  if (map && m) return <MapView m={m} maps={list} />;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1>Раскидки профи</h1>
        <p className="muted">Гранаты игроков из турнирных демок: где стоял, куда целился, как бросал и куда упало. Для каждой — команда <span className="kbd">setpos</span>/<span className="kbd">setang</span>, чтобы повторить на своём сервере.</p>
      </div>
      {!list.length && <div className="notice">Карты ещё не загружены.</div>}
      <div className="feature-grid">
        {[...list].sort((a, b) => Number(!!b.active) - Number(!!a.active)).map((x) => (
          <a key={x.id} className="feature" href={href(`/nades/${x.id}`)} style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ aspectRatio: '16 / 9', background: '#0b0d10', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
              <img src={x.radar} alt={x.name} loading="lazy" style={{ width: '70%', opacity: 0.9 }} />
            </div>
            <div style={{ padding: '12px 16px' }} className="row between">
              <h3>{x.name}</h3>
              {x.active ? <span className="badge gold">Active Duty</span> : <span className="badge">Резерв</span>}
            </div>
          </a>
        ))}
      </div>
      <div className="card pad stack small">
        <h3>Откуда данные</h3>
        <p className="muted">Скрипт <span className="kbd">tools/demos/extract_nades.py</span> разбирает .dem турнирных матчей (demoparser2) и сохраняет каждый бросок: игрок, команда, сторона, раунд, позиция и углы в момент броска, скорость (прыжок/бег), траектория и точка взрыва. Видео трансляций сайт не хранит — у броска есть ссылка на матч и на VOD с таймкодом, если её указали при загрузке демки.</p>
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
  const data = useAsync(() => getJSON<MapFile>(`${m.id}.json`).catch(() => ({ map: m.id, throws: [] as Throw[] })), [m.id]);
  const type = query.get('type') || '';
  const side = query.get('side') || '';
  const player = query.get('player') || '';
  const event = query.get('event') || '';
  const sel = query.get('id') || '';
  const [anim, setAnim] = useState(0);

  const throws = data.data?.throws || [];
  const players = useMemo(() => {
    const c = new Map<string, { n: number; team: string }>();
    for (const t of throws) { const e = c.get(t.player) || { n: 0, team: t.team }; e.n++; c.set(t.player, e); }
    return [...c.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [throws]);
  const events = useMemo(() => [...new Set(throws.map((t) => t.event).filter(Boolean))].sort(), [throws]);
  const list = useMemo(() => throws.filter((t) => (!type || t.type === type) && (!side || t.side === side) && (!player || t.player === player) && (!event || t.event === event)), [throws, type, side, player, event]);
  const selected = throws.find((t) => t.id === sel) || null;

  // cluster landing spots so popular nades stand out
  const clusters = useMemo(() => {
    const cell = 48; // world units
    const map = new Map<string, { key: string; x: number; y: number; type: string; items: Throw[] }>();
    for (const t of list) {
      const key = `${t.type}:${Math.round(t.land.x / cell)}:${Math.round(t.land.y / cell)}`;
      const c = map.get(key) || { key, x: 0, y: 0, type: t.type, items: [] };
      c.items.push(t);
      c.x += t.land.x; c.y += t.land.y;
      map.set(key, c);
    }
    return [...map.values()].map((c) => ({ ...c, x: c.x / c.items.length, y: c.y / c.items.length })).sort((a, b) => b.items.length - a.items.length);
  }, [list]);
  const [cluster, setCluster] = useState<string | null>(null);
  useEffect(() => setCluster(null), [type, side, player, event]);
  const clusterItems = cluster ? clusters.find((c) => c.key === cluster)?.items || [] : [];

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row between">
        <div className="stack" style={{ gap: 4 }}>
          <div className="small muted"><a className="link" href="#/nades">Раскидки</a> / {m.name}</div>
          <h1>{m.name}</h1>
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
          {players.map(([p, v]) => <option key={p} value={p}>{p}{v.team ? ` (${v.team})` : ''} · {v.n}</option>)}
        </select>
        {events.length > 1 && (
          <select className="select small" value={event} onChange={(e) => setQuery({ event: e.target.value })}>
            <option value="">Все турниры</option>
            {events.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        )}
        <span className="small muted">{list.length} бросков</span>
      </div>

      {data.loading ? <Spinner /> : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.25fr) minmax(300px, 1fr)', alignItems: 'start' }}>
          <Radar m={m} clusters={clusters} selected={selected} anim={anim} cluster={cluster} onCluster={(k) => { setCluster(k); const c = clusters.find((x) => x.key === k); if (c?.items.length === 1) setQuery({ id: c.items[0].id }); }} />
          <div className="stack">
            {selected ? <ThrowCard t={selected} onReplay={() => setAnim((a) => a + 1)} /> : null}
            {cluster && clusterItems.length > 0 && (
              <div className="card">
                <div className="card-head"><h3>Здесь бросали: {clusterItems.length}</h3><button className="btn small ghost" onClick={() => setCluster(null)}>×</button></div>
                <div className="stack" style={{ maxHeight: 360, overflow: 'auto', gap: 0 }}>
                  {clusterItems.map((t) => (
                    <button key={t.id} className="row between" onClick={() => setQuery({ id: t.id })} style={{ padding: '8px 16px', background: t.id === sel ? 'var(--surface-2)' : 'transparent', border: 0, borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
                      <span><b>{t.player}</b> <span className="muted small">{t.team} · {t.side}</span></span>
                      <span className="small muted">{MOVES[t.move] || t.move} · {t.event}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!throws.length && (
              <div className="notice">
                Для {m.name} бросков пока нет. Они появятся после разбора турнирных демок — см. <a className="link" href="https://github.com/vsemvamdam/cs2-craft/tree/main/tools/demos" target="_blank" rel="noreferrer">tools/demos</a>.
              </div>
            )}
            {!selected && !cluster && throws.length > 0 && (
              <div className="card">
                <div className="card-head"><h3>Популярные точки</h3><span className="small muted">нажмите на точку на радаре</span></div>
                <div className="stack" style={{ gap: 0, maxHeight: 460, overflow: 'auto' }}>
                  {clusters.slice(0, 30).map((c) => (
                    <button key={c.key} className="row between" onClick={() => setCluster(c.key)} style={{ padding: '8px 16px', background: 'transparent', border: 0, borderBottom: '1px solid var(--border)', cursor: 'pointer', width: '100%', textAlign: 'left' }}>
                      <span className="row" style={{ gap: 8 }}><span className="rar-dot" style={{ background: TYPES[c.type]?.color }} />{TYPES[c.type]?.ru}</span>
                      <span className="small muted">{c.items.length} · {[...new Set(c.items.map((i) => i.player))].slice(0, 3).join(', ')}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <style>{`@media (max-width: 1000px){ .grid[style*="1.25fr"]{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

function Radar({ m, clusters, selected, anim, cluster, onCluster }: { m: MapInfo; clusters: { key: string; x: number; y: number; type: string; items: Throw[] }[]; selected: Throw | null; anim: number; cluster: string | null; onCluster: (k: string) => void }) {
  const path = useRef<SVGPolylineElement>(null);
  const pts = selected?.traj?.length ? selected.traj.map(([x, y]) => project(m, x, y)) : selected ? [project(m, selected.throw.x, selected.throw.y), project(m, selected.land.x, selected.land.y)] : [];
  const pointsAttr = pts.map((p) => `${p.px},${p.py}`).join(' ');
  useEffect(() => {
    const el = path.current;
    if (!el) return;
    const len = el.getTotalLength?.() || 0;
    el.style.transition = 'none';
    el.style.strokeDasharray = `${len}`;
    el.style.strokeDashoffset = `${len}`;
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = 'stroke-dashoffset 1.6s ease-out'; el.style.strokeDashoffset = '0'; }));
  }, [selected?.id, anim]);
  const max = Math.max(1, ...clusters.map((c) => c.items.length));
  return (
    <div className="card" style={{ overflow: 'hidden', background: '#0b0d10' }}>
      <svg viewBox="0 0 1024 1024" style={{ width: '100%', display: 'block' }}>
        <image href={m.radar} x="0" y="0" width="1024" height="1024" />
        {clusters.map((c) => {
          const p = project(m, c.x, c.y);
          const r = 7 + 10 * Math.sqrt(c.items.length / max);
          const on = c.key === cluster || c.items.some((t) => t.id === selected?.id);
          return (
            <g key={c.key} style={{ cursor: 'pointer' }} onClick={() => onCluster(c.key)}>
              <circle cx={p.px} cy={p.py} r={r} fill={TYPES[c.type]?.color} fillOpacity={on ? 0.95 : 0.55} stroke={on ? '#fff' : '#000'} strokeWidth={on ? 3 : 1.5} />
              {c.items.length > 1 && <text x={p.px} y={p.py + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#111">{c.items.length}</text>}
            </g>
          );
        })}
        {selected && pts.length > 1 && (
          <>
            <polyline ref={path} points={pointsAttr} fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 3px rgba(0,0,0,.8))' }} />
            <circle cx={pts[0].px} cy={pts[0].py} r="9" fill="#3ccf7a" stroke="#000" strokeWidth="2" />
            <line x1={pts[0].px} y1={pts[0].py} x2={pts[0].px + Math.cos((-selected.throw.yaw * Math.PI) / 180) * 28} y2={pts[0].py + Math.sin((-selected.throw.yaw * Math.PI) / 180) * 28} stroke="#3ccf7a" strokeWidth="3" />
          </>
        )}
      </svg>
    </div>
  );
}

function ThrowCard({ t, onReplay }: { t: Throw; onReplay: () => void }) {
  const setpos = `setpos ${t.throw.x} ${t.throw.y} ${t.throw.z}; setang ${t.throw.pitch} ${t.throw.yaw} 0`;
  const mm = Math.floor(t.time / 60), ss = Math.floor(t.time % 60);
  return (
    <div className="card pad stack" style={{ gap: 10 }}>
      <div className="row between">
        <div className="row" style={{ gap: 8 }}>
          <span className="rar-dot" style={{ background: TYPES[t.type]?.color, width: 12, height: 12 }} />
          <h3>{TYPES[t.type]?.ru}: {t.player}</h3>
        </div>
        <span className={'badge ' + (t.side === 'T' ? 'st' : '')}>{t.side}</span>
      </div>
      <dl className="dl">
        <dt>Команда</dt><dd>{t.team || '—'}</dd>
        <dt>Турнир</dt><dd>{t.event || '—'}</dd>
        <dt>Матч</dt><dd>{t.url ? <a className="link" href={t.url} target="_blank" rel="noreferrer">{t.match}</a> : t.match}{t.date ? ` · ${new Date(t.date).toLocaleDateString('ru-RU')}` : ''}</dd>
        <dt>Раунд</dt><dd>{t.round}, {mm}:{String(ss).padStart(2, '0')} от начала</dd>
        <dt>Техника</dt><dd>{MOVES[t.move] || t.move}{t.speed != null ? <span className="muted"> · скорость {Math.round(t.speed)}</span> : null}</dd>
      </dl>
      <div className="code">{setpos}</div>
      <div className="row">
        <button className="btn small primary" onClick={() => copy(setpos, 'Команда скопирована — вставьте в консоль на сервере с sv_cheats 1')}>Копировать setpos</button>
        <button className="btn small" onClick={onReplay}>▶ Полёт</button>
        {t.vod && <a className="btn small" href={t.vod} target="_blank" rel="noreferrer">Смотреть VOD ↗</a>}
        <a className="btn small ghost" href="#/tools?t=practice">Конфиг тренировки</a>
      </div>
      {t.demo && <p className="tiny faint">Демка: {t.demo}, тик {t.tick}. В CS2: <span className="mono">playdemo {t.demo.replace(/\.dem$/, '')}</span>, затем <span className="mono">demo_gototick {Math.max(0, t.tick - 320)}</span>.</p>}
    </div>
  );
}
