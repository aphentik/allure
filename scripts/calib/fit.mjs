// Minimal FIT decoder: extracts `record` messages (timestamp, position, altitude, speed, power, heart_rate).
// Handles definition/data messages, developer fields (skipped), compressed timestamps, big/little endian.
const BASE_SIZE = { 0: 1, 1: 1, 2: 1, 131: 2, 132: 2, 133: 4, 134: 4, 136: 4, 137: 8, 7: 1, 10: 1, 139: 2, 140: 4, 142: 8, 143: 8, 144: 8 };
const REC = { 253: 'timestamp', 0: 'lat', 1: 'lon', 2: 'altitude', 5: 'distance', 6: 'speed', 7: 'power', 3: 'heart_rate', 78: 'enhanced_altitude', 73: 'enhanced_speed', 13: 'temperature' };
export function parseFIT(buf) {
  const dv = new DataView(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength);
  const hdrLen = dv.getUint8(0), dataSize = dv.getUint32(4, true); let p = hdrLen; const end = Math.min(dv.byteLength, hdrLen + dataSize);
  const defs = {}, records = []; let lastTs = 0;
  while (p < end) {
    const h = dv.getUint8(p++);
    if (h & 0x80) { // compressed timestamp header
      const lt = h & 0x0f, off = h & 0x1f; const d = defs[lt]; if (!d) break; lastTs = (lastTs & ~0x1f) + off + ((off < (lastTs & 0x1f)) ? 0x20 : 0);
      p = readData(dv, p, d, records, lastTs); continue;
    }
    const lt = h & 0x0f;
    if (h & 0x40) { // definition
      p++; const arch = dv.getUint8(p++), le = arch === 0, gnum = dv.getUint16(p, le); p += 2; const nf = dv.getUint8(p++); const fields = [];
      for (let i = 0; i < nf; i++) { fields.push({ num: dv.getUint8(p), size: dv.getUint8(p + 1), type: dv.getUint8(p + 2) }); p += 3; }
      let devSize = 0; if (h & 0x20) { const nd = dv.getUint8(p++); for (let i = 0; i < nd; i++) { devSize += dv.getUint8(p + 1); p += 3; } }
      defs[lt] = { gnum, le, fields, devSize, size: fields.reduce((a, f) => a + f.size, 0) + devSize };
    } else { const d = defs[lt]; if (!d) break; const r = readData(dv, p, d, records, null); if (records.length && records[records.length - 1].timestamp) lastTs = records[records.length - 1].timestamp; p = r; }
  }
  return records;
}
function readData(dv, p, d, records, tsOverride) {
  if (d.gnum !== 20) return p + d.size; // only `record` messages
  const rec = {}; let q = p;
  for (const f of d.fields) {
    const name = REC[f.num]; let v = null;
    if (name && (f.size === (BASE_SIZE[f.type] || f.size))) {
      const t = f.type & 0x1f, le = d.le;
      if (t === 0x0c || t === 0x06 || t === 0x86) v = dv.getUint32(q, le); else if (t === 0x05 || t === 0x85) v = dv.getInt32(q, le); else if (t === 0x04 || t === 0x84) v = dv.getUint16(q, le); else if (t === 0x03 || t === 0x83) v = dv.getInt16(q, le); else if (t === 0x02 || t === 0x0a) v = dv.getUint8(q); else if (t === 0x01) v = dv.getInt8(q);
      if (v != null) { const inv = f.size === 4 ? (t === 0x05 || t === 0x85 ? 0x7fffffff : 0xffffffff) : f.size === 2 ? (t === 0x03 || t === 0x83 ? 0x7fff : 0xffff) : (t === 0x01 ? 0x7f : 0xff); if (v === inv) v = null; }
    }
    if (v != null) rec[name] = v; q += f.size;
  }
  q += d.devSize;
  if (tsOverride != null) rec.timestamp = tsOverride;
  if (rec.timestamp != null) records.push(rec);
  return q;
}
// → [{t (unix s), lat, lon, ele, power?, hr?, dist?}]
export function fitToPoints(records) {
  const FIT_EPOCH = 631065600, out = [];
  for (const r of records) {
    if (r.lat == null || r.lon == null) continue;
    const ele = r.enhanced_altitude != null ? r.enhanced_altitude / 5 - 500 : (r.altitude != null ? r.altitude / 5 - 500 : null);
    out.push({ t: r.timestamp + FIT_EPOCH, lat: r.lat * (180 / 2147483648), lon: r.lon * (180 / 2147483648), ele, power: r.power != null ? r.power : null, hr: r.heart_rate != null ? r.heart_rate : null, dist: r.distance != null ? r.distance / 100 : null });
  }
  return out;
}
