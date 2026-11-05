// In-game preview ("masked inspect link") generator for CS2.
// Encodes a CEconItemPreviewDataBlock protobuf, prefixes 0x00 and appends the checksum the game
// expects. The format follows the MIT-licensed cs2-inspect-create package
// (github.com/candyboyz/cs2-inspect-create); this is an independent dependency-free implementation.

export type InspectSticker = { slot: number; id: number; wear?: number; rotation?: number; offsetX?: number; offsetY?: number; scale?: number; pattern?: number };
export type InspectItem = {
  defindex: number;
  paintindex: number;
  paintseed?: number;
  paintwear?: number;
  rarity?: number;
  quality?: number;
  stattrak?: boolean;
  stickers?: InspectSticker[];
  keychains?: InspectSticker[];
};

class W {
  b: number[] = [];
  varint(v: number) {
    v = v >>> 0;
    while (v > 0x7f) { this.b.push((v & 0x7f) | 0x80); v >>>= 7; }
    this.b.push(v);
  }
  tag(field: number, wire: number) { this.varint((field << 3) | wire); }
  u32(field: number, v: number | undefined) { if (v == null) return; this.tag(field, 0); this.varint(v); }
  f32(field: number, v: number | undefined) {
    if (v == null) return;
    this.tag(field, 5);
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, v, true);
    for (let i = 0; i < 4; i++) this.b.push(dv.getUint8(i));
  }
  msg(field: number, inner: W) { this.tag(field, 2); this.varint(inner.b.length); this.b.push(...inner.b); }
}

function floatBits(f: number) {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, f);
  return dv.getUint32(0);
}

let CRC: Int32Array | null = null;
function crc32(bytes: number[]) {
  if (!CRC) {
    CRC = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? -306674912 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c;
    }
  }
  let c = -1;
  for (const x of bytes) c = (c >>> 8) ^ CRC[(c ^ x) & 0xff];
  return ~c;
}

function sticker(s: InspectSticker) {
  const w = new W();
  w.u32(1, s.slot);
  w.u32(2, s.id);
  w.f32(3, s.wear ?? 0);
  if (s.scale != null) w.f32(4, s.scale);
  w.f32(5, s.rotation ?? 0);
  if (s.offsetX != null) w.f32(7, s.offsetX);
  if (s.offsetY != null) w.f32(8, s.offsetY);
  if (s.pattern != null) w.u32(10, s.pattern);
  return w;
}

export function inspectHex(item: InspectItem): string {
  const w = new W();
  w.u32(3, item.defindex);
  w.u32(4, item.paintindex);
  w.u32(5, item.rarity);
  w.u32(6, item.quality);
  w.u32(7, floatBits(item.paintwear ?? 0.001));
  w.u32(8, item.paintseed ?? 0);
  if (item.stattrak) { w.u32(9, 0); w.u32(10, 0); }
  for (const s of item.stickers || []) w.msg(12, sticker(s));
  for (const k of item.keychains || []) w.msg(20, sticker(k));
  const payload = [0, ...w.b];
  const crc = crc32(payload);
  const x = ((crc & 0xffff) ^ (w.b.length * crc)) >>> 0;
  const all = [...payload, (x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff];
  return all.map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}
export const inspectLink = (item: InspectItem) => `steam://rungame/730/76561202255233023/+csgo_econ_action_preview%20${inspectHex(item)}`;

/** `!gen` command for community servers (5 sticker slots as id/wear pairs) */
export function genCommand(item: InspectItem): string {
  const slots = Array.from({ length: 5 }, () => [0, 0]);
  for (const s of item.stickers || []) if (s.slot >= 0 && s.slot < 5) slots[s.slot] = [s.id, +(s.wear ?? 0).toFixed(2)];
  return `!gen ${item.defindex} ${item.paintindex} ${item.paintseed ?? 0} ${item.paintwear ?? 0.001} ${slots.map((s) => s.join(' ')).join(' ')}`;
}
