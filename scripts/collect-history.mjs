#!/usr/bin/env node
// Сбор полной истории цен Steam Market с обычного домашнего подключения.
// Steam отвечает 429 на все запросы истории с серверов GitHub, поэтому этот шаг делается на своём компьютере.
// Вход в Steam не нужен: история берётся со страницы предмета на торговой площадке (тот же график, что видят все).
// С ноября 2026 Steam по умолчанию показывает гостям бету нового маркета (без графика в странице) — скрипт
// отправляет ту же настройку, что ставит кнопка «Выйти из бета-теста торговой площадки» (cookie bMarketOptOut=1).
//
//   node collect-history.mjs                 # 600 самых продаваемых скинов, ~45 минут
//   node collect-history.mjs --limit 1500    # больше предметов — дольше (≈4 с на предмет)
//
// Нужен только Node.js 18+. Результат — файл cs2-history.json.gz рядом со скриптом; его можно прервать
// (Ctrl+C) и запустить снова — продолжит с места остановки. Готовый файл перетащите в чат (или загрузите
// в релиз репозитория), сайт импортирует его в историю цен.

import fs from 'node:fs';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const LIMIT = +opt('limit', 600);
let DELAY = +opt('delay', 5000);
const TIMEOUT = +opt('timeout', 25000);
const OUT = opt('out', 'cs2-history.json.gz');
const SITE = 'https://vsemvamdam.github.io/cs2-craft/data/history-targets.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s, n = 46) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const mmss = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`; };

function load() {
  try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(OUT)).toString()); } catch { return { v: 1, items: {} }; }
}
function save(db) {
  db.updated = new Date().toISOString();
  fs.writeFileSync(OUT + '.tmp', zlib.gzipSync(JSON.stringify(db)));
  fs.renameSync(OUT + '.tmp', OUT);
}
/** what is still to fetch: everything without a price history, except items Steam says don't exist (404) */
const pending = (it) => !it || !(it.p?.length || it.err === 404);

async function get(url) {
  return fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) cs2-craft history',
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: 'bMarketOptOut=1', // old market page: it has the price chart (var line1) in the HTML
    },
  });
}

async function main() {
  console.log('Загружаю список самых продаваемых скинов…');
  const targets = (await (await fetch(SITE, { signal: AbortSignal.timeout(TIMEOUT) })).json()).names.slice(0, LIMIT);
  const db = load();
  const todo = targets.filter((n) => pending(db.items[n]));
  console.log(`Всего ${targets.length}, уже собрано ${targets.length - todo.length}, осталось ${todo.length} (≈${mmss(todo.length * (DELAY + 700))}).`);
  if (!todo.length) return done(db);

  let stop = false;
  process.on('SIGINT', () => {
    if (stop) process.exit(130);
    stop = true;
    console.log('\nОстанавливаюсь, сохраняю собранное… (ещё раз Ctrl+C — выйти сразу)');
  });

  // first contact: say right away whether Steam answers at all
  console.log('Проверяю, отвечает ли steamcommunity.com…');

  let ok = 0, empty = 0, wait = 0, netErr = 0, emptyRun = 0, newMarket = 0;
  const t0 = Date.now();
  for (let i = 0; i < todo.length && !stop; i++) {
    const name = todo[i];
    const tag = `[${i + 1}/${todo.length}]`;
    const url = `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}`;
    let r;
    try {
      r = await get(url);
    } catch (e) {
      netErr++;
      const why = e.name === 'TimeoutError' ? `нет ответа за ${TIMEOUT / 1000} с` : (e.cause?.code || e.cause?.message || e.message);
      console.log(`${tag} ${short(name)} — ошибка сети: ${why}`);
      if (netErr >= 6) {
        save(db);
        console.log('\nsteamcommunity.com не отвечает 6 раз подряд. Проверьте, открывается ли в браузере');
        console.log('  https://steamcommunity.com/market/listings/730/AK-47%20%7C%20Redline%20(Field-Tested)');
        console.log('Если сайт открывается только с обходом блокировок (Zapret, VPN), он должен работать и для node.');
        console.log('Собранное сохранено — после проверки просто запустите скрипт снова.');
        process.exit(2);
      }
      await sleep(5000 * netErr);
      i--;
      continue;
    }
    netErr = 0;
    if (r.status === 429) {
      wait = Math.min((wait || 30000) * 2, 600000);
      DELAY = Math.min(DELAY + 1000, 12000); // go slower from now on
      console.log(`${tag} Steam просит подождать (429) — пауза ${Math.round(wait / 1000)} с, дальше по ${DELAY / 1000} с на предмет…`);
      save(db);
      await sleep(wait);
      i--;
      continue;
    }
    wait = 0;
    if (!r.ok) {
      db.items[name] = { err: r.status };
      console.log(`${tag} ${short(name)} — Steam ответил ${r.status}`);
    } else if (/\/listings\/730\/G\d/.test(r.url)) {
      // Steam ignored the opt-out and sent the new market (no chart in the page)
      newMarket = (newMarket || 0) + 1;
      db.items[name] = { p: [] };
      console.log(`${tag} ${short(name)} — Steam открыл новую версию маркета (без графика)`);
      if (newMarket >= 3 && ok === 0) {
        save(db);
        console.log('\nSteam больше не отдаёт старую страницу с графиком цен. Пришлите скриншот — нужен новый способ.');
        process.exit(3);
      }
    } else {
      const html = await r.text();
      const m = html.match(/var line1=(\[.*?\]);/s);
      const pre = (html.match(/var strFormatPrefix = "([^"]*)"/) || [])[1] || '';
      const suf = (html.match(/var strFormatSuffix = "([^"]*)"/) || [])[1] || '';
      let pts = null;
      if (m) try { pts = JSON.parse(m[1]); } catch { /* broken page */ }
      if (pts && pts.length) {
        db.items[name] = { cur: `${pre}|${suf}`, p: pts };
        ok++;
        emptyRun = 0;
        console.log(`${tag} ${short(name)} — ${pts.length} точек с ${String(pts[0][0]).slice(0, 11)}`);
      } else {
        // a page without the chart: either the item really has no sales or Steam served an error page — retry later
        db.items[name] = { p: [] };
        empty++;
        emptyRun++;
        const title = ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').trim();
        console.log(`${tag} ${short(name)} — на странице нет графика (${Math.round(html.length / 1024)} КБ, «${short(title || 'без заголовка', 60)}»)`);
        if (empty === 1) {
          // keep one sample so we can see what Steam actually sent
          try { fs.writeFileSync('debug-page.html', html); console.log('   образец страницы сохранён в debug-page.html'); } catch { /* read-only folder */ }
        }
        if (emptyRun === 8 && ok === 0) {
          console.log('\nУже 8 страниц подряд без графика цен. Возможно, Steam отдаёт заглушку вместо страницы предмета');
          console.log('(например, страницу блокировки провайдера или «ошибка, попробуйте позже»). Откройте ссылку выше в браузере');
          console.log('и проверьте, виден ли график. Скрипт продолжает работу; Ctrl+C — остановить.\n');
        }
      }
    }
    if ((i + 1) % 10 === 0) {
      save(db);
      const left = ((Date.now() - t0) / (i + 1)) * (todo.length - i - 1);
      console.log(`   … сохранено: с историей ${ok}, без графика ${empty}; осталось ≈${mmss(left)}`);
    }
    await sleep(DELAY + Math.random() * 700);
  }
  done(db, stop);
}

function done(db, stopped = false) {
  save(db);
  const all = Object.values(db.items);
  const good = all.filter((x) => x.p?.length).length;
  console.log(`\n${stopped ? 'Остановлено, при следующем запуске продолжу' : 'Готово'}: ${good} предметов с историей (из ${all.length}) в файле ${OUT}.`);
  if (good) console.log('Перетащите этот файл в чат или загрузите в релиз data-store.');
  else console.log('Ни одного графика не получено — пришлите скриншот вывода, разберёмся.');
}

main().catch((e) => { console.error('Ошибка:', e.cause?.code || e.message); process.exit(1); });
