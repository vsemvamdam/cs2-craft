import { useMemo, useState } from 'react';
import { DOPPLER_PHASES, FADE_SUPPORTED_WEAPONS, NOTABLE_SEEDS, PATTERN_FINISHES, findSeedTier, getFadePercentage, getFadeTable, type FadeFinish } from '../lib/patterns';
import { href } from '../lib/router';

export default function Patterns() {
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="stack" style={{ gap: 6, maxWidth: 900 }}>
        <h1>Паттерны</h1>
        <p className="muted">У каждого предмета есть сид паттерна от 0 до 1000: он задаёт, какой кусок текстуры ляжет на оружие. У большинства скинов разница незаметна, но у «Поверхностной закалки», «Градиента», «Мраморного градиента», «Волн» и ещё нескольких отделок от сида зависят цвет и рисунок — а значит и цена, иногда в десятки раз.</p>
      </div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <FadeCalc />
        <SeedLookup />
      </div>
      <DopplerTable />
      <div className="stack">
        <h2>Какие отделки зависят от паттерна</h2>
        <div className="feature-grid">
          {Object.values(PATTERN_FINISHES).map((f) => (
            <a key={f.finish} className="feature" href={href(`/skins?q=${encodeURIComponent(f.finish)}`)}>
              <div className="row between"><h3>{f.titleRu}</h3><span className="badge">{f.finish}</span></div>
              <p className="small muted">{f.explanationRu}</p>
              <span className="tiny faint">{f.weapons.length} предметов · {f.tool === 'fade' ? 'калькулятор %' : f.tool === 'phases' ? 'фазы' : f.tool === 'seedlist' ? 'списки сидов' : 'описание'}</span>
            </a>
          ))}
        </div>
      </div>
      <p className="tiny faint">Расчёт процента «Градиента» портирован из открытого csgo-fade-percentage-calculator (MIT). Списки сидов — только подтверждённые минимум двумя независимыми источниками сообщества.</p>
    </div>
  );
}

function FadeCalc() {
  const [finish, setFinish] = useState<FadeFinish>('Fade');
  const weapons = FADE_SUPPORTED_WEAPONS[finish];
  const [weapon, setWeapon] = useState('Karambit');
  const w = weapons.includes(weapon) ? weapon : weapons[0];
  const [seed, setSeed] = useState('412');
  const n = parseInt(seed, 10);
  const r = Number.isNaN(n) ? null : getFadePercentage(w, finish, n);
  const top = useMemo(() => {
    const t = getFadeTable(w, finish);
    return t ? t.map((x, s) => ({ s, ...x })).sort((a, b) => b.percentage - a.percentage).slice(0, 15) : [];
  }, [w, finish]);
  return (
    <div className="card pad stack">
      <h3>Калькулятор «Градиента» (Fade %)</h3>
      <div className="row">
        <div className="seg">{(Object.keys(FADE_SUPPORTED_WEAPONS) as FadeFinish[]).map((f) => <button key={f} className={finish === f ? 'on' : ''} onClick={() => setFinish(f)}>{f}</button>)}</div>
      </div>
      <div className="row">
        <select className="select grow" value={w} onChange={(e) => setWeapon(e.target.value)}>{weapons.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <input className="input num" style={{ width: 100 }} value={seed} inputMode="numeric" onChange={(e) => setSeed(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="сид" />
      </div>
      {r ? (
        <div className="kpis">
          <div className="kpi"><div className="label">Процент</div><div className="value">{r.percentage.toFixed(2)}%</div></div>
          <div className="kpi"><div className="label">Место</div><div className="value">{r.ranking}</div></div>
        </div>
      ) : <div className="notice">Введите сид от 0 до 1000.</div>}
      <div className="small muted">Топ сидов для {w} | {finish}:</div>
      <div className="row" style={{ gap: 4 }}>{top.map((t) => <button key={t.s} className={'chip' + (t.s === n ? ' on' : '')} onClick={() => setSeed(String(t.s))}>{t.s} · {t.percentage.toFixed(1)}%</button>)}</div>
    </div>
  );
}

function SeedLookup() {
  const items = useMemo(() => [...new Set(NOTABLE_SEEDS.map((l) => `${l.weapon}|${l.finish}`))], []);
  const [item, setItem] = useState(items[0] || '');
  const [seed, setSeed] = useState('');
  const [wpn, fin] = item.split('|');
  const lists = NOTABLE_SEEDS.filter((l) => l.weapon === wpn && l.finish === fin).sort((a, b) => a.rank - b.rank);
  const n = parseInt(seed, 10);
  const tier = Number.isNaN(n) ? null : findSeedTier(wpn, fin, n);
  return (
    <div className="card pad stack">
      <h3>Редкие сиды: blue gem, Fire &amp; Ice и др.</h3>
      <div className="row">
        <select className="select grow" value={item} onChange={(e) => setItem(e.target.value)}>
          {items.map((i) => { const [a, b] = i.split('|'); return <option key={i} value={i}>{a} | {PATTERN_FINISHES[b as keyof typeof PATTERN_FINISHES]?.titleRu || b}</option>; })}
        </select>
        <input className="input num" style={{ width: 100 }} value={seed} inputMode="numeric" onChange={(e) => setSeed(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="ваш сид" />
      </div>
      {seed && (tier ? <div className="notice warn">Сид <b className="num">{n}</b> — <b>{tier.tierRu}</b>{tier.noteRu ? `. ${tier.noteRu}` : ''}</div> : <div className="notice">Сид {seed} не входит в известные списки для этого предмета.</div>)}
      <div className="stack" style={{ gap: 6 }}>
        {lists.map((l) => (
          <div key={l.id} className="small">
            <b>{l.tierRu}</b>: <span className="num muted">{l.seeds.join(', ')}</span>
            {l.noteRu && <div className="tiny faint">{l.noteRu}</div>}
            <div className="tiny faint">Источники: {l.sources.slice(0, 3).map((s, i) => <a key={s} className="link" href={s} target="_blank" rel="noreferrer">{i ? ', ' : ''}{new URL(s).hostname.replace('www.', '')}</a>)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DopplerTable() {
  return (
    <div className="card">
      <div className="card-head"><h3>Фазы «Волн» (Doppler) и «Гамма-волн»</h3><span className="small muted">шансы — оценки сообщества, Valve их не публикует</span></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Отделка</th><th>Фаза</th><th>Как выглядит</th><th className="r">≈ Доля</th><th className="r">Paint index</th></tr></thead>
          <tbody>
            {DOPPLER_PHASES.map((p) => (
              <tr key={p.finish + p.phase}>
                <td className="nowrap">{p.finish === 'Doppler' ? 'Волны' : 'Гамма-волны'}</td>
                <td className="nowrap"><b>{p.titleRu}</b>{p.isGem ? ' 💎' : ''}</td>
                <td className="muted small">{p.descriptionRu}</td>
                <td className="r num">{p.approxOdds ? `${p.approxOdds.minPercent}–${p.approxOdds.maxPercent}%` : '—'}</td>
                <td className="r num small">{p.paintIndexes.slice(0, 3).join(', ')}{p.paintIndexes.length > 3 ? '…' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
