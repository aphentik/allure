import { S, on, emit } from './state.js';
import { t, segName, esc } from './i18n.js';
import { altAtKm, gradAround } from './gpx.js';

const VW = 1000, VH = 320, TOP = 32, BOT = 300;
let alt = { min: 0, max: 1 };
function niceStep(range, targets) { for (const s of targets) if (range / s <= 7) return s; return targets[targets.length - 1]; }
function profX(km) { return km / S.D.totalKm * VW; }
function profY(a) { const d = alt.max - alt.min || 1; return TOP + (alt.max - a) / d * (BOT - TOP); }
function localMaxKm(km, win) { const P = S.D.profile; let best = km, ba = -1e9; P.forEach(p => { if (Math.abs(p[0] - km) <= win && p[1] > ba) { ba = p[1]; best = p[0]; } }); return best; }

export function buildProfile() {
  const svg = document.getElementById('profSvg'), wrap = document.getElementById('profile'); if (!svg) return;
  const D = S.D, race = S.race;
  if (!race || !D) { svg.innerHTML = ''; return; }
  wrap.classList.toggle('noele', !D.hasEle);
  const P = D.profile; let mn = D.minAlt, mx = D.maxAlt; if (mx - mn < 50) { const c = (mx + mn) / 2; mn = c - 25; mx = c + 25; }
  alt = { min: mn, max: mx };
  let line = ''; const st = Math.max(1, Math.floor(P.length / 1200));
  for (let i = 0; i < P.length; i += st) line += (i ? ' L' : 'M') + profX(P[i][0]).toFixed(1) + ',' + profY(P[i][1]).toFixed(1);
  const last = P[P.length - 1]; line += ' L' + profX(last[0]).toFixed(1) + ',' + profY(last[1]).toFixed(1);
  const defs = '<defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2b43d" stop-opacity="0.28"/><stop offset="1" stop-color="#f2b43d" stop-opacity="0.02"/></linearGradient></defs>';
  const fill = '<path d="' + line + ' L' + VW + ',' + VH + ' L0,' + VH + ' Z" fill="url(#fill)"/>';
  const stroke = '<path d="' + line + '" fill="none" stroke="#f2b43d" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>';
  // segment shading
  let shade = '<g>'; race.segments.forEach(s => { if (s.type === 'flat') return; const c = s.type === 'climb' ? (s.key ? '#e2503b' : '#f2b43d') : '#74bccd'; shade += '<rect x="' + profX(s.from).toFixed(1) + '" y="0" width="' + (profX(s.to) - profX(s.from)).toFixed(1) + '" height="' + VH + '" fill="' + c + '" opacity="0.06"/>'; }); shade += '</g>';
  let g1 = '', g2 = '';
  if (D.hasEle) { const step = niceStep(mx - mn, [100, 250, 500, 1000]); for (let a = Math.ceil(mn / step) * step; a < mx; a += step) { if (a <= mn) continue; const y = profY(a); g1 += '<line x1="0" y1="' + y.toFixed(1) + '" x2="' + VW + '" y2="' + y.toFixed(1) + '"/>'; g2 += '<text x="5" y="' + (y - 2).toFixed(1) + '">' + a + ' m</text>'; } }
  const grid = '<g stroke="#33506a" stroke-width="1" stroke-dasharray="3 5" vector-effect="non-scaling-stroke" opacity="0.5">' + g1 + '</g><g fill="#5f7d95" font-size="9" font-family="JetBrains Mono">' + g2 + '</g>';
  let cols = '<g font-family="Barlow Condensed">'; let ci = 0;
  race.segments.forEach(s => { if (s.type !== 'climb') return; ci++;
    const mk = localMaxKm(s.to, 1.2), x = profX(mk), y = profY(altAtKm(D, mk)), col = s.key ? '#e2503b' : '#f2b43d', fs = s.key ? 16 : 14;
    const ta = x > 940 ? 'end' : (x < 60 ? 'start' : 'middle'), tx = x > 940 ? 996 : (x < 60 ? 4 : x);
    cols += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (s.key ? 4.5 : 4) + '" fill="' + col + '"/>' +
      '<text x="' + tx.toFixed(1) + '" y="' + (y - 9).toFixed(1) + '" fill="#eaf1f5" font-size="' + fs + '" font-weight="' + (s.key ? 700 : 600) + '" text-anchor="' + ta + '">' + esc(segName(s, ci)) + '</text>' +
      '<text x="' + tx.toFixed(1) + '" y="' + (y - 22).toFixed(1) + '" fill="' + col + '" font-size="10.5" text-anchor="' + ta + '" font-family="JetBrains Mono">' + Math.round(altAtKm(D, mk)) + ' m</text>'; });
  cols += '</g>';
  let rav = '<g>';
  (race.waypoints || []).forEach(w => { if (w.kind !== 'ravito' && w.kind !== 'barrier') return; const x = profX(w.km), y = profY(altAtKm(D, w.km)); const ta = x > 950 ? 'end' : (x < 50 ? 'start' : 'middle'), tx = x > 950 ? 998 : (x < 50 ? 2 : x);
    if (w.kind === 'ravito') rav += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3" fill="#74bccd" stroke="#0c1620" stroke-width="1"/><text x="' + tx.toFixed(1) + '" y="' + (y + 13).toFixed(1) + '" fill="#74bccd" font-size="9.5" font-weight="700" text-anchor="' + ta + '" font-family="JetBrains Mono">' + esc(w.code || '') + '</text>';
    else if (w.time) rav += '<line x1="' + x.toFixed(1) + '" y1="' + y.toFixed(1) + '" x2="' + x.toFixed(1) + '" y2="' + BOT + '" stroke="#e2503b" stroke-width="1" stroke-dasharray="2 3" vector-effect="non-scaling-stroke" opacity="0.7"/>'; });
  rav += '</g>';
  const fount = S.settings.showFountains ? ('<g fill="#3ad6a2" stroke="#0c1620" stroke-width="0.8">' + (race.waypoints || []).filter(w => w.kind === 'fountain').map(w => { const x = profX(w.km), y = profY(altAtKm(D, w.km)); return '<path d="M' + x.toFixed(1) + ',' + (y - 3.2).toFixed(1) + ' L' + (x + 3.2).toFixed(1) + ',' + y.toFixed(1) + ' L' + x.toFixed(1) + ',' + (y + 3.2).toFixed(1) + ' L' + (x - 3.2).toFixed(1) + ',' + y.toFixed(1) + ' Z"/>'; }).join('') + '</g>') : '';
  const dng = '<g font-size="11">' + (race.waypoints || []).filter(w => w.kind === 'danger').map(w => { const x = profX(w.km), y = profY(altAtKm(D, w.km)); return '<text x="' + x.toFixed(1) + '" y="' + (y - 6).toFixed(1) + '" text-anchor="middle">⚠</text>'; }).join('') + '</g>';
  svg.innerHTML = defs + shade + grid + fill + stroke + fount + cols + rav + dng;
  buildAxis();
}
function buildAxis() {
  const D = S.D, total = D.totalKm, step = niceStep(total, [5, 10, 20, 25, 50, 100]); let h = '';
  for (let km = 0; km < total - step * 0.4; km += step) { const pct = km / total * 100; h += '<span style="left:' + pct + '%;transform:' + (km === 0 ? 'none' : 'translateX(-50%)') + '">' + km + '</span>'; }
  h += '<span style="left:100%;transform:translateX(-100%)">' + Math.round(total) + ' <span class="u">km</span></span>';
  document.getElementById('profAxis').innerHTML = h;
}
let cross, dot, tip, plot;
export function showCursor(km, fromMap) {
  if (!S.D || !plot) return;
  const D = S.D, a = altAtKm(D, km), g = gradAround(D, km, 0.5), total = D.totalKm;
  const xPct = km / total * 100, yPct = profY(a) / VH * 100;
  cross.style.left = xPct + '%'; dot.style.left = xPct + '%'; dot.style.top = yPct + '%';
  const gtxt = D.hasEle ? (g >= 0.8 ? ' · ▲ ' + g.toFixed(1) + '%' : (g <= -0.8 ? ' · ▼ ' + Math.abs(g).toFixed(1) + '%' : '')) : '';
  let ci = 0, nm = ''; for (const s of S.race.segments) { if (s.type === 'climb') ci++; if (km <= s.to + 1e-6) { nm = segName(s, s.type === 'climb' ? ci : null); break; } }
  tip.innerHTML = '<span class="seg">' + esc(nm) + '</span>km ' + km.toFixed(1) + (D.hasEle ? ' · <b>' + Math.round(a / 5) * 5 + ' m</b>' : '') + gtxt;
  tip.style.left = Math.max(14, Math.min(86, xPct)) + '%'; tip.style.top = yPct + '%';
  tip.style.transform = yPct < 48 ? 'translate(-50%,12px)' : 'translate(-50%,calc(-100% - 12px))';
  cross.style.display = dot.style.display = tip.style.display = 'block';
  if (!fromMap) emit('hover-km', { km, src: 'profile' });
}
export function hideCursor(fromMap) { if (!plot) return; cross.style.display = dot.style.display = tip.style.display = 'none'; if (!fromMap) emit('hover-km', { km: null, src: 'profile' }); }
export function initProfile() {
  plot = document.getElementById('profPlot'); if (!plot) return;
  cross = document.getElementById('profCross'); dot = document.getElementById('profDot'); tip = document.getElementById('profTip');
  const move = cx => { const r = plot.getBoundingClientRect(); if (!r.width || !S.D) return; showCursor(Math.max(0, Math.min(S.D.totalKm, (cx - r.left) / r.width * S.D.totalKm))); };
  plot.addEventListener('mousemove', e => move(e.clientX));
  plot.addEventListener('mouseleave', () => hideCursor());
  plot.addEventListener('touchstart', e => { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
  plot.addEventListener('touchmove', e => { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
  plot.addEventListener('touchend', () => hideCursor());
  on('hover-km', d => { if (d.src === 'map') { if (d.km == null) hideCursor(true); else showCursor(d.km, true); } });
}
