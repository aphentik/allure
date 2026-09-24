import { S } from './state.js';
import { t, fmtn, fmtDur, fmtClock, esc } from './i18n.js';
import { currentSegc, cumSecAt, parseStart, kgVal } from './physics.js';

export const RAVITO_GEL_G = 25;
export function wxMaxTemp() {
  const W = S.wx; if (!W.data) return null; let mx = -99;
  W.data.forEach(d => { if (d && d.daily && d.daily.temperature_2m_max) mx = Math.max(mx, d.daily.temperature_2m_max[0]); });
  return mx > -50 ? mx : null;
}
// hydration: ml/kg/h by forecast heat (8 cool · 10 moderate · 12 hot) × body mass
export function waterLPerH() { const kg = kgVal(), temp = wxMaxTemp(), ml = temp == null ? 9 : (temp < 20 ? 8 : (temp <= 27 ? 10 : 12)); return kg * ml / 1000; }

export function nutritionPlan() {
  const N = S.settings.nut, race = S.race, D = S.D;
  const hrs = (S.totalSec || 0) / 3600;
  const gph = Math.max(0, +N.gph || 0), gGel = Math.max(1, +N.gGel || 45), gBidon = Math.max(0, +N.gBidon || 0), bsize = Math.max(0.3, +N.bsize || 0.6);
  const water = waterLPerH(), bottlesPerH = bsize > 0 ? water / bsize : 0;
  const isoFrac = Math.max(0, Math.min(1, (N.isoPct || 0) / 100));
  const isoCarbsH = Math.min(gph, bottlesPerH * isoFrac * gBidon), gelCarbsH = Math.max(0, gph - isoCarbsH);
  const gelsPerH = gGel > 0 ? gelCarbsH / gGel : 0;
  const need = Math.round(gph * hrs), totalWater = water * hrs, gelCarbsTot = gelCarbsH * hrs;
  const isoDoses = Math.ceil(totalWater / bsize * isoFrac);
  const segc = currentSegc(), startSec = parseStart(race.start), finKm = D.totalKm, C = 2 * bsize;
  const ravs = [];
  segc.forEach(s => (s.ravitos || []).forEach(r => { if (r.k !== 'ARR') ravs.push({ k: r.k, km: r.km, sec: startSec + cumSecAt(segc, r.km) }); }));
  ravs.sort((a, b) => a.km - b.km);
  const finSec = startSec + cumSecAt(segc, finKm), startS = startSec;
  const wB = (a, b) => water * (b - a) / 3600;
  const req = {}; let last = startS, guard = 0;
  while (wB(last, finSec) > C + 1e-6 && guard++ < 30) {
    let pick = -1, j;
    for (j = 0; j < ravs.length; j++) if (ravs[j].sec > last + 1 && wB(last, ravs[j].sec) <= C) pick = j;
    if (pick < 0) for (j = 0; j < ravs.length; j++) if (ravs[j].sec > last + 1) { pick = j; break; }
    if (pick < 0) break; req[ravs[pick].k] = 1; last = ravs[pick].sec;
  }
  const stops = [], reqCodes = [], optCodes = []; let lastReq = startS, maxLegGels = 0;
  ravs.forEach(r => {
    if (req[r.k]) { const dur = r.sec - lastReq, lh = dur / 3600, wl = water * lh, gl = gelCarbsH * lh / gGel; if (gl > maxLegGels) maxLegGels = gl;
      stops.push({ code: r.k, km: r.km, clock: fmtClock(r.sec), required: true, durSec: dur, waterL: wl, gels: gl, tooLong: wl > C }); lastReq = r.sec; reqCodes.push(r.k); }
    else { stops.push({ code: r.k, km: r.km, clock: fmtClock(r.sec), required: false }); optCodes.push(r.k); }
  });
  const fd = finSec - lastReq, fl = fd / 3600, fw = water * fl, fg = gelCarbsH * fl / gGel; if (fg > maxLegGels) maxLegGels = fg;
  stops.push({ code: 'ARR', km: +finKm.toFixed(1), clock: fmtClock(finSec), required: true, finish: true, durSec: fd, waterL: fw, gels: fg, tooLong: fw > C });
  const gelsToCarry = (N.ravito === 'autonome' || !ravs.length) ? Math.ceil(gelCarbsTot / gGel) : Math.max(0, Math.ceil(maxLegGels) + 1);
  const ravitoGels = (N.ravito === 'ravitos' && ravs.length) ? Math.ceil(Math.max(0, gelCarbsTot - gelsToCarry * gGel) / RAVITO_GEL_G) : 0;
  return { hrs, gph, water, bsize, ravito: N.ravito, isoPct: Math.round(isoFrac * 100), need, totalWater, gelCarbsH, isoCarbsH, gelsPerH, bottlesPerH,
    perGelMin: gelsPerH > 0 ? 60 / gelsPerH : 0, perBottleMin: bottlesPerH > 0 ? 60 / bottlesPerH : 0,
    gelsToCarry, isoDoses, waterBottles: Math.max(0, Math.ceil(totalWater / bsize * (1 - isoFrac))), ravitoGels, stops, reqCodes, optCodes, hasRavitos: ravs.length > 0 };
}
export function nutSync() {
  const N = S.settings.nut;
  const iv = document.getElementById('isoPctV'); if (iv) iv.textContent = N.isoPct;
  const ir = document.getElementById('isoPct'); if (ir) ir.value = N.isoPct;
  ['gph', 'gGel', 'gBidon', 'bsize'].forEach(id => { const e = document.getElementById(id); if (e && document.activeElement !== e) e.value = N[id]; });
  document.querySelectorAll('#nutRv button').forEach(b => b.setAttribute('aria-pressed', b.dataset.rv === N.ravito));
}
export function computeNutrition() {
  if (!document.getElementById('nutRates') || !S.race) return;
  const p = nutritionPlan();
  document.getElementById('nutSub').innerHTML = fmtn(t('nutSub'), { dur: '<b>' + fmtDur(S.totalSec) + '</b>', need: '<b>' + p.need + ' g</b>', water: '<b>' + p.totalWater.toFixed(1) + ' L</b>' });
  const rates = '<div class="nrate">🎯 ' + fmtn(t('nrTarget'), { g: p.gph, l: p.water.toFixed(1) }) + '</div>'
    + (p.gelsPerH > 0.05 ? '<div class="nrate">🍬 ' + fmtn(t('nrGelRhythm'), { m: Math.round(p.perGelMin) }) + '</div>' : '');
  document.getElementById('nutRates').innerHTML = rates;
  const carry = '<div class="ncl"><b>' + p.gelsToCarry + '</b> ' + t('ncGels') + '</div>'
    + (p.isoDoses > 0 ? '<div class="ncl"><b>' + p.isoDoses + '</b> ' + t('ncIsoB') + '</div>' : '')
    + (p.waterBottles > 0 ? '<div class="ncl"><b>' + p.waterBottles + '</b> ' + t('ncWaterB') + '</div>' : '');
  const note = !p.hasRavitos ? t('ncNoRavito') : (p.ravito === 'ravitos' ? fmtn(t('ncRavitoNote'), { n: p.ravitoGels }) : t('ncAutoNote'));
  document.getElementById('nutCarry').innerHTML = carry + '<div class="nc-note">' + t('ncBike') + ' ' + note + '</div>';
  const sum = '<div class="nc-note" style="margin:0 0 10px">' + fmtn(t('nlSummary'), { req: p.reqCodes.join(', ') || t('nlNone'), opt: p.optCodes.join(', ') || t('nlNone') }) + '</div>';
  document.getElementById('nutPlan').innerHTML = sum + p.stops.map(l => {
    if (!l.required) return '<div class="nleg opt"><div class="nlk">' + l.code + '</div><div class="nlmid"><div class="nlh">km ' + l.km + ' · ' + l.clock + '</div></div><div class="nlact">' + t('nlSkip') + '</div></div>';
    const act = l.finish ? t('nlFinish') : (p.ravito === 'ravitos' ? t('nlRefillFood') : t('nlRefill'));
    return '<div class="nleg' + (l.tooLong ? ' warn' : '') + '"><div class="nlk">' + l.code + '</div><div class="nlmid">'
      + '<div class="nlh">km ' + l.km + ' · ' + l.clock + '</div>'
      + '<div class="nls">' + fmtn(t('nlLeg'), { d: fmtDur(l.durSec), l: l.waterL.toFixed(1), g: Math.round(l.gels) }) + '</div>'
      + (l.tooLong ? '<div class="nlwarn">' + t('nlTooLong') + '</div>' : '') + '</div><div class="nlact">' + act + '</div></div>';
  }).join('');
  updateWxNote();
}
export function updateWxNote() {
  const e = document.getElementById('wxNote'); if (!e) return;
  const temp = wxMaxTemp(), kg = kgVal(), w = fmtn(t('wxWater'), { l: waterLPerH().toFixed(1), kg });
  if (temp == null) { e.innerHTML = w + ' ' + t('wxTempWait'); return; }
  const k = temp < 20 ? 'wxCool' : (temp <= 27 ? 'wxWarm' : 'wxHot');
  e.innerHTML = '<b>' + Math.round(temp) + '° ' + t('wxMaxLabel') + '</b> · ' + t(k) + ' ' + w;
}
