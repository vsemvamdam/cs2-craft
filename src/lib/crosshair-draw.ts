// Canvas rendering of a CS2 crosshair at real pixel scale + procedural preview backgrounds.
// Geometry (all in pixels of the rendered frame):
//   sizes are pixels at ch.screenHeight and get rescaled to the render height like CS2 does;
//   a bar starts `gap` pixels from the centre (the converter README defines new gap = space + ceil(thickness / 2)),
//   bars are `thickness` wide and centred on the centre line; the centre lands on a pixel centre for odd
//   thickness and on a pixel corner for even thickness, so every edge falls on the pixel grid;
//   outline: 1 px around each element (full) or only on the top and left sides (half);
//   overlapping elements are merged before alpha is applied (one layer per alpha group).
// Circle, quad and square styles: Valve has not published their exact geometry, the preview is approximate.
import type { CrosshairV1 } from 'csgo-sharecode';
import { styleInfo } from './crosshair';

type Rect = { k: 'r'; x: number; y: number; w: number; h: number };
type Arc = { k: 'a'; x: number; y: number; r: number; w: number; a0: number; a1: number };
type Shape = Rect | Arc;
type Group = { mul: number; shapes: Shape[] };

/** dynamic state of the weapon, in pixels at the render height */
export type Motion = { spread: number; kick: number; dx: number; dy: number };
export const NO_MOTION: Motion = { spread: 0, kick: 0, dx: 0, dy: 0 };

const R = (x: number, y: number, w: number, h: number): Rect => ({ k: 'r', x, y, w, h });
const A = (x: number, y: number, r: number, w: number, a0 = 0, a1 = Math.PI * 2): Arc => ({ k: 'a', x, y, r, w, a0, a1 });

export function scaled(ch: CrosshairV1, renderHeight: number) {
  const s = renderHeight / Math.max(1, ch.screenHeight);
  const L = Math.max(0, Math.round(ch.length * s));
  const T = ch.thickness > 0 ? Math.max(1, Math.round(ch.thickness * s)) : 0;
  let G = Math.round(ch.gap * s);
  if (ch.style !== 2 && G < 0) G = 0; // negative gap only works for Dynamic Cross (Legacy)
  return { s, L, T, G, limit: Math.round(ch.dynamicSpreadLimit * s), split: Math.round(ch.splitDistance * s), outline: Math.max(1, Math.round(s)) };
}

/** builds the crosshair elements around the screen centre (cx, cy: pixel corner in frame coords) */
export function crosshairGroups(ch: CrosshairV1, renderHeight: number, cx: number, cy: number, m: Motion = NO_MOTION): Group[] {
  const info = styleInfo(ch.style);
  const { L, T, G, limit, split } = scaled(ch, renderHeight);
  const spread = info.dynamic ? Math.max(0, Math.min(Math.round(m.spread), limit)) : 0;
  const odd = T % 2;
  const px = Math.round(cx + m.dx) - odd * 0.5;
  const py = Math.round(cy + m.dy) - odd * 0.5;
  const din = (g: number) => g - Math.ceil(T / 2) + T / 2; // centre -> inner edge of a bar
  const cross = (g: number, len: number): Rect[] => {
    if (!len || !T) return [];
    const d = din(g);
    const out = [R(px + d, py - T / 2, len, T), R(px - d - len, py - T / 2, len, T), R(px - T / 2, py + d, T, len)];
    if (!ch.tStyleEnabled) out.push(R(px - T / 2, py - d - len, T, len));
    return out;
  };
  const dot = (force = false): Rect[] => (T && (force || ch.centerDotEnabled) ? [R(px - T / 2, py - T / 2, T, T)] : []);
  const arcs = (radius: number, span: number): Arc[] =>
    [0, 1, 2, 3].map((i) => {
      const mid = Math.PI / 4 + (i * Math.PI) / 2;
      return A(px, py, radius, T, mid - span / 2, mid + span / 2);
    });

  switch (ch.style) {
    case 0: return [{ mul: 1, shapes: [...cross(G + spread, L), ...dot()] }];
    case 2: {
      if (spread <= split) return [{ mul: 1, shapes: [...cross(G + spread, L), ...dot()] }];
      const inner = Math.round(L * (1 - ch.splitSizeRatio));
      const outer = L - inner;
      return [
        { mul: ch.innerSplitAlpha, shapes: cross(G + split, inner) },
        { mul: ch.outerSplitAlpha, shapes: cross(G + spread, outer) },
        { mul: 1, shapes: dot() },
      ];
    }
    case 5: return [{ mul: 1, shapes: [...cross(G + Math.round(m.kick), L), ...dot()] }];
    case 6: return [{ mul: 1, shapes: dot(true) }];
    case 1:
    case 3: {
      if (!T) return [];
      const r = Math.max(T / 2, din(G + spread) + T / 2);
      return [{ mul: 1, shapes: [A(px, py, r, T), ...dot()] }];
    }
    case 7: {
      if (!T) return [{ mul: 1, shapes: [] }];
      const r = din(G) + L + Math.max(2, T) + T / 2 + spread;
      return [{ mul: 1, shapes: [...cross(G, L), ...dot(), ...arcs(r, (50 * Math.PI) / 180)] }];
    }
    case 9: {
      if (!T) return [];
      const r = Math.max(T, din(G) + T / 2);
      const span = (Math.PI / 2) * Math.min(0.9, Math.max(0.1, ch.splitSizeRatio));
      return [{ mul: 1, shapes: [...arcs(r, span), ...dot()] }];
    }
    case 8: {
      if (!T) return [];
      const h = Math.max(0, din(G));
      return [{ mul: 1, shapes: [R(px - h - T, py - h - T, 2 * h + 2 * T, T), R(px - h - T, py + h, 2 * h + 2 * T, T), R(px - h - T, py - h, T, 2 * h), R(px + h, py - h, T, 2 * h), ...dot()] }];
    }
    default: return [{ mul: 1, shapes: [...cross(G, L), ...dot()] }];
  }
}

function outlineOf(s: Shape, mode: number, o: number): Shape {
  if (s.k === 'r') return mode === 2 ? R(s.x - o, s.y - o, s.w + o, s.h + o) : R(s.x - o, s.y - o, s.w + 2 * o, s.h + 2 * o);
  return mode === 2 ? { ...s, x: s.x - o / 2, y: s.y - o / 2, w: s.w + o } : { ...s, w: s.w + 2 * o };
}

const layers = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
function layerFor(c: HTMLCanvasElement) {
  let l = layers.get(c);
  if (!l) layers.set(c, (l = document.createElement('canvas')));
  if (l.width !== c.width || l.height !== c.height) { l.width = c.width; l.height = c.height; }
  return l;
}

/** draws the crosshair into ctx (frame coordinates = game pixels) */
export function paintCrosshair(ctx: CanvasRenderingContext2D, ch: CrosshairV1, renderHeight: number, cx: number, cy: number, m: Motion = NO_MOTION) {
  const groups = crosshairGroups(ch, renderHeight, cx, cy, m);
  const { outline } = scaled(ch, renderHeight);
  const layer = layerFor(ctx.canvas);
  const lc = layer.getContext('2d')!;
  const paint = (shapes: Shape[], color: string, alpha: number) => {
    if (alpha <= 0 || !shapes.length) return;
    lc.clearRect(0, 0, layer.width, layer.height);
    lc.fillStyle = color;
    lc.strokeStyle = color;
    for (const s of shapes) {
      if (s.k === 'r') { if (s.w > 0 && s.h > 0) lc.fillRect(s.x, s.y, s.w, s.h); }
      else { lc.lineWidth = s.w; lc.beginPath(); lc.arc(s.x, s.y, s.r, s.a0, s.a1); lc.stroke(); }
    }
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  };
  if (ch.outlineMode) {
    const oc = `rgb(${ch.outlineRed},${ch.outlineGreen},${ch.outlineBlue})`;
    for (const g of groups) paint(g.shapes.map((s) => outlineOf(s, ch.outlineMode, outline)), oc, (ch.outlineAlpha / 255) * g.mul);
  }
  const c = `rgb(${ch.red},${ch.green},${ch.blue})`;
  for (const g of groups) paint(g.shapes, c, (ch.alpha / 255) * g.mul);
}

/** scoped AWP/SSG view: black lines through the centre (cl_crosshair_sniper_width) */
export function paintScope(ctx: CanvasRenderingContext2D, gw: number, gh: number, ox: number, oy: number, width: number) {
  const w = Math.max(1, Math.round(width * (gh / 1080)));
  const cx = gw / 2 - ox, cy = gh / 2 - oy;
  const r = gh * 0.47;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.92)';
  ctx.beginPath();
  ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, Math.round(cy - w / 2), ctx.canvas.width, w);
  ctx.fillRect(Math.round(cx - w / 2), 0, w, ctx.canvas.height);
  ctx.restore();
}

// ---------- weapon state simulation (illustrative, not real weapon data) ----------

export type MoveState = 'idle' | 'walk' | 'run' | 'jump' | 'spray';
export const MOVE_STATES: { k: MoveState; ru: string }[] = [
  { k: 'idle', ru: 'Стоим' }, { k: 'walk', ru: 'Шаг' }, { k: 'run', ru: 'Бег' }, { k: 'jump', ru: 'Прыжок' }, { k: 'spray', ru: 'Спрей' },
];
// cumulative aim punch of a 10-bullet spray, px at 1080p (simplified rifle-like pattern)
const SPRAY: [number, number][] = [[0, 0], [0, -5], [1, -12], [0, -21], [-2, -31], [2, -40], [6, -47], [9, -52], [5, -56], [-3, -58], [-10, -59]];
export const isAnimated = (st: MoveState) => st === 'jump' || st === 'spray';

/** motion at time t (seconds) for the given state, scaled to the render height */
export function motionAt(st: MoveState, t: number, renderHeight: number, followRecoil: boolean): Motion {
  const k = renderHeight / 1080;
  let spread = 0, kick = 0, dx = 0, dy = 0;
  if (st === 'walk') spread = 18;
  else if (st === 'run') spread = 72;
  else if (st === 'jump') {
    const p = (t % 1.6) / 1.6;
    spread = p < 0.6 ? 40 + 200 * Math.sin((p / 0.6) * Math.PI) : 40 * (1 - (p - 0.6) / 0.4);
  } else if (st === 'spray') {
    const c = t % 2.4;
    if (c < 1) {
      const i = Math.min(9, Math.floor(c / 0.1));
      const tau = c - i * 0.1;
      const f = Math.min(1, tau / 0.03);
      spread = 10 + i * 5 + f * 5;
      kick = 6 * Math.exp(-tau / 0.05);
      dx = SPRAY[i][0] + (SPRAY[i + 1][0] - SPRAY[i][0]) * f;
      dy = SPRAY[i][1] + (SPRAY[i + 1][1] - SPRAY[i][1]) * f;
    } else {
      const e = Math.exp(-(c - 1) / 0.22);
      spread = 60 * e;
      dx = SPRAY[10][0] * e;
      dy = SPRAY[10][1] * e;
    }
  }
  if (!followRecoil) { dx = 0; dy = 0; }
  return { spread: spread * k, kick: kick * k, dx: dx * k, dy: dy * k };
}

// ---------- resolutions ----------

export type Resolution = { k: string; ru: string; gw: number; gh: number; mw: number; mh: number; mode: 'native' | 'stretch' | 'bars' };
export const RESOLUTIONS: Resolution[] = [
  { k: '1080', ru: '1920×1080', gw: 1920, gh: 1080, mw: 1920, mh: 1080, mode: 'native' },
  { k: '1440', ru: '2560×1440', gw: 2560, gh: 1440, mw: 2560, mh: 1440, mode: 'native' },
  { k: '2160', ru: '3840×2160 (4K)', gw: 3840, gh: 2160, mw: 3840, mh: 2160, mode: 'native' },
  { k: '960s', ru: '1280×960 4:3, растянутое на 1920×1080', gw: 1280, gh: 960, mw: 1920, mh: 1080, mode: 'stretch' },
  { k: '960b', ru: '1280×960 4:3, чёрные полосы на 1920×1080', gw: 1280, gh: 960, mw: 1920, mh: 1080, mode: 'bars' },
  { k: '1080s', ru: '1440×1080 4:3, растянутое на 1920×1080', gw: 1440, gh: 1080, mw: 1920, mh: 1080, mode: 'stretch' },
  { k: '768s', ru: '1024×768 4:3, растянутое на 1920×1080', gw: 1024, gh: 768, mw: 1920, mh: 1080, mode: 'stretch' },
];
export const resolution = (k: string) => RESOLUTIONS.find((r) => r.k === k) || RESOLUTIONS[0];
/** monitor pixels per game pixel and the left offset of the game image on the monitor */
export function monitorMap(r: Resolution) {
  const sy = r.mh / r.gh;
  const sx = r.mode === 'stretch' ? r.mw / r.gw : sy;
  return { sx, sy, offX: (r.mw - r.gw * sx) / 2 };
}

// ---------- procedural backgrounds (generated, no images) ----------

export const BACKGROUNDS: { k: string; ru: string }[] = [
  { k: 'wall', ru: 'Песчаная стена' }, { k: 'dark', ru: 'Тёмный угол' }, { k: 'sky', ru: 'Небо' },
  { k: 'concrete', ru: 'Бетон' }, { k: 'grass', ru: 'Листва' }, { k: 'flash', ru: 'Засвет' },
];

function hash(x: number, y: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, oct = 4) {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(x * f + i * 17.3, y * f - i * 9.1); n += amp; f *= 2; amp *= 0.5; }
  return s / n;
}
const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const mod = (a: number, m: number) => ((a % m) + m) % m;

/** fills ctx (w×h) with the background of the game frame region starting at game pixel (ox, oy) */
export function paintBackground(ctx: CanvasRenderingContext2D, kind: string, ox: number, oy: number, gw: number, gh: number) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  // features are defined in 1080p units around the screen centre, so they look the same at any resolution / aspect
  const u = 1080 / gh;
  for (let j = 0; j < h; j++) {
    const gy = oy + j;
    const Y = (gy - gh / 2) * u;
    for (let i = 0; i < w; i++) {
      const gx = ox + i;
      const X = (gx - gw / 2) * u;
      const grain = hash(gx, gy) - 0.5;
      let r = 0, g = 0, b = 0;
      if (kind === 'wall') {
        const n = fbm(X / 90, Y / 90);
        const stain = sm(0.55, 0.75, fbm(X / 320 + 5, Y / 260 - 3, 3));
        const row = Math.floor((Y + 25) / 130);
        const joint = mod(Y + 25, 130) < 2.4 || mod(X + 60 + mod(row, 2) * 130, 260) < 2.4;
        let k = 0.82 + 0.3 * n + 0.07 * grain - 0.12 * stain;
        if (joint) k *= 0.78;
        const floor = Y > 320 ? 0.72 : 1;
        r = 206 * k * floor; g = 182 * k * floor; b = 138 * k * floor;
      } else if (kind === 'dark') {
        const edge = sm(70, 100, X);
        const n = fbm(X / 160, Y / 160);
        const k = (0.75 + 0.45 * n + 0.08 * grain) * (1 - 0.35 * edge) * (0.85 + 0.3 * (0.5 - Y / 1080));
        r = 52 * k; g = 52 * k; b = 60 * k;
      } else if (kind === 'sky') {
        const t = Math.min(1, Math.max(0, (Y + 540) / 1080));
        let rr = 88 + (200 - 88) * t, gg = 146 + (224 - 146) * t, bb = 210 + (242 - 210) * t;
        const c = sm(0.5, 0.72, fbm(X / 260, Y / 110, 5));
        rr += (250 - rr) * c * 0.9; gg += (250 - gg) * c * 0.9; bb += (252 - bb) * c * 0.9;
        r = rr + grain * 3; g = gg + grain * 3; b = bb + grain * 3;
      } else if (kind === 'concrete') {
        const n = fbm(X / 70, Y / 70);
        const seam = mod(X + 150, 380) < 2.2 || Math.abs(Y - 110) < 1.2;
        let k = 0.8 + 0.32 * n + 0.1 * grain;
        if (seam) k *= 0.7;
        r = 132 * k; g = 135 * k; b = 138 * k;
      } else if (kind === 'grass') {
        const n = fbm(X / 14, Y / 30, 4);
        const big = fbm(X / 200, Y / 200, 3);
        const t = Math.min(1, Math.max(0, n * 1.25 - 0.1 + (big - 0.5) * 0.6));
        r = 38 + 92 * t + grain * 10; g = 66 + 112 * t + grain * 12; b = 24 + 40 * t + grain * 8;
      } else {
        const v = 1 - Math.min(1, Math.sqrt(X * X + Y * Y) / 1400) * 0.12;
        r = 246 * v + grain * 4; g = 245 * v + grain * 4; b = 238 * v + grain * 4;
      }
      const p = (j * w + i) * 4;
      d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** user screenshot scaled to cover the game frame (gw×gh) */
export function paintImage(ctx: CanvasRenderingContext2D, im: CanvasImageSource & { width: number; height: number }, ox: number, oy: number, gw: number, gh: number) {
  const c = Math.max(gw / im.width, gh / im.height);
  const ix = (gw - im.width * c) / 2, iy = (gh - im.height * c) / 2;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(im, ix - ox, iy - oy, im.width * c, im.height * c);
  ctx.restore();
}

/** simple enemy silhouette with the head on the crosshair (size of a model at mid range) */
export function paintEnemy(ctx: CanvasRenderingContext2D, ox: number, oy: number, gw: number, gh: number) {
  const k = gh / 1080;
  const cx = gw / 2 - ox, cy = gh / 2 - oy;
  const hr = 9 * k;
  ctx.save();
  ctx.fillStyle = '#2a2d33';
  ctx.beginPath();
  ctx.ellipse(cx, cy + hr * 0.25, hr * 0.92, hr * 1.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(cx - hr * 0.45, cy + hr, hr * 0.9, hr * 1.1);
  ctx.beginPath();
  ctx.moveTo(cx - hr * 2.7, cy + hr * 2.4);
  ctx.quadraticCurveTo(cx, cy + hr * 1.6, cx + hr * 2.7, cy + hr * 2.4);
  ctx.lineTo(cx + hr * 3.1, cy + hr * 14);
  ctx.lineTo(cx - hr * 3.1, cy + hr * 14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath();
  ctx.ellipse(cx - hr * 0.3, cy - hr * 0.2, hr * 0.45, hr * 0.6, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
