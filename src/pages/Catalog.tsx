import { useMemo, useState } from 'react';
import { SkinCard, Spinner, NoPricesNotice, Updated } from '../components/ui';
import { norm, skinText } from '../components/Layout';
import { useDB, usePrices } from '../lib/hooks';
import { CATEGORIES, RARITIES, plural } from '../lib/labels';
import { priceRange, usePrefs } from '../lib/prefs';
import { setQuery, useRoute } from '../lib/router';

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

  if (!db) return <Spinner />;
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
          <div>
            <h4>Оружие</h4>
            <select className="select" style={{ width: '100%' }} value={wpn} onChange={(e) => setQuery({ w: e.target.value })}>
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
            <select className="select" style={{ width: '100%' }} value={col} onChange={(e) => setQuery({ c: e.target.value })}>
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
            <select className="select" style={{ width: '100%' }} value={sort} onChange={(e) => setQuery({ sort: e.target.value })}>
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
