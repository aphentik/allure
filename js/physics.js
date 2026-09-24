// Speed model + per-segment computation (single source of truth).
import { S } from './state.js';
import { altAtKm, PROFILE_STEP_KM } from './gpx.js';

export function solveSpeed(power, mass, gradPct, opt) {
  // Robust bisection on f(v) = k v^3 + b v - P (single positive root, also valid downhill where b < 0)
  const g = 9.81, Crr = (opt && opt.Crr) || 0.005, rho = 1.2, CdA = (opt && opt.CdA) || 0.34, eff = 0.97;
  const grade = gradPct / 100, sin = grade / Math.sqrt(1 + grade * grade), cos = 1 / Math.sqrt(1 + grade * grade);
  const P = power * eff, k = 0.5 * rho * CdA, b = mass * g * (sin + Crr * cos);
  const f = v => k * v * v * v + b * v - P;
  let lo = 0.3, hi = 40;
  if (f(lo) > 0) return lo;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}
export const BASE = { chill: 0.68, diesel: 0.75, perf: 0.80 };
export const DESC_LEVELS = { prudent: 40, standard: 48, confirme: 55, expert: 62 };
export const DRAFT_LEVELS = { seul: 0, groupe: 0.20, peloton: 0.40 };
// flat / descent model presets per objective; 'adv' uses the user's own settings
const PRESETS = { chill: { flatIF: 0.58, draft: 0.20, descentCapKmh: 40 }, diesel: { flatIF: 0.62, draft: 0.20, descentCapKmh: 48 }, perf: { flatIF: 0.66, draft: 0.20, descentCapKmh: 55 } };
export function modelParams() {
  const s = S.settings;
  if (s.obj !== 'adv') return PRESETS[s.obj] || PRESETS.diesel;
  return { flatIF: s.flatIF, draft: DRAFT_LEVELS[s.draftLevel] != null ? DRAFT_LEVELS[s.draftLevel] : s.draft, descentCapKmh: DESC_LEVELS[s.descLevel] || s.descentCapKmh || 48 };
}
export function baseIntensity() { const s = S.settings; return s.obj === 'adv' ? s.advIF : (BASE[s.obj] || BASE.diesel); }
export function ftpVal() { return Math.max(60, +S.settings.ftp || 0); }
export function kgVal() { return Math.max(35, +S.settings.kg || 0); }

// speed (m/s) on a non-climb sub-step: coasting model when clearly downhill, otherwise flat model
function stepSpeed(grad, ftp, mass, st) {
  const cap = (st.descentCapKmh || 48) / 3.6;
  let v;
  if (grad <= -1.5) v = solveSpeed(ftp * 0.30, mass, grad, { CdA: 0.30 });
  else v = solveSpeed(ftp * (st.flatIF || 0.62), mass, grad, { CdA: 0.34 * (1 - (st.draft || 0)) });
  return Math.max(8 / 3.6, Math.min(v, cap));
}

// Enriched segments: spd (m/s), tSec, w, pct, ravitos, barrier, warn
export function computeSegc(race, D) {
  const st = modelParams(), ftp = ftpVal(), kg = kgVal(), mass = kg + (S.settings.bikeKg || 8), base = baseIntensity();
  const wps = race.waypoints || [];
  return race.segments.map(s => {
    const len = s.to - s.from; let spd, w = null, pct = null;
    if (s.type === 'climb') {
      pct = Math.max(0.55, base + (s.delta || 0)); w = Math.round(ftp * pct); spd = solveSpeed(w, mass, s.grad);
    } else if (s.speedKmh) {
      spd = s.speedKmh / 3.6;
    } else if (D && D.hasEle && len > 0) {
      let tsum = 0, k = s.from;
      while (k < s.to - 1e-9) {
        const k2 = Math.min(s.to, k + PROFILE_STEP_KM);
        const g = (altAtKm(D, k2) - altAtKm(D, k)) / ((k2 - k) * 1000) * 100;
        tsum += (k2 - k) * 1000 / stepSpeed(g, ftp, mass, st); k = k2;
      }
      spd = len * 1000 / tsum;
    } else spd = stepSpeed(s.grad || 0, ftp, mass, st);
    const inSeg = wp => wp.km >= s.from - 1e-6 && wp.km < s.to + (s.to >= D.totalKm - 1e-6 ? 1 : 0) + 1e-6;
    const ravitos = wps.filter(w2 => w2.kind === 'ravito' && inSeg(w2)).map(w2 => ({ k: w2.code, km: w2.km, t: w2.name + (w2.desc ? ' · ' + w2.desc : '') }));
    const bars = wps.filter(w2 => w2.kind === 'barrier' && w2.time && inSeg(w2));
    const barrier = bars.length ? { km: bars[0].km, time: bars[0].time, label: bars[0].name } : null;
    const dangers = wps.filter(w2 => w2.kind === 'danger' && inSeg(w2));
    const warn = dangers.map(d => d.name).filter(Boolean).join(' · ');
    const flatW = s.type === 'flat' ? Math.round(ftp * (st.flatIF || 0.62)) : null;
    return Object.assign({}, s, { spd, tSec: len * 1000 / spd, w, pct, wkg: w != null ? w / kg : null, flatW, flatPct: flatW != null ? (st.flatIF || 0.62) : null, ravitos, barrier, barriers: bars, warn, dangers });
  });
}
export function cumSecAt(segc, km) {
  let c = 0;
  for (let i = 0; i < segc.length; i++) { const s = segc[i]; if (km <= s.to + 1e-6) return c + Math.max(0, km - s.from) * 1000 / s.spd; c += s.tSec; }
  return c;
}
export function parseStart(str) { const p = String(str || '07:00').split(':').map(Number); return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0); }
export function hmsToSec(str) { return parseStart(str); }

// assign ravito codes by km order (R1..Rn, ARR near finish)
export function assignCodes(race, D) {
  const r = (race.waypoints || []).filter(w => w.kind === 'ravito').sort((a, b) => a.km - b.km);
  let n = 0; r.forEach(w => { if (D && w.km >= D.totalKm - 0.3) w.code = 'ARR'; else w.code = 'R' + (++n); });
}
