import { useMemo, useState } from 'react';
import { SkinCard, Spinner, NoPricesNotice, Updated } from '../components/ui';
import { norm, skinText } from '../components/Layout';
import { useAsync, useDB, usePrices } from '../lib/hooks';
import { CATEGORIES, OTHER_CATEGORIES, RARITIES, STICKER_EFFECTS, plural } from '../lib/labels';
import { money, pick, priceRange, steamUrl, usePrefs } from '../lib/prefs';
import { setQuery, useRoute } from '../lib/router';
import { imgUrl, loadItems, loadStickers, type OtherItem, type Prices } from '../lib/data';

const SORTS = [
  { k: 'new', ru: 'Сначала новые' },
  { k: 'price-desc', ru: 'Дороже' },
  { k: 'price-asc', ru: 'Дешевле' },
  { k: 'rarity', ru: 'По редкости' },
  { k: 'name', ru: 'По названию' },
];

export default function Catalog() {
  const db = useDB();
  const prices = usePrices();
  const { source } = usePrefs();
  const { query } = useRoute();
  const q = query.get('q') || '';
  const cat = query.get('cat') || '';
  const wpn = query.get('w') || '';
  const rar = (query.get('r') || '').split(',').filter(Boolean).map(Number);
  const col = query.get('c') || '';
  const st = query.get('st') === '1';
  const sv = query.get('sv') === '1';
  const sort = query.get('sort') || 'new';
  const [limit, setLimit] = useState(120);

  const colDate = useMemo(() => {
    const m = new Map<string, string>();
    db?.collections.forEach((c) => c.skins.forEach((id) => m.set(id, c.date)));
    db?.crates.forEach((c) => [...c.skins, ...c.rare].forEach((id) => { if (!m.has(id) || (c.date && c.date.replace(/\//g, '-') < (m.get(id) || '9'))) m.set(id, c.date.replace(/\//g, '-')); }));
    return m;
  }, [db]);

  const list = useMemo(() => {
    if (!db) return [];
    const words = norm(q).split(' ').filter(Boolean);
    let out = db.skins.filter((s) => {
      if (cat && s.cat !== cat) return false;
      if (wpn && s.wpn !== wpn) return false;
      if (rar.length && !rar.includes(s.rar)) return false;
      if (col && !s.col.includes(col) && !(db.colById.get(col)?.gold || []).some((id) => db.alias.get(id) === s)) return false;
      if (st && !s.st) return false;
      if (sv && !s.sv) return false;
      if (words.length) { const n = skinText(s); if (!words.every((w) => n.includes(w))) return false; }
      return true;
    });
    const pr = (s: (typeof out)[0]) => priceRange(prices, s, source)?.[0] ?? null;
    if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'rarity') out.sort((a, b) => b.rar - a.rar || a.name.localeCompare(b.name));
    else if (sort === 'price-asc') out.sort((a, b) => (pr(a) ?? 1e15) - (pr(b) ?? 1e15));
    else if (sort === 'price-desc') out.sort((a, b) => (pr(b) ?? -1) - (pr(a) ?? -1));
    else out.sort((a, b) => (colDate.get(b.id) || '').localeCompare(colDate.get(a.id) || '') || b.rar - a.rar);
    return out;
  }, [db, prices, source, q, cat, wpn, rar.join(), col, st, sv, sort, colDate]);

  const other = cat in OTHER_CATEGORIES;
  if (!db) return <Spinner />;
  if (other) return <OtherCatalog cat={cat} prices={prices} />;
  const weapons = [...new Set(db.skins.filter((s) => !cat || s.cat === cat).map((s) => s.wpn))].sort();
  const toggleR = (r: number) => setQuery({ r: (rar.includes(r) ? rar.filter((x) => x !== r) : [...rar, r]).join(',') });

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row between">
        <div>
          <h1>Все скины CS2</h1>
          <p className="muted">{list.length} {plural(list.length, 'предмет', 'предмета', 'предметов')} · оружие, ножи и перчатки с ценами и историей</p>
        </div>
        <Updated prices={prices} />
      </div>
      <NoPricesNotice prices={prices} />
      <div className="catalog">
        <aside className="filters">
          <div>
            <h4>Поиск</h4>
            <input className="input" style={{ width: '100%' }} placeholder="AK-47 Redline, Керамбит…" value={q} onChange={(e) => setQuery({ q: e.target.value })} />
          </div>
          <div>
            <h4>Тип</h4>
            <div className="filter-list">
              <button className={'chip' + (!cat ? ' on' : '')} onClick={() => setQuery({ cat: null, w: null })}>Все</button>
              {Object.entries(CATEGORIES).map(([k, v]) => <button key={k} className={'chip' + (cat === k ? ' on' : '')} onClick={() => setQuery({ cat: cat === k ? null : k, w: null })}>{v}</button>)}
            </div>
          </div>
          <OtherTypes cat={cat} />
          <div>
            <h4>Оружие</h4>
            <select className="select" aria-label="Оружие" style={{ width: '100%' }} value={wpn} onChange={(e) => setQuery({ w: e.target.value })}>
              <option value="">Любое</option>
              {weapons.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div>
            <h4>Редкость</h4>
            <div className="filter-list">
              {[8, 7, 6, 5, 4, 3, 2, 1].map((r) => (
                <button key={r} className={'chip' + (rar.includes(r) ? ' on' : '')} onClick={() => toggleR(r)}>
                  <span className="rar-dot" style={{ background: RARITIES[r].color }} />{RARITIES[r].ru.replace('★ ', '')}
                </button>
              ))}
            </div>
          </div>
          <div>
            <h4>Коллекция</h4>
            <select className="select" aria-label="Коллекция" style={{ width: '100%' }} value={col} onChange={(e) => setQuery({ c: e.target.value })}>
              <option value="">Любая</option>
              {[...db.collections].sort((a, b) => b.date.localeCompare(a.date)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            <label className="check"><input type="checkbox" checked={st} onChange={(e) => setQuery({ st: e.target.checked ? 1 : null })} />Есть StatTrak™</label>
            <label className="check"><input type="checkbox" checked={sv} onChange={(e) => setQuery({ sv: e.target.checked ? 1 : null })} />Есть сувенирная версия</label>
          </div>
          <div>
            <h4>Сортировка</h4>
            <select className="select" aria-label="Сортировка" style={{ width: '100%' }} value={sort} onChange={(e) => setQuery({ sort: e.target.value })}>
              {SORTS.map((s) => <option key={s.k} value={s.k}>{s.ru}</option>)}
            </select>
          </div>
          <button className="btn ghost" onClick={() => setQuery({ q: null, cat: null, w: null, r: null, c: null, st: null, sv: null, sort: null })}>Сбросить фильтры</button>
        </aside>
        <section className="stack">
          <div className="skin-grid">
            {list.slice(0, limit).map((s) => <SkinCard key={s.id} s={s} prices={prices} />)}
          </div>
          {list.length > limit && <button className="btn" onClick={() => setLimit((l) => l + 240)}>Показать ещё ({list.length - limit})</button>}
          {!list.length && <div className="empty">Ничего не найдено — попробуйте убрать часть фильтров.</div>}
        </section>
      </div>
    </div>
  );
}

// ── «Другое»: agents, charms, cases, keys, graffiti, music kits, patches, collectibles, passes, gifts, stickers ──

function OtherTypes({ cat }: { cat: string }) {
  return (
    <div>
      <h4>Другое</h4>
      <div className="filter-list">
        {Object.entries(OTHER_CATEGORIES).map(([k, v]) => (
          <button key={k} className={'chip' + (cat === k ? ' on' : '')} onClick={() => setQuery({ cat: cat === k ? null : k, w: null, r: null, c: null, st: null, sv: null, kind: null })}>{v}</button>
        ))}
      </div>
    </div>
  );
}

const STICKER_RAR: Record<number, string> = { 0: 'Обычная', 3: 'Высшего класса', 4: 'Примечательного типа', 5: 'Экзотичного вида', 6: 'Экстраординарного типа', 7: 'Контрабанда' };

function OtherCatalog({ cat, prices }: { cat: string; prices: Prices | null }) {
  const { source } = usePrefs();
  const { query } = useRoute();
  const q = query.get('q') || '';
  const kind = query.get('kind') || '';
  const rar = (query.get('r') || '').split(',').filter(Boolean).map(Number);
  const onMarket = query.get('mk') === '1';
  const sort = query.get('sort') || 'new';
  const [limit, setLimit] = useState(120);
  const items = useAsync(loadItems, []);
  const stickers = useAsync(() => (cat === 'sticker' ? loadStickers() : Promise.resolve([])), [cat]);
  const title = OTHER_CATEGORIES[cat];

  // stickers come from stickers.json — same card shape as the rest
  const all = useMemo<OtherItem[]>(() => {
    if (cat === 'sticker') {
      return (stickers.data || []).map((x) => ({
        id: x.id, c: 'sticker', n: 'Наклейка | ' + x.n, r: x.r, rn: STICKER_RAR[x.r], i: x.img, m: x.m ? [x.m] : undefined,
        t: x.tour || (x.e && x.e !== 'Other' ? STICKER_EFFECTS[x.e] || x.e : undefined), o: x.d,
      }));
    }
    return (items.data || []).filter((x) => x.c === cat);
  }, [cat, items.data, stickers.data]);
  const priceOf = (x: OtherItem) => pick(cat === 'sticker' ? prices?.st?.[x.id] : prices?.ot?.[x.id], source);
  const kinds = useMemo(() => {
    const c = new Map<string, number>();
    for (const x of all) if (x.t && !/^\d+ цвет/.test(x.t)) c.set(x.t, (c.get(x.t) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);
  const rarities = useMemo(() => {
    const m = new Map<number, string>();
    for (const x of all) if (!m.has(x.r)) m.set(x.r, x.rn || RARITIES[x.r]?.ru || '');
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [all]);
  const list = useMemo(() => {
    const words = norm(q).split(' ').filter(Boolean);
    const out = all.filter((x) => {
      if (kind && x.t !== kind) return false;
      if (rar.length && !rar.includes(x.r)) return false;
      if (onMarket && !x.m?.length) return false;
      if (words.length) { const t = norm(x.n + ' ' + (x.en || '') + ' ' + (x.t || '')); if (!words.every((w) => t.includes(w))) return false; }
      return true;
    });
    const p = new Map(out.map((x) => [x.id, priceOf(x)]));
    if (sort === 'name') out.sort((a, b) => a.n.localeCompare(b.n, 'ru'));
    else if (sort === 'rarity') out.sort((a, b) => b.r - a.r || a.n.localeCompare(b.n, 'ru'));
    else if (sort === 'price-asc') out.sort((a, b) => (p.get(a.id) ?? 1e15) - (p.get(b.id) ?? 1e15));
    else if (sort === 'price-desc') out.sort((a, b) => (p.get(b.id) ?? -1) - (p.get(a.id) ?? -1));
    else out.sort((a, b) => (b.o || 0) - (a.o || 0));
    return out;
  }, [all, q, kind, rar.join(), onMarket, sort, prices, source]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleR = (r: number) => setQuery({ r: (rar.includes(r) ? rar.filter((x) => x !== r) : [...rar, r]).join(',') || null });
  const loading = cat === 'sticker' ? stickers.loading : items.loading;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row between">
        <div>
          <h1>{title}</h1>
          <p className="muted">{list.length} {plural(list.length, 'предмет', 'предмета', 'предметов')} · цены Steam и Skinport, клик по карточке — страница на торговой площадке Steam</p>
        </div>
        <Updated prices={prices} />
      </div>
      <div className="catalog">
        <aside className="filters">
          <div>
            <h4>Поиск</h4>
            <input className="input" style={{ width: '100%' }} placeholder={cat === 'sticker' ? 'Команда, игрок, турнир…' : 'Название…'} value={q} onChange={(e) => setQuery({ q: e.target.value })} />
          </div>
          <div>
            <h4>Оружие и снаряжение</h4>
            <div className="filter-list">
              <button className="chip" onClick={() => setQuery({ cat: null, kind: null, r: null, mk: null })}>Все скины</button>
              {Object.entries(CATEGORIES).map(([k, v]) => <button key={k} className="chip" onClick={() => setQuery({ cat: k, kind: null, r: null, mk: null })}>{v}</button>)}
            </div>
          </div>
          <OtherTypes cat={cat} />
          {kinds.length > 1 && (
            <div>
              <h4>{cat === 'sticker' ? 'Турнир / вид' : 'Вид'}</h4>
              <select className="select" aria-label="Вид предмета" style={{ width: '100%' }} value={kind} onChange={(e) => setQuery({ kind: e.target.value || null })}>
                <option value="">Любой</option>
                {kinds.map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}
              </select>
            </div>
          )}
          {rarities.length > 1 && (
            <div>
              <h4>Редкость</h4>
              <div className="filter-list">
                {rarities.map(([r, ru]) => (
                  <button key={r} className={'chip' + (rar.includes(r) ? ' on' : '')} onClick={() => toggleR(r)}>
                    <span className="rar-dot" style={{ background: RARITIES[r]?.color || RARITIES[0].color }} />{ru}
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="check"><input type="checkbox" checked={onMarket} onChange={(e) => setQuery({ mk: e.target.checked ? 1 : null })} />Только продающиеся на маркете</label>
          <div>
            <h4>Сортировка</h4>
            <select className="select" aria-label="Сортировка" style={{ width: '100%' }} value={sort} onChange={(e) => setQuery({ sort: e.target.value })}>
              {SORTS.map((s) => <option key={s.k} value={s.k}>{s.ru}</option>)}
            </select>
          </div>
          <button className="btn ghost" onClick={() => setQuery({ q: null, kind: null, r: null, mk: null, sort: null })}>Сбросить фильтры</button>
        </aside>
        <section className="stack">
          {loading ? <Spinner /> : (
            <>
              <div className="skin-grid">
                {list.slice(0, limit).map((x) => <ItemCard key={x.id} x={x} price={priceOf(x)} prices={prices} />)}
              </div>
              {list.length > limit && <button className="btn" onClick={() => setLimit((l) => l + 240)}>Показать ещё ({list.length - limit})</button>}
              {!list.length && <div className="empty">Ничего не найдено — попробуйте убрать часть фильтров.</div>}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function ItemCard({ x, price, prices }: { x: OtherItem; price: number | null; prices: Prices | null }) {
  const { currency } = usePrefs();
  // "Брелок | Крошка Ава" → kind line «Брелок», big line «Крошка Ава»
  const cut = x.n.indexOf(' | ');
  const prefixed = cut > 0 && ['sticker', 'charm', 'patch', 'graffiti', 'music'].includes(x.c);
  const head = prefixed ? x.n.slice(0, cut) : x.t || x.rn || '';
  const name = prefixed ? x.n.slice(cut + 3) : x.n;
  const sub = prefixed ? x.t : x.t && x.rn ? x.rn : '';
  const body = (
    <>
      <div className="img">
        <img src={imgUrl(x.i, 256)} alt={x.n} loading="lazy" width={256} height={192} />
      </div>
      <div className="meta">
        <div className="row between" style={{ gap: 6 }}>
          <span className="wpn">{head}</span>
          {x.m && x.m.length > 1 && x.c === 'music' ? <span className="badge st">ST</span> : null}
        </div>
        <div className="fin" title={x.en ? `${x.n}\n${x.en}` : x.n}>{name}</div>
        {sub ? <div className="tiny muted pl-ell" title={sub}>{sub}</div> : null}
        <div className="price muted">{price != null ? (x.k || (x.m && x.m.length > 1) ? 'от ' : '') + money(price, prices, currency) : x.m?.length ? '—' : 'не продаётся'}</div>
      </div>
    </>
  );
  const style = { ['--rc' as any]: RARITIES[x.r]?.color || RARITIES[0].color } as React.CSSProperties;
  if (!x.m?.length) return <div className="skin-card" style={style}>{body}</div>;
  return <a className="skin-card" style={style} href={steamUrl(x.m[0])} target="_blank" rel="noopener noreferrer">{body}</a>;
}
