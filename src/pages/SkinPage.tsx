import { useEffect, useMemo, useState } from 'react';
import { FloatBar, Price, RarityTag, SkinCard, Spinner, NoPricesNotice, Updated, rarityColor } from '../components/ui';
import { PriceChart } from '../components/PriceChart';
import { PatternBlock } from '../components/PatternBlock';
import { imgUrl, loadHistory, type HistoryFile, type Skin } from '../lib/data';
import { useDB, usePrices } from '../lib/hooks';
import { CATEGORIES, PHASE_RU, RARITIES, WEARS, wearOf } from '../lib/labels';
import { marketName, money, pick, skinportUrl, steamUrl, usePrefs, vkey, type Flag } from '../lib/prefs';
import { href, setQuery, useRoute } from '../lib/router';
import { canBeInput, encodeContract } from '../lib/tradeup';

export default function SkinPage({ id }: { id: string }) {
  const db = useDB();
  const prices = usePrices();
  const { query } = useRoute();
  const { source, currency } = usePrefs();
  const skin = db?.alias.get(id);
  const [hist, setHist] = useState<HistoryFile | null>(null);
  useEffect(() => {
    setHist(null);
    if (skin) loadHistory(skin.id).then(setHist);
  }, [skin?.id]);

  const wears: (number | 'x')[] = skin ? (skin.vanilla ? ['x'] : skin.wears) : [];
  const flags: Flag[] = skin ? (['', ...(skin.st ? ['s'] : []), ...(skin.sv ? ['v'] : [])] as Flag[]) : [''];
  const flag = (flags.includes(query.get('f') as Flag) ? query.get('f') : '') as Flag;
  const phase = query.get('ph') || skin?.phases?.[0]?.ph || '';
  const floatQ = query.get('fl');
  const defaultWear = typeof wears[0] === 'number' ? (wears as number[])[0] : 0;
  const wearQ = query.get('w');
  const wear: number | 'x' = skin?.vanilla ? 'x' : wearQ != null && wears.includes(+wearQ) ? +wearQ : defaultWear;
  const floatVal = floatQ != null ? parseFloat(floatQ) : null;

  const related = useMemo(() => {
    if (!db || !skin) return [];
    const col = skin.col[0];
    if (col) return (db.colById.get(col)?.skins || []).map((x) => db.alias.get(x)).filter((x): x is Skin => !!x && x !== skin).sort((a, b) => b.rar - a.rar);
    return db.skins.filter((x) => x.wpn === skin.wpn && x !== skin).slice(0, 24);
  }, [db, skin]);

  const sameFinish = useMemo(() => (db && skin && skin.fin && skin.fin !== 'Vanilla' ? db.skins.filter((x) => x.fin === skin.fin && x !== skin).sort((a, b) => Number(b.gold) - Number(a.gold) || a.wpn.localeCompare(b.wpn)).slice(0, 18) : []), [db, skin]);
  if (!db) return <Spinner />;
  if (!skin) return <div className="empty">Скин не найден. <a className="link" href="#/skins">К каталогу</a></div>;

  const [wpn, fin] = skin.name.replace('★ ', '').split(' | ');
  const phaseImg = skin.phases?.find((p) => p.ph === phase)?.img || skin.img;
  const cols = skin.col.map((c) => db.colById.get(c)).filter(Boolean);
  const crates = skin.cr.map((c) => db.crateById.get(c)).filter(Boolean);
  const goldCols = skin.gold ? db.collections.filter((c) => c.gold.some((g) => db.alias.get(g) === skin)) : [];
  const wearIdx = typeof wear === 'number' ? wear : 0;
  const setWear = (w: number) => setQuery({ w, fl: null });
  const wearList = wears.filter((w): w is number => typeof w === 'number');
  const curIdx = wearList.indexOf(wearIdx);

  const onFloat = (v: number) => {
    const f = Math.min(skin.mx, Math.max(skin.mn, v));
    setQuery({ fl: +f.toFixed(4), w: wearOf(f) });
  };

  // contract helpers
  let craftLink: string | null = null;
  let craftNote = '';
  if (!skin.gold && skin.rar >= 2 && skin.rar <= 6 && skin.col[0]) {
    const lower = db.colTiers.get(skin.col[0])?.get(skin.rar - 1) || [];
    if (lower.length) {
      const cheapest = [...lower].sort((a, b) => (pick(prices?.s[a.id]?.[vkey('', a.wears[0] ?? 0)], source) ?? 1e12) - (pick(prices?.s[b.id]?.[vkey('', b.wears[0] ?? 0)], source) ?? 1e12))[0];
      const n = db.colTiers.get(skin.col[0])?.get(skin.rar)?.length || 1;
      craftNote = `10 предметов редкости «${RARITIES[skin.rar - 1].ru}» из этой коллекции дают этот скин с шансом 1 к ${n}.`;
      craftLink = '/tradeup?c=' + encodeContract({ mode: 'weapon', st: false, inputs: Array.from({ length: 10 }, () => ({ id: cheapest.id, float: +(cheapest.mn + (Math.min(cheapest.mx, 0.069) - cheapest.mn) * 0.5).toFixed(4) })) });
    }
  }
  if (skin.gold && goldCols.length) {
    const c = goldCols[0];
    const covert = (db.colTiers.get(c.id)?.get(6) || [])[0];
    craftNote = `Крафт из 5 тайных предметов: ${goldCols.length > 1 ? `${goldCols.length} коллекций дают этот предмет` : c.name}. Шанс в контракте из одной коллекции — 1 к ${new Set(c.gold.map((g) => db.alias.get(g))).size}.`;
    if (covert) craftLink = '/tradeup?c=' + encodeContract({ mode: 'gold', st: false, inputs: Array.from({ length: 5 }, () => ({ id: covert.id, float: +(covert.mn + 0.01).toFixed(4) })) });
  }
  const asInput = canBeInput(skin, 'weapon') || canBeInput(skin, 'gold');
  const inputLink = asInput ? '/tradeup?c=' + encodeContract({ mode: skin.rar === 6 ? 'gold' : 'weapon', st: flag === 's', inputs: Array.from({ length: skin.rar === 6 ? 5 : 10 }, () => ({ id: skin.id, float: floatVal ?? +(skin.mn + 0.001).toFixed(4), sv: flag === 'v' })) }) : null;

  const vk = vkey(flag, wear);
  const label = (f: Flag) => (f === 's' ? 'StatTrak™' : f === 'v' ? 'Сувенир' : 'Обычный');

  return (
    <div className="stack" style={{ gap: 18, ['--rc' as any]: rarityColor(skin) }}>
      <div className="small muted">
        <a className="link" href="#/skins">Скины</a> / <a className="link" href={href(`/skins?w=${encodeURIComponent(skin.wpn)}`)}>{skin.wpn}</a> / {fin || 'Ванильный'}
      </div>
      <div className="skin-hero">
        <div className="stack" style={{ gap: 12 }}>
          <div className="viewer">
            <div className="corner">
              {skin.gold ? <span className="badge gold">★</span> : null}
              {flag === 's' && <span className="badge st">StatTrak™</span>}
              {flag === 'v' && <span className="badge sv">Сувенир</span>}
            </div>
            <img src={imgUrl(phaseImg, 1024)} alt={skin.name} />
          </div>
          {skin.phases && (
            <div className="row" style={{ gap: 6 }}>
              {skin.phases.map((p) => <button key={p.ph} className={'chip' + (p.ph === phase ? ' on' : '')} onClick={() => setQuery({ ph: p.ph })}>{PHASE_RU[p.ph] || p.ph}</button>)}
            </div>
          )}
          {!skin.vanilla && (
            <div className="wear-picker">
              <div className="card wear-switch">
                <button className="btn ghost icon" disabled={curIdx <= 0} onClick={() => setWear(wearList[curIdx - 1])} aria-label="Предыдущий износ">‹</button>
                <div className="name">{WEARS[wearIdx].ru}</div>
                <button className="btn ghost icon" disabled={curIdx >= wearList.length - 1} onClick={() => setWear(wearList[curIdx + 1])} aria-label="Следующий износ">›</button>
              </div>
              <div className="card float-box">
                <span className="stack" style={{ gap: 0 }}><span className="muted">Float</span><span className="tiny faint num nowrap">{skin.mn.toFixed(2)}–{skin.mx.toFixed(2)}</span></span>
                <input
                  className="input f"
                  type="number"
                  step="0.001"
                  min={skin.mn}
                  max={skin.mx}
                  value={floatVal ?? ''}
                  placeholder={(Math.max(skin.mn, WEARS[wearIdx].min) + (Math.min(skin.mx, WEARS[wearIdx].max) - Math.max(skin.mn, WEARS[wearIdx].min)) / 2).toFixed(3)}
                  onChange={(e) => e.target.value !== '' && onFloat(parseFloat(e.target.value))}
                />
                <FloatBar value={floatVal ?? Math.max(skin.mn, WEARS[wearIdx].min) + (Math.min(skin.mx, WEARS[wearIdx].max) - Math.max(skin.mn, WEARS[wearIdx].min)) / 2} min={skin.mn} max={skin.mx} onChange={onFloat} />
              </div>
            </div>
          )}
          <PatternBlock skin={skin} phase={skin.phases ? phase : undefined} float={floatVal} />
        </div>

        <div className="stack" style={{ gap: 12 }}>
          <div className="card pad stack" style={{ gap: 10 }}>
            <div className="muted">{skin.gold ? '★ ' : ''}{wpn} · {CATEGORIES[skin.cat] || ''}</div>
            <h1>{fin || 'Ванильный'}{skin.phases ? <span className="muted" style={{ fontWeight: 500 }}> · {PHASE_RU[phase] || phase}</span> : null}</h1>
            {skin.ru && <div className="muted">{skin.ru}</div>}
            <div className="row" style={{ gap: 14 }}>
              <span style={{ color: rarityColor(skin), fontWeight: 600 }}><RarityTag rar={skin.rar} cat={skin.cat} /></span>
              <span className="muted small num">Флоат {skin.mn.toFixed(2)}–{skin.mx.toFixed(2)}</span>
              {skin.pi ? <span className="muted small">Paint #{skin.pi}</span> : null}
            </div>
            {flags.length > 1 && (
              <div className="seg" style={{ alignSelf: 'flex-start' }}>
                {flags.map((f) => <button key={f} className={f === flag ? 'on' : ''} onClick={() => setQuery({ f: f || null })}>{label(f)}</button>)}
              </div>
            )}
            <dl className="dl">
              {cols.length > 0 && <><dt>Коллекция</dt><dd>{cols.map((c) => <a key={c!.id} className="link" href={href(`/collection/${c!.id}`)}>{c!.name} </a>)}</dd></>}
              {crates.length > 0 && <><dt>Кейс</dt><dd>{crates.slice(0, 6).map((c, i) => <span key={c!.id}>{i ? ', ' : ''}{c!.name}</span>)}{crates.length > 6 ? ` и ещё ${crates.length - 6}` : ''}</dd></>}
              {goldCols.length > 0 && <><dt>Крафт из</dt><dd>{goldCols.slice(0, 6).map((c, i) => <span key={c.id}>{i ? ', ' : ''}<a className="link" href={href(`/collection/${c.id}`)}>{c.name.replace(/^The /, '')}</a></span>)}{goldCols.length > 6 ? ` и ещё ${goldCols.length - 6}` : ''}</dd></>}
            </dl>
            {skin.notes?.map((n, i) => <div key={i} className="notice small">{n}</div>)}
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Цены по износу</h3>
              <Updated prices={prices} />
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Износ</th>{flags.map((f) => <th key={f} className="r">{label(f)}</th>)}</tr>
                </thead>
                <tbody>
                  {wears.map((w) => (
                    <tr key={String(w)} className="click" onClick={() => typeof w === 'number' && setWear(w)} style={w === wear ? { background: 'var(--surface-2)' } : undefined}>
                      <td>{w === 'x' ? 'Без износа' : <span className="row" style={{ gap: 8 }}><span className="rar-dot" style={{ background: WEARS[w].color }} />{WEARS[w].ru}</span>}</td>
                      {flags.map((f) => {
                        const row = prices?.s[skin.id]?.[vkey(f, w)];
                        const p = phase && skin.phases ? prices?.ph?.[skin.id]?.[phase]?.[vkey(f, w)]?.[0] ?? pick(row, source) : pick(row, source);
                        return (
                          <td key={f} className="r num" onClick={(e) => { e.stopPropagation(); setQuery({ f: f || null, w: typeof w === 'number' ? w : null }); }} style={{ cursor: 'pointer', fontWeight: f === flag && w === wear ? 700 : 400 }}>
                            {money(p, prices, currency)}
                            {row?.[1] != null && <div className="tiny faint">{row[1]} лотов</div>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ padding: '12px 18px', gap: 8, borderTop: '1px solid var(--border)' }}>
              <a className="btn small" target="_blank" rel="noreferrer" href={steamUrl(marketName(skin, flag, wear))}>Steam Market ↗</a>
              <a className="btn small" target="_blank" rel="noreferrer" href={skinportUrl(marketName(skin, flag, wear))}>Skinport ↗</a>
              {skin.phases && <span className="tiny faint">Steam не разделяет фазы Doppler — цены по фазам берутся со Skinport.</span>}
            </div>
            {(() => {
              // special pattern variants Skinport sells separately (Blue Gem, Fire & Ice, Max…)
              const ph = prices?.ph?.[skin.id];
              if (!ph) return null;
              const PH = new Set(['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Ruby', 'Sapphire', 'Black Pearl', 'Emerald']);
              const rows = Object.entries(ph)
                .filter(([name]) => !PH.has(name))
                .map(([name, v]) => ({ name, p: v[vk]?.[0] ?? v[vk]?.[2] ?? null, vol: (v[vk]?.[1] || 0) + (v[vk]?.[3] || 0) }))
                .filter((r) => r.p != null);
              if (!rows.length) return null;
              return (
                <div style={{ padding: '10px 18px 14px', borderTop: '1px solid var(--border)' }} className="stack small">
                  <b>Особые паттерны ({WEARS[wearIdx]?.short || ''}, медиана продаж Skinport)</b>
                  {rows.map((r) => <div key={r.name} className="row between"><span>{r.name}</span><span className="num">{money(r.p, prices, currency)} <span className="faint tiny">· {r.vol} продаж</span></span></div>)}
                </div>
              );
            })()}
          </div>

          {(craftLink || inputLink) && (
            <div className="card pad stack" style={{ gap: 10 }}>
              <h3>Крафт</h3>
              {craftNote && <p className="muted small">{craftNote}</p>}
              <div className="row">
                {craftLink && <a className="btn primary small" href={href(craftLink)}>Скрафтить этот скин</a>}
                {inputLink && <a className="btn small" href={href(inputLink)}>Использовать как вход</a>}
                <a className="btn small" href={href(`/craft?skin=${skin.id}`)}>Стикер-крафт</a>
              </div>
            </div>
          )}
        </div>
      </div>

      <NoPricesNotice prices={prices} />
      <div className="card pad stack">
        <div className="row between">
          <h2>История цены</h2>
          <span className="muted small">{marketName(skin, flag, wear)}</span>
        </div>
        <PriceChart hist={hist} vk={vk} prices={prices} />
      </div>

      {sameFinish.length > 0 && (
        <div className="stack">
          <div className="section-title"><h2>«{skin.fin}» на другом оружии</h2><span className="small muted">{sameFinish.length}</span></div>
          <div className="skin-grid">{sameFinish.map((s) => <SkinCard key={s.id} s={s} prices={prices} />)}</div>
        </div>
      )}
      {related.length > 0 && (
        <div className="stack">
          <div className="section-title"><h2>{cols[0] ? cols[0]!.name : `Другие ${skin.wpn}`}</h2>{cols[0] && <a className="link small" href={href(`/collection/${cols[0]!.id}`)}>Вся коллекция →</a>}</div>
          <div className="skin-grid">{related.slice(0, 18).map((s) => <SkinCard key={s.id} s={s} prices={prices} />)}</div>
        </div>
      )}
    </div>
  );
}
