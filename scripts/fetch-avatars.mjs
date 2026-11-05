#!/usr/bin/env node
// Steam avatars of the pro players (players/index.json from the demo pipeline) → public/data/players/avatars.json
// { steamid: avatarhash }. Needs the STEAM_API_KEY secret; without it the site shows initials instead of avatars.
import fs from 'node:fs/promises';
import path from 'node:path';

const KEY = process.env.STEAM_API_KEY;
const DIR = path.join(process.cwd(), 'public', 'data', 'players');
const idx = JSON.parse(await fs.readFile(path.join(DIR, 'index.json'), 'utf8').catch(() => 'null'));
if (!idx) { console.log('players/index.json нет — пропускаю аватары'); process.exit(0); }
if (!KEY) { console.log('STEAM_API_KEY не задан — аватары игроков пропущены (будут инициалы)'); process.exit(0); }
const si = idx.cols.indexOf('sid');
const ids = idx.rows.map((r) => r[si]);
const out = {};
for (let i = 0; i < ids.length; i += 100) {
  const u = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${KEY}&steamids=${ids.slice(i, i + 100).join(',')}`;
  try {
    const r = await fetch(u);
    if (!r.ok) { console.log(`Steam API ${r.status} — остальные аватары пропущены`); break; }
    for (const p of (await r.json()).response?.players || []) if (p.avatarhash && !/^0+$/.test(p.avatarhash) && p.avatarhash !== 'fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb') out[p.steamid] = p.avatarhash;
  } catch (e) { console.log('Steam API:', e.message); break; }
  await new Promise((r) => setTimeout(r, 300));
}
await fs.writeFile(path.join(DIR, 'avatars.json'), JSON.stringify(out));
console.log(`аватары: ${Object.keys(out).length} из ${ids.length}`);
