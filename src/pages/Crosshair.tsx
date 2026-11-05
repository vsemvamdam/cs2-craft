import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_EXTRAS, DEFAULT_XH, PRESETS, PROS, PROS_CHECKED, STYLES, SWATCHES,
  autoexec, commandLines, commandsOneLine, decodeCode, encode, importAny, randomXH, rescale, sanitize, styleInfo,
  type Extras, type ImportResult, type XH,
} from '../lib/crosshair';
import {
  BACKGROUNDS, MOVE_STATES, RESOLUTIONS, isAnimated, monitorMap, motionAt, paintBackground, paintCrosshair, paintEnemy, paintImage, paintScope, resolution, scaled,
  type MoveState, type Resolution,
} from '../lib/crosshair-draw';
import { copy, toast, useLocal } from '../lib/hooks';
import { setQuery, useRoute } from '../lib/router';

type View = { res: string; zoom: number; bg: string; move: MoveState; enemy: boolean; scope: boolean };
const DEFAULT_VIEW: View = { res: '1080', zoom: 2, bg: 'wall', move: 'idle', enemy: false, scope: false };
const ZOOMS = [1, 2, 4, 8];
type OutFmt = 'line' | 'lines' | 'cfg';

export default function Crosshair() {
  const { query } = useRoute();
  const [viewRaw, setViewRaw] = useLocal<View>('cs2craft.crosshair.view', DEFAULT_VIEW);
  const view: View = { ...DEFAULT_VIEW, ...viewRaw };
  const setView = (p: Partial<View>) => setViewRaw({ ...view, ...p });
  const res = resolution(view.res);

  const [saved, setSaved] = useLocal<XH>('cs2craft.crosshair', DEFAULT_XH);
  const [ch, setChRaw] = useState<XH>(() => {
    const c = query.get('c');
    const r = c ? decodeCode(c, res.gh) : null;
    return r?.ok ? r.ch : sanitize(saved);
  });
  const setCh = (next: XH | ((p: XH) => XH)) => setChRaw((p) => sanitize(typeof next === 'function' ? next(p) : next));
  const upd = (p: Partial<XH>) => setCh((c) => ({ ...c, ...p }));
  useEffect(() => setSaved(ch), [ch]);

  const [ex, setExRaw] = useLocal<Extras>('cs2craft.crosshair.extra', DEFAULT_EXTRAS);
  const extras: Extras = { ...DEFAULT_EXTRAS, ...ex };
  const code = useMemo(() => encode(ch), [ch]);

  // share link: #/crosshair?c=<code> — load incoming codes, keep the address bar in sync with edits
  const qc = query.get('c');
  useEffect(() => {
    if (!qc || qc === code) return;
    const r = decodeCode(qc, res.gh);
    if (r.ok) { setChRaw(r.ch); toast('Прицел загружен по ссылке'); }
    else toast('Код в ссылке не распознан');
  }, [qc]);
  useEffect(() => {
    const t = window.setTimeout(() => { if (code && code !== qc) setQuery({ c: code }); }, 350);
    return () => clearTimeout(t);
  }, [code]);

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const onFile = (f: File | undefined) => {
    if (!f) return;
    const url = URL.createObjectURL(f); // stays in the browser, nothing is uploaded
    const im = new Image();
    im.onload = () => { setImg((old) => { if (old) URL.revokeObjectURL(old.src); return im; }); setView({ bg: 'img' }); };
    im.onerror = () => { URL.revokeObjectURL(url); toast('Не удалось открыть изображение'); };
    im.src = url;
  };
  const bg = view.bg === 'img' && !img ? 'wall' : view.bg;

  const [imp, setImp] = useState('');
  const [impRes, setImpRes] = useState<ImportResult | null>(null);
  const doImport = (text: string) => {
    const r = importAny(text, ch, res.gh);
    setImpRes(r);
    if (r.ok) {
      setChRaw(r.ch);
      if (r.extras && Object.keys(r.extras).length) setExRaw({ ...extras, ...r.extras });
      toast('Прицел импортирован');
    }
  };
  const applyCode = (c: string, label: string) => {
    const r = decodeCode(c, res.gh);
    if (r.ok) { setChRaw(r.ch); setImpRes({ ...r, kind: label }); toast(`Применён: ${label}`); }
  };

  const [fmt, setFmt] = useLocal<OutFmt>('cs2craft.crosshair.fmt', 'line');
  const out = fmt === 'cfg' ? autoexec(ch, extras) : fmt === 'lines' ? commandLines(ch, extras).join('\n') : commandsOneLine(ch, extras);
  const shareUrl = () => location.href.split('#')[0] + '#/crosshair?c=' + code;
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([autoexec(ch, extras)], { type: 'text/plain;charset=utf-8' }));
    a.download = 'autoexec.cfg';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const info = styleInfo(ch.style);
  const sz = scaled(ch, res.gh);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1>Генератор прицела CS2</h1>
        <p className="muted">Коды нового формата <span className="mono">CS…</span> (с 30.09.2026), размеры в пикселях, предпросмотр в реальном масштабе. Импорт старых кодов <span className="mono">CSGO-…</span> и команд консоли.</p>
      </div>

      <div className="xh-layout">
        <div className="xh-left">
          <div className="card xh-sticky" style={{ overflow: 'hidden' }}>
            <Preview ch={ch} view={{ ...view, bg }} res={res} img={img} extras={extras} />
            <div className="stack xh-toolbar">
              <div className="row" style={{ gap: 6 }}>
                {BACKGROUNDS.map((b) => <button key={b.k} type="button" className={'chip' + (bg === b.k ? ' on' : '')} onClick={() => setView({ bg: b.k })}>{b.ru}</button>)}
                <button type="button" className={'chip' + (bg === 'img' ? ' on' : '')} onClick={() => (img ? setView({ bg: 'img' }) : fileRef.current?.click())}>{img ? 'Мой скриншот' : 'Загрузить свой скриншот'}</button>
                {img && <button type="button" className="chip" onClick={() => fileRef.current?.click()} title="Выбрать другой файл">Другой файл…</button>}
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <select className="select small grow" style={{ minWidth: 200 }} value={res.k} onChange={(e) => setView({ res: e.target.value })} aria-label="Разрешение в игре">
                  {RESOLUTIONS.map((r) => <option key={r.k} value={r.k}>{r.ru}</option>)}
                </select>
                <Seg value={view.zoom} options={ZOOMS.map((z) => ({ k: z, ru: `×${z}` }))} onChange={(z) => setView({ zoom: z })} label="Масштаб" />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <Seg value={view.move} options={MOVE_STATES} onChange={(m) => setView({ move: m })} label="Состояние игрока" />
                <label className="check small"><input type="checkbox" checked={view.enemy} onChange={(e) => setView({ enemy: e.target.checked })} />Силуэт противника</label>
                <label className="check small"><input type="checkbox" checked={view.scope} onChange={(e) => setView({ scope: e.target.checked })} />Снайперский прицел</label>
              </div>
              <p className="tiny faint">
                ×1 — один пиксель игры как на обычном мониторе {res.mode === 'native' ? res.ru.split(' ')[0] : '1920×1080'}. В игре на высоте {res.gh} px: длина {sz.L}, толщина {sz.T}, зазор {sz.G} px.
                {info.dynamic || info.feedback || ch.followRecoil ? ' Разброс и отдача в режимах «Шаг/Бег/Прыжок/Спрей» показаны условно.' : ''}
                {bg === 'img' ? ' Скриншот не покидает ваш браузер.' : ''}
              </p>
            </div>
            <div className="stack xh-share">
              <div className="row between">
                <h3>Код для CS2</h3>
                <div className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn small" onClick={() => setChRaw(randomXH(res.gh))}>Случайный</button>
                  <button type="button" className="btn small" onClick={() => { setChRaw(sanitize(DEFAULT_XH)); toast('Сброшено к стандартному прицелу CS2'); }}>Сбросить</button>
                </div>
              </div>
              <div className="code xh-code">{code || '—'}</div>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn primary small" disabled={!code} onClick={() => copy(code, 'Код прицела скопирован')}>Копировать код</button>
                <button type="button" className="btn small" disabled={!code} onClick={() => copy(shareUrl(), 'Ссылка на прицел скопирована')}>Ссылка на прицел</button>
              </div>
              <p className="tiny faint">В игре: Настройки → вкладка прицела (Crosshair / Scopes) → импорт кода. Старые коды CSGO-… CS2 больше не принимает — вставьте их в поле «Импорт», мы переведём.</p>
            </div>
          </div>

        </div>

        <div className="stack">
          <div className="card pad stack" style={{ gap: 10 }}>
            <h3>Импорт</h3>
            <textarea
              className="input mono small" rows={3} value={imp}
              placeholder={'Код CS…, старый CSGO-… или команды:\ncl_crosshairsize 2; cl_crosshairgap -3; cl_crosshairthickness 0.5'}
              onChange={(e) => setImp(e.target.value)}
              onPaste={(e) => { const t = e.clipboardData.getData('text'); if (!imp.trim() && t.trim()) setTimeout(() => doImport(t), 0); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) doImport(imp); }}
              aria-label="Код прицела или команды консоли"
            />
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn primary small" onClick={() => doImport(imp)} disabled={!imp.trim()}>Применить</button>
              {imp && <button type="button" className="btn ghost small" onClick={() => { setImp(''); setImpRes(null); }}>Очистить</button>}
              <span className="tiny faint">Старые значения пересчитываются для выбранного разрешения ({res.gh} px).</span>
            </div>
            {impRes && !impRes.ok && <div className="notice bad small">{impRes.error}</div>}
            {impRes && impRes.ok && (
              <div className="notice small stack" style={{ gap: 4 }}>
                <b style={{ color: 'var(--text)' }}>{impRes.kind}</b>
                {impRes.notes.map((n, i) => <span key={i}>{n}</span>)}
              </div>
            )}
          </div>

          <div className="card pad stack" style={{ gap: 14 }}>
            <Section title="Стиль">
              <select className="select" value={ch.style} onChange={(e) => upd({ style: +e.target.value })} aria-label="Стиль прицела">
                <optgroup label="Статичные">{STYLES.filter((s) => !s.dynamic).map((s) => <option key={s.id} value={s.id}>{s.id} · {s.en} — {s.ru}</option>)}</optgroup>
                <optgroup label="Динамические">{STYLES.filter((s) => s.dynamic).map((s) => <option key={s.id} value={s.id}>{s.id} · {s.en} — {s.ru}</option>)}</optgroup>
              </select>
              <p className="small muted">{info.hint}</p>
              {info.approx && <p className="tiny warn">Форма этого стиля в предпросмотре приблизительная: Valve не публиковала его точную геометрию. Код и команды при этом точные.</p>}
            </Section>

            <Section title="Форма" note={`px при высоте ${ch.screenHeight}`}>
              <NumField label="Длина" cvar="cl_crosshair_length" value={ch.length} min={0} max={255} smax={40} onChange={(v) => upd({ length: v })} disabled={info.kind === 'dot' || info.kind === 'circle' || info.kind === 'square' || ch.style === 9} />
              <NumField label="Толщина" cvar="cl_crosshair_thickness" value={ch.thickness} min={0} max={32} smin={1} smax={12} onChange={(v) => upd({ thickness: v })} />
              <NumField label="Зазор" cvar="cl_crosshair_gap" value={ch.gap} min={-128} max={128} smin={-10} smax={30} onChange={(v) => upd({ gap: v })} disabled={info.kind === 'dot'} />
              {ch.gap < 0 && ch.style !== 2 && <p className="tiny warn">Отрицательный зазор CS2 применяет только к Dynamic Cross (Legacy) — у этого стиля он работает как 0.</p>}
              <div className="row" style={{ gap: 14 }}>
                <label className="check small"><input type="checkbox" checked={ch.centerDotEnabled} disabled={info.kind === 'dot'} onChange={(e) => upd({ centerDotEnabled: e.target.checked })} />Точка в центре</label>
                <label className="check small"><input type="checkbox" checked={ch.tStyleEnabled} disabled={!(info.kind === 'cross' || ch.style === 7)} onChange={(e) => upd({ tStyleEnabled: e.target.checked })} />T-образный</label>
                <label className="check small" title="cl_crosshair_recoil"><input type="checkbox" checked={ch.followRecoil} onChange={(e) => upd({ followRecoil: e.target.checked })} />Следует за отдачей</label>
              </div>
            </Section>

            <Section title="Цвет">
              <ColorRow r={ch.red} g={ch.green} b={ch.blue} onChange={(red, green, blue) => upd({ red, green, blue })} swatches />
              <NumField label="Непрозрачность" cvar="cl_crosshaircolor_a" value={ch.alpha} min={0} max={255} onChange={(v) => upd({ alpha: v })} />
            </Section>

            <Section title="Обводка" note="всегда 1 px">
              <Seg value={ch.outlineMode} options={[{ k: 0, ru: 'Нет' }, { k: 1, ru: 'Полная' }, { k: 2, ru: 'Половина', title: 'Только сверху и слева' }]} onChange={(v) => upd({ outlineMode: v })} label="Обводка" />
              <ColorRow r={ch.outlineRed} g={ch.outlineGreen} b={ch.outlineBlue} onChange={(outlineRed, outlineGreen, outlineBlue) => upd({ outlineRed, outlineGreen, outlineBlue })} disabled={!ch.outlineMode} />
              <NumField label="Непрозрачность" cvar="cl_crosshairoutline_a" value={ch.outlineAlpha} min={0} max={255} onChange={(v) => upd({ outlineAlpha: v })} disabled={!ch.outlineMode} />
              <p className="tiny faint">«Половина» рисует обводку только сверху и слева. Толщина обводки после обновления 23.09.2026 не настраивается.</p>
            </Section>

            {(info.dynamic || ch.style === 9) && (
              <Section title={ch.style === 9 ? 'Дуги' : 'Динамика'}>
                {info.dynamic && <NumField label="Предел раскрытия" cvar="cl_crosshair_dynamic_spread_limit" value={ch.dynamicSpreadLimit} min={0} max={255} onChange={(v) => upd({ dynamicSpreadLimit: v })} />}
                {info.split && <>
                  <NumField label="Дистанция разделения" cvar="cl_crosshair_dynamic_splitdist" value={ch.splitDistance} min={0} max={127} smax={40} onChange={(v) => upd({ splitDistance: v })} />
                  <NumField label="Прозр. внутренних" cvar="cl_crosshair_dynamic_splitalpha_innermod" value={ch.innerSplitAlpha} min={0} max={1} step={0.01} onChange={(v) => upd({ innerSplitAlpha: v })} />
                  <NumField label="Прозр. внешних" cvar="cl_crosshair_dynamic_splitalpha_outermod" value={ch.outerSplitAlpha} min={0.3} max={1} step={0.01} onChange={(v) => upd({ outerSplitAlpha: v })} />
                </>}
                {(info.split || ch.style === 9) && <NumField label={ch.style === 9 ? 'Размер дуг' : 'Доля внешних линий'} cvar="cl_crosshair_dynamic_maxdist_splitratio" value={ch.splitSizeRatio} min={0} max={1} step={0.01} onChange={(v) => upd({ splitSizeRatio: v })} />}
                {info.dynamic && <p className="tiny faint">Включите «Шаг», «Бег», «Прыжок» или «Спрей» над предпросмотром, чтобы увидеть, как раскрывается прицел.</p>}
              </Section>
            )}

            <Section title="Разрешение кода">
              <NumField label="Высота экрана" cvar="cl_crosshair_screen_height" value={ch.screenHeight} min={240} max={4320} smin={480} smax={2160} onChange={(v) => upd({ screenHeight: v })} />
              {ch.screenHeight !== res.gh ? (
                <div className="notice warn small stack" style={{ gap: 8 }}>
                  <span>Код рассчитан на высоту {ch.screenHeight} px, а предпросмотр — на {res.gh} px: CS2 масштабирует прицел ×{(res.gh / ch.screenHeight).toFixed(3).replace(/\.?0+$/, '')}.</span>
                  <button type="button" className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setChRaw(rescale(ch, res.gh))}>Пересчитать значения под {res.gh} px</button>
                </div>
              ) : <p className="tiny faint">Совпадает с выбранным разрешением — размеры в игре будут ровно такими, как в полях выше.</p>}
            </Section>

            <Section title="Точка в оптике AUG / SG 553" note="входит в код">
              <NumField label="Размер точки" cvar="cl_ironsight_dot_scale" value={ch.scopeDotScale} min={0.1} max={2} step={0.01} onChange={(v) => upd({ scopeDotScale: v })} />
              <label className="check small"><input type="checkbox" checked={ch.scopeDotUseCrosshairColor} onChange={(e) => upd({ scopeDotUseCrosshairColor: e.target.checked })} />Цвет как у прицела</label>
            </Section>

            <Section title="Снайперские винтовки" note="только консоль">
              <NumField label="Толщина линий прицела" cvar="cl_crosshair_sniper_width" value={extras.sniperWidth} min={0} max={20} onChange={(v) => setExRaw({ ...extras, sniperWidth: v })} />
              <p className="tiny faint">Не входит в код прицела — попадает только в команды и autoexec. В предпросмотре — флажок «Снайперский прицел».</p>
            </Section>
          </div>

          <div className="card pad stack" style={{ gap: 10 }}>
            <h3>Пресеты</h3>
            <div className="xh-presets">
              {PRESETS.map((p) => (
                <button key={p.name} type="button" className="xh-preset" onClick={() => { setChRaw(p.ch); setImpRes(null); toast(`Пресет «${p.name}»`); }}>
                  <Thumb ch={p.ch} />
                  <b className="small">{p.name}</b>
                  <span className="tiny faint">{p.note}</span>
                </button>
              ))}
            </div>
          </div>

          <ProsCard onApply={(c, name) => applyCode(c, `Прицел ${name}`)} />
        </div>
      </div>

      <div className="card pad stack" style={{ gap: 10 }}>
        <div className="row between">
          <h3>Команды консоли</h3>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn small primary" onClick={() => copy(out, fmt === 'cfg' ? 'autoexec скопирован' : 'Команды скопированы')}>Копировать</button>
            {fmt === 'cfg' && <button type="button" className="btn small" onClick={download}>Скачать autoexec.cfg</button>}
          </div>
        </div>
        <Seg value={fmt} options={[{ k: 'line', ru: 'Одной строкой' }, { k: 'lines', ru: 'Построчно' }, { k: 'cfg', ru: 'autoexec.cfg' }]} onChange={setFmt} label="Формат" />
        <div className="code" style={{ maxHeight: 220, overflow: 'auto' }}>{out}</div>
        <p className="tiny faint">
          {fmt === 'cfg'
            ? <>Сохраните как <span className="kbd">autoexec.cfg</span> в папку <span className="mono">…/Counter-Strike Global Offensive/game/csgo/cfg/</span> и добавьте в параметры запуска Steam <span className="kbd">+exec autoexec</span>.</>
            : <>Одну строку можно вставить в консоль (клавиша <span className="kbd">~</span>) целиком. <span className="mono">cl_crosshair_sniper_width</span> в код не входит — только командой.</>}
        </p>
      </div>

      <div className="card pad stack" style={{ gap: 8 }}>
        <h3>Как это устроено</h3>
        <ul className="small muted xh-notes">
          <li>С обновления 23.09.2026 длина, толщина и зазор — целые пиксели при высоте экрана <span className="mono">cl_crosshair_screen_height</span>. Если вы играете в другом разрешении, CS2 пересчитает прицел пропорционально — это видно, если выбрать другое разрешение в предпросмотре.</li>
          <li>Зазор — расстояние от центра до начала линии. При толщине 2 зазор 0 даёт сплошной плюс, зазор 1 — плюс с пустым центром.</li>
          <li>Старые коды <span className="mono">CSGO-…</span> и команды <span className="mono">cl_crosshairsize / cl_crosshairgap / cl_crosshairthickness</span> пересчитываются по формулам конвертера <a className="link" href="https://github.com/JDD310/CS2-Crosshair-Converter" target="_blank" rel="noreferrer">JDD310/CS2-Crosshair-Converter</a>: размер × высота / 480, зазор = 4 + gap + половина толщины. Результат может отличаться на 1 px — проверьте в игре.</li>
          <li>Предпросмотр рисует прицел попиксельно, как в игре: растянутое 4:3 показано так, как его видит монитор 1920×1080. Разброс и отдача в режимах движения — условная анимация, не реальные данные оружия.</li>
          <li>Кодирование кодов — библиотека <a className="link" href="https://github.com/akiver/csgo-sharecode" target="_blank" rel="noreferrer">csgo-sharecode</a> (MIT). Фоны предпросмотра сгенерированы процедурно.</li>
        </ul>
      </div>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="stack xh-section" style={{ gap: 10 }}>
      <div className="row between"><h4>{title}</h4>{note && <span className="tiny faint">{note}</span>}</div>
      {children}
    </section>
  );
}

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { k: T; ru: string; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg xh-seg" role="group" aria-label={label}>
      {options.map((o) => <button key={String(o.k)} type="button" title={o.title} className={value === o.k ? 'on' : ''} aria-pressed={value === o.k} onClick={() => onChange(o.k)}>{o.ru}</button>)}
    </div>
  );
}

function NumField({ label, cvar, value, min, max, step = 1, smin = min, smax = max, onChange, disabled }: {
  label: string; cvar?: string; value: number; min: number; max: number; step?: number; smin?: number; smax?: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  const id = useId();
  const [txt, setTxt] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setTxt(String(value)); }, [value]);
  const dec = step < 1 ? String(step).split('.')[1]?.length || 2 : 0;
  const norm = (v: number) => Number(Math.min(max, Math.max(min, Math.round(v / step) * step)).toFixed(dec));
  return (
    <div className={'xh-field' + (disabled ? ' off' : '')}>
      <label className="lbl" htmlFor={id}>
        <span>{label}</span>
        {cvar && <span className="cvar">{cvar}</span>}
      </label>
      <input type="range" min={smin} max={smax} step={step} value={Math.min(smax, Math.max(smin, value))} disabled={disabled} aria-label={label} onChange={(e) => onChange(norm(+e.target.value))} />
      <input
        id={id} className="input small num" type="number" min={min} max={max} step={step} disabled={disabled}
        inputMode={min < 0 ? undefined : 'decimal'} value={txt}
        onFocus={() => (focused.current = true)}
        onBlur={() => { focused.current = false; setTxt(String(value)); }}
        onChange={(e) => {
          setTxt(e.target.value);
          const v = parseFloat(e.target.value.replace(',', '.'));
          if (Number.isFinite(v)) onChange(norm(v));
        }}
      />
    </div>
  );
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
function ColorRow({ r, g, b, onChange, swatches, disabled }: { r: number; g: number; b: number; onChange: (r: number, g: number, b: number) => void; swatches?: boolean; disabled?: boolean }) {
  const hex = '#' + hex2(r) + hex2(g) + hex2(b);
  const ch = (v: string) => Math.max(0, Math.min(255, Math.round(+v || 0)));
  return (
    <div className={'stack' + (disabled ? ' xh-off' : '')} style={{ gap: 8 }}>
      {swatches && (
        <div className="row" style={{ gap: 6 }}>
          {SWATCHES.map((s) => {
            const on = s.rgb[0] === r && s.rgb[1] === g && s.rgb[2] === b;
            return <button key={s.ru} type="button" className={'xh-swatch' + (on ? ' on' : '')} title={s.ru} aria-label={s.ru} aria-pressed={on} style={{ background: `rgb(${s.rgb.join(',')})` }} onClick={() => onChange(...s.rgb)} />;
          })}
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <input type="color" className="xh-color" value={hex} disabled={disabled} aria-label="Цвет" onChange={(e) => { const v = e.target.value; onChange(parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)); }} />
        {(['R', 'G', 'B'] as const).map((k, i) => (
          <label key={k} className="row tiny muted" style={{ gap: 4, flexWrap: 'nowrap' }}>
            {k}
            <input className="input small num" style={{ width: 62 }} type="number" min={0} max={255} inputMode="numeric" disabled={disabled} value={[r, g, b][i]}
              onChange={(e) => { const c = [r, g, b]; c[i] = ch(e.target.value); onChange(c[0], c[1], c[2]); }} />
          </label>
        ))}
        <span className="mono tiny faint">{hex}</span>
      </div>
    </div>
  );
}

function ProsCard({ onApply }: { onApply: (code: string, name: string) => void }) {
  const pros = useMemo(() => PROS.map((p) => ({ ...p, r: decodeCode(p.code, 1080) })), []);
  return (
    <div className="card pad stack" style={{ gap: 10 }}>
      <div className="row between"><h3>Прицелы профи</h3><span className="tiny faint">проверено {PROS_CHECKED}</span></div>
      <div className="xh-presets">
        {pros.map((p) => p.r.ok && (
          <div key={p.name} className="xh-preset" role="button" tabIndex={0} onClick={() => onApply(p.code, p.name)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onApply(p.code, p.name); } }}>
            <Thumb ch={p.r.ch} />
            <b className="small">{p.name}</b>
            <span className="tiny faint">{p.team} · замечен {p.seen}</span>
            <a className="tiny link" href={p.source} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Источник</a>
          </div>
        ))}
      </div>
      <p className="tiny faint">Коды взяты со страниц игроков на crosshair.club (сайт считывает настройки из демок матчей). {PROS_CHECKED} мы проверили каждый: код декодируется и совпадает с командами на странице. Профи часто меняют прицел — перед копированием сверьтесь с источником. Большинство играет в 4:3 (высота 960 или 768), поэтому на 1080p эти прицелы масштабируются.</p>
    </div>
  );
}

/** small preview of a crosshair at 1080p, ×2 */
function Thumb({ ch }: { ch: XH }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const N = 44, Z = 2;
    const f = document.createElement('canvas');
    f.width = N; f.height = N;
    const g = f.getContext('2d')!;
    paintBackground(g, 'concrete', 960 - N / 2, 540 - N / 2, 1920, 1080);
    paintCrosshair(g, ch, 1080, N / 2, N / 2);
    c.width = N * Z; c.height = N * Z;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(f, 0, 0, N * Z, N * Z);
  }, [ch]);
  return <canvas ref={ref} className="xh-thumb" aria-hidden="true" />;
}

/** live preview: game frame at real pixel scale, scaled with nearest-neighbour by the zoom factor */
function Preview({ ch, view, res, img, extras }: { ch: XH; view: View; res: Resolution; img: HTMLImageElement | null; extras: Extras }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 640, h: 380 });
  const bgCache = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const frameRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.max(200, Math.round(el.clientWidth));
      let h = Math.min(440, Math.max(230, w * 0.58));
      // two-column layout: the sticky card (preview + toolbar + code) has to fit into the viewport
      if (window.innerWidth > 980) h = Math.min(h, Math.max(220, window.innerHeight - 540));
      h = Math.round(h);
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const DW = Math.round(size.w * dpr), DH = Math.round(size.h * dpr);
    if (cv.width !== DW) cv.width = DW;
    if (cv.height !== DH) cv.height = DH;
    const k = view.zoom * dpr; // device pixels per monitor pixel
    const { sx, sy, offX } = monitorMap(res);
    const hw = DW / (2 * k), hh = DH / (2 * k); // half of the visible monitor area
    const gcx = res.gw / 2, gcy = res.gh / 2;
    const ox = Math.max(0, Math.floor(gcx - hw / sx) - 2), oy = Math.max(0, Math.floor(gcy - hh / sy) - 2);
    const fw = Math.min(res.gw, Math.ceil(gcx + hw / sx) + 2) - ox, fh = Math.min(res.gh, Math.ceil(gcy + hh / sy) + 2) - oy;
    const key = [view.bg, res.k, ox, oy, fw, fh, view.enemy ? 1 : 0, view.bg === 'img' && img ? img.src : ''].join('|');
    if (!bgCache.current || bgCache.current.key !== key) {
      const c = document.createElement('canvas');
      c.width = fw; c.height = fh;
      const g = c.getContext('2d')!;
      if (view.bg === 'img' && img) paintImage(g, img, ox, oy, res.gw, res.gh);
      else paintBackground(g, view.bg, ox, oy, res.gw, res.gh);
      if (view.enemy) paintEnemy(g, ox, oy, res.gw, res.gh);
      bgCache.current = { key, canvas: c };
    }
    const bgc = bgCache.current.canvas;
    const frame = frameRef.current || (frameRef.current = document.createElement('canvas'));
    if (frame.width !== fw || frame.height !== fh) { frame.width = fw; frame.height = fh; }
    const fc = frame.getContext('2d')!;
    const ctx = cv.getContext('2d')!;
    const mx0 = res.mw / 2 - hw, my0 = res.mh / 2 - hh;
    const dx = Math.round((offX + ox * sx - mx0) * k), dy = Math.round((oy * sy - my0) * k);
    const dw = Math.round(fw * sx * k), dh = Math.round(fh * sy * k);
    const draw = (t: number) => {
      fc.drawImage(bgc, 0, 0);
      if (view.scope) paintScope(fc, res.gw, res.gh, ox, oy, extras.sniperWidth);
      else paintCrosshair(fc, ch, res.gh, gcx - ox, gcy - oy, motionAt(view.move, t, res.gh, ch.followRecoil));
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, DW, DH);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(frame, dx, dy, dw, dh);
    };
    if (view.scope || !isAnimated(view.move)) { draw(0); return; }
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => { draw((now - t0) / 1000); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ch, view.bg, view.zoom, view.move, view.enemy, view.scope, res, img, size, extras.sniperWidth]);

  return (
    <div ref={wrapRef} className="xh-canvas">
      <canvas ref={cvRef} style={{ height: size.h }} role="img" aria-label="Предпросмотр прицела" />
      <span className="xh-badge">{res.ru.split(',')[0]} · ×{view.zoom}</span>
    </div>
  );
}
