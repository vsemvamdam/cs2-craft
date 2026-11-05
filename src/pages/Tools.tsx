import { useEffect, useMemo, useRef, useState } from 'react';
import { crosshairToConVars, decodeCrosshairShareCode, encodeCrosshair, type Crosshair, type CrosshairV1 } from 'csgo-sharecode';
import { copy, useLocal } from '../lib/hooks';
import { setQuery, useRoute } from '../lib/router';

const TABS = [
  { k: 'crosshair', ru: 'Прицел' },
  { k: 'sens', ru: 'Сенса и eDPI' },
  { k: 'viewmodel', ru: 'Viewmodel' },
  { k: 'practice', ru: 'Конфиг для тренировки' },
  { k: 'binds', ru: 'Бинды' },
  { k: 'launch', ru: 'Параметры запуска' },
];

export default function Tools() {
  const { query } = useRoute();
  const tab = query.get('t') || 'crosshair';
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1>Утилиты CS2</h1>
        <p className="muted">Прицел нового формата, перевод сенсы, viewmodel, конфиги и бинды — всё работает прямо в браузере.</p>
      </div>
      <div className="tabs">{TABS.map((t) => <button key={t.k} className={tab === t.k ? 'on' : ''} onClick={() => setQuery({ t: t.k })}>{t.ru}</button>)}</div>
      {tab === 'crosshair' && <CrosshairTool />}
      {tab === 'sens' && <SensTool />}
      {tab === 'viewmodel' && <ViewmodelTool />}
      {tab === 'practice' && <PracticeTool />}
      {tab === 'binds' && <BindsTool />}
      {tab === 'launch' && <LaunchTool />}
    </div>
  );
}

const DEFAULT_CH: CrosshairV1 = {
  format: 'cs2-v1', style: 4, followRecoil: false, centerDotEnabled: false, tStyleEnabled: false, outlineMode: 1,
  red: 0, green: 255, blue: 0, alpha: 255, outlineRed: 0, outlineGreen: 0, outlineBlue: 0, outlineAlpha: 255,
  gap: 2, length: 8, thickness: 2, dynamicSpreadLimit: 0, splitDistance: 7, innerSplitAlpha: 0, outerSplitAlpha: 1,
  splitSizeRatio: 1, screenHeight: 1080, scopeDotScale: 1, scopeDotUseCrosshairColor: false,
} as CrosshairV1;

function toV1(c: Crosshair): CrosshairV1 {
  if (c.format === 'cs2-v1') return c;
  const a: any = c;
  return {
    ...DEFAULT_CH,
    style: a.style ?? 4, followRecoil: !!a.followRecoil, centerDotEnabled: !!a.centerDotEnabled, tStyleEnabled: !!a.tStyleEnabled,
    outlineMode: a.outlineMode ?? (a.outlineEnabled ? 1 : 0), red: a.red, green: a.green, blue: a.blue, alpha: a.alpha ?? 255,
    gap: Math.round(a.gap ?? 0), length: Math.max(1, Math.round((a.length ?? 2) * 4)), thickness: Math.max(1, Math.round((a.thickness ?? 0.5) * 2)),
  };
}

function CrosshairTool() {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [ch, setCh] = useLocal<CrosshairV1>('cs2craft.crosshair', DEFAULT_CH);
  const [legacy, setLegacy] = useState(false);
  const [bg, setBg] = useState(0);
  const out = useMemo(() => { try { return encodeCrosshair(ch); } catch { return ''; } }, [ch]);
  const convars = useMemo(() => { try { return crosshairToConVars(ch); } catch { return ''; } }, [ch]);
  const load = (v: string) => {
    setCode(v);
    if (!v.trim()) return setErr('');
    try {
      const d = decodeCrosshairShareCode(v.trim());
      setLegacy(d.format !== 'cs2-v1');
      setCh(toV1(d));
      setErr('');
    } catch { setErr('Не похоже на код прицела. Новый формат — CS… (44 символа), старый — CSGO-XXXXX-…'); }
  };
  const num = (k: keyof CrosshairV1, label: string, min: number, max: number, step = 1) => (
    <label className="row small" style={{ gap: 10, flexWrap: 'nowrap' }}>
      <span className="muted" style={{ width: 150 }}>{label}</span>
      <input type="range" className="grow" min={min} max={max} step={step} value={ch[k] as number} onChange={(e) => setCh({ ...ch, [k]: +e.target.value })} />
      <span className="num" style={{ width: 40, textAlign: 'right' }}>{ch[k] as number}</span>
    </label>
  );
  const flag = (k: keyof CrosshairV1, label: string) => <label className="check small"><input type="checkbox" checked={!!ch[k]} onChange={(e) => setCh({ ...ch, [k]: e.target.checked })} />{label}</label>;
  const hex = '#' + [ch.red, ch.green, ch.blue].map((x) => x.toString(16).padStart(2, '0')).join('');
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div className="card pad stack">
        <h3>Импорт кода</h3>
        <input className="input" placeholder="Вставьте код прицела (CS… или CSGO-…)" value={code} onChange={(e) => load(e.target.value)} />
        {err && <div className="notice bad">{err}</div>}
        {legacy && !err && <div className="notice warn">Это код старого формата. С 30.09.2026 CS2 принимает только новые коды «CS…», а размеры теперь в пикселях — ниже он уже переведён, проверьте длину и толщину.</div>}
        <hr className="sep" />
        {num('style', 'Стиль (0–9)', 0, 9)}
        {num('length', 'Длина, px', 0, 40)}
        {num('thickness', 'Толщина, px', 1, 12)}
        {num('gap', 'Зазор, px', -10, 20)}
        {num('outlineMode', 'Обводка (0–2)', 0, 2)}
        {num('alpha', 'Прозрачность', 0, 255)}
        <label className="row small" style={{ gap: 10 }}>
          <span className="muted" style={{ width: 150 }}>Цвет</span>
          <input type="color" value={hex} onChange={(e) => { const v = e.target.value; setCh({ ...ch, red: parseInt(v.slice(1, 3), 16), green: parseInt(v.slice(3, 5), 16), blue: parseInt(v.slice(5, 7), 16) }); }} />
          {[['#00ff00', 'Зелёный'], ['#ffff00', 'Жёлтый'], ['#00ffff', 'Голубой'], ['#ff00ff', 'Розовый'], ['#ffffff', 'Белый']].map(([c, n]) => (
            <button key={c} className="btn small icon" title={n} style={{ width: 26, height: 26, background: c }} onClick={() => setCh({ ...ch, red: parseInt(c.slice(1, 3), 16), green: parseInt(c.slice(3, 5), 16), blue: parseInt(c.slice(5, 7), 16) })} />
          ))}
        </label>
        <div className="row">{flag('centerDotEnabled', 'Точка в центре')}{flag('tStyleEnabled', 'T-образный')}{flag('followRecoil', 'Следует за отдачей')}</div>
      </div>
      <div className="stack">
        <div className="card" style={{ overflow: 'hidden' }}>
          <CrosshairPreview ch={ch} bg={bg} />
          <div className="row" style={{ padding: 10, gap: 6 }}>
            {['Светлая стена', 'Тёмный угол', 'Небо'].map((n, i) => <button key={n} className={'chip' + (bg === i ? ' on' : '')} onClick={() => setBg(i)}>{n}</button>)}
          </div>
        </div>
        <div className="card pad stack" style={{ gap: 10 }}>
          <div className="row between"><h3>Код для CS2</h3><button className="btn small primary" disabled={!out} onClick={() => copy(out, 'Код прицела скопирован')}>Копировать</button></div>
          <div className="code">{out || '—'}</div>
          <p className="tiny faint">В игре: Настройки → Игра → Прицел → «Импорт кода».</p>
          <div className="row between"><h3>Команды консоли</h3><button className="btn small" disabled={!convars} onClick={() => copy(convars.replace(/\n/g, '; '))}>Копировать</button></div>
          <div className="code" style={{ maxHeight: 180, overflow: 'auto' }}>{convars}</div>
          <p className="tiny faint">Кодирование — библиотека csgo-sharecode (MIT, akiver).</p>
        </div>
      </div>
    </div>
  );
}

function CrosshairPreview({ ch, bg }: { ch: CrosshairV1; bg: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext('2d')!;
    const W = (c.width = 640), H = (c.height = 300);
    const grads = [['#b9b2a0', '#8e8673'], ['#2b2a2f', '#151518'], ['#9cc7e6', '#d9ecf7']];
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, grads[bg][0]); gr.addColorStop(1, grads[bg][1]);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const k = 2; // preview zoom (sizes are px at 1080p)
    const cx = W / 2, cy = H / 2;
    const len = ch.length * k, th = Math.max(1, ch.thickness * k), gap = ch.gap * k + th / 2;
    const color = `rgba(${ch.red},${ch.green},${ch.blue},${ch.alpha / 255})`;
    const rects: [number, number, number, number][] = [];
    rects.push([cx + gap, cy - th / 2, len, th]);
    rects.push([cx - gap - len, cy - th / 2, len, th]);
    rects.push([cx - th / 2, cy + gap, th, len]);
    if (!ch.tStyleEnabled) rects.push([cx - th / 2, cy - gap - len, th, len]);
    if (ch.centerDotEnabled) rects.push([cx - th / 2, cy - th / 2, th, th]);
    if (ch.outlineMode) {
      const o = ch.outlineMode * k * 0.5 + 1;
      g.fillStyle = `rgba(${ch.outlineRed},${ch.outlineGreen},${ch.outlineBlue},${ch.outlineAlpha / 255})`;
      for (const [x, y, w, h] of rects) g.fillRect(x - o, y - o, w + 2 * o, h + 2 * o);
    }
    g.fillStyle = color;
    for (const [x, y, w, h] of rects) g.fillRect(x, y, w, h);
  }, [ch, bg]);
  return <canvas ref={ref} style={{ width: '100%', display: 'block' }} />;
}

const GAMES = [
  { k: 'cs2', ru: 'CS2 / CS:GO', yaw: 0.022 },
  { k: 'val', ru: 'Valorant', yaw: 0.07 },
  { k: 'apex', ru: 'Apex Legends', yaw: 0.022 },
  { k: 'ow', ru: 'Overwatch 2', yaw: 0.0066 },
  { k: 'r6', ru: 'Rainbow Six Siege (×1)', yaw: 0.00572958 },
  { k: 'fn', ru: 'Fortnite', yaw: 0.5555 },
];

function SensTool() {
  const [dpi, setDpi] = useLocal('cs2craft.dpi', 800);
  const [sens, setSens] = useLocal('cs2craft.sens', 1.2);
  const [from, setFrom] = useState('cs2');
  const [fromSens, setFromSens] = useState(0.4);
  const edpi = dpi * sens;
  const cm360 = 41563.6 / edpi;
  const fromYaw = GAMES.find((g) => g.k === from)!.yaw;
  const csFrom = (fromSens * fromYaw) / 0.022;
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div className="card pad stack">
        <h3>eDPI и см/360°</h3>
        <div className="row"><label className="stack small" style={{ gap: 4 }}>DPI<input className="input num" type="number" value={dpi} onChange={(e) => setDpi(+e.target.value || 0)} /></label><label className="stack small" style={{ gap: 4 }}>Сенса в CS2<input className="input num" type="number" step="0.01" value={sens} onChange={(e) => setSens(+e.target.value || 0)} /></label></div>
        <div className="kpis">
          <div className="kpi"><div className="label">eDPI</div><div className="value">{Math.round(edpi)}</div></div>
          <div className="kpi"><div className="label">см на 360°</div><div className="value">{cm360.toFixed(1)}</div></div>
          <div className="kpi"><div className="label">Дюймов на 360°</div><div className="value">{(cm360 / 2.54).toFixed(1)}</div></div>
        </div>
        <p className="small muted">eDPI = DPI × сенса. Большинство профи играют в диапазоне 600–1200 eDPI (≈35–70 см на оборот).</p>
      </div>
      <div className="card pad stack">
        <h3>Перевод сенсы из другой игры</h3>
        <div className="row">
          <select className="select" value={from} onChange={(e) => setFrom(e.target.value)}>{GAMES.map((g) => <option key={g.k} value={g.k}>{g.ru}</option>)}</select>
          <input className="input num" type="number" step="0.001" value={fromSens} onChange={(e) => setFromSens(+e.target.value || 0)} />
        </div>
        <div className="kpi"><div className="label">Сенса в CS2 (тот же DPI)</div><div className="value">{csFrom.toFixed(3)}</div></div>
        <div className="table-wrap">
          <table className="table small">
            <thead><tr><th>Игра</th><th className="r">Ваша сенса CS2 {sens} →</th></tr></thead>
            <tbody>{GAMES.filter((g) => g.k !== 'cs2').map((g) => <tr key={g.k}><td>{g.ru}</td><td className="r num">{((sens * 0.022) / g.yaw).toFixed(3)}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="tiny faint">Перевод по углу поворота на единицу сенсы (yaw). Для Valorant: CS2 = Valorant × 3,182.</p>
      </div>
    </div>
  );
}

function ViewmodelTool() {
  const [vm, setVm] = useLocal('cs2craft.vm', { fov: 68, x: 2.5, y: 0, z: -1.5, preset: 0, bob: false });
  const cmd = `viewmodel_fov ${vm.fov}; viewmodel_offset_x ${vm.x}; viewmodel_offset_y ${vm.y}; viewmodel_offset_z ${vm.z}${vm.preset ? `; viewmodel_presetpos ${vm.preset}` : ''}`;
  const presets = [
    { n: 'Классика (по умолчанию)', v: { fov: 60, x: 1, y: 1, z: -1 } },
    { n: 'Минимальный (широкий обзор)', v: { fov: 68, x: 2.5, y: 0, z: -1.5 } },
    { n: 'Ближе к центру', v: { fov: 64, x: 0, y: 0, z: -1 } },
    { n: 'Низко и справа', v: { fov: 68, x: 2, y: 2, z: -2 } },
  ];
  const s = (k: 'fov' | 'x' | 'y' | 'z', label: string, min: number, max: number, step: number) => (
    <label className="row small" style={{ gap: 10, flexWrap: 'nowrap' }}><span className="muted" style={{ width: 110 }}>{label}</span><input type="range" className="grow" min={min} max={max} step={step} value={vm[k]} onChange={(e) => setVm({ ...vm, [k]: +e.target.value, preset: 0 })} /><span className="num" style={{ width: 40, textAlign: 'right' }}>{vm[k]}</span></label>
  );
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div className="card pad stack">
        <h3>Положение оружия</h3>
        {s('fov', 'FOV (54–68)', 54, 68, 1)}
        {s('x', 'Смещение X', -2.5, 2.5, 0.5)}
        {s('y', 'Смещение Y', -2, 2, 0.5)}
        {s('z', 'Смещение Z', -2, 2, 0.5)}
        <div className="row">{presets.map((p) => <button key={p.n} className="chip" onClick={() => setVm({ ...vm, ...p.v, preset: 0 })}>{p.n}</button>)}</div>
        <p className="tiny faint">Левая рука включается в настройках или клавишей H; старой команды cl_righthand в CS2 нет.</p>
      </div>
      <div className="card pad stack">
        <div className="row between"><h3>Команда</h3><button className="btn small primary" onClick={() => copy(cmd)}>Копировать</button></div>
        <div className="code">{cmd}</div>
        <ViewmodelSketch {...vm} />
      </div>
    </div>
  );
}

function ViewmodelSketch({ fov, x, y, z }: { fov: number; x: number; y: number; z: number }) {
  // schematic: bigger FOV pushes the weapon further away (smaller)
  const scale = 1.25 - (fov - 54) * 0.03;
  const left = 58 + x * 6, top = 52 - z * 7 + y * 2;
  return (
    <div style={{ position: 'relative', height: 200, borderRadius: 10, background: 'linear-gradient(#9aa7b4, #5f6a74)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: '50%', top: '42%', width: 10, height: 10, marginLeft: -5, borderRadius: '50%', border: '2px solid #0f0' }} />
      <svg viewBox="0 0 200 120" style={{ position: 'absolute', left: `${left}%`, top: `${top}%`, width: `${42 * scale}%`, transform: 'translate(-50%, 0)' }}>
        <path d="M10 70 L120 52 L190 48 L192 60 L130 66 L118 100 L96 104 L104 72 L20 86 Z" fill="#1c1f24" stroke="#000" strokeWidth="2" />
      </svg>
      <span className="tiny" style={{ position: 'absolute', left: 10, bottom: 8, color: '#fff' }}>Схема, не точный рендер</span>
    </div>
  );
}

function PracticeTool() {
  const [opt, setOpt] = useLocal('cs2craft.prac', { traj: true, infammo: true, impacts: true, bot: true, noflash: false, time: true, money: true, ladder: false });
  const lines = [
    'sv_cheats 1',
    'mp_warmup_end',
    'mp_freezetime 0',
    'mp_buytime 9999',
    'mp_buy_anywhere 1',
    opt.money && 'mp_maxmoney 60000; mp_startmoney 60000',
    opt.time && 'mp_roundtime_defuse 60; mp_roundtime 60; mp_restartgame 1',
    opt.infammo && 'sv_infinite_ammo 1',
    'ammo_grenade_limit_total 5',
    opt.traj && 'sv_grenade_trajectory_prac_pipreview 1; sv_grenade_trajectory_prac_trailtime 8',
    opt.impacts && 'sv_showimpacts 1; sv_showimpacts_time 10',
    opt.bot && 'bot_kick; bot_stop 1',
    opt.noflash && 'mp_flashbang_damage 0',
    'mp_limitteams 0; mp_autoteambalance 0',
  ].filter(Boolean).join('\n');
  const t = (k: keyof typeof opt, n: string) => <label className="check small"><input type="checkbox" checked={opt[k]} onChange={(e) => setOpt({ ...opt, [k]: e.target.checked })} />{n}</label>;
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div className="card pad stack">
        <h3>Что включить</h3>
        {t('traj', 'Траектория гранат и превью полёта')}
        {t('infammo', 'Бесконечные патроны и гранаты')}
        {t('impacts', 'Показывать попадания')}
        {t('time', 'Длинный раунд (60 минут)')}
        {t('money', 'Много денег и покупка где угодно')}
        {t('bot', 'Убрать ботов')}
        <p className="tiny faint">Запустите локальный сервер (Играть → Практика с ботами / Мастерская), откройте консоль и вставьте конфиг. Вместе с ним удобно использовать команды setpos/setang из раздела «Раскидки».</p>
      </div>
      <div className="card pad stack">
        <div className="row between"><h3>Конфиг</h3><button className="btn small primary" onClick={() => copy(lines.replace(/\n/g, '; '), 'Конфиг скопирован одной строкой')}>Копировать</button></div>
        <div className="code">{lines}</div>
        <p className="tiny faint">Можно сохранить как <span className="kbd">prac.cfg</span> в папку game/csgo/cfg и запускать командой <span className="kbd">exec prac</span>.</p>
      </div>
    </div>
  );
}

const BUY = [
  { k: 'ak47', n: 'AK-47 / M4' }, { k: 'awp', n: 'AWP' }, { k: 'vesthelm', n: 'Броня + шлем' }, { k: 'vest', n: 'Броня' },
  { k: 'smokegrenade', n: 'Дым' }, { k: 'flashbang', n: 'Флешка' }, { k: 'hegrenade', n: 'Граната' }, { k: 'molotov', n: 'Молотов / зажигательная' },
  { k: 'defuser', n: 'Набор сапёра' }, { k: 'deagle', n: 'Desert Eagle' }, { k: 'p250', n: 'P250' }, { k: 'mac10', n: 'MAC-10 / MP9' },
];
function BindsTool() {
  const [key, setKey] = useState('kp_end');
  const [items, setItems] = useState<string[]>(['ak47', 'vesthelm', 'smokegrenade', 'flashbang']);
  const buy = `bind "${key}" "${items.map((i) => `buy ${i}`).join('; ')}"`;
  const singles = [
    ['Прыжок на колесо мыши', 'bind mwheeldown +jump'],
    ['Голосовой чат по кнопке', 'bind "k" "+voicerecord"'],
    ['Очистить следы крови/декали', 'bind "n" "r_cleardecals"'],
    ['Быстрый переключатель громкости', 'bind "o" "toggle volume 0.1 0.6"'],
  ];
  return (
    <div className="grid cols-2" style={{ alignItems: 'start' }}>
      <div className="card pad stack">
        <h3>Бинд закупки</h3>
        <label className="row small">Клавиша <input className="input small" style={{ width: 120 }} value={key} onChange={(e) => setKey(e.target.value)} /> <span className="faint tiny">например kp_end, f1, kp_downarrow</span></label>
        <div className="row" style={{ gap: 6 }}>
          {BUY.map((b) => <button key={b.k} className={'chip' + (items.includes(b.k) ? ' on' : '')} onClick={() => setItems(items.includes(b.k) ? items.filter((x) => x !== b.k) : [...items, b.k])}>{b.n}</button>)}
        </div>
        <div className="code">{buy}</div>
        <button className="btn small primary" style={{ alignSelf: 'flex-start' }} onClick={() => copy(buy)}>Копировать</button>
      </div>
      <div className="card pad stack">
        <h3>Полезные одиночные бинды</h3>
        {singles.map(([n, c]) => <div key={c} className="row between small"><span>{n}</span><button className="btn small" onClick={() => copy(c)}><span className="mono">{c}</span></button></div>)}
        <div className="notice warn small">Jumpthrow-бинд в матчах не работает: с 19.08.2024 CS2 игнорирует бинды, где сразу несколько действий (прыжок + отпускание гранаты). Прыжок с броском в CS2 стабилен и без бинда; скрипт можно включить только на сервере с sv_cheats для тренировки.</div>
      </div>
    </div>
  );
}

function LaunchTool() {
  const opts = [
    ['-novid', 'Пропустить заставку при запуске'],
    ['-fullscreen', 'Полноэкранный режим'],
    ['-freq 240', 'Частота монитора (укажите свою)'],
    ['-console', 'Открывать консоль при старте'],
    ['+fps_max 0', 'Без ограничения FPS'],
    ['-allow_third_party_software', 'Разрешить программы, которые встраиваются в игру (например, захват игры в OBS)'],
    ['+exec autoexec', 'Выполнять autoexec.cfg при запуске'],
  ];
  const [on, setOn] = useLocal<string[]>('cs2craft.launch', ['-novid', '-console', '+exec autoexec']);
  const line = on.join(' ');
  return (
    <div className="card pad stack">
      <h3>Параметры запуска</h3>
      <p className="small muted">Steam → Библиотека → CS2 → Свойства → Общие → Параметры запуска.</p>
      {opts.map(([k, n]) => <label key={k} className="check small"><input type="checkbox" checked={on.includes(k)} onChange={(e) => setOn(e.target.checked ? [...on, k] : on.filter((x) => x !== k))} /><span className="mono">{k}</span> <span className="muted">— {n}</span></label>)}
      <div className="code">{line || '—'}</div>
      <button className="btn small primary" style={{ alignSelf: 'flex-start' }} onClick={() => copy(line)}>Копировать</button>
    </div>
  );
}
