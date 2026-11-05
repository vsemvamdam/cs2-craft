// Checks the inspect-link encoder against the reference vector published in the
// cs2-inspect-create README (MIT).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const out = new URL('./.inspect.bundle.mjs', import.meta.url).pathname;
await build({ entryPoints: ['src/lib/inspect.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const I = await import(out);

test('inspect hex matches the documented reference vector', () => {
  const hex = I.inspectHex({ defindex: 7, paintindex: 474, paintseed: 306, paintwear: 0.6336590647697449, rarity: 6, stickers: [{ slot: 3, id: 2, wear: 0, scale: 1, rotation: 0 }] });
  assert.equal(hex, '00180720DA03280638FBEE88F90340B2026213080310021D00000000250000803F2D00000000503D5A64');
});

test('!gen command layout', () => {
  assert.equal(I.genCommand({ defindex: 7, paintindex: 474, paintseed: 306, paintwear: 0.63, stickers: [{ slot: 3, id: 2, wear: 0 }] }), '!gen 7 474 306 0.63 0 0 0 0 0 0 2 0 0 0');
});
