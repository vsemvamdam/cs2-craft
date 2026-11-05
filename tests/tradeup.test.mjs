// Run: npm test   (bundles src/lib/tradeup.ts with esbuild, then checks the math on real data)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';

const out = new URL('./.tradeup.bundle.mjs', import.meta.url).pathname;
await build({ entryPoints: ['src/lib/tradeup.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const T = await import(out);
const raw = JSON.parse(fs.readFileSync('public/data/db.json', 'utf8'));

function index(db) {
  const byId = new Map(db.skins.map((s) => [s.id, s]));
  const alias = new Map(byId);
  for (const s of db.skins) for (const p of s.phases || []) alias.set(p.id, s);
  const colById = new Map(db.collections.map((c) => [c.id, c]));
  const colTiers = new Map();
  for (const c of db.collections) {
    const m = new Map();
    for (const id of c.skins) { const s = alias.get(id); if (!s || s.gold) continue; if (!m.has(s.rar)) m.set(s.rar, []); if (!m.get(s.rar).includes(s)) m.get(s.rar).push(s); }
    colTiers.set(c.id, m);
  }
  return { ...db, byId, alias, colById, colTiers };
}
const db = index(raw);
const find = (name) => db.skins.find((s) => s.name === name);
const opts = { source: 'steam', fee: 0 };

test('weapon contract: single collection, uniform odds, normalized float', () => {
  const s = find('P250 | Supernova'); // Restricted, Breakout collection, range 0–0.40
  assert.ok(s, 'skin exists');
  const r = T.computeTradeUp(db, null, { mode: 'weapon', st: false, inputs: Array.from({ length: 10 }, () => ({ id: s.id, float: 0.02 })) }, opts);
  assert.equal(r.valid, true, r.errors.join('; '));
  const n = r.outcomes.length;
  assert.ok(n >= 2);
  for (const o of r.outcomes) assert.ok(Math.abs(o.prob - 1 / n) < 1e-9);
  assert.ok(Math.abs(r.avgNorm - (0.02 - s.mn) / (s.mx - s.mn)) < 1e-9);
  for (const o of r.outcomes) assert.ok(Math.abs(o.float - (o.skin.mn + r.avgNorm * (o.skin.mx - o.skin.mn))) < 1e-9);
  assert.ok(r.outcomes.every((o) => o.skin.rar === 5));
});

test('weapon contract: 8/2 split between collections', () => {
  const restricted = db.skins.filter((x) => x.rar === 3 && !x.gold && x.col.length);
  const a = restricted.find((x) => (db.colTiers.get(x.col[0])?.get(4) || []).length > 0);
  const b = restricted.find((x) => x.col[0] !== a.col[0] && (db.colTiers.get(x.col[0])?.get(4) || []).length > 0);
  const inputs = [...Array(8).fill({ id: a.id, float: Math.max(a.mn, 0.1) }), ...Array(2).fill({ id: b.id, float: Math.max(b.mn, 0.1) })];
  const r = T.computeTradeUp(db, null, { mode: 'weapon', st: false, inputs }, opts);
  const pa = r.outcomes.filter((o) => o.cols.includes(a.col[0])).reduce((x, o) => x + o.prob, 0);
  const pb = r.outcomes.filter((o) => o.cols.includes(b.col[0])).reduce((x, o) => x + o.prob, 0);
  assert.ok(Math.abs(pa - 0.8) < 1e-9 && Math.abs(pb - 0.2) < 1e-9, `${pa} ${pb}`);
});

test('gold contract: 5 Coverts from a knife case -> uniform knife pool, Doppler phases split', () => {
  const col = db.collections.find((c) => c.name === 'The Chroma 2 Collection');
  const covert = db.skins.find((x) => x.rar === 6 && !x.gold && x.col.includes(col.id));
  const r = T.computeTradeUp(db, null, { mode: 'gold', st: false, inputs: Array(5).fill({ id: covert.id, float: covert.mn + 0.01 }) }, opts);
  assert.equal(r.valid, true, r.errors.join('; '));
  const total = r.outcomes.reduce((a, o) => a + o.prob, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  const uniq = new Set(r.outcomes.map((o) => o.skin.id));
  const perSkin = 1 / uniq.size;
  for (const id of uniq) {
    const p = r.outcomes.filter((o) => o.skin.id === id).reduce((a, o) => a + o.prob, 0);
    assert.ok(Math.abs(p - perSkin) < 1e-9);
  }
  assert.ok(r.outcomes.some((o) => o.phase === 'Ruby'));
  console.log(`  Chroma 2: ${uniq.size} knives, ${r.outcomes.length} outcomes incl. phases`);
});

test('gold contract: StatTrak from a glove-only case is rejected', () => {
  const col = db.collections.find((c) => c.name === 'The Glove Collection');
  const covert = db.skins.find((x) => x.rar === 6 && !x.gold && x.col.includes(col.id) && x.st);
  const r = T.computeTradeUp(db, null, { mode: 'gold', st: true, inputs: Array(5).fill({ id: covert.id, float: covert.mn + 0.01 }) }, opts);
  assert.equal(r.valid, false);
  const r2 = T.computeTradeUp(db, null, { mode: 'gold', st: false, inputs: Array(5).fill({ id: covert.id, float: covert.mn + 0.01 }) }, opts);
  assert.equal(r2.valid, true, r2.errors.join('; '));
  assert.ok(r2.outcomes.every((o) => o.skin.cat === 'gloves'));
});

test('share link round-trip', () => {
  const cfg = { mode: 'gold', st: true, inputs: [{ id: 'skin-abc123', float: 0.123456, sv: false, price: 1500 }, { id: 'skin-def', float: 0.5, sv: true }] };
  const back = T.decodeContract(T.encodeContract(cfg));
  assert.equal(back.mode, 'gold'); assert.equal(back.st, true);
  assert.equal(back.inputs[0].price, 1500); assert.equal(back.inputs[1].sv, true);
  assert.ok(Math.abs(back.inputs[0].float - 0.123456) < 1e-9);
});
