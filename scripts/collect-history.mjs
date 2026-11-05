#!/usr/bin/env node
// Сбор полной истории цен Steam Market с обычного домашнего подключения.
// Steam отвечает 429 на все запросы истории с серверов GitHub, поэтому этот шаг делается на своём компьютере.
// Вход в Steam не нужен: история берётся со страницы предмета на торговой площадке (тот же график, что видят все).
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
const DELAY = +opt('delay', 3500);
const OUT = opt('out', 'cs2-history.json.gz');
const SITE = 'https://vsemvamdam.github.io/cs2-craft/data/history-targets.json';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function load() {
  try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(OUT)).toString()); } catch { return { v: 1, items: {} }; }
}
function save(db) {
  db.updated = new Date().toISOString();
  fs.writeFileSync(OUT + '.tmp', zlib.gzipSync(JSON.stringify(db)));
  fs.renameSync(OUT + '.tmp', OUT);
}

async function main() {
  console.log('Загружаю список самых продаваемых скинов…');
  const targets = (await (await fetch(SITE)).json()).names.slice(0, LIMIT);
  const db = load();
  const todo = targets.filter((n) => !db.items[n]);
  console.log(`Всего ${targets.length}, уже собрано ${targets.length - todo.length}, осталось ${todo.length} (≈${Math.round((todo.length * (DELAY + 700)) / 60000)} мин).`);
  let ok = 0, fail = 0, wait = 0;
  for (let i = 0; i < todo.length; i++) {
    const name = todo[i];
    const url = `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}`;
    let r;
    try {
      r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) cs2-craft history', 'Accept-Language': 'en-US,en;q=0.9' } });
    } catch (e) { fail++; await sleep(10000); continue; }
    if (r.status === 429) {
      wait = Math.min((wait || 30000) * 2, 600000);
      console.log(`Steam просит подождать — пауза ${Math.round(wait / 1000)} с…`);
      await sleep(wait);
      i--;
      continue;
    }
    wait = 0;
    if (!r.ok) { fail++; db.items[name] = { err: r.status }; continue; }
    const html = await r.text();
    const m = html.match(/var line1=(\[.*?\]);/s);
    const pre = (html.match(/var strFormatPrefix = "([^"]*)"/) || [])[1] || '';
    const suf = (html.match(/var strFormatSuffix = "([^"]*)"/) || [])[1] || '';
    if (!m) { db.items[name] = { p: [] }; fail++; }
    else {
      try {
        db.items[name] = { cur: `${pre}|${suf}`, p: JSON.parse(m[1]) };
        ok++;
      } catch { db.items[name] = { p: [] }; fail++; }
    }
    if ((ok + fail) % 25 === 0) { save(db); console.log(`${i + 1}/${todo.length}: собрано ${ok}, без истории ${fail}`); }
    await sleep(DELAY + Math.random() * 700);
  }
  save(db);
  console.log(`Готово: ${Object.keys(db.items).length} предметов в ${OUT}. Перетащите этот файл в чат.`);
}
main().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
