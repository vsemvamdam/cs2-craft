import { useMemo, useState } from 'react';
import { SkinCard, Spinner } from '../components/ui';
import { imgUrl, type Skin } from '../lib/data';
import { useDB, usePrices } from '../lib/hooks';
import { RARITIES, plural } from '../lib/labels';
import { href } from '../lib/router';
import { encodeContract } from '../lib/tradeup';

const KIND = { case: 'Кейсы', map: 'Карты (сувенирные)', other: 'Прочие' } as const;

export function Collections() {
  const db = useDB();
  const [kind, setKind] = useState<'all' | 'case' | 'map' | 'other'>('all');
  const [q, setQ] = useState('');
  if (!db) return <Spinner />;
  const list = db.collections
    .filter((c) => (kind === 'all' || c.kind === kind) && c.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row between">
        <div><h1>Коллекции и кейсы</h1><p className="muted">{db.collections.length} коллекций · {db.collections.filter((c) => c.gold.length).length} с ножами или перчатками (подходят для крафта 5 → 1)</p></div>
        <div className="row">
          <input className="input" placeholder="Поиск коллекции" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="seg">
            {(['all', 'case', 'map', 'other'] as const).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'all' ? 'Все' : KIND[k]}</button>)}
          </div>
        </div>
      </div>
      <div className="feature-grid">
        {list.map((c) => (
          <a key={c.id} href={href(`/collection/${c.id}`)} className="feature" style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <img src={imgUrl(c.img)} alt="" style={{ width: 64, height: 64, objectFit: 'contain' }} loading="lazy" />
            <div className="grow">
              <div style={{ fontWeight: 650 }}>{c.name}</div>
              <div className="tiny muted">{c.date ? new Date(c.date).getFullYear() + ' · ' : ''}{c.skins.length} {plural(c.skins.length, 'скин', 'скина', 'скинов')}{c.gold.length ? ' · ★ ' + new Set(c.gold.map((g) => db.alias.get(g))).size : ''}</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

export function CollectionPage({ id }: { id: string }) {
  const db = useDB();
  const prices = usePrices();
  const c = db?.colById.get(id);
  const tiers = useMemo(() => {
    if (!db || !c) return [];
    const m = db.colTiers.get(c.id)!;
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [db, c]);
  if (!db) return <Spinner />;
  if (!c) return <div className="empty">Коллекция не найдена</div>;
  const gold = [...new Set(c.gold.map((g) => db.alias.get(g)).filter((x): x is Skin => !!x))];
  const crates = c.crates.map((x) => db.crateById.get(x)).filter(Boolean);
  const coverts = db.colTiers.get(c.id)?.get(6) || [];
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="small muted"><a className="link" href="#/collections">Коллекции</a> / {c.name}</div>
      <div className="row" style={{ gap: 18 }}>
        <img src={imgUrl(c.img)} alt="" style={{ width: 96, height: 96, objectFit: 'contain' }} />
        <div className="stack" style={{ gap: 6 }}>
          <h1>{c.name}</h1>
          <div className="muted">{c.date ? `Вышла ${new Date(c.date).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' })}` : ''}{crates.length ? ' · ' + crates.map((x) => x!.name).join(', ') : ''}</div>
          {coverts.length > 0 && gold.length > 0 && (
            <div className="row">
              <a className="btn primary small" href={href('/tradeup?c=' + encodeContract({ mode: 'gold', st: false, inputs: Array.from({ length: 5 }, () => ({ id: coverts[0].id, float: +(coverts[0].mn + 0.01).toFixed(4) })) }))}>Крафт ножа из этой коллекции</a>
              <span className="small muted">шанс каждого ножа/перчаток — 1 к {gold.length}</span>
            </div>
          )}
        </div>
      </div>
      {tiers.map(([rar, skins]) => (
        <div key={rar} className="stack">
          <div className="section-title">
            <h2 style={{ color: RARITIES[rar].color }}>{RARITIES[rar].ru}</h2>
            <span className="small muted">{skins.length} {plural(skins.length, 'скин', 'скина', 'скинов')}{rar < 6 && tiers.some(([r]) => r === rar + 1) ? ' · шанс в контракте 1 к ' + (tiers.find(([r]) => r === rar + 1)?.[1].length || 1) + ' для следующей редкости' : ''}</span>
          </div>
          <div className="skin-grid">{skins.map((s) => <SkinCard key={s.id} s={s} prices={prices} />)}</div>
        </div>
      ))}
      {gold.length > 0 && (
        <div className="stack">
          <div className="section-title"><h2 style={{ color: RARITIES[8].color }}>★ Особо редкие предметы</h2><span className="small muted">{gold.length}</span></div>
          <div className="skin-grid">{gold.map((s) => <SkinCard key={s.id} s={s} prices={prices} />)}</div>
        </div>
      )}
    </div>
  );
}
