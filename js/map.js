import { S, on, emit, savePrefs } from './state.js';
import { t, segName, fmtClock, esc } from './i18n.js';
import { llAtKm, altAtKm, nearestKm } from './gpx.js';
import { windSeries, windDir } from './weather.js';

let map = null, layers = {}, base = {}, hoverMarker = null, ready = false;
const SEGCOL = { climb: '#f2b43d', key: '#e2503b', descent: '#74bccd', flat: '#8fa3b3' };
const WCOL = { head: '#e2503b', cross: '#f2b43d', tail: '#5fc27e', calm: '#8fa3b3' };

function ensureMap() {
  if (map || !window.L) return !!map;
  const el = document.getElementById('map'); if (!el) return false;
  map = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: false });
  base.topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' });
  base.osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>' });
  (base[S.ui.baseLayer] || base.topo).addTo(map);
  layers.track = L.layerGroup().addTo(map); layers.marks = L.layerGroup().addTo(map); layers.wind = L.layerGroup();
  if (S.ui.showWind) layers.wind.addTo(map);
  hoverMarker = L.circleMarker([0, 0], { radius: 6, color: '#0c1620', weight: 2, fillColor: '#f2b43d', fillOpacity: 1 });
  map.on('mousemove', e => { if (!S.race) return; const n = nearestKm(S.race, S.D, e.latlng.lat, e.latlng.lng); if (n.dist < 400) { emit('hover-km', { km: n.km, src: 'map' }); setHover(n.km); } else { emit('hover-km', { km: null, src: 'map' }); clearHover(); } });
  map.on('mouseout', () => { emit('hover-km', { km: null, src: 'map' }); clearHover(); });
  // controls
  const ctl = L.control({ position: 'topright' });
  ctl.onAdd = () => { const d = L.DomUtil.create('div', 'mapctl'); d.innerHTML = '<button data-base="topo">' + t('mapTopo') + '</button><button data-base="osm">' + t('mapOsm') + '</button><button data-wind="1">' + t('windBtn') + '</button>';
    L.DomEvent.disableClickPropagation(d);
    d.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.base) { Object.values(base).forEach(l => map.removeLayer(l)); base[b.dataset.base].addTo(map); S.ui.baseLayer = b.dataset.base; }
      if (b.dataset.wind) { S.ui.showWind = !S.ui.showWind; if (S.ui.showWind) layers.wind.addTo(map); else map.removeLayer(layers.wind); emit('wind-toggle'); }
      savePrefs(); syncCtl(); });
    return d; };
  ctl.addTo(map);
  const leg = L.control({ position: 'bottomleft' });
  leg.onAdd = () => { const d = L.DomUtil.create('div', 'maplegend'); d.id = 'mapLegend'; return d; };
  leg.addTo(map);
  ready = true; syncCtl();
  return true;
}
function syncCtl() { document.querySelectorAll('.mapctl button').forEach(b => { if (b.dataset.base) b.setAttribute('aria-pressed', b.dataset.base === S.ui.baseLayer); if (b.dataset.wind) b.setAttribute('aria-pressed', !!S.ui.showWind); }); }
function setHover(km) { if (!S.race) return; const ll = llAtKm(S.race, S.D, km); hoverMarker.setLatLng([ll.lat, ll.lon]); if (!map.hasLayer(hoverMarker)) hoverMarker.addTo(map); }
function clearHover() { if (hoverMarker && map && map.hasLayer(hoverMarker)) map.removeLayer(hoverMarker); }

function icon(html, cls, size) { return L.divIcon({ html, className: 'mi ' + (cls || ''), iconSize: [size || 22, size || 22], iconAnchor: [(size || 22) / 2, (size || 22) / 2] }); }

export function buildMap() {
  const w = document.getElementById('mapWrap'); if (w) w.style.display = S.race ? '' : 'none';
  if (!S.race || !ensureMap()) return;
  const race = S.race, D = S.D, pts = race.track.pts, cum = D.cum;
  layers.track.clearLayers(); layers.marks.clearLayers();
  const stride = Math.max(1, Math.floor(pts.length / 4000));
  let ci = 0;
  race.segments.forEach(s => {
    if (s.type === 'climb') ci++;
    const a = s.from * 1000, b = s.to * 1000, ll = [];
    for (let i = 0; i < pts.length; i += stride) { if (cum[i] >= a - 1 && cum[i] <= b + 1) ll.push([pts[i][0], pts[i][1]]); }
    if (ll.length < 2) return;
    const col = s.type === 'climb' ? (s.key ? SEGCOL.key : SEGCOL.climb) : SEGCOL[s.type];
    L.polyline(ll, { color: '#0c1620', weight: 7, opacity: 0.55 }).addTo(layers.track);
    const pl = L.polyline(ll, { color: col, weight: 4, opacity: 0.95 }).addTo(layers.track);
    pl.bindTooltip(esc(segName(s, s.type === 'climb' ? ci : null)) + ' · km ' + s.from + '→' + s.to + (D.hasEle ? ' · ' + s.grad + '%' : ''), { sticky: true, className: 'maptip' });
    pl.on('click', () => { const el = document.querySelector('[data-seg="' + s.id + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  });
  const p0 = pts[0], pN = pts[pts.length - 1];
  L.marker([p0[0], p0[1]], { icon: icon('▶', 'mi-start', 24) }).bindTooltip(t('mapStart')).addTo(layers.marks);
  L.marker([pN[0], pN[1]], { icon: icon('🏁', 'mi-finish', 24) }).bindTooltip(t('mapFinish')).addTo(layers.marks);
  ci = 0;
  race.segments.forEach(s => { if (s.type !== 'climb') return; ci++; const ll = llAtKm(race, D, s.to);
    L.marker([ll.lat, ll.lon], { icon: icon('▲', s.key ? 'mi-key' : 'mi-col', 22) }).bindTooltip('<b>' + esc(segName(s, ci)) + '</b><br>km ' + s.to + ' · ' + Math.round(altAtKm(D, s.to)) + ' m', { className: 'maptip' }).addTo(layers.marks); });
  (race.waypoints || []).forEach(w => {
    if (w.kind === 'fountain' && !S.settings.showFountains) return;
    if (w.kind === 'summit' || w.kind === 'foot' || w.kind === 'other') return;
    const ll = llAtKm(race, D, w.km), ic = w.kind === 'ravito' ? icon(esc(w.code || 'R'), 'mi-rav', 26) : w.kind === 'fountain' ? icon('💧', 'mi-fount', 20) : w.kind === 'barrier' ? icon('⛔', 'mi-bar', 22) : icon('⚠', 'mi-dng', 22);
    L.marker([ll.lat, ll.lon], { icon: ic }).bindTooltip('<b>' + esc(w.name || t('k' + w.kind[0].toUpperCase() + w.kind.slice(1))) + '</b><br>km ' + w.km + (w.time ? ' · ' + w.time : '') + (w.desc ? '<br>' + esc(w.desc) : ''), { className: 'maptip' }).addTo(layers.marks); });
  const bounds = L.latLngBounds(pts.filter((_, i) => i % stride === 0).map(p => [p[0], p[1]]));
  setTimeout(() => { map.invalidateSize(); map.fitBounds(bounds, { padding: [20, 20] }); }, 30);
  buildWind();
}
export function buildWind() {
  if (!map || !ready) return;
  layers.wind.clearLayers();
  const leg = document.getElementById('mapLegend');
  const ws = windSeries();
  if (!ws || !ws.length) { if (leg) leg.innerHTML = '<span class="lg-muted">' + t(S.wx.status === 'nodate' || S.wx.status === 'toofar' ? 'windNoDate' : 'windNoData') + '</span>'; return; }
  ws.forEach(w => {
    const len = 14 + Math.max(0, Math.min(1, (w.wind - 5) / 35)) * 22, sw = 2 + Math.max(0, Math.min(1, (w.wind - 5) / 35)) * 2, col = WCOL[w.cls], rot = (w.wdir + 180) % 360;
    const html = '<div class="warrow" style="transform:rotate(' + rot.toFixed(0) + 'deg)"><svg width="44" height="44" viewBox="-22 -22 44 44"><line x1="0" y1="' + (len / 2).toFixed(1) + '" x2="0" y2="' + (-len / 2).toFixed(1) + '" stroke="' + col + '" stroke-width="' + sw.toFixed(1) + '" stroke-linecap="round"/><path d="M0,' + (-len / 2).toFixed(1) + ' l-5,7 M0,' + (-len / 2).toFixed(1) + ' l5,7" stroke="' + col + '" stroke-width="' + sw.toFixed(1) + '" fill="none" stroke-linecap="round"/></svg></div><div class="wlab" style="color:' + col + '">' + Math.round(w.wind) + '</div>';
    const m = L.marker([w.lat, w.lon], { icon: L.divIcon({ html, className: 'mi-wind', iconSize: [44, 56], iconAnchor: [22, 22] }), interactive: true, zIndexOffset: -100 });
    m.bindTooltip('<b>' + t('wind' + w.cls[0].toUpperCase() + w.cls.slice(1)) + '</b><br>km ' + w.km + ' · ' + fmtClock(w.passSec) + '<br>' + Math.round(w.wind) + ' km/h ' + windDir(w.wdir) + ' · ' + t('wxGust') + ' ' + Math.round(w.gust), { className: 'maptip' });
    m.addTo(layers.wind);
  });
  if (leg) leg.innerHTML = '<span><i style="background:' + WCOL.head + '"></i>' + t('windHead') + '</span><span><i style="background:' + WCOL.cross + '"></i>' + t('windCross') + '</span><span><i style="background:' + WCOL.tail + '"></i>' + t('windTail') + '</span><span class="lg-muted">' + t('windLegend') + '</span>';
}
export function initMap() {
  on('hover-km', d => { if (!map || d.src !== 'profile') return; if (d.km == null) clearHover(); else setHover(d.km); });
  on('wx', buildWind);
  on('wind-toggle', buildWind);
  window.addEventListener('resize', () => { if (map) map.invalidateSize(); });
}
export function relabelMap() { if (!map) return; const c = document.querySelector('.mapctl'); if (c) { c.querySelector('[data-base=topo]').textContent = t('mapTopo'); c.querySelector('[data-base=osm]').textContent = t('mapOsm'); c.querySelector('[data-wind]').textContent = t('windBtn'); } buildMap(); }
