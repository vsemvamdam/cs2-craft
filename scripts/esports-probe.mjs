#!/usr/bin/env node
// Временный зонд: сохраняет сырые ответы источников, чтобы написать по ним разбор.
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = process.argv[2] || 'probe';
await fs.mkdir(OUT, { recursive: true });
const UA = 'CS2CRAFT-esports/0.1 (https://github.com/vsemvamdam/cs2-craft)';
const LP = 'https://liquipedia.net/counterstrike/api.php';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, file, headers = {}) {
  const t = Date.now();
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip', ...headers } });
    const body = await r.text();
    await fs.writeFile(path.join(OUT, file), body);
    console.log(file, r.status, body.length, 'bytes', Date.now() - t, 'ms', r.headers.get('content-encoding') || '');
    return body;
  } catch (e) {
    console.log(file, 'ERR', e.message);
    return '';
  }
}
const lp = (params) => LP + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params });

await get(lp({ action: 'parse', page: 'Liquipedia:Matches', prop: 'text' }), 'lp-matches.json');
await sleep(3000);
await get(lp({ action: 'query', prop: 'info', titles: 'Liquipedia:Tournaments|Liquipedia:Upcoming and ongoing matches|S-Tier Tournaments|A-Tier Tournaments|Portal:Tournaments|Liquipedia:Matches' }), 'lp-info.json');
await sleep(3000);
await get(lp({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: 'Liquipedia:Tournaments' }), 'lp-tournaments-wikitext.json');
await sleep(3000);
await get(lp({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', rvsection: '0', titles: 'IEM/2026/Chengdu|BLAST/Premier/2026/World_Final|PGL/2026/Masters/Bucharest' }), 'lp-sec0-multi.json');

const PM = 'https://gamma-api.polymarket.com';
await get(PM + '/sports', 'pm-sports.json');
for (const s of ['counter-strike-2', 'cs2', 'counter-strike', 'csgo', 'esports']) await get(PM + '/tags/slug/' + s, `pm-tag-${s}.json`);
await get(PM + '/events?tag_slug=counter-strike-2&closed=false&limit=100', 'pm-events-cs2tag.json');
await get(PM + '/events?tag_slug=cs2&closed=false&limit=100', 'pm-events-cs2.json');
await get(PM + '/events/keyset?tag_slug=counter-strike-2&closed=false&limit=100', 'pm-keyset-cs2tag.json');
