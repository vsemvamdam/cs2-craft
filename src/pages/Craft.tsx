import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Price, Spinner, rarityColor } from '../components/ui';
import { norm, skinText } from '../components/Layout';
import { imgUrl, loadCharms, loadStickers, type Charm, type Indexed, type Prices, type Skin, type Sticker } from '../lib/data';
import { copy, toast, useAsync, useDB, useDebounced, useLocal, usePrices } from '../lib/hooks';
import { STICKER_EFFECTS, STICKER_RARITY, WEARS } from '../lib/labels';
import { genCommand, inspectLink, type InspectItem } from '../lib/inspect';
import { money, pick, skinPrice, usePrefs, type Flag } from '../lib/prefs';
import { href, useRoute } from '../lib/router';

type Placed = { uid: string; d: number; x: number; y: number; r: number; w: number; s: number };
type CharmP = { d: number; x: number; y: number; p: number } | null;
type State = { skin: string; flag: Flag; wear: number; seed: number; stickers: Placed[]; charm: CharmP };
type SavedCraft = { name: string; at: number; code: string };

const MAX = 5;
const DEFAULT_POS = [0.3, 0.42, 0.54, 0.66, 0.78];
const uid = () => Math.random().toString(36).slice(2, 9);

function encode(s: State) {
  const st = s.stickers.map((p) => [p.d, p.x.toFixed(3), p.y.toFixed(3), Math.round(p.r), p.w.toFixed(1), p.s.toFixed(2)].join(',')).join(';');
  const ch = s.charm ? [s.charm.d, s.charm.x.toFixed(3), s.charm.y.toFixed(3), s.charm.p].join(',') : '';
  return [s.skin.replace(/^skin-/, ''), s.flag || 'n', s.wear, s.seed].join('~') + '|' + st + '|' + ch;
}
function decode(code: string | null): State | null {
  if (!code) return null;
  try {
    const [head, st = '', ch = ''] = code.split('|');
    const [id, flag, wear, seed] = head.split('~');
    return {
      skin: 'skin-' + id,
      flag: (flag === 'n' ? '' : flag) as Flag,
      wear: +wear || 0,
      seed: +seed || 0,
      stickers: st ? st.split(';').slice(0, MAX).map((x) => { const [d, px, py, r, w, s] = x.split(',').map(Number); return { uid: uid(), d, x: px, y: py, r, w, s: s || 1 }; }) : [],
      charm: ch ? (() => { const [d, x, y, p] = ch.split(',').map(Number); return { d, x, y, p }; })() : null,
    };
  } catch {
    return null;
  }
}

/** SVG filters that eat holes into a sticker for scrape levels 1..9 */
function ScrapeFilters() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        {Array.from({ length: 10 }, (_, i) => i).map((i) => (
          <filter key={i} id={`scrape-${i}`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed={7} result="n" />
            <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 2.4 -0.7" result="a" />
            <feComponentTransfer in="a" result="m">
              <feFuncA type="discrete" tableValues={Array.from({ length: 20 }, (_, k) => (k / 20 < i / 10 ? 0 : 1)).join(' ')} />
            </feComponentTransfer>
            <feComposite in="SourceGraphic" in2="m" operator="in" />
          </filter>
        ))}
      </defs>
    </svg>
  );
}

export default function Craft() {
  const db = useDB();
  const prices = usePrices();
  const { query } = useRoute();
  const stickers = useAsync(loadStickers, []);
  const charms = useAsync(loadCharms, []);
  const [saved, setSaved] = useLocal<string>('cs2craft.craft', '');
  const [gallery, setGallery] = useLocal<SavedCraft[]>('cs2craft.gallery', []);
  const [state, setState] = useState<State | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [sp, setSp] = useLocal('cs2craft.sp', 8);

  useEffect(() => {
    if (!db) return;
    const fromUrl = decode(query.get('d'));
    const skinParam = query.get('skin');
    if (fromUrl && db.alias.get(fromUrl.skin)) return setState(fromUrl);
    if (skinParam && db.alias.get(skinParam)) {
      const s = db.alias.get(skinParam)!;
      return setState({ skin: s.id, flag: '', wear: s.wears[0] ?? 0, seed: 0, stickers: [], charm: null });
    }
    const prev = decode(saved);
    if (prev && db.alias.get(prev.skin)) return setState(prev);
    const ak = db.skins.find((s) => s.name === 'AK-47 | Redline') || db.skins.find((s) => !s.gold)!;
    setState({ skin: ak.id, flag: '', wear: ak.wears[0] ?? 2, seed: 0, stickers: [], charm: null });
  }, [db, query.get('d'), query.get('skin')]);
  useEffect(() => { if (state) setSaved(encode(state)); }, [state]);

  const byDef = useMemo(() => new Map((stickers.data || []).map((s) => [s.d, s])), [stickers.data]);
  const charmByDef = useMemo(() => new Map((charms.data || []).map((c) => [c.d, c])), [charms.data]);

  if (!db || !state) return <Spinner />;
  const skin = db.alias.get(state.skin)!;
  const set = (p: Partial<State>) => setState((s) => (s ? { ...s, ...p } : s));
  const updSt = (u: string, p: Partial<Placed>) => setState((s) => (s ? { ...s, stickers: s.stickers.map((x) => (x.uid === u ? { ...x, ...p } : x)) } : s));
  const addSticker = (st: Sticker) => {
    if (state.stickers.length >= MAX) return toast('В CS2 на оружие помещается 5 наклеек');
    const used = state.stickers.map((x) => x.x);
    const x = DEFAULT_POS.find((p) => !used.some((u) => Math.abs(u - p) < 0.05)) ?? 0.5;
    const n: Placed = { uid: uid(), d: st.d, x, y: 0.52, r: 0, w: 0, s: 1 };
    set({ stickers: [...state.stickers, n] });
    setSel(n.uid);
  };
  const stickerPrice = (d: number) => { const s = byDef.get(d); return s ? pick(prices?.st[s.id], usePrefsSource()) : null; };

  const wearList = skin.wears.length ? skin.wears : [0];
  const skinCost = skinPrice(prices, skin, state.flag, state.wear, usePrefsSource());
  const stickersCost = state.stickers.reduce((a, p) => a + (stickerPrice(p.d) || 0), 0);
  const charmObj = state.charm ? charmByDef.get(state.charm.d) : undefined;
  const charmCost = charmObj ? pick(prices?.ch[charmObj.id], usePrefsSource()) || 0 : 0;
  const missing = state.stickers.filter((p) => stickerPrice(p.d) == null).length;
  const selected = state.stickers.find((p) => p.uid === sel);

  const inspect: InspectItem = {
    defindex: skin.wid,
    paintindex: skin.pi,
    paintseed: state.seed,
    paintwear: Math.max(skin.mn, Math.min(skin.mx, (Math.max(skin.mn, WEARS[state.wear].min) + Math.min(skin.mx, WEARS[state.wear].max)) / 2)),
    rarity: skin.rar,
    quality: state.flag === 's' ? 9 : state.flag === 'v' ? 12 : 4,
    stattrak: state.flag === 's',
    stickers: [...state.stickers].sort((a, b) => a.x - b.x).map((p, i) => ({ slot: i, id: p.d, wear: p.w, rotation: p.r })),
    keychains: state.charm ? [{ slot: 0, id: state.charm.d, pattern: state.charm.p }] : undefined,
  };
  const shareUrl = () => location.href.split('#')[0] + '#/craft?d=' + encodeURIComponent(encode(state));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <ScrapeFilters />
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <div className="stack" style={{ gap: 6 }}>
          <h1>Стикер-крафт</h1>
          <p className="muted">До 5 наклеек в любом месте, поворот и потёртость, брелок. Цена сборки, ссылка, превью в игре.</p>
        </div>
        <div className="row">
          <button className="btn small" onClick={() => randomCraft(state, stickers.data || [], prices, setState)} disabled={!stickers.data}>🎲 Случайный крафт</button>
          <button className="btn small" onClick={() => copy(shareUrl(), 'Ссылка на крафт скопирована')}>Поделиться</button>
          <a className="btn small primary" href={inspectLink(inspect)} title="Открывает CS2 и показывает предмет с наклейками (позиции — по слотам)">Осмотреть в CS2</a>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(320px, 1fr)', alignItems: 'start' }}>
        <div className="stack" style={{ gap: 12 }}>
          <SkinChooser db={db} skin={skin} onPick={(s) => set({ skin: s.id, wear: s.wears.includes(state.wear) ? state.wear : s.wears[0] ?? 0, flag: s.st || state.flag !== 's' ? (s.sv || state.flag !== 'v' ? state.flag : '') : '' })} />
          <Stage skin={skin} state={state} byDef={byDef} charm={charmObj} sel={sel} setSel={setSel} updSt={updSt} setCharm={(c) => set({ charm: c })} />
          <div className="card pad row" style={{ gap: 14 }}>
            <div className="seg">
              {wearList.map((w) => <button key={w} className={state.wear === w ? 'on' : ''} onClick={() => set({ wear: w })} title={WEARS[w].ru}>{WEARS[w].short}</button>)}
            </div>
            <div className="seg">
              <button className={state.flag === '' ? 'on' : ''} onClick={() => set({ flag: '' })}>Обычный</button>
              {skin.st ? <button className={state.flag === 's' ? 'on' : ''} onClick={() => set({ flag: 's' })}>StatTrak™</button> : null}
              {skin.sv ? <button className={state.flag === 'v' ? 'on' : ''} onClick={() => set({ flag: 'v' })}>Сувенир</button> : null}
            </div>
            <label className="row small muted" style={{ gap: 6 }}>Паттерн <input className="input small num" style={{ width: 70 }} type="number" min={0} max={1000} value={state.seed} onChange={(e) => set({ seed: Math.max(0, Math.min(1000, +e.target.value || 0)) })} /></label>
            <button className="btn small ghost" onClick={() => copy(genCommand(inspect), 'Команда !gen скопирована')}>!gen</button>
            <button className="btn small ghost" onClick={() => exportPng(skin, state, byDef, charmObj)}>PNG</button>
          </div>

          {selected && (
            <div className="card pad stack" style={{ gap: 10 }}>
              <div className="row between">
                <div className="row" style={{ gap: 10 }}>
                  <img src={imgUrl(byDef.get(selected.d)?.img || '')} alt="" style={{ width: 40, height: 40, objectFit: 'contain' }} />
                  <b>{byDef.get(selected.d)?.n || 'Наклейка'}</b>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn small" disabled={state.stickers.length >= MAX} onClick={() => { const n = { ...selected, uid: uid(), x: Math.min(0.95, selected.x + 0.08) }; set({ stickers: [...state.stickers, n] }); setSel(n.uid); }}>Дублировать</button>
                  <button className="btn small" onClick={() => set({ stickers: [...state.stickers.filter((x) => x.uid !== selected.uid), selected] })}>Наверх</button>
                  <button className="btn small danger" onClick={() => { set({ stickers: state.stickers.filter((x) => x.uid !== selected.uid) }); setSel(null); }}>Убрать</button>
                </div>
              </div>
              <Slider label="Поворот" value={selected.r} min={-180} max={180} step={1} fmt={(v) => `${v}°`} onChange={(v) => updSt(selected.uid, { r: v })} />
              <Slider label="Потёртость" value={selected.w} min={0} max={0.9} step={0.1} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updSt(selected.uid, { w: v })} />
              <Slider label="Размер (визуально)" value={selected.s} min={0.6} max={1.6} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updSt(selected.uid, { s: v })} />
              <p className="tiny faint">Перетаскивайте наклейку мышью или пальцем. В CS2 каждая наклейка стирается шагами по 10%, последний шаг её удаляет. В превью «Осмотреть в CS2» наклейки встают в стандартные слоты.</p>
            </div>
          )}

          <div className="card">
            <div className="card-head"><h3>Стоимость</h3><span className="small muted">{state.stickers.length}/{MAX} наклеек{state.charm ? ' · брелок' : ''}</span></div>
            <div className="stack small" style={{ padding: '12px 18px', gap: 8 }}>
              <div className="row between"><span>{state.flag === 's' ? 'StatTrak™ ' : state.flag === 'v' ? 'Souvenir ' : ''}{skin.name} ({WEARS[state.wear].short})</span><Price cents={skinCost} prices={prices} /></div>
              {state.stickers.map((p) => (
                <div key={p.uid} className="row between" style={{ cursor: 'pointer', color: p.uid === sel ? 'var(--accent)' : undefined }} onClick={() => setSel(p.uid)}>
                  <span>{byDef.get(p.d)?.n || p.d}{p.w ? <span className="faint"> · {Math.round(p.w * 100)}%</span> : null}</span><Price cents={stickerPrice(p.d)} prices={prices} />
                </div>
              ))}
              {charmObj && <div className="row between"><span>Брелок: {charmObj.n} <button className="btn small ghost" onClick={() => set({ charm: null })}>×</button></span><Price cents={charmCost} prices={prices} /></div>}
              <hr className="sep" />
              <div className="row between"><b>Собрать всё (купить)</b><b><Price cents={(skinCost || 0) + stickersCost + charmCost} prices={prices} /></b></div>
              <div className="row between">
                <span className="muted">Оценка готового: скин + {sp}% от наклеек</span>
                <span><Price cents={(skinCost || 0) + (stickersCost * sp) / 100 + charmCost} prices={prices} /></span>
              </div>
              <input type="range" min={0} max={50} value={sp} onChange={(e) => setSp(+e.target.value)} />
              <p className="tiny faint">Наклеенные стикеры обычно продаются за малую долю их цены (sticker premium). Редкие холо/Katowice 2014 — дороже.{missing ? ` Нет цены у ${missing} наклеек.` : ''}</p>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Мои крафты</h3>
              <button className="btn small" onClick={() => { const name = prompt('Название крафта', `${skin.name} · ${state.stickers.length} наклеек`); if (name) setGallery([{ name, at: Date.now(), code: encode(state) }, ...gallery].slice(0, 60)); }}>Сохранить текущий</button>
            </div>
            {gallery.length ? (
              <div className="stack" style={{ padding: 10, gap: 4 }}>
                {gallery.map((g, i) => (
                  <div key={g.at} className="row between" style={{ padding: '4px 8px' }}>
                    <a className="link" href={href('/craft?d=' + encodeURIComponent(g.code))}>{g.name}</a>
                    <span className="row" style={{ gap: 6 }}>
                      <span className="tiny faint">{new Date(g.at).toLocaleDateString('ru-RU')}</span>
                      <button className="btn small ghost" onClick={() => setGallery(gallery.filter((_, j) => j !== i))}>×</button>
                    </span>
                  </div>
                ))}
              </div>
            ) : <div className="empty small">Сохранённые крафты появятся здесь (хранятся в этом браузере).</div>}
          </div>
        </div>

        <Library stickers={stickers.data} charms={charms.data} prices={prices} onSticker={addSticker} onCharm={(c) => set({ charm: { d: c.d, x: 0.2, y: 0.82, p: 0 } })} />
      </div>
      <style>{`@media (max-width: 1000px){ .grid[style*="1.5fr"]{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

function usePrefsSource() {
  // read without subscribing (we're inside a render that already subscribes via Price)
  try { return JSON.parse(localStorage.getItem('cs2craft.prefs') || '{}').source || 'steam'; } catch { return 'steam'; }
}

function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="row small" style={{ gap: 10, flexWrap: 'nowrap' }}>
      <span className="muted" style={{ width: 140 }}>{label}</span>
      <input type="range" className="grow" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
      <span className="num" style={{ width: 52, textAlign: 'right' }}>{fmt(value)}</span>
    </label>
  );
}

function Stage({ skin, state, byDef, charm, sel, setSel, updSt, setCharm }: { skin: Skin; state: State; byDef: Map<number, Sticker>; charm?: Charm; sel: string | null; setSel: (u: string | null) => void; updSt: (u: string, p: Partial<Placed>) => void; setCharm: (c: CharmP) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ uid: string; charm?: boolean } | null>(null);
  const move = (e: React.PointerEvent) => {
    if (!drag.current || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    if (drag.current.charm && state.charm) setCharm({ ...state.charm, x, y });
    else updSt(drag.current.uid, { x, y });
  };
  return (
    <div
      ref={ref}
      className="viewer"
      style={{ aspectRatio: '4 / 3', touchAction: 'none', userSelect: 'none', ['--rc' as any]: rarityColor(skin) }}
      onPointerMove={move}
      onPointerUp={() => (drag.current = null)}
      onPointerLeave={() => (drag.current = null)}
      onPointerDown={(e) => { if (e.target === ref.current || (e.target as HTMLElement).tagName === 'IMG' && (e.target as HTMLElement).dataset.base) setSel(null); }}
    >
      <img data-base="1" src={imgUrl(skin.img, 1024)} alt={skin.name} draggable={false} style={{ width: '94%' }} />
      {state.stickers.map((p) => {
        const st = byDef.get(p.d);
        const lvl = Math.round(p.w * 10);
        return (
          <img
            key={p.uid}
            src={st ? imgUrl(st.img) : ''}
            alt={st?.n || ''}
            draggable={false}
            onPointerDown={(e) => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { uid: p.uid }; setSel(p.uid); }}
            style={{
              position: 'absolute', left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${13 * p.s}%`, height: 'auto',
              transform: `translate(-50%, -50%) rotate(${p.r}deg)`, cursor: 'grab', filter: lvl ? `url(#scrape-${lvl}) drop-shadow(0 1px 1px rgba(0,0,0,.4))` : 'drop-shadow(0 1px 1px rgba(0,0,0,.4))',
              outline: p.uid === sel ? '2px dashed var(--accent)' : 'none', outlineOffset: 3, borderRadius: 6,
            }}
          />
        );
      })}
      {state.charm && charm && (
        <img
          src={imgUrl(charm.img)}
          alt={charm.n}
          draggable={false}
          onPointerDown={(e) => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { uid: 'charm', charm: true }; setSel(null); }}
          style={{ position: 'absolute', left: `${state.charm.x * 100}%`, top: `${state.charm.y * 100}%`, width: '11%', transform: 'translate(-50%, -50%)', cursor: 'grab', filter: 'drop-shadow(0 3px 4px rgba(0,0,0,.45))' }}
        />
      )}
      {!state.stickers.length && <div style={{ position: 'absolute', bottom: 14, left: 0, right: 0, textAlign: 'center' }} className="small muted">Выберите наклейки справа — они появятся на оружии</div>}
    </div>
  );
}

function SkinChooser({ db, skin, onPick }: { db: Indexed; skin: Skin; onPick: (s: Skin) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q, 120);
  const list = useMemo(() => {
    const words = norm(dq).split(' ').filter(Boolean);
    if (!words.length) return [];
    return db.skins.filter((s) => !s.gold && s.cat !== 'equipment' && words.every((w) => skinText(s).includes(w))).slice(0, 30);
  }, [db, dq]);
  return (
    <div className="card pad row" style={{ position: 'relative', gap: 12 }}>
      <img src={imgUrl(skin.img, 128)} alt="" style={{ width: 64, height: 48, objectFit: 'contain' }} />
      <div className="grow">
        <div className="tiny muted">Оружие</div>
        <a className="link" href={href(`/skin/${skin.id}`)} style={{ fontWeight: 650 }}>{skin.name}</a>
      </div>
      <div style={{ position: 'relative', width: 'min(320px, 100%)' }}>
        <input className="input" style={{ width: '100%' }} placeholder="Сменить скин: AWP Asiimov…" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 200)} />
        {open && list.length > 0 && (
          <div className="search-pop">
            {list.map((s) => (
              <a key={s.id} href="#" onMouseDown={(e) => { e.preventDefault(); onPick(s); setQ(''); setOpen(false); }}>
                <img src={imgUrl(s.img, 96)} alt="" style={{ width: 48, height: 36, objectFit: 'contain' }} />
                <span className="small" style={{ fontWeight: 600 }}>{s.name}</span>
              </a>
            ))}
          </div>
        )}
      </div>
      <p className="tiny faint" style={{ width: '100%' }}>На ножи и перчатки наклейки и брелоки не клеятся.</p>
    </div>
  );
}

function Library({ stickers, charms, prices, onSticker, onCharm }: { stickers: Sticker[] | null; charms: Charm[] | null; prices: Prices | null; onSticker: (s: Sticker) => void; onCharm: (c: Charm) => void }) {
  const { source, currency } = usePrefs();
  const [tab, setTab] = useState<'st' | 'ch'>('st');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 150);
  const [effect, setEffect] = useState('');
  const [type, setType] = useState('');
  const [tour, setTour] = useState('');
  const [sort, setSort] = useState<'price-desc' | 'price-asc' | 'new'>('new');
  const [limit, setLimit] = useState(90);
  const tours = useMemo(() => [...new Set((stickers || []).map((s) => s.tour).filter(Boolean))].sort().reverse() as string[], [stickers]);
  const list = useMemo(() => {
    if (!stickers) return [];
    const words = norm(dq).split(' ').filter(Boolean);
    let out = stickers.filter((s) => {
      if (effect && s.e !== effect) return false;
      if (type && s.t !== type) return false;
      if (tour && s.tour !== tour) return false;
      if (words.length) { const n = norm(`${s.n} ${s.team || ''} ${s.pl || ''}`); if (!words.every((w) => n.includes(w))) return false; }
      return true;
    });
    const p = (s: Sticker) => pick(prices?.st[s.id], source);
    if (sort === 'price-desc') out = [...out].sort((a, b) => (p(b) ?? -1) - (p(a) ?? -1));
    else if (sort === 'price-asc') out = [...out].sort((a, b) => (p(a) ?? 1e12) - (p(b) ?? 1e12));
    else out = [...out].sort((a, b) => b.d - a.d);
    return out;
  }, [stickers, prices, dq, effect, type, tour, sort, source]);
  useEffect(() => setLimit(90), [dq, effect, type, tour, sort]);

  return (
    <div className="card" style={{ position: 'sticky', top: 78 }}>
      <div className="tabs" style={{ padding: '0 10px' }}>
        <button className={tab === 'st' ? 'on' : ''} onClick={() => setTab('st')}>Наклейки {stickers ? `· ${stickers.length.toLocaleString('ru-RU')}` : ''}</button>
        <button className={tab === 'ch' ? 'on' : ''} onClick={() => setTab('ch')}>Брелоки {charms ? `· ${charms.length}` : ''}</button>
      </div>
      {tab === 'st' ? (
        <div className="stack" style={{ padding: 12, gap: 10 }}>
          <input className="input" placeholder="Команда, игрок, турнир…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="row" style={{ gap: 6 }}>
            <select aria-label="Эффект" className="select small grow" value={effect} onChange={(e) => setEffect(e.target.value)}>
              <option value="">Любой тип</option>
              {Object.entries(STICKER_EFFECTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select aria-label="Тип наклейки" className="select small grow" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Все</option><option value="A">Автографы</option><option value="T">Команды</option><option value="E">Турниры</option><option value="O">Прочие</option>
            </select>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <select aria-label="Турнир" className="select small grow" value={tour} onChange={(e) => setTour(e.target.value)}>
              <option value="">Любой турнир</option>
              {tours.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select aria-label="Сортировка" className="select small" value={sort} onChange={(e) => setSort(e.target.value as any)}>
              <option value="new">Новые</option><option value="price-desc">Дороже</option><option value="price-asc">Дешевле</option>
            </select>
          </div>
          {!stickers ? <Spinner /> : (
            <div style={{ maxHeight: '62vh', overflow: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
                {list.slice(0, limit).map((s) => (
                  <button key={s.id} className="card" style={{ padding: 6, cursor: 'pointer', textAlign: 'left', borderColor: STICKER_RARITY[s.r]?.color + '55' }} onClick={() => onSticker(s)} title={s.n}>
                    <img src={imgUrl(s.img)} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'contain' }} />
                    <div className="tiny" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.n}</div>
                    <div className="tiny num muted">{money(pick(prices?.st[s.id], source), prices, currency, { compact: true })}</div>
                  </button>
                ))}
              </div>
              {list.length > limit && <button className="btn small" style={{ width: '100%', marginTop: 8 }} onClick={() => setLimit((l) => l + 120)}>Ещё ({list.length - limit})</button>}
              {!list.length && <div className="empty small">Ничего не найдено</div>}
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: 12, maxHeight: '70vh', overflow: 'auto' }}>
          {!charms ? <Spinner /> : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
              {charms.map((c) => (
                <button key={c.id} className="card" style={{ padding: 6, cursor: 'pointer', textAlign: 'left', borderColor: STICKER_RARITY[c.r]?.color + '55' }} onClick={() => onCharm(c)} title={c.n}>
                  <img src={imgUrl(c.img)} alt="" loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'contain' }} />
                  <div className="tiny" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.n}</div>
                  <div className="tiny num muted">{money(pick(prices?.ch[c.id], source), prices, currency, { compact: true })}</div>
                </button>
              ))}
            </div>
          )}
          <p className="tiny faint" style={{ marginTop: 10 }}>Один брелок на оружие; перетащите его на картинке.</p>
        </div>
      )}
    </div>
  );
}

function randomCraft(state: State, stickers: Sticker[], prices: Prices | null, setState: (s: State) => void) {
  if (!stickers.length) return;
  const priced = stickers.filter((s) => prices?.st[s.id]);
  const pool = priced.length > 200 ? priced : stickers;
  const rnd = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  const mode = Math.floor(Math.random() * 3);
  let chosen: Sticker[] = [];
  if (mode === 0) {
    const s = rnd(pool.filter((x) => x.e === 'Holo' || x.e === 'Gold' || x.e === 'Foil'));
    chosen = Array(4).fill(s);
  } else if (mode === 1) {
    const team = rnd(pool.filter((x) => x.t === 'T' && x.team)).team;
    const same = pool.filter((x) => x.team === team);
    chosen = Array.from({ length: Math.min(5, Math.max(3, same.length)) }, () => rnd(same));
  } else {
    const tour = rnd(pool.filter((x) => x.tour)).tour;
    const same = pool.filter((x) => x.tour === tour);
    chosen = Array.from({ length: 4 }, () => rnd(same));
  }
  setState({ ...state, stickers: chosen.map((s, i) => ({ uid: uid(), d: s.d, x: DEFAULT_POS[i], y: 0.52, r: 0, w: 0, s: 1 })) });
}

async function exportPng(skin: Skin, state: State, byDef: Map<number, Sticker>, charm?: Charm) {
  const W = 1600, H = 1200;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
  try {
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#171a21';
    g.fillRect(0, 0, W, H);
    const base = await load(imgUrl(skin.img, 1024));
    const bw = W * 0.94, bh = (base.height / base.width) * bw;
    g.drawImage(base, (W - bw) / 2, (H - bh) / 2, bw, bh);
    for (const p of state.stickers) {
      const st = byDef.get(p.d);
      if (!st) continue;
      const im = await load(imgUrl(st.img));
      const sw = W * 0.13 * p.s, sh = (im.height / im.width) * sw;
      g.save();
      g.translate(p.x * W, p.y * H);
      g.rotate((p.r * Math.PI) / 180);
      g.globalAlpha = 1 - p.w * 0.85;
      g.drawImage(im, -sw / 2, -sh / 2, sw, sh);
      g.restore();
    }
    if (state.charm && charm) {
      const im = await load(imgUrl(charm.img));
      const sw = W * 0.11, sh = (im.height / im.width) * sw;
      g.drawImage(im, state.charm.x * W - sw / 2, state.charm.y * H - sh / 2, sw, sh);
    }
    const url = c.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${skin.name.replace(/[^\w\-]+/g, '_')}-craft.png`;
    a.click();
  } catch {
    toast('Не удалось собрать PNG: CDN Steam не отдал картинку для холста. Сделайте скриншот.');
  }
}
