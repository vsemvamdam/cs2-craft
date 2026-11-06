import { useEffect, useState } from 'react';
import { copy, useLocal } from '../lib/hooks';
import { href, navigate, setQuery, useRoute } from '../lib/router';

const TABS = [
  { k: 'sens', ru: 'Сенса и eDPI' },
  { k: 'viewmodel', ru: 'Viewmodel' },
  { k: 'practice', ru: 'Конфиг для тренировки' },
  { k: 'binds', ru: 'Бинды' },
  { k: 'launch', ru: 'Параметры запуска' },
];

export default function Tools() {
  const { query } = useRoute();
  const tab = query.get('t') || 'sens';
  // the crosshair tool moved to its own page; keep old #/tools?t=crosshair links working
  useEffect(() => {
    if (tab === 'crosshair') navigate('/crosshair' + (query.get('c') ? '?c=' + encodeURIComponent(query.get('c')!) : ''), true);
  }, [tab]);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1>Утилиты CS2</h1>
        <p className="muted">Перевод сенсы, viewmodel, конфиги и бинды — всё работает прямо в браузере.</p>
      </div>
      <a className="feature" href={href('/crosshair')}>
        <span className="row" style={{ gap: 10 }}><span className="ic">🎯</span><h3>Генератор прицела</h3></span>
        <span className="small muted">Коды нового формата CS…, предпросмотр в реальном масштабе, импорт старых кодов CSGO-… и команд консоли, пресеты и прицелы профи — на отдельной странице.</span>
      </a>
      <div className="tabs">{TABS.map((t) => <button key={t.k} className={tab === t.k ? 'on' : ''} onClick={() => setQuery({ t: t.k })}>{t.ru}</button>)}</div>
      {tab === 'sens' && <SensTool />}
      {tab === 'viewmodel' && <ViewmodelTool />}
      {tab === 'practice' && <PracticeTool />}
      {tab === 'binds' && <BindsTool />}
      {tab === 'launch' && <LaunchTool />}
    </div>
  );
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
          <select aria-label="Игра" className="select" value={from} onChange={(e) => setFrom(e.target.value)}>{GAMES.map((g) => <option key={g.k} value={g.k}>{g.ru}</option>)}</select>
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
