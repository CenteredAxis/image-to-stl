let crc32Table: Uint32Array | null = null;

function getCrc32Table(): Uint32Array {
  if (!crc32Table) {
    crc32Table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crc32Table[i] = c;
    }
  }
  return crc32Table;
}

export function crc32(data: Uint8Array): number {
  const table = getCrc32Table();
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

export function buildZip(files: { name: string; data: Uint8Array }[]): Blob {
  const entries: { offset: number; nameBytes: Uint8Array; crc: number; size: number }[] = [];
  let centralOffset = 0;
  const localParts: Uint8Array[] = [];

  for (const f of files) {
    const nameBytes = new TextEncoder().encode(f.name);
    const header = new ArrayBuffer(30);
    const hv = new DataView(header);
    hv.setUint32(0, 0x04034b50, true);
    hv.setUint16(4, 20, true);
    hv.setUint16(6, 0, true);
    hv.setUint16(8, 0, true);
    hv.setUint16(10, 0, true);
    hv.setUint16(12, 0, true);
    const fileCrc = crc32(f.data);
    hv.setUint32(14, fileCrc, true);
    hv.setUint32(18, f.data.length, true);
    hv.setUint32(22, f.data.length, true);
    hv.setUint16(26, nameBytes.length, true);
    hv.setUint16(28, 0, true);

    entries.push({ offset: centralOffset, nameBytes, crc: fileCrc, size: f.data.length });
    localParts.push(new Uint8Array(header), nameBytes, f.data);
    centralOffset += 30 + nameBytes.length + f.data.length;
  }

  const centralParts: Uint8Array[] = [];
  const centralStart = centralOffset;
  for (const e of entries) {
    const cd = new ArrayBuffer(46);
    const cv = new DataView(cd);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, e.crc, true);
    cv.setUint32(20, e.size, true);
    cv.setUint32(24, e.size, true);
    cv.setUint16(28, e.nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, e.offset, true);
    centralParts.push(new Uint8Array(cd), e.nameBytes);
    centralOffset += 46 + e.nameBytes.length;
  }

  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralOffset - centralStart, true);
  ev.setUint32(16, centralStart, true);
  ev.setUint16(20, 0, true);

  const all = concatBytes([...localParts, ...centralParts, new Uint8Array(eocd)]);
  // Transfer to a plain ArrayBuffer to satisfy strict Blob typing
  const plain = all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer;
  return new Blob([plain], { type: 'application/zip' });
}
