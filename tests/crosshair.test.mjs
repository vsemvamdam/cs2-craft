// Crosshair generator: share codes, old -> pixel conversion, console command parsing and bar geometry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { encodeCrosshair } from 'csgo-sharecode';

const out = new URL('./.crosshair.bundle.mjs', import.meta.url).pathname;
const outLib = new URL('./.crosshair-lib.bundle.mjs', import.meta.url).pathname;
await build({ entryPoints: ['src/lib/crosshair.ts'], bundle: true, format: 'esm', platform: 'node', outfile: outLib, logLevel: 'error' });
await build({ entryPoints: ['src/lib/crosshair-draw.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const X = await import(outLib);
const D = await import(out);

const B1T = 'CSiuObDzWBiXvWXr8UJU5TLsmhBNMJMBaH5AjAS63CFNqF';

test('new CS… code decodes and re-encodes to the same code', () => {
  const r = X.decodeCode(B1T, 1080);
  assert.ok(r.ok);
  assert.equal(r.ch.style, 4);
  assert.equal(r.ch.length, 2);
  assert.equal(r.ch.thickness, 2);
  assert.equal(r.ch.gap, 1);
  assert.equal(r.ch.screenHeight, 960);
  assert.equal(X.encode(r.ch), B1T);
});

test('every listed pro code is valid', () => {
  for (const p of X.PROS) assert.ok(X.decodeCode(p.code, 1080).ok, p.name);
});

test('old commands use the converter README formulas (1080p, size 2, thickness 0.5, gap -2 -> 4/1/3)', () => {
  const r = X.importAny('cl_crosshairstyle 4; cl_crosshairsize 2; cl_crosshairthickness 0.5; cl_crosshairgap -2', X.DEFAULT_XH, 1080);
  assert.ok(r.ok);
  assert.deepEqual([r.ch.style, r.ch.length, r.ch.thickness, r.ch.gap, r.ch.screenHeight], [4, 4, 1, 3, 1080]);
});

test('old commands at 960p and old colour presets', () => {
  const r = X.importAny('cl_crosshairsize "3"\ncl_crosshairthickness "1"\ncl_crosshairgap "-3"\ncl_crosshaircolor "1"\ncl_crosshaircolor_r "255"\ncl_crosshairstyle "2"', X.DEFAULT_XH, 960);
  assert.ok(r.ok);
  // 3 × 2 = 6, 1 × 2 = 2, trunc(1) + ceil(2 / 2) = 2; colour 1 = green, r/g/b ignored without cl_crosshaircolor 5
  assert.deepEqual([r.ch.length, r.ch.thickness, r.ch.gap, r.ch.screenHeight], [6, 2, 2, 960]);
  assert.deepEqual([r.ch.red, r.ch.green, r.ch.blue], [50, 250, 50]);
  assert.equal(r.ch.style, 2);
});

test('legacy CSGO-… code (v1) is converted to pixels', () => {
  const legacy = encodeCrosshair({
    format: 'legacy-v1', length: 2, red: 0, green: 255, blue: 255, gap: -3, alphaEnabled: false, alpha: 200, outlineEnabled: true, outline: 1, color: 5,
    thickness: 0.5, centerDotEnabled: false, splitDistance: 7, followRecoil: false, fixedCrosshairGap: 3, innerSplitAlpha: 1, outerSplitAlpha: 0.5,
    splitSizeRatio: 0.3, tStyleEnabled: false, deployedWeaponGapEnabled: false, style: 4,
  });
  assert.match(legacy, /^CSGO-/);
  const r = X.importAny(legacy, X.DEFAULT_XH, 1080);
  assert.ok(r.ok);
  assert.deepEqual([r.ch.style, r.ch.length, r.ch.thickness, r.ch.gap, r.ch.outlineMode, r.ch.alpha], [4, 4, 1, 2, 1, 255]);
  assert.deepEqual([r.ch.red, r.ch.green, r.ch.blue], [0, 255, 255]);
});

test('new console commands round-trip through the generated commands', () => {
  const ch = { ...X.DEFAULT_XH, style: 2, gap: -2, length: 5, innerSplitAlpha: 0.37, outerSplitAlpha: 0.61, outlineMode: 2, outlineRed: 20 };
  const r = X.importAny(X.commandsOneLine(ch, { sniperWidth: 3 }), X.DEFAULT_XH, 1080);
  assert.ok(r.ok);
  assert.equal(X.encode(r.ch), X.encode(ch));
  assert.equal(r.extras.sniperWidth, 3);
});

test('garbage is rejected', () => {
  assert.equal(X.importAny('hello world', X.DEFAULT_XH, 1080).ok, false);
  assert.equal(X.importAny('CSabc', X.DEFAULT_XH, 1080).ok, false);
});

test('rescale follows the screen height', () => {
  const r = X.rescale({ ...X.DEFAULT_XH }, 960);
  assert.deepEqual([r.length, r.thickness, r.gap, r.dynamicSpreadLimit, r.screenHeight], [7, 2, 4, 227, 960]);
});

test('bar geometry: gap is measured from the centre, edges on the pixel grid', () => {
  // thickness 2: centre on a pixel corner, right bar starts exactly `gap` px right of it
  let g = D.crosshairGroups({ ...X.DEFAULT_XH, style: 4, length: 8, thickness: 2, gap: 4 }, 1080, 100, 100);
  let [right, left, bottom, top] = g[0].shapes;
  assert.deepEqual(right, { k: 'r', x: 104, y: 99, w: 8, h: 2 });
  assert.deepEqual(left, { k: 'r', x: 88, y: 99, w: 8, h: 2 });
  assert.deepEqual(bottom, { k: 'r', x: 99, y: 104, w: 2, h: 8 });
  assert.deepEqual(top, { k: 'r', x: 99, y: 88, w: 2, h: 8 });
  // thickness 1: centre column 99, a 3 px space (gap - ceil(1/2)) before the bar
  g = D.crosshairGroups({ ...X.DEFAULT_XH, style: 4, length: 8, thickness: 1, gap: 4, tStyleEnabled: true }, 1080, 100, 100);
  assert.equal(g[0].shapes.length, 3);
  assert.deepEqual(g[0].shapes[0], { k: 'r', x: 103, y: 99, w: 8, h: 1 });
  assert.deepEqual(g[0].shapes[1], { k: 'r', x: 88, y: 99, w: 8, h: 1 });
  // a 960p code shown at 1080p is rescaled ×1.125 (length 8 -> 9)
  g = D.crosshairGroups({ ...X.DEFAULT_XH, style: 4, length: 8, thickness: 2, gap: 4, screenHeight: 960 }, 1080, 100, 100);
  assert.equal(g[0].shapes[0].w, 9);
});
