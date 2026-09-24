import { S, emit } from './state.js';
import { t, fmtn, fmtClock, fmtHM, fmtDate, segName, esc } from './i18n.js';
import { currentSegc, cumSecAt, parseStart } from './physics.js';
import { llAtKm, bearingAtKm, altAtKm } from './gpx.js';

const WXCODE = {
 0:{i:'☀️',fr:'ciel clair',en:'clear sky'},1:{i:'🌤️',fr:'peu nuageux',en:'mainly clear'},2:{i:'⛅',fr:'partiellement nuageux',en:'partly cloudy'},3:{i:'☁️',fr:'couvert',en:'overcast'},
 45:{i:'🌫️',fr:'brouillard',en:'fog'},48:{i:'🌫️',fr:'brouillard givrant',en:'rime fog'},
 51:{i:'🌦️',fr:'bruine légère',en:'light drizzle'},53:{i:'🌦️',fr:'bruine',en:'drizzle'},55:{i:'🌦️',fr:'bruine dense',en:'dense drizzle'},
 56:{i:'🌧️',fr:'bruine verglaçante',en:'freezing drizzle'},57:{i:'🌧️',fr:'bruine verglaçante',en:'freezing drizzle'},
 61:{i:'🌧️',fr:'pluie faible',en:'light rain'},63:{i:'🌧️',fr:'pluie',en:'rain'},65:{i:'🌧️',fr:'pluie forte',en:'heavy rain'},
 66:{i:'🌧️',fr:'pluie verglaçante',en:'freezing rain'},67:{i:'🌧️',fr:'pluie verglaçante',en:'freezing rain'},
 71:{i:'🌨️',fr:'neige faible',en:'light snow'},73:{i:'🌨️',fr:'neige',en:'snow'},75:{i:'🌨️',fr:'neige forte',en:'heavy snow'},77:{i:'🌨️',fr:'grains de neige',en:'snow grains'},
 80:{i:'🌦️',fr:'averses',en:'showers'},81:{i:'🌦️',fr:'averses',en:'showers'},82:{i:'⛈️',fr:'fortes averses',en:'heavy showers'},
 85:{i:'🌨️',fr:'averses de neige',en:'snow showers'},86:{i:'🌨️',fr:'averses de neige',en:'snow showers'},
 95:{i:'⛈️',fr:'orage',en:'thunderstorm'},96:{i:'⛈️',fr:'orage, grêle',en:'thunderstorm, hail'},99:{i:'⛈️',fr:'orage violent',en:'severe storm'}
};
const WXARROWS = ['↓','↙','←','↖','↑','↗','→','↘'];
export function wxCodeInfo(c) { return WXCODE[c] || { i: '·', fr: '·', en: '·' }; }
export function windDir(deg) { const d = S.lang === 'en' ? ['N','NE','E','SE','S','SW','W','NW'] : ['N','NE','E','SE','S','SO','O','NO']; return d[Math.round((deg || 0) / 45) % 8]; }
export function windArrow(deg) { return WXARROWS[Math.round((deg || 0) / 45) % 8]; }

// ---- points ----
// weather points: start, each climb summit, finish (+ midpoints if gaps > 40 km), cap 8
export function buildWxPoints(race, D) {
  const pts = [];
  const push = (km, name, key) => pts.push({ km: +km.toFixed(1), name, key: !!key });
  push(0, t('mapStart'));
  let ci = 0; race.segments.forEach(s => { if (s.type === 'climb') { ci++; push(s.to, segName(s, ci), s.key); } });
  push(D.totalKm, t('mapFinish'));
  pts.sort((a, b) => a.km - b.km);
  let out = []; pts.forEach(p => { const l = out[out.length - 1]; if (!l || p.km - l.km >= 5) out.push(p); else if (p.key && !l.key) out[out.length - 1] = p; });
  // midpoints for long gaps
  const withMid = []; for (let i = 0; i < out.length; i++) { withMid.push(out[i]); const n = out[i + 1]; if (n && n.km - out[i].km > 40) { const mk = (out[i].km + n.km) / 2; withMid.push({ km: +mk.toFixed(1), name: 'km ' + Math.round(mk), mid: true }); } }
  out = withMid;
  while (out.length > 8) { const i = out.findIndex(p => p.mid); if (i < 0) break; out.splice(i, 1); }
  while (out.length > 8) out.splice(out.length - 2, 1);
  out.forEach(p => { const ll = llAtKm(race, D, p.km); p.lat = ll.lat; p.lon = ll.lon; p.alt = Math.round(D.hasEle ? altAtKm(D, p.km) : 0); });
  return out;
}
// wind points: every max(5 km, total/20), cap 25
export function buildWindPoints(race, D) {
  const step = Math.max(5, D.totalKm / 20), out = [];
  for (let k = step / 2; k < D.totalKm; k += step) { const ll = llAtKm(race, D, k); out.push({ km: +k.toFixed(1), lat: ll.lat, lon: ll.lon, alt: Math.round(D.hasEle ? altAtKm(D, k) : 0), wind: true }); }
  return out.slice(0, 25);
}
function daysUntil(iso) { const d = new Date(iso + 'T00:00:00'); if (isNaN(d)) return null; return Math.round((d - new Date().setHours(0, 0, 0, 0)) / 86400000); }
export function wxStatus() {
  if (!S.race) return 'norace';
  if (!S.race.date) return 'nodate';
  const du = daysUntil(S.race.date); if (du == null) return 'nodate';
  if (du > 15) return 'toofar';
  if (du < -1) return 'past';
  return 'ok';
}
function wxUrl(pts) {
  const la = pts.map(p => p.lat.toFixed(4)).join(','), lo = pts.map(p => p.lon.toFixed(4)).join(','), el = pts.map(p => p.alt).join(',');
  return 'https://api.open-meteo.com/v1/forecast?latitude=' + la + '&longitude=' + lo + '&elevation=' + el + '&hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant&start_date=' + S.race.date + '&end_date=' + S.race.date + '&timezone=auto';
}
export function fetchWeather() {
  const W = S.wx; W.data = null; W.error = false; W.status = wxStatus();
  if (W.status !== 'ok' && W.status !== 'past') { W.loading = false; renderWeather(); emit('wx'); return; }
  const wxp = buildWxPoints(S.race, S.D), wp = buildWindPoints(S.race, S.D);
  W.pts = wxp.concat(wp); W.nWx = wxp.length; W.loading = true; renderWeather();
  const myKey = W.key = Math.random();
  fetch(wxUrl(W.pts)).then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
    .then(j => { if (W.key !== myKey) return; W.data = Array.isArray(j) ? j : [j]; W.loading = false; W.fetchedAt = new Date(); renderWeather(); emit('wx'); })
    .catch(() => { if (W.key !== myKey) return; W.loading = false; W.error = true; renderWeather(); emit('wx'); });
}
// interpolated hourly values at pass time for point index i
function sample(i, passSec) {
  const d = S.wx.data && S.wx.data[i]; if (!d || !d.hourly) return null;
  const hf = passSec / 3600, h0 = Math.max(0, Math.min(23, Math.floor(hf))), h1 = Math.min(23, h0 + 1), f = Math.max(0, Math.min(1, hf - h0)), hp = f < 0.5 ? h0 : h1, H = d.hourly;
  const lp = a => a[h0] + (a[h1] - a[h0]) * f;
  return { temp: lp(H.temperature_2m), feels: lp(H.apparent_temperature), code: H.weather_code[hp], wind: H.wind_speed_10m[hp], gust: H.wind_gusts_10m[hp], wdir: H.wind_direction_10m[hp], pop: H.precipitation_probability[hp] };
}
// Wind at a km and a clock time (s from midnight): interpolated between the two nearest wind points. null without forecast.
export function windAtKm(km, passSec) {
  const W = S.wx; if (!W.data || !W.pts || W.pts.length <= W.nWx) return null;
  const pts = W.pts.slice(W.nWx); let j = 0; while (j < pts.length - 1 && pts[j + 1].km < km) j++;
  const a = pts[j], b = pts[Math.min(pts.length - 1, j + 1)], f = b.km > a.km ? Math.max(0, Math.min(1, (km - a.km) / (b.km - a.km))) : 0;
  const sa = sample(W.nWx + j, passSec), sb = sample(W.nWx + Math.min(pts.length - 1, j + 1), passSec); if (!sa || !sb) return null;
  const r = Math.PI / 180, ux = sa.wind * Math.sin(sa.wdir * r) * (1 - f) + sb.wind * Math.sin(sb.wdir * r) * f, uy = sa.wind * Math.cos(sa.wdir * r) * (1 - f) + sb.wind * Math.cos(sb.wdir * r) * f;
  return { speed: Math.hypot(ux, uy), dir: ((Math.atan2(ux, uy) / r) + 360) % 360 };
}
export function windUsed() { return !!(S.windFn && S.wx.data); }
export function wxSeries() {
  const W = S.wx; if (!W.data || !S.race) return null;
  const segc = currentSegc(), startSec = parseStart(S.race.start);
  return W.pts.slice(0, W.nWx).map((p, i) => { const passSec = startSec + cumSecAt(segc, p.km), s = sample(i, passSec); return Object.assign({ pt: p, passSec, ok: !!s }, s || {}); });
}
// wind along the route: {km, lat, lon, passSec, wind, gust, wdir, bearing, rel, cls}
export function windSeries() {
  const W = S.wx; if (!W.data || !S.race) return null;
  const segc = currentSegc(), startSec = parseStart(S.race.start);
  return W.pts.slice(W.nWx).map((p, j) => {
    const i = W.nWx + j, passSec = startSec + cumSecAt(segc, p.km), s = sample(i, passSec); if (!s) return null;
    const br = bearingAtKm(S.race, S.D, p.km), rel = Math.cos((s.wdir - br) * Math.PI / 180);
    const cls = s.wind < 5 ? 'calm' : (Math.abs(rel) < 0.35 ? 'cross' : (rel > 0 ? 'head' : 'tail'));
    return { km: p.km, lat: p.lat, lon: p.lon, passSec, wind: s.wind, gust: s.gust, wdir: s.wdir, bearing: br, rel, cls };
  }).filter(Boolean);
}
export function windTotals(ws) {
  const tot = { head: 0, cross: 0, tail: 0, calm: 0 }; let worst = null;
  if (!ws || !ws.length) return { tot, worst };
  const total = S.D.totalKm;
  ws.forEach((w, i) => { const a = i === 0 ? 0 : (ws[i - 1].km + w.km) / 2, b = i === ws.length - 1 ? total : (w.km + ws[i + 1].km) / 2; tot[w.cls] += b - a; const hw = w.wind * Math.max(0, w.rel); if (w.cls === 'head' && (!worst || hw > worst.hw)) worst = { km: w.km, v: Math.round(w.wind), t: fmtClock(w.passSec), hw }; });
  return { tot, worst };
}

// ---- rendering ----
function statusMsg() {
  const st = S.wx.status || wxStatus();
  if (st === 'norace') return t('wxNoRace'); if (st === 'nodate') return t('wxNoDate'); if (st === 'toofar') return fmtn(t('wxTooFar'), { date: fmtDate(S.race.date) });
  return null;
}
export function renderWeather() {
  const grid = document.getElementById('wxGrid'), msg = document.getElementById('wxMsg'), upd = document.getElementById('wxUpd'); if (!grid) return;
  const W = S.wx, sm = statusMsg();
  const show = txt => { msg.textContent = txt; msg.style.display = ''; grid.innerHTML = ''; upd.textContent = ''; renderSummary(); };
  if (sm) return show(sm);
  if (W.loading) return show(t('wxLoading'));
  if (W.error || !W.data) return show(t('wxError'));
  msg.style.display = 'none'; upd.textContent = W.fetchedAt ? fmtn(t('wxUpd'), { t: fmtHM(W.fetchedAt) }) : '';
  const s = wxSeries() || [];
  grid.innerHTML = s.map(x => { const p = x.pt; if (!x.ok) return ''; const ci = wxCodeInfo(x.code);
    return '<div class="wxcard' + (p.key ? ' key' : '') + '">' +
      '<div class="wxn">' + esc(p.name) + '</div>' +
      '<div class="wxkm">km ' + p.km + (S.D.hasEle ? ' · ' + p.alt + ' m' : '') + '</div>' +
      '<div class="wxpass">' + fmtn(t('wxAt'), { t: fmtClock(x.passSec) }) + '</div>' +
      '<div class="wxmain"><span class="wxico">' + ci.i + '</span><span class="wxt">' + Math.round(x.temp) + '<span class="u">°C</span></span></div>' +
      '<div class="wxdesc">' + ci[S.lang] + '</div>' +
      '<div class="wxrow"><span>' + t('wxWind') + ' <b>' + Math.round(x.wind) + '</b> km/h ' + windDir(x.wdir) + ' ' + windArrow(x.wdir) + '</span><span>' + t('wxGust') + ' ' + Math.round(x.gust) + '</span></div>' +
      '<div class="wxrow"><span>' + t('wxFeels') + ' ' + Math.round(x.feels) + '°</span><span class="wxrain">' + t('wxRain') + ' <b>' + Math.round(x.pop) + '%</b></span></div>' +
      '</div>'; }).join('');
  renderSummary();
}
export function renderSummary() {
  const body = document.getElementById('wxSumBody'), msg = document.getElementById('wxSumMsg'), upd = document.getElementById('wxSumUpd'); if (!body) return;
  const W = S.wx, sm = statusMsg();
  const show = txt => { msg.textContent = txt; msg.style.display = ''; body.innerHTML = ''; upd.textContent = ''; };
  if (sm) return show(sm);
  if (W.loading) return show(t('wxLoading'));
  if (W.error || !W.data) return show(t('wxError'));
  const pts = W.pts.slice(0, W.nWx); let vi = 0, hi = 0;
  pts.forEach((p, i) => { if (p.alt < pts[vi].alt) vi = i; if (p.alt > pts[hi].alt) hi = i; });
  const V = W.data[vi] && W.data[vi].daily, H = W.data[hi] && W.data[hi].daily;
  if (!V || !H) return show(t('wxError'));
  msg.style.display = 'none'; upd.textContent = W.fetchedAt ? fmtn(t('wxUpd'), { t: fmtHM(W.fetchedAt) }) : '';
  const vMin = Math.round(V.temperature_2m_min[0]), vMax = Math.round(V.temperature_2m_max[0]), sMin = Math.round(H.temperature_2m_min[0]), sMax = Math.round(H.temperature_2m_max[0]),
    pop = Math.max(Math.round(V.precipitation_probability_max[0]), Math.round(H.precipitation_probability_max[0])), wind = Math.round(H.wind_speed_10m_max[0]), dir = H.wind_direction_10m_dominant ? H.wind_direction_10m_dominant[0] : null;
  const adv = [];
  if (vMax >= 30) adv.push(fmtn(t('wxAdvHot'), { t: vMax })); else if (vMax >= 25) adv.push(fmtn(t('wxAdvWarm'), { t: vMax })); else adv.push(fmtn(t('wxAdvMild'), { t: vMax }));
  if (hi !== vi) { if (sMax <= 10 || wind >= 30) adv.push(fmtn(t('wxAdvCold'), { lo: sMin, hi: sMax, w: wind, name: esc(pts[hi].name) })); else adv.push(fmtn(t('wxAdvCool'), { lo: sMin, hi: sMax, name: esc(pts[hi].name) })); }
  if (pop >= 40) adv.push(fmtn(t('wxAdvRain'), { p: pop }));
  let h = '<div class="wxbar-stats">' + fmtn(t('wxValley'), { name: esc(pts[vi].name) }) + ' <b>' + vMin + '–' + vMax + '°</b>' +
    (hi !== vi ? '  ·  ' + fmtn(t('wxSummits'), { name: esc(pts[hi].name) }) + ' <b>' + sMin + '–' + sMax + '°</b>' : '') +
    '  ·  💨 ' + (dir != null ? windDir(dir) + ' ' : '') + '<b>' + wind + '</b> km/h  ·  🌧️ <b>' + pop + '%</b></div>';
  const ws = windSeries(); if (ws && ws.length) { const wt = windTotals(ws);
    h += '<div class="wxbar-stats wxwind">' + fmtn(t('wxWindLine'), { head: Math.round(wt.tot.head), cross: Math.round(wt.tot.cross), tail: Math.round(wt.tot.tail) }) + (wt.worst ? ' · <span class="wxworst">' + fmtn(t('wxWindWorst'), wt.worst) + '</span>' : '') + (windUsed() ? ' · <span class="wxused">✓ ' + t('wxWindUsed') + '</span>' : '') + '</div>'; }
  h += '<div class="wxbar-adv">' + adv.join(' ') + '</div>';
  body.innerHTML = h;
}
