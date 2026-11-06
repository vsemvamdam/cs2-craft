import { useEffect, useMemo, useState } from 'react';
import { FloatBar, Price, Spinner, NoPricesNotice, Updated, WearPicker, rarityColor } from '../components/ui';
import { norm, skinText } from '../components/Layout';
import { imgUrl, type Indexed, type Prices, type Skin } from '../lib/data';
import { copy, useDB, useDebounced, useLocal, usePrices } from '../lib/hooks';
import { PHASE_RU, RARITIES, WEARS, rarityName, wearOf } from '../lib/labels';
import { currencySymbol, fromCentsUSD, money, setPrefs, skinPrice, toCentsUSD, usePrefs, type Source } from '../lib/prefs';
import { href, setQuery, useRoute } from '../lib/router';
import { canBeInput, computeTradeUp, decodeContract, encodeContract, poolFor, wearThresholds, PHASE_PRESETS, type TUConfig, type TUInput, type TUResult } from '../lib/tradeup';

const FEES = [
  { k: 'steam', ru: 'Steam (−13%)', v: 1 - 1 / 1.15 },
  { k: 'skinport', ru: 'Skinport (−8%)', v: 0.08 },
  { k: 'none', ru: 'Без комиссии', v: 0 },
];
const pct = (x: number | null, d = 1) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`);

export default function TradeUp() {
  const db = useDB();
  const prices = usePrices();
  const prefs = usePrefs();
  const { query } = useRoute();
  const [saved, setSaved] = useLocal<TUConfig>('cs2craft.tradeup', { mode: 'weapon', st: false, inputs: [] });
  const [cfg, setCfg] = useState<TUConfig>(() => decodeContract(query.get('c')) || saved);
  const [fee, setFee] = useLocal('cs2craft.fee', 'steam');
  const [picker, setPicker] = useState(false);
  const [phases, setPhases] = useLocal('cs2craft.phases', 'community');

  useEffect(() => {
    const c = decodeContract(query.get('c'));
    if (c) setCfg(c);
  }, [query.get('c')]);
  useEffect(() => setSaved(cfg), [cfg]);

  const feeV = FEES.find((f) => f.k === fee)?.v ?? 0;
  const res = useMemo(() => (db ? computeTradeUp(db, prices, cfg, { source: prefs.source, fee: feeV, phases }) : null), [db, prices, cfg, prefs.source, feeV, phases]);
  if (!db || !res) return <Spinner />;

  const need = cfg.mode === 'gold' ? 5 : 10;
  const upd = (i: number, p: Partial<TUInput>) => setCfg((c) => ({ ...c, inputs: c.inputs.map((x, j) => (j === i ? { ...x, ...p } : x)) }));
  const remove = (i: number) => setCfg((c) => ({ ...c, inputs: c.inputs.filter((_, j) => j !== i) }));
  const dup = (i: number) => setCfg((c) => (c.inputs.length >= need ? c : { ...c, inputs: [...c.inputs.slice(0, i + 1), { ...c.inputs[i] }, ...c.inputs.slice(i + 1)] }));
  const fill = () => setCfg((c) => (c.inputs.length ? { ...c, inputs: [...c.inputs, ...Array.from({ length: need - c.inputs.length }, () => ({ ...c.inputs[c.inputs.length - 1] }))] } : c));
  const add = (s: Skin, n: number, float: number) =>
    setCfg((c) => ({ ...c, inputs: [...c.inputs, ...Array.from({ length: Math.min(n, need - c.inputs.length) }, () => ({ id: s.id, float: +Math.min(s.mx, Math.max(s.mn, float)).toFixed(5) }))] }));
  const share = () => copy(location.href.split('#')[0] + '#/tradeup?c=' + encodeContract(cfg), 'Ссылка на контракт скопирована');

  const best = res.outcomes.length ? Math.max(...res.outcomes.map((o) => o.price ?? 0)) : 0;
  const worst = res.outcomes.filter((o) => o.price != null).length ? Math.min(...res.outcomes.filter((o) => o.price != null).map((o) => o.price!)) : null;
  // float target: the loosest avg that keeps every outcome in its best wear
  const fnTarget = res.outcomes.length ? Math.min(...res.outcomes.map((o) => wearThresholds(o.skin)[0]?.maxAvg ?? 1)) : null;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <div className="stack" style={{ gap: 6 }}>
          <h1>Калькулятор крафтов</h1>
          <p className="muted">Контракты обмена CS2: шансы исходов, флоат результата, ожидаемая стоимость и окупаемость.</p>
        </div>
        <Updated prices={prices} />
      </div>
      <NoPricesNotice prices={prices} />

      <div className="card pad row between" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 10 }}>
          <div className="seg">
            <button className={cfg.mode === 'weapon' ? 'on' : ''} onClick={() => setCfg((c) => ({ ...c, mode: 'weapon', inputs: c.mode === 'weapon' ? c.inputs : [] }))}>Оружие · 10 → 1</button>
            <button className={cfg.mode === 'gold' ? 'on' : ''} onClick={() => setCfg((c) => ({ ...c, mode: 'gold', inputs: c.mode === 'gold' ? c.inputs : [] }))}>★ Ножи и перчатки · 5 → 1</button>
          </div>
          <label className="check"><input type="checkbox" checked={cfg.st} onChange={(e) => setCfg((c) => ({ ...c, st: e.target.checked }))} />StatTrak™</label>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <span className="small muted">Цены</span>
          <select aria-label="Источник цен" className="select small" value={prefs.source} onChange={(e) => setPrefs({ source: e.target.value as Source })}>
            <option value="steam">Steam</option>
            <option value="skinport">Skinport</option>
            <option value="best">Лучшая из двух</option>
          </select>
          <span className="small muted">Продажа</span>
          <select aria-label="Комиссия" className="select small" value={fee} onChange={(e) => setFee(e.target.value)}>
            {FEES.map((f) => <option key={f.k} value={f.k}>{f.ru}</option>)}
          </select>
          {cfg.mode === 'gold' && (
            <select aria-label="Шансы фаз Doppler" className="select small" value={phases} onChange={(e) => setPhases(e.target.value)} title="Шансы фаз Doppler">
              {Object.entries(PHASE_PRESETS).map(([k, v]) => <option key={k} value={k}>Фазы: {v.ru}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.15fr)', alignItems: 'start' }}>
        {/* inputs */}
        <div className="card">
          <div className="card-head">
            <h3>Входы <span className="muted num">{cfg.inputs.length}/{need}</span></h3>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn small" disabled={!cfg.inputs.length || cfg.inputs.length >= need} onClick={fill}>Заполнить копиями</button>
              <button className="btn small" onClick={share} disabled={!cfg.inputs.length}>Поделиться</button>
              <button className="btn small danger" onClick={() => setCfg((c) => ({ ...c, inputs: [] }))} disabled={!cfg.inputs.length}>Очистить</button>
            </div>
          </div>
          <div className="stack" style={{ gap: 0 }}>
            {res.inputs.map((info, i) => <InputRow key={i} info={info} prices={prices} i={i} upd={upd} remove={remove} dup={dup} canDup={cfg.inputs.length < need} />)}
            {cfg.inputs.length < need && (
              <button className="btn ghost" style={{ margin: 12, height: 56, borderStyle: 'dashed' }} onClick={() => setPicker(true)}>
                + Добавить {cfg.mode === 'gold' ? 'тайный предмет' : 'предмет'} ({need - cfg.inputs.length})
              </button>
            )}
          </div>
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)' }} className="stack small">
            <div className="row between"><span className="muted">Средний нормированный флоат</span><b className="num">{res.inputs.length ? res.avgNorm.toFixed(5) : '—'}</b></div>
            {fnTarget != null && (
              <div className="row between">
                <span className="muted">Чтобы все исходы были «{WEARS[0].ru}», нужно ≤</span>
                <b className={'num ' + (res.avgNorm <= fnTarget ? 'good' : 'warn')}>{fnTarget.toFixed(5)}</b>
              </div>
            )}
            <p className="tiny faint">Флоат каждого входа нормируется в его собственном диапазоне: (флоат − мин) / (макс − мин). Среднее переносится на диапазон результата.</p>
          </div>
        </div>

        {/* results */}
        <div className="stack">
          <div className="kpis">
            <div className="kpi"><div className="label">Стоимость входов</div><div className="value"><Price cents={res.cost} prices={prices} /></div></div>
            <div className="kpi"><div className="label">Ожидаемый возврат</div><div className="value"><Price cents={res.evNet} prices={prices} /></div><div className="tiny faint">после комиссии</div></div>
            <div className="kpi"><div className="label">Прибыль (EV)</div><div className={'value ' + (res.profit == null ? '' : res.profit >= 0 ? 'good' : 'bad')}><Price cents={res.profit} prices={prices} /></div><div className={'tiny ' + (res.roi != null && res.roi >= 0 ? 'good' : 'bad')}>{res.roi == null ? '' : `ROI ${res.roi >= 0 ? '+' : ''}${(res.roi * 100).toFixed(1)}%`}</div></div>
            <div className="kpi"><div className="label">Шанс профита</div><div className="value">{res.cost == null ? '—' : pct(res.profitChance)}</div><div className="tiny faint">{worst != null ? `от ${money(worst, prices, prefs.currency)} до ${money(best, prices, prefs.currency)}` : ''}</div></div>
          </div>
          {res.breakEven != null && <div className="small muted">Безубыточная средняя цена входа: <b className="num">{money(res.breakEven, prices, prefs.currency)}</b> · результат контракта получает 7-дневный запрет на обмен</div>}
          {res.valid && res.cost != null && res.evNet != null && <Simulation res={res} prices={prices} />}
          {(res.errors.length > 0 || res.warnings.length > 0) && (
            <div className="stack" style={{ gap: 8 }}>
              {res.errors.map((e) => <div key={e} className="notice bad">{e}</div>)}
              {res.warnings.map((w) => <div key={w} className="notice warn">{w}</div>)}
            </div>
          )}
          <div className="card">
            <div className="card-head"><h3>Возможные исходы <span className="muted num">{res.outcomes.length}</span></h3>{res.rarity != null && <span className="small muted">{rarityName(res.rarity)} → {cfg.mode === 'gold' ? '★ нож или перчатки' : RARITIES[res.rarity + 1]?.ru}{cfg.st ? ' · StatTrak™' : ''}</span>}</div>
            {res.outcomes.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Предмет</th><th className="r">Шанс</th><th className="r">Флоат</th><th className="r">Цена</th><th className="r">Итог</th></tr></thead>
                  <tbody>
                    {res.outcomes.map((o, i) => {
                      const delta = o.net != null && res.cost != null ? o.net - res.cost : null;
                      return (
                        <tr key={i} className="click" onClick={() => (location.hash = `#/skin/${o.skin.id}?w=${o.wear}&fl=${o.float.toFixed(4)}${cfg.st ? '&f=s' : ''}${o.phase ? '&ph=' + encodeURIComponent(o.phase) : ''}`)}>
                          <td>
                            <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                              <img className="thumb" src={imgUrl(o.skin.phases?.find((p) => p.ph === o.phase)?.img || o.skin.img, 128)} alt="" style={{ borderBottom: `2px solid ${rarityColor(o.skin)}` }} />
                              <div>
                                <div style={{ fontWeight: 600 }}>{cfg.st ? 'StatTrak™ ' : ''}{o.skin.name}{o.phase ? ` · ${PHASE_RU[o.phase] || o.phase}` : ''}</div>
                                <div className="tiny muted">{o.skin.vanilla ? 'Без износа' : WEARS[o.wear].ru}{o.cols.length ? ' · ' + o.cols.map((c) => db.colById.get(c)?.name.replace(/^The /, '').replace(/ Collection$/, '')).join(', ') : ''}</div>
                              </div>
                            </div>
                          </td>
                          <td className="r num">{pct(o.prob, o.prob < 0.01 ? 3 : 2)}</td>
                          <td className="r num">{o.float.toFixed(4)}</td>
                          <td className="r num" title={o.approx ? 'Цена соседнего износа' : undefined}>{o.approx ? '≈ ' : ''}{money(o.price, prices, prefs.currency)}</td>
                          <td className={'r num ' + (delta == null ? '' : delta >= 0 ? 'good' : 'bad')}>{delta == null ? '—' : (delta >= 0 ? '+' : '') + money(delta, prices, prefs.currency)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">Добавьте предметы — здесь появятся все возможные результаты с шансами и флоатом.</div>
            )}
          </div>
          <div className="card pad stack small" style={{ gap: 6 }}>
            <h3>Правила контрактов (ноябрь 2026)</h3>
            <p className="muted">• Оружие: 10 предметов одной редкости → 1 предмет следующей редкости из коллекций входов. Каждый вход — один «билет» своей коллекции.</p>
            <p className="muted">• Ножи и перчатки (с 23.10.2025): 5 тайных предметов → нож или перчатки из пула кейса одной из коллекций. StatTrak™ → только ножи StatTrak™ (перчаток StatTrak™ не бывает).</p>
            <p className="muted">• StatTrak™ нельзя смешивать с обычными. Сувенирные с 21.05.2026 можно класть вместе с обычными — результат всегда обычного качества.</p>
            <p className="muted">• Шанс исхода = Σ (1/{need} × 1/число предметов следующей редкости в коллекции входа).</p>
          </div>
        </div>
      </div>
      {picker && <Picker db={db} prices={prices} cfg={cfg} rarity={res.rarity} onAdd={add} onClose={() => setPicker(false)} />}
      <style>{`@media (max-width: 1000px){ .grid[style*="1.15fr"]{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

function InputRow({ info, prices, i, upd, remove, dup, canDup }: { info: ReturnType<typeof computeTradeUp>['inputs'][0]; prices: Prices | null; i: number; upd: (i: number, p: Partial<TUInput>) => void; remove: (i: number) => void; dup: (i: number) => void; canDup: boolean }) {
  const { currency } = usePrefs();
  const s = info.skin;
  const [f, setF] = useState(String(info.input.float));
  useEffect(() => setF(String(info.input.float)), [info.input.float]);
  if (!s) return <div className="row" style={{ padding: '10px 18px' }}><span className="bad">Неизвестный предмет</span><button className="btn small" onClick={() => remove(i)}>×</button></div>;
  const wear = wearOf(info.input.float);
  const setFloat = (v: number) => { setF(String(v)); upd(i, { float: v }); };
  return (
    <div className="tu-row">
      <a href={href(`/skin/${s.id}`)}><img className="thumb" src={imgUrl(s.img, 128)} alt="" style={{ borderBottom: `2px solid ${rarityColor(s)}` }} /></a>
      <div className="tu-main">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.name}>{s.name}</div>
          <div className="tiny muted">{WEARS[wear].ru} · диапазон {s.mn.toFixed(2)}–{s.mx.toFixed(2)} · норм. <span className="num">{info.norm.toFixed(3)}</span>{info.problems.length ? <span className="bad"> · {info.problems[0]}</span> : null}</div>
        </div>
      </div>
      <div className="tu-actions">
        <PriceInput cents={info.price} overridden={info.input.price != null} prices={prices} currency={currency} onChange={(c) => upd(i, { price: c })} />
        <label className="check tiny" title="Сувенирная версия"><input type="checkbox" checked={!!info.input.sv} onChange={(e) => upd(i, { sv: e.target.checked })} />SV</label>
        <button className="btn small icon" style={{ width: 30 }} title="Копия" disabled={!canDup} onClick={() => dup(i)}>⧉</button>
        <button className="btn small icon danger" style={{ width: 30 }} title="Убрать" onClick={() => remove(i)}>×</button>
      </div>
      <div className="tu-float">
        <WearPicker select value={info.input.float} min={s.mn} max={s.mx} onChange={setFloat} />
        <FloatBar compact value={info.input.float} min={s.mn} max={s.mx} onChange={setFloat} />
        <input className="input small num" value={f} title="Точный флоат" inputMode="decimal"
          onChange={(e) => { setF(e.target.value); const v = parseFloat(e.target.value.replace(',', '.')); if (!Number.isNaN(v)) upd(i, { float: Math.min(s.mx, Math.max(s.mn, v)) }); }}
          onBlur={() => setF(String(info.input.float))} />
      </div>
    </div>
  );
}

function PriceInput({ cents, overridden, prices, currency, onChange }: { cents: number | null; overridden: boolean; prices: Prices | null; currency: any; onChange: (c: number | null) => void }) {
  const [v, setV] = useState('');
  const [edit, setEdit] = useState(false);
  if (!edit)
    return (
      <button className="btn small num" style={{ width: 96, justifyContent: 'flex-end', color: overridden ? 'var(--accent)' : undefined }} title={overridden ? 'Своя цена (нажмите, чтобы изменить)' : 'Цена рынка (нажмите, чтобы указать свою)'} onClick={() => { setV(cents != null ? fromCentsUSD(cents, prices, currency).toFixed(2) : ''); setEdit(true); }}>
        {money(cents, prices, currency)}
      </button>
    );
  const done = () => {
    setEdit(false);
    const n = parseFloat(v.replace(',', '.'));
    onChange(v.trim() === '' || Number.isNaN(n) ? null : toCentsUSD(n, prices, currency));
  };
  return <input autoFocus className="input small num" style={{ width: 96 }} value={v} placeholder={currencySymbol(currency)} onChange={(e) => setV(e.target.value)} onBlur={done} onKeyDown={(e) => e.key === 'Enter' && done()} />;
}

function Picker({ db, prices, cfg, rarity, onAdd, onClose }: { db: Indexed; prices: Prices | null; cfg: TUConfig; rarity: number | null; onAdd: (s: Skin, n: number, f: number) => void; onClose: () => void }) {
  const { source, currency } = usePrefs();
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 150);
  const [rar, setRar] = useState<number>(rarity ?? (cfg.mode === 'gold' ? 6 : 3));
  const [col, setCol] = useState('');
  const [float, setFloat] = useState('0.06');
  const [n, setN] = useState(1);
  const [sort, setSort] = useState<'price' | 'name' | 'rar'>('price');
  const [desc, setDesc] = useState(false);
  // a second click on the active sort flips it; rarity starts from the rarest (red → pink → purple → blue…)
  const pickSort = (k: 'price' | 'name' | 'rar') => { if (k === sort) setDesc(!desc); else { setSort(k); setDesc(false); } };
  // ↓ = from the largest (most expensive / rarest / Я), ↑ = from the smallest — same as the players table
  const arrow = (k: string) => (k !== sort ? '' : (k === 'rar') !== desc ? ' ↓' : ' ↑');
  const fl = Math.max(0, Math.min(1, parseFloat(float.replace(',', '.')) || 0));
  const flag = cfg.st ? 's' : '';
  const list = useMemo(() => {
    const words = norm(dq).split(' ').filter(Boolean);
    const out = db.skins.filter((s) => {
      if (!canBeInput(s, cfg.mode)) return false;
      if (rar && s.rar !== rar) return false;
      if (cfg.st && !s.st) return false;
      if (col && !s.col.includes(col)) return false;
      if (!poolFor(db, s, cfg.mode, cfg.st).pool.length) return false;
      if (words.length) { const nm = skinText(s); if (!words.every((w) => nm.includes(w))) return false; }
      return true;
    });
    const price = (s: Skin) => skinPrice(prices, s, flag, wearOf(Math.min(s.mx, Math.max(s.mn, fl))), source);
    const rows = out.map((s) => ({ s, p: price(s) }));
    const byPrice = (a: { p: number | null | undefined }, b: { p: number | null | undefined }) => (a.p ?? 1e12) - (b.p ?? 1e12);
    const sign = desc ? -1 : 1;
    if (sort === 'price') rows.sort((a, b) => sign * byPrice(a, b));
    else if (sort === 'rar') rows.sort((a, b) => sign * (b.s.rar - a.s.rar) || byPrice(a, b));
    else rows.sort((a, b) => sign * a.s.name.localeCompare(b.s.name));
    return rows.slice(0, 300);
  }, [db, prices, dq, rar, col, fl, cfg.mode, cfg.st, sort, desc, source]);
  const cols = useMemo(() => db.collections.filter((c) => (cfg.mode === 'gold' ? c.gold.length : rar ? (db.colTiers.get(c.id)?.get(rar + 1) || []).length : [2, 3, 4, 5, 6].some((r) => (db.colTiers.get(c.id)?.get(r) || []).length))).sort((a, b) => a.name.localeCompare(b.name)), [db, cfg.mode, rar]);
  const lockedRar = rarity != null;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h3>Добавить предмет</h3>
          <button className="btn small icon" onClick={onClose}>×</button>
        </div>
        <div style={{ padding: 16 }} className="stack">
          <div className="row">
            <input autoFocus className="input grow" placeholder="Название скина…" value={q} onChange={(e) => setQ(e.target.value)} />
            {cfg.mode === 'weapon' && (
              <select aria-label="Редкость" className="select" value={rar} disabled={lockedRar} onChange={(e) => setRar(+e.target.value)} title={lockedRar ? 'Редкость задана первым предметом' : ''}>
                {!lockedRar && <option value={0}>Все редкости</option>}
                {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{RARITIES[r].ru}</option>)}
              </select>
            )}
            <select aria-label="Коллекция" className="select" value={col} onChange={(e) => setCol(e.target.value)} style={{ maxWidth: 260 }}>
              <option value="">Все коллекции</option>
              {cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <span className="small muted">Качество</span>
            <WearPicker full value={fl} onChange={(v) => setFloat(String(v))} />
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
            <span className="small muted">Флоат</span>
            <FloatBar compact value={fl} onChange={(v) => setFloat(String(v))} />
            <input className="input small num" style={{ width: 80 }} value={float} inputMode="decimal" onChange={(e) => setFloat(e.target.value)} />
          </div>
          <div className="row">
            <span className="small muted">Количество</span>
            <div className="seg">{[1, 5, 10].filter((x) => x <= (cfg.mode === 'gold' ? 5 : 10)).map((x) => <button key={x} className={n === x ? 'on' : ''} onClick={() => setN(x)}>×{x}</button>)}</div>
            <span className="small muted">Сортировка</span>
            <div className="seg" title="Ещё клик по выбранной — в обратную сторону">
              <button className={sort === 'price' ? 'on' : ''} onClick={() => pickSort('price')}>Цена{arrow('price')}</button>
              {cfg.mode === 'weapon' && <button className={sort === 'rar' ? 'on' : ''} onClick={() => { pickSort('rar'); if (!lockedRar && sort !== 'rar') setRar(0); }}>Редкость{arrow('rar')}</button>}
              <button className={sort === 'name' ? 'on' : ''} onClick={() => pickSort('name')}>Имя{arrow('name')}</button>
            </div>
          </div>
          <div className="table-wrap" style={{ maxHeight: '56vh' }}>
            <table className="table">
              <tbody>
                {list.map(({ s, p }) => {
                  const f = Math.min(s.mx, Math.max(s.mn, fl));
                  return (
                    <tr key={s.id} className="click" onClick={() => { onAdd(s, n, f); onClose(); }}>
                      <td style={{ width: 70 }}><img className="thumb" src={imgUrl(s.img, 128)} alt="" style={{ borderBottom: `2px solid ${rarityColor(s)}` }} /></td>
                      <td><div style={{ fontWeight: 600 }}>{s.name}</div><div className="tiny muted">{s.col.map((c) => db.colById.get(c)?.name).join(', ')} · {s.mn.toFixed(2)}–{s.mx.toFixed(2)}</div></td>
                      <td className="r num nowrap">{WEARS[wearOf(f)].short} {f.toFixed(3)}</td>
                      <td className="r num nowrap">{money(p, prices, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!list.length && <div className="empty">Ничего не найдено</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Simulation({ res, prices }: { res: TUResult; prices: Prices | null }) {
  const { currency } = usePrefs();
  const [sim, setSim] = useState<{ n: number; profit: number; wins: number; best: number; worst: number; hist: number[]; lo: number; hi: number } | null>(null);
  const run = () => {
    const outs = res.outcomes.filter((o) => o.net != null);
    const cum: number[] = [];
    let acc = 0;
    for (const o of outs) cum.push((acc += o.prob));
    const n = 1000;
    const vals: number[] = [];
    for (let i = 0; i < n; i++) {
      const r = Math.random() * acc;
      const o = outs[cum.findIndex((c) => c >= r)] || outs[outs.length - 1];
      vals.push((o.net || 0) - (res.cost || 0));
    }
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const bins = 24;
    const hist = new Array(bins).fill(0);
    for (const v of vals) hist[Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo || 1)) * bins))]++;
    setSim({ n, profit: vals.reduce((a, b) => a + b, 0), wins: vals.filter((v) => v > 0).length, best: hi, worst: lo, hist, lo, hi });
  };
  return (
    <div className="card pad stack" style={{ gap: 10 }}>
      <div className="row between">
        <h3>Симуляция 1000 контрактов</h3>
        <button className="btn small" onClick={run}>{sim ? 'Ещё раз' : 'Запустить'}</button>
      </div>
      {sim && (
        <>
          <div className="row small" style={{ gap: 18 }}>
            <span>Итог: <b className={'num ' + (sim.profit >= 0 ? 'good' : 'bad')}>{money(sim.profit, prices, currency)}</b></span>
            <span>В плюс: <b className="num">{((sim.wins / sim.n) * 100).toFixed(1)}%</b></span>
            <span>Лучший: <b className="num good">{money(sim.best, prices, currency)}</b></span>
            <span>Худший: <b className="num bad">{money(sim.worst, prices, currency)}</b></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 70 }}>
            {sim.hist.map((h, i) => {
              const mid = sim.lo + ((i + 0.5) / sim.hist.length) * (sim.hi - sim.lo);
              return <div key={i} title={`${money(mid, prices, currency)}: ${h}`} style={{ flex: 1, height: `${(h / Math.max(...sim.hist)) * 100}%`, minHeight: h ? 2 : 0, background: mid >= 0 ? 'var(--good)' : 'var(--bad)', opacity: 0.8, borderRadius: 2 }} />;
            })}
          </div>
        </>
      )}
    </div>
  );
}
