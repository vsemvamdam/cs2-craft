import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

/** Source engine (x east, y north, z up) → three.js (y up). Keeps handedness. */
export const toThree = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

export type V3 = [number, number, number];
/** one grenade throw, enough to replay it in 3D */
export type Throw = {
  type: string; side: 'T' | 'CT';
  from: V3; ang: [number, number]; land: V3;
  traj: number[][]; dur: number; move: string; btn: string;
};

export const GRAVITY = 800 * 0.4; // sv_gravity × grenade gravity scale
export const EYE = { stand: 64, crouch: 46 };

const BASE = import.meta.env.BASE_URL + 'maps3d/';
const cache = new Map<string, Promise<THREE.BufferGeometry>>();

async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const u = new Uint8Array(buf, 0, 2);
  if (u[0] !== 0x1f || u[1] !== 0x8b) return buf; // already decoded by the server (Content-Encoding)
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/** M3D1 mesh written by tools/maps3d/build_meshes.py */
function decode(buf: ArrayBuffer): THREE.BufferGeometry {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'M3D1') throw new Error('bad mesh');
  const nv = dv.getUint32(4, true), nt = dv.getUint32(8, true);
  const mn = [dv.getFloat32(12, true), dv.getFloat32(16, true), dv.getFloat32(20, true)];
  const mx = [dv.getFloat32(24, true), dv.getFloat32(28, true), dv.getFloat32(32, true)];
  const q = new Uint16Array(buf.slice(36, 36 + nv * 6));
  const pos = new Float32Array(nv * 3);
  const k = [0, 1, 2].map((a) => (mx[a] - mn[a]) / 65535);
  for (let i = 0; i < nv; i++) {
    const x = mn[0] + q[i * 3] * k[0], y = mn[1] + q[i * 3 + 1] * k[1], z = mn[2] + q[i * 3 + 2] * k[2];
    pos[i * 3] = x; pos[i * 3 + 1] = z; pos[i * 3 + 2] = -y;
  }
  const off = 36 + nv * 6;
  const small = nv < 65536;
  const n = nt * 3;
  let index: Uint16Array | Uint32Array;
  if (small) {
    const d = new Uint16Array(buf.slice(off, off + n * 2));
    index = new Uint16Array(n);
    let p = 0;
    for (let i = 0; i < n; i++) { p = (p + d[i]) & 0xffff; index[i] = p; }
  } else {
    const d = new Uint32Array(buf.slice(off, off + n * 4));
    index = new Uint32Array(n);
    let p = 0;
    for (let i = 0; i < n; i++) { p = (p + d[i]) >>> 0; index[i] = p; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export function loadMapGeometry(map: string): Promise<THREE.BufferGeometry> {
  let p = cache.get(map);
  if (!p) {
    p = fetch(BASE + map + '.bin.gz')
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then(gunzip)
      .then(decode)
      .then((g) => { g.userData.bvh = new MeshBVH(g); return g; }); // fast raycasts for camera collision
    p.catch(() => cache.delete(map));
    cache.set(map, p);
  }
  return p;
}

/** forward vector for Source view angles (pitch > 0 looks down) */
export function forward(pitch: number, yaw: number) {
  const p = (pitch * Math.PI) / 180, y = (yaw * Math.PI) / 180;
  return toThree(Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), -Math.sin(p)).normalize();
}

export const eyeHeight = (move: string) => (move === 'crouch' ? EYE.crouch : EYE.stand);

export type Path = { pts: THREE.Vector3[]; t: number[]; total: number; synthetic: boolean };

/**
 * Grenade path with timing. Real data (x, y, z per point, uniform in time over `dur`) is used as is;
 * older entries have only x, y — then height is reconstructed from the launch angle (CS2 throw physics:
 * pitch' = -10 + pitch·8/9, speed 675 u/s for a full throw, gravity 320 u/s²) until it reaches the landing height.
 */
export function buildPath(th: Throw): Path {
  const tr = th.traj || [];
  if (tr.length >= 2 && tr[0].length >= 3) {
    const total = th.dur > 0 ? th.dur : (tr.length - 1) * 0.1;
    const dt = total / (tr.length - 1);
    return { pts: tr.map((p) => toThree(p[0], p[1], p[2])), t: tr.map((_, i) => i * dt), total, synthetic: false };
  }
  const xy: [number, number][] = tr.length >= 2 ? tr.map((p) => [p[0], p[1]]) : [[th.from[0], th.from[1]], [th.land[0], th.land[1]]];
  const speed = 675 * (th.btn === 'R' ? 0.3 : th.btn === 'LR' ? 0.65 : 1);
  const pa = (-10 + (th.ang[0] * 8) / 9) * (Math.PI / 180);
  const vh = Math.max(60, speed * Math.cos(pa)), vz = -speed * Math.sin(pa) + (th.move === 'jump' || th.move === 'runjump' ? 250 : 0);
  const z0 = th.from[2] + eyeHeight(th.move);
  const pts: THREE.Vector3[] = [], t: number[] = [];
  let dist = 0, landed = false, tLand = 0;
  for (let i = 0; i < xy.length; i++) {
    if (i) dist += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
    let ti = dist / vh;
    let z = z0 + vz * ti - 0.5 * GRAVITY * ti * ti;
    if (landed || (z < th.land[2] && vz - GRAVITY * ti < 0)) {
      if (!landed) { landed = true; tLand = ti; }
      z = th.land[2];
      ti = tLand + (ti - tLand) * 2.5; // rolling is slower than flight
    }
    pts.push(toThree(xy[i][0], xy[i][1], z));
    t.push(ti);
  }
  return { pts, t, total: t[t.length - 1] || 1, synthetic: true };
}

/** position on the path at time s (linear between samples — they are ≤0.4 s apart) */
export function pathAt(p: Path, s: number, out = new THREE.Vector3()) {
  if (s <= 0) return out.copy(p.pts[0]);
  if (s >= p.total) return out.copy(p.pts[p.pts.length - 1]);
  let i = 1;
  while (i < p.t.length - 1 && p.t[i] < s) i++;
  const a = p.t[i - 1], b = p.t[i];
  return out.copy(p.pts[i - 1]).lerp(p.pts[i], b > a ? (s - a) / (b - a) : 1);
}

/** where the camera looks when the grenade lands: a bit above the landing point */
export function landPoint(th: Throw) {
  return toThree(th.land[0], th.land[1], th.land[2]);
}

// ---- textured maps (real CS2 geometry + textures from the game files, tools/maps3d/build_textured.mjs) ----
/** maps that have a textured .glb next to the collision mesh */
export const TEXTURED_MAPS = new Set(['de_mirage']);
const texCache = new Map<string, Promise<THREE.Group>>();

/** loads public/maps3d/<map>.glb (meshopt-compressed, already in three/Source units); shared between replays */
export function loadTexturedMap(map: string, onProgress?: (share: number) => void): Promise<THREE.Group> {
  let p = texCache.get(map);
  if (!p) {
    p = (async () => {
      const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/libs/meshopt_decoder.module.js'),
      ]);
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(BASE + map + '.glb', (e) => { if (e.total) onProgress?.(e.loaded / e.total); });
      const group = gltf.scene;
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const src = mesh.material as THREE.MeshStandardMaterial;
        const name = (src.name || '').toLowerCase();
        const cutout = src.alphaTest > 0;
        const decal = src.transparent || /decal|overlay|stain|trans|spray|graffiti/.test(name);
        // Lambert: no specular — CS2 maps are mostly matte, and it is much cheaper than PBR
        const mat = new THREE.MeshLambertMaterial({
          name: src.name,
          map: src.map,
          color: src.color,
          vertexColors: !!mesh.geometry.getAttribute('color'),
          transparent: src.transparent,
          alphaTest: src.alphaTest,
          side: cutout ? THREE.DoubleSide : THREE.FrontSide,
          depthWrite: !src.transparent,
          polygonOffset: decal,
          polygonOffsetFactor: decal ? -2 : 0,
          polygonOffsetUnits: decal ? -2 : 0,
          emissiveMap: src.emissiveMap,
          emissive: src.emissiveMap ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
        });
        if (mat.map) { mat.map.anisotropy = 8; mat.map.colorSpace = THREE.SRGBColorSpace; }
        src.dispose();
        mesh.material = mat;
        mesh.renderOrder = decal ? 1 : 0;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
      });
      group.userData.keep = true; // owned by the cache, not by one replay
      return group;
    })();
    p.catch(() => texCache.delete(map));
    texCache.set(map, p);
  }
  return p;
}
