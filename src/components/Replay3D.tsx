import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MeshBVH } from 'three-mesh-bvh';
import { buildPath, eyeHeight, forward, landPoint, loadMapGeometry, pathAt, toThree, type Throw } from '../lib/map3d';

export type View = 'video' | 'aim' | 'pos' | 'free';
export const VIEWS: { id: View; ru: string; hint: string }[] = [
  { id: 'video', ru: 'Видео', hint: 'бросок от первого лица, полёт за гранатой и результат' },
  { id: 'aim', ru: 'Прицел', hint: 'куда смотреть в момент броска (зажмите Shift)' },
  { id: 'pos', ru: 'Позиция', hint: 'где встать (зажмите Ctrl)' },
  { id: 'free', ru: '3D', hint: 'крутите мышью, колесо — приближение' },
];

const TYPE_COLOR: Record<string, number> = { smoke: 0xdfe5ec, flash: 0xffe066, molotov: 0xff7b3a, he: 0xff4d6d, decoy: 0x9aa5b1 };
const SIDE_COLOR = { T: 0xd8a45a, CT: 0x6f9ed8 };
const PRE = 2.6; // seconds of aiming (first person, crosshair + zoom) before the release
const POST = 3.2; // seconds after landing

const VERT = `
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FRAG = `
varying vec3 vW;
uniform vec3 uCam; uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar; uniform vec3 uFocus;
float gridLine(vec2 uv, float s) { vec2 g = abs(fract(uv / s - 0.5) - 0.5) / fwidth(uv / s); return 1.0 - min(min(g.x, g.y), 1.0); }
void main() {
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  if (dot(n, uCam - vW) < 0.0) n = -n;
  vec3 floorC = vec3(0.80, 0.75, 0.66), wallC = vec3(0.66, 0.64, 0.61), ceilC = vec3(0.45, 0.45, 0.47);
  vec3 base = n.y > 0.65 ? floorC : (n.y < -0.65 ? ceilC : wallC);
  base *= 0.82 + 0.18 * clamp((vW.y + 300.0) / 700.0, 0.0, 1.0);
  vec3 an = abs(n);
  vec2 uv = an.y > 0.65 ? vW.xz : (an.x > an.z ? vW.zy : vW.xy);
  base *= 1.0 - 0.10 * gridLine(uv, 64.0) - 0.14 * gridLine(uv, 512.0);
  vec3 L = normalize(vec3(0.35, 0.85, 0.4));
  float diff = 0.52 + 0.48 * max(dot(n, L), 0.0) + 0.06 * max(dot(n, -L), 0.0);
  vec3 col = base * diff;
  float f = smoothstep(uFogNear, uFogFar, length(uCam - vW));
  gl_FragColor = vec4(mix(col, uFog, f), 1.0);
}`;

const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

export default function Replay3D({ map, th, title, keys }: { map: string; th: Throw; title?: string; keys?: string[] }) {
  const host = useRef<HTMLDivElement>(null);
  const magRef = useRef<HTMLDivElement>(null);
  const capRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>('video');
  const [held, setHeld] = useState<View | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'nogl'>('loading');
  const [rec, setRec] = useState<number | null>(null); // recording progress 0..1
  const [flash, setFlash] = useState(0);
  const ctl = useRef({ view: 'video' as View, playing: true, speed: 1, t: 0, restart: 0, record: null as null | ((cb: (b: Blob | null) => void) => void), total: 1 });
  const active = held || view;
  ctl.current.view = active;
  ctl.current.playing = playing;
  ctl.current.speed = speed;

  // Shift = aim, Ctrl = position while held (like cs2util)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea,select')) return;
      if (e.key === 'Shift') setHeld('aim');
      if (e.key === 'Control') setHeld('pos');
      if (e.key === ' ' && (e.target as HTMLElement)?.tagName !== 'BUTTON') { e.preventDefault(); setPlaying((p) => !p); }
    };
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift' || e.key === 'Control') setHeld(null); };
    const blur = () => setHeld(null);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    } catch {
      setStatus('nogl');
      return;
    }
    let disposed = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    const scene = new THREE.Scene();
    const sky = new THREE.Color(0x9fbfdc);
    scene.background = sky;
    const camera = new THREE.PerspectiveCamera(73.74, 16 / 9, 2, 16000); // CS2: 90° horizontal at 4:3
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f70, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(0.35, 0.85, 0.4);
    scene.add(sun);
    // zoom window: same eye, ~4× narrower field of view
    const MAG = 4;
    const magCam = new THREE.PerspectiveCamera(73.74 / MAG, 4 / 3, 2, 16000);
    // crosshair drawn into the frame itself (so it is also in the downloaded video): classic green CS2 cross
    const hud = new THREE.Scene();
    const hudCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    const crossGroup = new THREE.Group();
    {
      const bar = (x: number, y: number, w: number, h: number, c: number, z: number) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, depthTest: false }));
        m.position.set(x, y, z);
        crossGroup.add(m);
      };
      const L = 7, G = 4, T = 2;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cx = dx * (G + L / 2), cy = dy * (G + L / 2), w = dx ? L : T, h = dx ? T : L;
        bar(cx, cy, w + 2, h + 2, 0x000000, 0);
        bar(cx, cy, w, h, 0x3cff6e, 0.5);
      }
      hud.add(crossGroup);
    }
    const drawHud = (w: number, h: number, scale: number) => {
      hudCam.left = -w / 2; hudCam.right = w / 2; hudCam.top = h / 2; hudCam.bottom = -h / 2;
      hudCam.updateProjectionMatrix();
      crossGroup.scale.setScalar(scale);
      renderer.autoClear = false;
      renderer.render(hud, hudCam);
      renderer.autoClear = true;
    };

    const color = TYPE_COLOR[th.type] ?? 0xffffff;
    const path = buildPath(th);
    const flight = path.total;
    const total = PRE + flight + POST;
    ctl.current.total = total;
    const eye = toThree(th.from[0], th.from[1], th.from[2] + eyeHeight(th.move));
    const feet = toThree(th.from[0], th.from[1], th.from[2]);
    const fwd = forward(th.ang[0], th.ang[1]);
    const land = landPoint(th);
    const start = path.pts[0].clone();

    // ---- static objects ---------------------------------------------------
    const uniforms = {
      uCam: { value: new THREE.Vector3() }, uFog: { value: sky }, uFogNear: { value: 2500 }, uFogFar: { value: 11000 },
      uFocus: { value: land.clone() },
    };
    const mapMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, side: THREE.DoubleSide });
    let mapMesh: THREE.Mesh | null = null;

    const lineGeo = new THREE.BufferGeometry().setFromPoints(path.pts);
    const fullLine = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color, dashSize: 10, gapSize: 8, transparent: true, opacity: 0.55, depthTest: false }));
    fullLine.computeLineDistances();
    fullLine.renderOrder = 5;
    scene.add(fullLine);
    const trailPos = new Float32Array(path.pts.length * 3 + 3 * 400);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }));
    trail.renderOrder = 6;
    scene.add(trail);

    const nade = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12), new THREE.MeshBasicMaterial({ color }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthTest: false }));
    halo.renderOrder = 7;
    nade.add(halo);
    scene.add(nade);

    const player = new THREE.Group();
    const sideColor = SIDE_COLOR[th.side] ?? 0xcccccc;
    const pm = new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.7 });
    const crouch = th.move === 'crouch';
    const body = new THREE.Mesh(new THREE.CylinderGeometry(13, 15, crouch ? 40 : 56, 16), pm);
    body.position.y = crouch ? 20 : 28;
    const head = new THREE.Mesh(new THREE.SphereGeometry(9, 16, 12), pm);
    head.position.y = eyeHeight(th.move);
    const dir = new THREE.ArrowHelper(fwd, new THREE.Vector3(0, eyeHeight(th.move), 0), 70, 0x3ccf7a, 14, 8);
    player.add(body, head, dir);
    player.position.copy(feet);
    scene.add(player);
    const ring = (p: THREE.Vector3, c: number, r: number) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.78, r, 40), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.copy(p).add(new THREE.Vector3(0, 1.5, 0));
      m.renderOrder = 4;
      scene.add(m);
      return m;
    };
    ring(feet, 0x3ccf7a, 22);
    const landRing = ring(land, color, 40);
    // where the crosshair points: found by a ray from the eyes once the map is loaded
    const aimPoint = eye.clone().addScaledVector(fwd, 2500);
    const laserGeo = new THREE.BufferGeometry().setFromPoints([eye, aimPoint]);
    const laser = new THREE.Line(laserGeo, new THREE.LineBasicMaterial({ color: 0x3cff6e, transparent: true, opacity: 0.85, depthTest: false }));
    laser.renderOrder = 8;
    scene.add(laser);
    const aimMark = new THREE.Group();
    {
      const mk = (r0: number, r1: number, c: number, o: number) => {
        const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 32), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthTest: false, side: THREE.DoubleSide }));
        m.renderOrder = 9;
        aimMark.add(m);
      };
      mk(0.62, 1, 0x3cff6e, 0.95);
      mk(0, 0.22, 0x3cff6e, 0.95);
      mk(1, 1.25, 0x000000, 0.5);
    }
    scene.add(aimMark);
    const placeAim = (dist: number) => {
      aimPoint.copy(eye).addScaledVector(fwd, dist);
      laserGeo.setFromPoints([eye, aimPoint]);
      aimMark.position.copy(aimPoint).addScaledVector(fwd, -2);
      aimMark.lookAt(eye);
      aimMark.scale.setScalar(Math.max(6, dist * 0.018));
    };
    placeAim(2500);

    // ---- effects ------------------------------------------------------------
    const fx = new THREE.Group();
    scene.add(fx);
    const puffs: { m: THREE.Mesh; base: THREE.Vector3; r: number; delay: number }[] = [];
    if (th.type === 'smoke') {
      const mat = new THREE.MeshStandardMaterial({ color: 0xc4c8ce, roughness: 1, transparent: true, opacity: 0.93 });
      const add = (dx: number, dz: number, dy: number, r: number, delay: number) => {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), mat);
        puffs.push({ m, base: new THREE.Vector3(dx, dy, dz), r, delay });
        fx.add(m);
      };
      add(0, 0, 55, 95, 0);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; add(Math.cos(a) * 85, Math.sin(a) * 85, 40 + (i % 2) * 25, 70, 0.08 + i * 0.03); }
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.6; add(Math.cos(a) * 45, Math.sin(a) * 45, 115, 60, 0.2); }
    } else if (th.type === 'molotov') {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff7b1c, transparent: true, opacity: 0.85 });
      const mat2 = new THREE.MeshBasicMaterial({ color: 0xffd04a, transparent: true, opacity: 0.9 });
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 110;
        const m = new THREE.Mesh(new THREE.ConeGeometry(14, 1, 7), i % 3 ? mat : mat2);
        puffs.push({ m, base: new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), r: 30 + Math.random() * 30, delay: (r / 110) * 0.5 });
        fx.add(m);
      }
    } else {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: th.type === 'flash' ? 0xffffff : 0xff8a3a, transparent: true, opacity: 0.9 }));
      puffs.push({ m, base: new THREE.Vector3(0, 0, 0), r: th.type === 'flash' ? 90 : 150, delay: 0 });
      fx.add(m);
    }
    fx.position.copy(path.pts[path.pts.length - 1]);
    if (th.type === 'smoke' || th.type === 'molotov') fx.position.y = Math.min(fx.position.y, land.y + 4);

    // ---- cameras ------------------------------------------------------------
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    const mid = start.clone().lerp(land, 0.5);
    orbit.target.copy(mid);
    const span = Math.max(700, start.distanceTo(land) * 0.9);
    camera.position.copy(mid).add(new THREE.Vector3(-fwd.x * span * 0.45, span * 1.25, -fwd.z * span * 0.45));
    orbit.update();
    const freeCam = camera.position.clone(), freeTarget = orbit.target.clone();
    let lastView: View | null = null;
    const flatFwd = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
    const posCam = feet.clone().addScaledVector(flatFwd, -230).add(new THREE.Vector3(0, 150, 0));
    const posLook = feet.clone().addScaledVector(flatFwd, 90).add(new THREE.Vector3(0, 36, 0));
    // result shot: a point the grenade flew through (open air) ~450 u before the landing spot
    const resCam = new THREE.Vector3(), resLook = fx.position.clone().add(new THREE.Vector3(0, th.type === 'smoke' ? 60 : 10, 0));
    {
      const endP = path.pts[path.pts.length - 1];
      let i = path.pts.length - 1;
      while (i > 0 && path.pts[i].distanceTo(endP) < 450) i--;
      resCam.copy(path.pts[i]).add(new THREE.Vector3(0, 40, 0));
      if (resCam.distanceTo(resLook) < 150) resCam.copy(resLook).add(new THREE.Vector3(-flatFwd.x * 380, 260, -flatFwd.z * 380));
    }
    const ray = new THREE.Ray();
    const freeDist = (from: THREE.Vector3, d: THREE.Vector3, max: number) => {
      const bvh = mapMesh?.geometry.userData.bvh as MeshBVH | undefined;
      if (!bvh) return max;
      ray.set(from, d);
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, max);
      return hit ? hit.distance : max;
    };
    const camDir = new THREE.Vector3();
    /** pull the camera in front of the first wall between it and what it looks at */
    const clampCam = (look: THREE.Vector3, pos: THREE.Vector3) => {
      camDir.copy(pos).sub(look);
      const len = camDir.length();
      if (len < 1) return pos;
      camDir.divideScalar(len);
      const free = freeDist(look, camDir, len);
      if (free < len) pos.copy(look).addScaledVector(camDir, Math.max(8, free - 12));
      return pos;
    };
    /** once the map is loaded: keep the cameras out of the walls */
    const placeCameras = () => {
      placeAim(Math.max(40, freeDist(eye, fwd, 6000)));
      // position view: from behind the player, the direction with the most free space
      let best = -1;
      for (const deg of [180, 155, 205, 130, 230, 100, 260]) {
        const a = (deg * Math.PI) / 180;
        const d = new THREE.Vector3(flatFwd.x * Math.cos(a) - flatFwd.z * Math.sin(a), 0.62, flatFwd.x * Math.sin(a) + flatFwd.z * Math.cos(a)).normalize();
        const free = Math.min(freeDist(eye, d, 270) - 14, 250);
        if (free > best + 25) { best = free; posCam.copy(eye).addScaledVector(d, Math.max(free, 40)); }
        if (free >= 240) break;
      }
      // result shot: a spot on the flight path 260–800 u before the landing with a clear view of it,
      // otherwise the most open spot on a ring around the landing point
      const sees = (c: THREE.Vector3) => {
        const dist = c.distanceTo(resLook);
        return freeDist(resLook, c.clone().sub(resLook).normalize(), dist) >= dist - 8;
      };
      let found = false;
      for (let i = path.pts.length - 1, tries = 0; i >= 0 && tries < 10; i--) {
        const c = path.pts[i].clone().add(new THREE.Vector3(0, 30, 0));
        const dist = c.distanceTo(resLook);
        if (dist < 260) continue;
        if (dist > 800) break;
        tries++;
        if (sees(c)) { resCam.copy(c); found = true; break; }
      }
      if (!found) {
        let bestFree = -1;
        const back = Math.atan2(-flatFwd.z, -flatFwd.x);
        for (let k = 0; k < 12; k++) {
          const a = back + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
          for (const el of [0.55, 0.25, 0.9]) {
            const d = new THREE.Vector3(Math.cos(a), el, Math.sin(a)).normalize();
            const free = Math.min(freeDist(resLook, d, 420) - 20, 400);
            if (free > bestFree + 30) { bestFree = free; resCam.copy(resLook).addScaledVector(d, Math.max(free, 60)); }
          }
          if (bestFree >= 380) break;
        }
      }
    };
    const chasePos = new THREE.Vector3(), chaseLook = new THREE.Vector3();
    const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

    const resize = () => {
      const w = el.clientWidth || 640, h = el.clientHeight || 360;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // ---- recording ------------------------------------------------------------
    let recorder: MediaRecorder | null = null;
    let chunks: Blob[] = [];
    let recEnd = 0;
    ctl.current.record = (cb) => {
      if (recorder) return;
      const stream = (renderer.domElement as HTMLCanvasElement).captureStream(30);
      const types = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
      const mime = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
      if (!mime) { cb(null); return; }
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      chunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      recorder.onstop = () => { const b = new Blob(chunks, { type: mime.split(';')[0] }); recorder = null; cb(b); };
      ctl.current.t = 0;
      recEnd = total;
      recorder.start(250);
    };

    // ---- loop -------------------------------------------------------------------
    let raf = 0;
    let prev = performance.now();
    let flashShown = false;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const c = ctl.current;
      const dt = Math.min(0.1, (now - prev) / 1000);
      prev = now;
      if (c.playing || recorder) c.t += dt * (recorder ? 1 : c.speed);
      if (recorder && c.t >= recEnd) { recorder.stop(); setRec(null); }
      else if (recorder) setRec(Math.floor((c.t / recEnd) * 50) / 50);
      if (c.t > total) c.t = 0;
      const t = c.t;
      const tf = t - PRE; // time since release
      const v = recorder ? 'video' : c.view;

      // grenade + trail
      const flying = tf >= 0 && tf <= flight;
      nade.visible = tf >= 0 && tf < flight + 0.15 && !(th.type !== 'smoke' && th.type !== 'decoy' && tf > flight);
      const gp = pathAt(path, Math.max(0, tf), tmp);
      nade.position.copy(gp);
      let k = 0;
      if (tf > 0) {
        for (let i = 0; i < path.pts.length && path.t[i] <= tf; i++) { trailPos[k++] = path.pts[i].x; trailPos[k++] = path.pts[i].y; trailPos[k++] = path.pts[i].z; }
        trailPos[k++] = gp.x; trailPos[k++] = gp.y; trailPos[k++] = gp.z;
      }
      trailGeo.setDrawRange(0, k / 3);
      trailGeo.attributes.position.needsUpdate = true;
      const fp = v === 'aim' || (v === 'video' && tf < 0.55); // first person: clean view like in the game
      fullLine.visible = !fp && (v !== 'video' || tf < 0);
      landRing.visible = v !== 'video' && v !== 'aim';
      laser.visible = aimMark.visible = v === 'pos' || v === 'free';

      // effect after landing
      const te = tf - flight;
      fx.visible = te >= 0;
      if (te >= 0) {
        for (const p of puffs) {
          const a = ease((te - p.delay) / (th.type === 'smoke' ? 0.9 : th.type === 'molotov' ? 0.5 : 0.25));
          if (th.type === 'smoke') {
            p.m.scale.setScalar(Math.max(0.001, p.r * a));
            p.m.position.copy(p.base).multiplyScalar(0.4 + 0.6 * a);
          } else if (th.type === 'molotov') {
            const fl = 0.75 + 0.25 * Math.sin(now / 70 + p.base.x);
            p.m.scale.set(a, Math.max(0.001, p.r * a * fl), a);
            p.m.position.set(p.base.x * a, (p.r * a * fl) / 2, p.base.z * a);
          } else {
            const life = Math.min(1, te / 0.6);
            p.m.scale.setScalar(Math.max(0.001, p.r * ease(te / 0.2)));
            (p.m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - life);
          }
        }
        if (th.type === 'flash' && !flashShown && (v === 'aim' || v === 'video')) {
          flashShown = true;
          const vis = tmp2.copy(fx.position).project(camera);
          if (Math.abs(vis.x) < 1.1 && Math.abs(vis.y) < 1.1 && vis.z < 1) setFlash((x) => x + 1);
        }
      } else flashShown = false;

      // camera
      const isFree = v === 'free';
      orbit.enabled = isFree;
      player.visible = v !== 'aim' && !(v === 'video' && tf < 0.7);
      if (isFree) {
        if (lastView !== 'free') { camera.position.copy(freeCam); orbit.target.copy(freeTarget); }
        orbit.update();
        freeCam.copy(camera.position);
        freeTarget.copy(orbit.target);
      } else if (v === 'aim') {
        camera.position.copy(eye);
        camera.lookAt(tmp2.copy(eye).add(fwd));
      } else if (v === 'pos') {
        camera.position.copy(posCam);
        camera.lookAt(posLook);
      } else {
        // video: first person → chase the grenade → orbit the result
        if (tf < 0.55) {
          camera.position.copy(eye);
          camera.lookAt(tmp2.copy(eye).add(fwd));
          chasePos.copy(eye);
          chaseLook.copy(eye).add(fwd);
        } else {
          const vel = pathAt(path, Math.min(flight, tf + 0.25), tmp2).sub(gp);
          if (vel.lengthSq() < 1) vel.copy(fwd);
          vel.setY(Math.min(vel.y, 0)).normalize();
          let wantPos: THREE.Vector3, wantLook: THREE.Vector3;
          if (flying) {
            wantPos = gp.clone().addScaledVector(vel, -170).add(new THREE.Vector3(0, 70, 0));
            wantLook = gp.clone().addScaledVector(vel, 120);
          } else {
            // slow push-in from a spot on the flight path towards the result
            const keep = th.type === 'smoke' ? 300 : 120; // never push into the cloud
            const d0 = resCam.distanceTo(resLook);
            const push = Math.min(0.35, Math.max(0, te) * 0.08, Math.max(0, (d0 - keep) / d0));
            wantPos = tmp2.copy(resCam).lerp(resLook, push).clone();
            wantLook = resLook;
          }
          const s = 1 - Math.exp(-dt * (flying ? 3.2 : 2.2));
          clampCam(wantLook, wantPos);
          chasePos.lerp(wantPos, s);
          chaseLook.lerp(wantLook, s);
          clampCam(flying ? gp : chaseLook, chasePos);
          camera.position.copy(chasePos);
          camera.lookAt(chaseLook);
        }
      }
      lastView = v;
      uniforms.uCam.value.copy(camera.position);
      renderer.render(scene, camera);
      const ready = !!mapMesh;
      const W = el.clientWidth || 640, H = el.clientHeight || 360;
      if (fp && ready) {
        drawHud(W, H, 1);
        // zoom window in the bottom-right corner: exactly what is under the crosshair
        const mw = Math.round(Math.min(W * 0.34, 300)), mh = Math.round(mw * 0.62);
        magCam.position.copy(eye);
        magCam.lookAt(tmp2.copy(eye).add(fwd));
        magCam.aspect = mw / mh;
        magCam.updateProjectionMatrix();
        renderer.setScissorTest(true);
        renderer.setViewport(W - mw - 10, 10, mw, mh);
        renderer.setScissor(W - mw - 10, 10, mw, mh);
        renderer.render(scene, magCam);
        drawHud(mw, mh, 1.6);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, W, H);
        const mg = magRef.current;
        if (mg) { mg.style.display = ''; mg.style.width = mw + 'px'; mg.style.height = mh + 'px'; }
      } else if (magRef.current) magRef.current.style.display = 'none';
      if (capRef.current) capRef.current.style.display = ready && fp && tf < 0 ? '' : 'none';
    };

    loadMapGeometry(map)
      .then((g) => {
        if (disposed) return;
        mapMesh = new THREE.Mesh(g, mapMat);
        scene.add(mapMesh);
        mapMesh.updateMatrixWorld();
        setStatus('ready');
        setTimeout(() => { if (!disposed) placeCameras(); }, 30);
      })
      .catch(() => !disposed && setStatus('error'));
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      orbit.dispose();
      if (recorder) try { recorder.stop(); } catch { /* ignore */ }
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry && m !== mapMesh) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      hud.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [map, th]);

  const download = () => {
    setRec(0);
    ctl.current.record?.((b) => {
      setRec(null);
      if (!b) { alert('Ваш браузер не умеет записывать видео с холста'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `${(title || 'raskidka').replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.${b.type.includes('mp4') ? 'mp4' : 'webm'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    });
  };

  return (
    <div className="r3d">
      <div className="r3d-stage" ref={host}>
        <div ref={magRef} className="r3d-mag" style={{ display: 'none' }} aria-hidden><span>Прицел ×4</span></div>
        <div ref={capRef} className="r3d-cap" style={{ display: 'none' }}>
          <b>Наведи прицел и бросай</b>
          {keys?.length ? <span>{keys.join(' + ')}</span> : null}
        </div>
        {flash > 0 && <div key={flash} className="r3d-flash" />}
        {status !== 'ready' && (
          <div className="r3d-msg">
            {status === 'loading' && 'Загружаем 3D-карту…'}
            {status === 'error' && 'Не удалось загрузить 3D-карту'}
            {status === 'nogl' && 'Браузер не поддерживает WebGL — 3D-повтор недоступен'}
          </div>
        )}
        <div className="r3d-badge">{VIEWS.find((x) => x.id === active)?.ru}{held ? ' (удерживается)' : ''}</div>
        {rec !== null && <div className="r3d-rec">● Запись видео {Math.round(rec * 100)}%</div>}
      </div>
      <div className="r3d-bar">
        <div className="seg">
          {VIEWS.map((x) => <button key={x.id} className={active === x.id ? 'on' : ''} title={x.hint} onClick={() => setView(x.id)}>{x.ru}</button>)}
        </div>
        <button className="btn small" onClick={() => setPlaying((p) => !p)} title="Пробел">{playing ? '❚❚ Пауза' : '▶ Играть'}</button>
        <button className="btn small ghost" onClick={() => { ctl.current.t = 0; setPlaying(true); }}>↺ Сначала</button>
        <div className="seg">
          {[0.5, 1, 2].map((s) => <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{s}×</button>)}
        </div>
        <button className="btn small ghost" onClick={download} disabled={rec !== null || status !== 'ready'} title="Записать один повтор в видеофайл">⤓ Скачать видео</button>
      </div>
    </div>
  );
}
