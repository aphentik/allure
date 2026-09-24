// OpenStreetMap enrichment via Overpass: climb names + drinking-water points.
import { S, uid } from './state.js';
import { llAtKm, nearestKm, hav, PROFILE_STEP_KM } from './gpx.js';

const ENDPOINTS = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const PHOTON = 'https://photon.komoot.io/reverse';
// 7-day localStorage cache keyed by query text: the same track is never queried twice
const CACHE_TTL = 7 * 86400000;
function qkey(q) { let h = 2166136261; for (let i = 0; i < q.length; i++) { h ^= q.charCodeAt(i); h = Math.imul(h, 16777619); } return 'allure-ov-' + (h >>> 0).toString(36); }
function cacheGet(q) { try { const e = JSON.parse(localStorage.getItem(qkey(q)) || 'null'); if (e && Date.now() - e.t < CACHE_TTL) return e.j; } catch (e) {} return null; }
function cacheSet(q, j) { try { const txt = JSON.stringify({ t: Date.now(), j }); if (txt.length < 400000) localStorage.setItem(qkey(q), txt); } catch (e) {} }
function overpass(query) {
  const hit = cacheGet(query); if (hit) return Promise.resolve(hit);
  let i = 0, retried = false;
  const tryNext = () => {
    if (i >= ENDPOINTS.length) return Promise.reject(new Error('overpass'));
    const url = ENDPOINTS[i++], ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 15000);
    return fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal })
      .then(r => { clearTimeout(tm);
        if (r.status === 429 && !retried) { retried = true; i--; return new Promise(res => setTimeout(res, 6000)).then(tryNext); } // throttled: wait once, same endpoint
        if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(j => { cacheSet(query, j); return j; })
      .catch(() => { clearTimeout(tm); return tryNext(); });
  };
  return tryNext();
}
const PRIO = n => n.tags.mountain_pass === 'yes' || n.tags.natural === 'saddle' ? 0 : (n.tags.natural === 'peak' ? 1 : 2);

// Names unnamed climbs. Primary: Photon reverse geocoding (one request per summit, cached);
// fallback: Overpass. Passes/saddles within 600 m, else peaks/places within 1 km.
const MAXD = { 0: 1000, 1: 1000, 2: 1000 };
// true summit of a climb: highest profile point within ±1.5 km of the detected end (the grade flattens before the pass sign)
function summitKm(D, s) { const P = D.profile, i0 = Math.max(0, Math.round((s.to - 1.5) / PROFILE_STEP_KM)), i1 = Math.min(P.length - 1, Math.round((s.to + 1.5) / PROFILE_STEP_KM)); let best = s.to, ba = -Infinity; for (let i = i0; i <= i1; i++) if (P[i][1] > ba) { ba = P[i][1]; best = P[i][0]; } return D.hasEle ? best : s.to; }
const prioTag = (k, v) => (k === 'mountain_pass' || (k === 'natural' && v === 'saddle')) ? 0 : (k === 'natural' && v === 'peak' ? 1 : 2);
function photonName(p) {
  const url = PHOTON + '?lat=' + p.lat.toFixed(5) + '&lon=' + p.lon.toFixed(5) + '&radius=1&limit=25&lang=fr' +
    ['mountain_pass:yes', 'natural:saddle', 'natural:peak', 'place:village', 'place:hamlet', 'place:locality', 'place:isolated_dwelling'].map(t => '&osm_tag=' + t).join('');
  const hit = cacheGet(url); if (hit) return Promise.resolve(hit);
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 10000);
  return fetch(url, { signal: ctl.signal }).then(r => { clearTimeout(tm); if (!r.ok) throw new Error('http ' + r.status); return r.json(); }).then(j => {
    let best = null, bk = Infinity, src = '';
    (j.features || []).forEach(f => { const pr = f.properties || {}, c = f.geometry && f.geometry.coordinates; if (!pr.name || !c) return;
      const d = hav(p.lat, p.lon, c[1], c[0]), k0 = prioTag(pr.osm_key, pr.osm_value); if (d > MAXD[k0]) return; const k = k0 * 1000 + d; if (k < bk) { bk = k; best = pr.name; src = k0 === 0 ? 'pass' : (k0 === 1 ? 'peak' : 'place'); } });
    const res = { name: best || '', src }; cacheSet(url, res); return res;
  });
}
export function nameClimbsFromOSM(race, D) {
  const climbs = race.segments.filter(s => s.type === 'climb' && !s.name);
  if (!climbs.length) return Promise.resolve(0);
  const pts = climbs.map(s => llAtKm(race, D, summitKm(D, s)));
  let named = 0, failed = false;
  const step = i => { if (i >= climbs.length) return Promise.resolve();
    return photonName(pts[i]).then(r => { if (r.name) { climbs[i].name = r.name; climbs[i].nameSrc = r.src; named++; } }).catch(() => { failed = true; })
      .then(() => failed ? null : new Promise(res => setTimeout(res, 250)).then(() => step(i + 1))); };
  return step(0).then(() => failed ? nameClimbsOverpass(race, D).then(n => named + n) : named);
}
function nameClimbsOverpass(race, D) {
  const climbs = race.segments.filter(s => s.type === 'climb' && !s.name);
  if (!climbs.length) return Promise.resolve(0);
  const pts = climbs.map(s => llAtKm(race, D, summitKm(D, s)));
  const q = '[out:json][timeout:20];(' + pts.map(p => { const a = 'around:1000,' + p.lat.toFixed(5) + ',' + p.lon.toFixed(5);
    return 'node(' + a + ')["mountain_pass"="yes"]["name"];node(' + a + ')["natural"="saddle"]["name"];node(' + a + ')["natural"="peak"]["name"];node(' + a + ')["place"~"^(village|hamlet|locality|isolated_dwelling|neighbourhood)$"]["name"];'; }).join('') + ');out body;';
  return overpass(q).then(j => {
    const nodes = (j.elements || []).filter(n => n.tags && n.tags.name); let named = 0;
    climbs.forEach((s, i) => {
      const p = pts[i]; let best = null, bk = Infinity;
      nodes.forEach(n => { const d = hav(p.lat, p.lon, n.lat, n.lon), pr = PRIO(n); if (d > MAXD[pr]) return; const k = pr * 1000 + d; if (k < bk) { bk = k; best = n; } });
      if (best) { s.name = best.tags.name; s.nameSrc = PRIO(best) === 0 ? 'pass' : (PRIO(best) === 1 ? 'peak' : 'place'); named++; }
    });
    return named;
  });
}
// Adds drinking-water points within 80 m of the track as fountain waypoints. Returns count added.
export function fountainsFromOSM(race, D) {
  const pts = race.track.pts, stride = Math.max(1, Math.ceil(pts.length / 400));
  const line = []; for (let i = 0; i < pts.length; i += stride) line.push(pts[i][0].toFixed(5) + ',' + pts[i][1].toFixed(5)); line.push(pts[pts.length - 1][0].toFixed(5) + ',' + pts[pts.length - 1][1].toFixed(5));
  const a = 'around:80,' + line.join(',');
  const q = '[out:json][timeout:25];(node(' + a + ')["amenity"="drinking_water"];node(' + a + ')["man_made"="water_tap"];node(' + a + ')["natural"="spring"]["drinking_water"="yes"];node(' + a + ')["amenity"="fountain"]["drinking_water"="yes"];);out body;';
  return overpass(q).then(j => {
    const existing = (race.waypoints || []).filter(w => w.kind === 'fountain').map(w => llAtKm(race, D, w.km)); let added = 0;
    (j.elements || []).forEach(n => {
      if (existing.some(e => hav(e.lat, e.lon, n.lat, n.lon) < 150)) return;
      const s = nearestKm(race, D, n.lat, n.lon); if (s.dist > 120) return;
      const t = n.tags || {}, desc = [t.description, t.operator, t.seasonal === 'yes' ? 'saisonnier' : '', t.fee === 'yes' ? 'payant' : ''].filter(Boolean).join(' · ');
      race.waypoints.push({ id: uid('w'), kind: 'fountain', km: +s.km.toFixed(1), name: t.name || '', desc, time: '', src: 'osm' });
      existing.push({ lat: n.lat, lon: n.lon }); added++;
    });
    return added;
  });
}
