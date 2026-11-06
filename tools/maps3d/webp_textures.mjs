#!/usr/bin/env node
// Re-encode JPEG/PNG textures of a built map .glb as WebP (when build_textured.mjs ran without sharp).
//   node webp_textures.mjs in.glb out.glb [--quality 80]
import fs from 'node:fs';
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const [IN, OUT] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const q = +(process.argv[process.argv.indexOf('--quality') + 1] || 80) || 80;
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
io.setLogger(new Logger(Logger.Verbosity.ERROR));
const doc = await io.read(IN);
let n = 0, before = 0, after = 0;
for (const tex of doc.getRoot().listTextures()) {
  const mime = tex.getMimeType();
  if (mime === 'image/webp') continue;
  const src = Buffer.from(tex.getImage());
  const alpha = mime === 'image/png';
  const out = await sharp(src).webp({ quality: q, alphaQuality: 90, effort: 5, ...(alpha ? {} : { smartSubsample: true }) }).toBuffer();
  before += src.length; after += out.length;
  tex.setImage(new Uint8Array(out)).setMimeType('image/webp').setURI((tex.getURI() || 'tex').replace(/\.[a-z0-9]+$/i, '') + '.webp');
  n++;
}
if (n) doc.createExtension(EXTTextureWebP).setRequired(true);
await io.write(OUT, doc);
console.log(`${IN.split('/').pop()}: ${n} textures ${(before / 1048576).toFixed(1)} → ${(after / 1048576).toFixed(1)} MB; file ${(fs.statSync(IN).size / 1048576).toFixed(1)} → ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB`);
