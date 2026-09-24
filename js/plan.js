import { S } from './state.js';
import { t, fmtn, fmtDur, fmtClock, segName, esc } from './i18n.js';
import { computeSegc, cumSecAt, parseStart, ftpVal, kgVal, baseIntensity } from './physics.js';
import { computeNutrition, nutritionPlan } from './nutrition.js';
import { renderWeather } from './weather.js';
import { buildWindBand } from './profile.js';
import { buildWind } from './map.js';

// Plan rows (shared by timeline, PDF, stickers, GPS export)
export function computePlanData() {
  const race = S.race, D = S.D, ftp = ftpVal(), kg = kgVal(), startSec = parseStart(race.start);
  const segc = computeSegc(race, D);
  let cum = 0, wkgSum = 0, nClimb = 0, idx = 0; const rows = [];
  segc.forEach(s => {
    cum += s.tSec; let bar = null;
    if (s.barrier) { const ps = startSec + cumSecAt(segc, s.barrier.km), p = s.barrier.time.split(':').map(Number), bs = p[0] * 3600 + p[1] * 60; bar = { ok: ps <= bs, margin: Math.abs(bs - ps), time: s.barrier.time, km: s.barrier.km, label: s.barrier.label, pass: ps }; }
    const rav = (s.ravitos || []).map(r => ({ k: r.k, km: r.km, t: r.t }));
    if (s.type === 'climb') { idx++; nClimb++; wkgSum += s.w / kg;
      rows.push({ id: s.id, type: 'climb', idx, name: segName(s, idx), from: s.from, to: s.to, grad: s.grad, pct: s.pct, w: s.w, wkg: s.w / kg, key: s.key, cue: s.cue || '', warn: s.warn, tSec: s.tSec, passSec: startSec + cum, rav, bar, seg: s }); }
    else rows.push({ id: s.id, type: 'liaison', stype: s.type, name: segName(s), from: s.from, to: s.to, grad: s.grad, cue: s.cue || '', warn: s.warn, tSec: s.tSec, passSec: startSec + cum, rav, bar, seg: s, spdKmh: s.spd * 3.6 });
  });
  const np = nutritionPlan();
  const nutri = { gph: np.gph, need: np.need, water: np.water.toFixed(1), gels: np.gelsToCarry, iso: np.isoDoses, waterBottles: np.waterBottles, ravitoGels: np.ravitoGels, ravito: np.ravito, perGelMin: np.perGelMin, gelsPerH: np.gelsPerH, stops: np.stops, optCodes: np.optCodes, hasRavitos: np.hasRavitos };
  return { ftp, kg, startSec, totalSec: cum, arrival: startSec + cum, avgWkg: wkgSum / (nClimb || 1), nClimb, rows, nutri, segc };
}
export function objLabel() { const o = S.settings.obj; return o === 'adv' ? t('o4') + ' ' + Math.round(S.settings.advIF * 100) + '% FTP' : t('o' + (o === 'chill' ? '1' : o === 'diesel' ? '2' : '3')); }

export function compute() {
  if (!S.race || !S.D) return;
  const race = S.race, D = S.D, ftp = ftpVal(), kg = kgVal(), startSec = parseStart(race.start), segc = computeSegc(race, D);
  let cum = 0, wkgSum = 0, nClimb = 0, idx = 0, html = '';
  segc.forEach(s => {
    cum += s.tSec;
    const rav = (s.ravitos || []).map(r => '<div class="ravito"><span class="rk">' + esc(r.k) + '</span> km ' + r.km + (r.t ? ' · ' + esc(r.t) : '') + '</div>').join(' ');
    let bar = '';
    if (s.barrier) { const ps = startSec + cumSecAt(segc, s.barrier.km), p = s.barrier.time.split(':').map(Number), bs = p[0] * 3600 + p[1] * 60, ok = ps <= bs, m = (ok ? t('tlMargin') : t('tlLate')) + fmtDur(Math.abs(bs - ps));
      bar = '<div class="barrier ' + (ok ? 'ok' : '') + '">⛔ ' + fmtn(t('tlBarr'), { label: esc(s.barrier.label), km: s.barrier.km, time: '<b>' + s.barrier.time + '</b>', pass: fmtClock(ps), m }) + '</div>'; }
    const warn = s.warn ? '<div class="cue warn">⚠ ' + esc(s.warn) + '</div>' : '';
    const extra = (rav || bar) ? '<div class="rzone">' + rav + bar + '</div>' : '';
    if (s.type === 'climb') { wkgSum += s.w / kg; nClimb++; idx++;
      html += '<div class="col ' + (s.key ? 'key' : '') + '" data-seg="' + s.id + '"><div class="idx">' + idx + '</div><div><div class="name">' + esc(segName(s, idx)) + '</div><div class="spec">km ' + s.from + '→' + s.to + ' · ' + s.grad + '% · ' + Math.round(s.pct * 100) + '% FTP</div>' + (s.cue ? '<div class="cue">' + esc(s.cue) + '</div>' : '') + warn + extra + '</div><div class="nums"><div class="w">' + s.w + '<span class="u">w</span></div><div class="wkg">' + (s.w / kg).toFixed(1) + ' W/kg</div><div class="t">' + (s.to - s.from).toFixed(1) + ' km · ' + fmtDur(s.tSec) + '</div><div class="pass">' + t('tlPass') + ' ' + fmtClock(startSec + cum) + '</div></div></div>';
    } else {
      html += '<div class="liaison" data-seg="' + s.id + '"><div class="dot">' + (s.type === 'descent' ? '↓' : '→') + '</div><div><div class="ln">' + esc(segName(s)) + '</div><div class="ls">km ' + s.from + '→' + s.to + ' · ' + (s.ravitos && s.ravitos.length ? t('tlRecupRav') : t('tlRecup')) + ' · ≈ ' + Math.round(s.spd * 3.6) + ' km/h</div>' + (s.cue ? '<div class="cue">' + esc(s.cue) + '</div>' : '') + warn + extra + '</div><div class="lt">' + (s.to - s.from).toFixed(1) + ' km · ≈ ' + fmtDur(s.tSec) + '<div class="lp">' + t('tlPass') + ' ' + fmtClock(startSec + cum) + '</div></div></div>';
    }
  });
  document.getElementById('timeline').innerHTML = html;
  document.getElementById('totalTime').textContent = fmtDur(cum);
  document.getElementById('totalMeta').innerHTML = t('metaLine') + '<br>' + t('metaArr') + ' <b>' + fmtClock(startSec + cum) + '</b>' + (nClimb ? ' · ' + t('metaAvg1') + ' <b>' + (wkgSum / nClimb).toFixed(1) + '</b> ' + t('metaAvg2') : '');
  S.totalSec = cum;
  computeNutrition(); renderWeather(); buildWindBand(); buildWind();
}
