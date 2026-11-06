import { useMemo, useState } from 'react';
import type { Skin } from '../lib/data';
import { findSeedTier, getFadePercentage, getFadeTable, getPatternInfo, NO_PATTERN_DIFFERENCE_RU } from '../lib/patterns';
import { href } from '../lib/router';
import { inspectHex, inspectLink } from '../lib/inspect';
import { copy } from '../lib/hooks';

/** Pattern section of a skin page: says plainly when the seed doesn't matter, otherwise offers a seed tool. */
export function PatternBlock({ skin, phase, float }: { skin: Skin; phase?: string; float?: number | null }) {
  const info = useMemo(() => getPatternInfo(skin.wpn, skin.fin), [skin]);
  const [seed, setSeed] = useState('');
  if (!info) return <div className="card pad muted" style={{ textAlign: 'center' }}>{NO_PATTERN_DIFFERENCE_RU}</div>;
  const n = seed.trim() === '' ? null : parseInt(seed, 10);
  return (
    <div className="card pad stack" style={{ gap: 10 }}>
      <div className="row between">
        <h3>Паттерн: {info.titleRu}{info.aliasRu ? <span className="muted" style={{ fontWeight: 500 }}> · {info.aliasRu}</span> : null}</h3>
        <a className="link small" href={href('/patterns')}>Все паттерны →</a>
      </div>
      <p className="small muted">{info.explanationRu}</p>
      {info.noteRu && <p className="tiny faint">{info.noteRu}</p>}

      {info.effectiveTool === 'fade' && <FadeTool weapon={skin.wpn} finish={skin.fin} seed={n} setSeed={setSeed} raw={seed} />}

      {info.effectiveTool === 'seedlist' && (
        <div className="stack" style={{ gap: 8 }}>
          <SeedInput raw={seed} setSeed={setSeed} />
          {n != null && !Number.isNaN(n) && (() => {
            const tier = findSeedTier(skin.wpn, skin.fin, n);
            return tier ? <div className="notice warn">Сид <b className="num">{n}</b>: <b>{tier.tierRu}</b>{tier.noteRu ? ` — ${tier.noteRu}` : ''}</div> : <div className="notice">Сид {n} не входит в известные списки редких паттернов.</div>;
          })()}
          {info.seedLists.map((l) => (
            <div key={l.id} className="small">
              <b>{l.tierRu}:</b> <span className="num muted">{l.seeds.join(', ')}</span>
            </div>
          ))}
        </div>
      )}

      {info.effectiveTool === 'phases' && (
        <div className="stack" style={{ gap: 6 }}>
          {info.phases.map((p) => (
            <div key={p.phase} className="row small" style={{ gap: 8, padding: '4px 8px', borderRadius: 8, background: p.phase === phase ? 'var(--accent-soft)' : undefined, flexWrap: 'nowrap' }}>
              <b style={{ width: 100, flex: 'none' }}>{p.titleRu}{p.isGem ? ' 💎' : ''}</b>
              <span className="muted grow">{p.descriptionRu}</span>
              <span className="num faint nowrap">{p.approxOdds ? `≈${p.approxOdds.minPercent}–${p.approxOdds.maxPercent}%` : '—'}</span>
            </div>
          ))}
          <p className="tiny faint">Фаза задаётся отдельным paint index, а сид меняет рисунок только внутри фазы. Шансы фаз Valve не публикует — это оценки сообщества.</p>
          <SeedInput raw={seed} setSeed={setSeed} />
        </div>
      )}

      <InspectRow skin={skin} phase={phase} seed={n != null && !Number.isNaN(n) ? Math.min(1000, n) : null} float={float} />
    </div>
  );
}

/** The picture above is Steam's one official icon for the skin — the same for every seed. The exact look of a
 *  seed is drawn only by the game, so we give an inspect link that opens this skin with this seed in CS2. */
function InspectRow({ skin, phase, seed, float }: { skin: Skin; phase?: string; seed: number | null; float?: number | null }) {
  const pi = (phase && skin.phases?.find((p) => p.ph === phase)?.pi) || skin.pi;
  if (!skin.wid || !pi) return null;
  const wear = float != null && !Number.isNaN(float) ? Math.min(skin.mx, Math.max(skin.mn, float)) : +(skin.mn + Math.min(0.01, (skin.mx - skin.mn) / 2)).toFixed(4);
  const item = seed == null ? null : { defindex: skin.wid, paintindex: pi, paintseed: seed, paintwear: wear, rarity: skin.gold ? 6 : Math.min(skin.rar, 7), quality: skin.gold ? 3 : 4 };
  return (
    <div className="pt-inspect stack" style={{ gap: 8 }}>
      <p className="small muted">Картинка вверху — официальная иконка Steam: она одна на все сиды, поэтому при выборе сида не меняется. Как выглядит именно этот сид, показывает сама игра — кнопка откроет CS2 сразу в окне осмотра этого скина.</p>
      {item ? (
        <div className="row" style={{ gap: 8 }}>
          <a className="btn primary small" href={inspectLink(item)}>Осмотреть сид {seed} в CS2 ↗</a>
          <button className="btn small ghost" onClick={() => copy('csgo_econ_action_preview ' + inspectHex(item), 'Команда скопирована — вставьте в консоль CS2')}>Команда для консоли</button>
          <span className="tiny faint">флоат {wear.toFixed(4)}</span>
        </div>
      ) : <span className="tiny faint">Введите сид или выберите один из списка — появится кнопка осмотра в игре.</span>}
    </div>
  );
}

function SeedInput({ raw, setSeed }: { raw: string; setSeed: (v: string) => void }) {
  return (
    <label className="row small" style={{ gap: 8 }}>
      <span className="muted">Сид паттерна (0–1000)</span>
      <input className="input small num" style={{ width: 90 }} inputMode="numeric" value={raw} placeholder="661" onChange={(e) => setSeed(e.target.value.replace(/\D/g, '').slice(0, 4))} />
    </label>
  );
}

function FadeTool({ weapon, finish, seed, setSeed, raw }: { weapon: string; finish: string; seed: number | null; setSeed: (v: string) => void; raw: string }) {
  const best = useMemo(() => {
    const t = getFadeTable(weapon, finish);
    if (!t) return [];
    return t.map((r, s) => ({ s, ...r })).sort((a, b) => b.percentage - a.percentage).slice(0, 8);
  }, [weapon, finish]);
  const r = seed != null && !Number.isNaN(seed) ? getFadePercentage(weapon, finish, seed) : null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <SeedInput raw={raw} setSeed={setSeed} />
      {r && (
        <div className="row" style={{ gap: 16 }}>
          <div className="kpi"><div className="label">Градиент</div><div className="value">{r.percentage.toFixed(1)}%</div></div>
          <div className="kpi"><div className="label">Место</div><div className="value">{r.ranking}</div><div className="tiny faint">с лучшего или худшего края</div></div>
        </div>
      )}
      {best.length > 0 && <div className="small muted">Лучшие сиды: {best.map((b) => <button key={b.s} className={'chip' + (seed === b.s ? ' on' : '')} style={{ margin: 2 }} onClick={() => setSeed(String(b.s))}>{b.s} · {b.percentage.toFixed(1)}%</button>)}</div>}
    </div>
  );
}
