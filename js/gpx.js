// GPX parsing, track building (cumulative distance, smoothing, resampling, D+).
export function hav(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180, d1 = (lat2 - lat1) * r, d2 = (lon2 - lon1) * r;
  const x = Math.sin(d1 / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(d2 / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function num(el, tag) { const c = el.getElementsByTagNameNS('*', tag)[0]; if (!c) return null; const v = parseFloat(c.textContent); return isFinite(v) ? v : null; }
function txt(el, tag) { const c = el.getElementsByTagNameNS('*', tag)[0]; return c ? c.textContent.trim() : ''; }

// -> {name, pts:[[lat,lon,ele|null]], wpts:[{lat,lon,name,sym,type,desc}]}
export function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('xml');
  let els = Array.from(doc.getElementsByTagNameNS('*', 'trkpt'));
  if (!els.length) els = Array.from(doc.getElementsByTagNameNS('*', 'rtept'));
  if (!els.length) throw new Error('no points');
  const pts = [];
  els.forEach(e => {
    const lat = parseFloat(e.getAttribute('lat')), lon = parseFloat(e.getAttribute('lon'));
    if (!isFinite(lat) || !isFinite(lon)) return;
    pts.push([lat, lon, num(e, 'ele')]);
  });
  const wpts = Array.from(doc.getElementsByTagNameNS('*', 'wpt')).map(w => ({
    lat: parseFloat(w.getAttribute('lat')), lon: parseFloat(w.getAttribute('lon')),
    name: txt(w, 'name'), sym: txt(w, 'sym'), type: txt(w, 'type'), desc: txt(w, 'desc') || txt(w, 'cmt')
  })).filter(w => isFinite(w.lat) && isFinite(w.lon));
  let name = '';
  const md = doc.getElementsByTagNameNS('*', 'metadata')[0]; if (md) name = txt(md, 'name');
  if (!name) { const tk = doc.getElementsByTagNameNS('*', 'trk')[0]; if (tk) name = txt(tk, 'name'); }
  return { name, pts, wpts };
}

export const DPLUS_HYST_M = 5;
export const PROFILE_STEP_KM = 0.1;

// Builds derived data from raw points. pts: [[lat,lon,ele]]
export function buildTrack(pts) {
  const n = pts.length;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + hav(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  const totalM = cum[n - 1];
  let missing = 0; for (let i = 0; i < n; i++) if (pts[i][2] == null) missing++;
  const hasEle = n > 1 && missing / n < 0.2;

  // elevation series with gaps filled, clamp spikes (±25 % per step)
  let ele = new Float64Array(n);
  if (hasEle) {
    let last = null;
    for (let i = 0; i < n; i++) { const e = pts[i][2]; if (e != null) last = e; ele[i] = last == null ? NaN : last; }
    for (let i = 0; i < n && isNaN(ele[i]); i++) { let j = i; while (j < n && isNaN(ele[j])) j++; ele[i] = j < n ? ele[j] : 0; }
    for (let i = 1; i < n; i++) { const d = cum[i] - cum[i - 1]; if (d > 0) { const mx = 0.25 * d; const dz = ele[i] - ele[i - 1]; if (Math.abs(dz) > mx) ele[i] = ele[i - 1] + Math.sign(dz) * mx; } }
    ele = smoothByDistance(ele, cum, 100);
  }

  // resample to fixed step
  const stepM = PROFILE_STEP_KM * 1000, m = Math.max(2, Math.floor(totalM / stepM) + 1);
  const profile = [];
  let j = 0;
  for (let k = 0; k < m; k++) {
    const d = Math.min(totalM, k * stepM);
    while (j < n - 2 && cum[j + 1] < d) j++;
    const a = cum[j], b = cum[j + 1], f = b > a ? (d - a) / (b - a) : 0;
    profile.push([d / 1000, hasEle ? ele[j] + (ele[j + 1] - ele[j]) * f : 0]);
  }
  if (profile[profile.length - 1][0] < totalM / 1000) profile.push([totalM / 1000, hasEle ? ele[n - 1] : 0]);

  let dplus = 0;
  if (hasEle) { let ref = profile[0][1]; for (let k = 1; k < profile.length; k++) { const e = profile[k][1]; if (e - ref >= DPLUS_HYST_M) { dplus += e - ref; ref = e; } else if (e < ref) ref = e; } }

  let minAlt = Infinity, maxAlt = -Infinity;
  profile.forEach(p => { if (p[1] < minAlt) minAlt = p[1]; if (p[1] > maxAlt) maxAlt = p[1]; });
  // curve radius (m) at each profile step from points 50 m before / after, bounded [15, 1000]
  const radius = new Float32Array(profile.length);
  const at = d => { let j = 0; return dd => { while (j < n - 2 && cum[j + 1] < dd) j++; const a = cum[j], b = cum[j + 1], f = b > a ? (dd - a) / (b - a) : 0; return [pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f]; }; };
  const look = at(0), kx = Math.cos((pts[0][0]) * Math.PI / 180) * 111320, ky = 110540;
  for (let k = 0; k < profile.length; k++) {
    const d = profile[k][0] * 1000;
    if (d < 50 || d > totalM - 50) { radius[k] = 1000; continue; }
    const A = look(d - 50), B = look(d), C = look(d + 50);
    const ax = (A[1] - B[1]) * kx, ay = (A[0] - B[0]) * ky, cx = (C[1] - B[1]) * kx, cy = (C[0] - B[0]) * ky;
    const cross = Math.abs(ax * cy - ay * cx), la = Math.hypot(ax, ay), lc = Math.hypot(cx, cy), lac = Math.hypot(ax - cx, ay - cy);
    const r = cross > 1e-6 ? (la * lc * lac) / (2 * cross) : 1000;
    radius[k] = Math.max(15, Math.min(1000, r));
  }
  return { cum, ele, totalKm: totalM / 1000, hasEle, profile, dplus: Math.round(dplus), minAlt, maxAlt, radius };
}

function smoothByDistance(ele, cum, halfWin) {
  const n = ele.length, out = new Float64Array(n);
  let lo = 0, hi = 0, sum = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    while (hi < n && cum[hi] <= cum[i] + halfWin) { sum += ele[hi]; cnt++; hi++; }
    while (lo < hi && cum[lo] < cum[i] - halfWin) { sum -= ele[lo]; cnt--; lo++; }
    out[i] = cnt ? sum / cnt : ele[i];
  }
  return out;
}

// ---- lookups on derived data ----
export function altAtKm(D, km) {
  const P = D.profile, step = PROFILE_STEP_KM;
  if (km <= 0) return P[0][1];
  const i = Math.min(P.length - 2, Math.floor(km / step));
  const a = P[i], b = P[i + 1], f = b[0] > a[0] ? (km - a[0]) / (b[0] - a[0]) : 0;
  return a[1] + (b[1] - a[1]) * Math.max(0, Math.min(1, f));
}
export function gradAtKm(D, km) {
  const P = D.profile, i = Math.max(0, Math.min(P.length - 2, Math.floor(km / PROFILE_STEP_KM)));
  const a = P[i], b = P[i + 1]; return b[0] > a[0] ? (b[1] - a[1]) / ((b[0] - a[0]) * 1000) * 100 : 0;
}
// average grade over a 1 km window centred on km (for tooltips)
export function gradAround(D, km, win) {
  const a = Math.max(0, km - win / 2), b = Math.min(D.totalKm, km + win / 2);
  return b > a ? (altAtKm(D, b) - altAtKm(D, a)) / ((b - a) * 1000) * 100 : 0;
}
export function llAtKm(race, D, km) {
  const pts = race.track.pts, cum = D.cum, d = km * 1000, n = pts.length;
  if (d <= 0) return { lat: pts[0][0], lon: pts[0][1], ele: D.hasEle ? D.ele[0] : 0, idx: 0 };
  if (d >= cum[n - 1]) return { lat: pts[n - 1][0], lon: pts[n - 1][1], ele: D.hasEle ? D.ele[n - 1] : 0, idx: n - 1 };
  let lo = 1, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < d) lo = mid + 1; else hi = mid; }
  const a = lo - 1, b = lo, f = cum[b] > cum[a] ? (d - cum[a]) / (cum[b] - cum[a]) : 0;
  return { lat: pts[a][0] + (pts[b][0] - pts[a][0]) * f, lon: pts[a][1] + (pts[b][1] - pts[a][1]) * f, ele: D.hasEle ? D.ele[a] + (D.ele[b] - D.ele[a]) * f : 0, idx: b };
}
export function bearing(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180, φ1 = lat1 * r, φ2 = lat2 * r, dλ = (lon2 - lon1) * r;
  const y = Math.sin(dλ) * Math.cos(φ2), x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}
export function bearingAtKm(race, D, km) {
  const a = llAtKm(race, D, Math.max(0, km - 0.25)), b = llAtKm(race, D, Math.min(D.totalKm, km + 0.25));
  return bearing(a.lat, a.lon, b.lat, b.lon);
}
// nearest track point to a lat/lon (linear scan over a stride)
export function nearestKm(race, D, lat, lon) {
  const pts = race.track.pts, n = pts.length, stride = Math.max(1, Math.floor(n / 3000));
  let best = -1, bd = Infinity;
  for (let i = 0; i < n; i += stride) { const d = hav(lat, lon, pts[i][0], pts[i][1]); if (d < bd) { bd = d; best = i; } }
  for (let i = Math.max(0, best - stride); i < Math.min(n, best + stride + 1); i++) { const d = hav(lat, lon, pts[i][0], pts[i][1]); if (d < bd) { bd = d; best = i; } }
  return { km: D.cum[best] / 1000, dist: bd, idx: best };
}
