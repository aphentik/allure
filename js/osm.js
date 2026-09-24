// OpenStreetMap enrichment via Overpass: climb names + drinking-water points.
import { S, uid } from './state.js';
import { llAtKm, nearestKm, hav } from './gpx.js';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
function overpass(query) {
  let i = 0, retried = false;
  const tryNext = () => {
    if (i >= ENDPOINTS.length) return Promise.reject(new Error('overpass'));
    const url = ENDPOINTS[i++], ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 15000);
    return fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal })
      .then(r => { clearTimeout(tm);
        if (r.status === 429 && !retried) { retried = true; i--; return new Promise(res => setTimeout(res, 6000)).then(tryNext); } // throttled: wait once, same endpoint
        if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .catch(() => { clearTimeout(tm); return tryNext(); });
  };
  return tryNext();
}
const PRIO = n => n.tags.mountain_pass === 'yes' || n.tags.natural === 'saddle' ? 0 : (n.tags.natural === 'peak' ? 1 : 2);

// Names unnamed climbs: passes/saddles within 600 m, else peaks/places within 1 km of the summit. Returns count named.
const MAXD = { 0: 600, 1: 1000, 2: 1000 };
export function nameClimbsFromOSM(race, D) {
  const climbs = race.segments.filter(s => s.type === 'climb' && !s.name);
  if (!climbs.length) return Promise.resolve(0);
  const pts = climbs.map(s => llAtKm(race, D, s.to));
  const q = '[out:json][timeout:20];(' + pts.map(p => { const a = 'around:1000,' + p.lat.toFixed(5) + ',' + p.lon.toFixed(5);
    return 'node(' + a + ')["mountain_pass"="yes"]["name"];node(' + a + ')["natural"="saddle"]["name"];node(' + a + ')["natural"="peak"]["name"];node(' + a + ')["place"~"^(village|hamlet|locality|isolated_dwelling|neighbourhood)$"]["name"];'; }).join('') + ');out body;';
  return overpass(q).then(j => {
    const nodes = (j.elements || []).filter(n => n.tags && n.tags.name); let named = 0;
    climbs.forEach((s, i) => {
      const p = pts[i]; let best = null, bk = Infinity;
      nodes.forEach(n => { const d = hav(p.lat, p.lon, n.lat, n.lon), pr = PRIO(n); if (d > MAXD[pr]) return; const k = pr * 1000 + d; if (k < bk) { bk = k; best = n; } });
      if (best) { s.name = best.tags.name; named++; }
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
