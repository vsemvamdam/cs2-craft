#!/usr/bin/env node
// Textured CS2 map for the 3D replay: Source 2 Viewer glTF export → one small .glb for the site.
//
//   cd tools/maps3d && npm i
//   node build_textured.mjs <export>/de_mirage.gltf ../../public/maps3d/de_mirage.glb [--tex 512] [--simplify 0.0004]
//
// The export comes from the player's own copy of the game (Source2Viewer-CLI … -d --gltf_export_format gltf
// --gltf_export_materials --gltf_textures_adapt), see README in this folder. What happens here:
//   • tool brushes (clip, nodraw, triggers, sky boxes) are dropped — they are invisible in the game;
//   • only the colour texture of each material is kept (plus vertex colours: baked lighting on props);
//   • metres → Source units and the exporter's axes → the site's three axes (Source x, z, −y) are baked in;
//   • pieces are merged per material, welded, lightly simplified, quantized and meshopt-compressed;
//   • textures are resized to ≤512 px and stored as WebP.
// Missing texture files are tolerated (the material keeps a neutral colour) so a partial export still builds.

import fs from 'node:fs';
import path from 'node:path';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, weld, join, simplify, quantize, textureCompress, transformMesh } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const [SRC, OUT] = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!SRC || !OUT) { console.error('usage: node build_textured.mjs export/de_mirage.gltf out/de_mirage.glb'); process.exit(1); }
const TEX = +opt('tex', 512);
const SIMPLIFY = +opt('simplify', 0.0004);
const INCH = 1 / 0.0254; // Source 2 Viewer writes metres

const isTool = (name) => /^materials\/tools\//i.test(name) || /tools(nodraw|clip|trigger|skybox|invisible|playerclip|blocklight|black)/i.test(name);

// ---- 1. prune the glTF JSON before loading: tool primitives, unused / missing images, extra texture slots
const dir = path.dirname(path.resolve(SRC));
const g = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const matName = (m) => m?.extras?.vmat?.Name || m?.name || '';
let dropped = 0;
for (const mesh of g.meshes) {
  const keep = mesh.primitives.filter((p) => !(p.material != null && isTool(matName(g.materials[p.material]))));
  dropped += mesh.primitives.length - keep.length;
  mesh.primitives = keep;
}
const usedImg = new Map();
let missing = 0;
for (const m of g.materials || []) {
  delete m.normalTexture; delete m.occlusionTexture;
  if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.metallicRoughnessTexture;
  for (const slot of [m.pbrMetallicRoughness?.baseColorTexture, m.emissiveTexture]) {
    if (!slot) continue;
    const img = g.images[g.textures[slot.index].source];
    const file = path.join(dir, decodeURIComponent(img.uri));
    if (!fs.existsSync(file)) { slot.missing = true; missing++; continue; }
    if (!usedImg.has(img.uri)) usedImg.set(img.uri, usedImg.size);
    slot.index = usedImg.get(img.uri);
  }
  if (m.pbrMetallicRoughness?.baseColorTexture?.missing) {
    delete m.pbrMetallicRoughness.baseColorTexture;
    m.pbrMetallicRoughness.baseColorFactor = [0.62, 0.56, 0.48, 1];
  }
  if (m.emissiveTexture?.missing) delete m.emissiveTexture;
  m.pbrMetallicRoughness = { ...(m.pbrMetallicRoughness || {}), metallicFactor: 0, roughnessFactor: 1 };
  delete m.extras;
}
g.images = [...usedImg.keys()].map((uri) => ({ uri: path.join(dir, decodeURIComponent(uri)) }));
g.textures = g.images.map((_, i) => ({ source: i, sampler: 0 }));
const tmp = path.join(path.dirname(path.resolve(OUT)), '.' + path.basename(OUT) + '.tmp.gltf');
g.buffers = g.buffers.map((b) => ({ ...b, uri: path.join(dir, decodeURIComponent(b.uri)) }));
fs.mkdirSync(path.dirname(tmp), { recursive: true });
fs.writeFileSync(tmp, JSON.stringify(g));
console.log(`tool primitives dropped: ${dropped}; colour textures: ${usedImg.size}${missing ? `, missing files: ${missing}` : ''}`);

// ---- 2. load and clean
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(tmp);
fs.rmSync(tmp);
const root = doc.getRoot();
for (const s of root.listSkins()) s.dispose();
const KEEP = new Set(['POSITION', 'NORMAL', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0']);
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    for (const sem of prim.listSemantics()) if (!KEEP.has(sem)) prim.setAttribute(sem, null);
    if (!prim.getMaterial()) prim.dispose();
  }
  if (!mesh.listPrimitives().length) mesh.dispose();
}
for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'KHR_lights_punctual') ext.dispose();

// bake node transforms + metres→inches into the meshes. Instanced props share one mesh: first give every
// further instance its own copy of the primitives (made before anything is transformed), then transform each.
const seen = new Set();
const jobs = [];
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  let target = mesh;
  if (seen.has(mesh)) {
    target = doc.createMesh(mesh.getName());
    for (const p of mesh.listPrimitives()) target.addPrimitive(p.clone());
    node.setMesh(target);
  }
  seen.add(mesh);
  jobs.push([node, target]);
}
// Source 2 Viewer axes: X = Source y, Y = Source z, Z = Source x (checked against the collision mesh bounds).
// The site uses three = (Source x, Source z, −Source y), i.e. three = (Z, Y, −X): a rotation, no mirroring.
const R = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1]; // column-major
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
for (const [node, mesh] of jobs) {
  const w = node.getWorldMatrix().slice();
  for (let i = 0; i < 12; i++) w[i] *= INCH;
  w[12] *= INCH; w[13] *= INCH; w[14] *= INCH;
  const m = mul(R, w);
  transformMesh(mesh, m); // detaches accessors still shared with other meshes before writing
  node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

if (process.env.DEBUG_FAR) {
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
    const a = prim.getAttribute('POSITION'), v = [0, 0, 0];
    let mx = 0;
    for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); mx = Math.max(mx, Math.abs(v[0]), Math.abs(v[2])); }
    if (mx > 8000) console.log('far:', mesh.getName(), prim.getMaterial()?.getName(), a.getCount(), Math.round(mx), prim.listSemantics().join(','));
  }
}
const tris = () => root.listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + (p.getIndices()?.getCount() || p.getAttribute('POSITION').getCount()) / 3, 0), 0);
console.log(`meshes ${root.listMeshes().length}, triangles ${Math.round(tris())}`);

await doc.transform(
  dedup(),
  prune(),
  join({ keepNamed: false }),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0, error: SIMPLIFY, lockBorder: true }),
  prune(),
);
console.log(`after merge/simplify: meshes ${root.listMeshes().length}, primitives ${root.listMeshes().reduce((a, m) => a + m.listPrimitives().length, 0)}, triangles ${Math.round(tris())}`);
const b = getBounds(root.listScenes()[0]);
console.log('bounds (three units = Source inches):', b.min.map(Math.round), b.max.map(Math.round));

await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEX, TEX], quality: 80 }),
  quantize({ quantizePosition: 16, quantizeTexcoord: 14, quantizeColor: 8, quantizeNormal: 8 }),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(OUT, doc);
console.log(`→ ${OUT}: ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB`);
