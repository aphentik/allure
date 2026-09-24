// Speed model + per-segment computation (single source of truth).
// Model: constant target power per segment type, integrated every 100 m on the real profile,
// with air density by altitude, head/tail wind (when a forecast exists) and cornering limits in descents.
import { S } from './state.js';
import { altAtKm, bearingAtKm, PROFILE_STEP_KM } from './gpx.js';

const G = 9.81;
export const MODEL = { CdA: 0.34, CdAdesc: 0.30, Crr: 0.005, eff: 0.97, coastIF: 0.30, vMin: 8 / 3.6, vMax: 75 / 3.6, windHeightFactor: 0.7 };

export function airDensity(altM) { return 1.225 * Math.exp(-(altM || 0) / 8500); }

// Speed (m/s) for a given power. opt: {CdA, Crr, rho, wind} — wind = headwind component in m/s (negative = tailwind).
export function solveSpeed(power, mass, gradPct, opt) {
  const o = opt || {}, Crr = o.Crr || MODEL.Crr, rho = o.rho || 1.2, CdA = o.CdA || MODEL.CdA, w = o.wind || 0;
  const grade = gradPct / 100, sin = grade / Math.sqrt(1 + grade * grade), cos = 1 / Math.sqrt(1 + grade * grade);
  const P = power * MODEL.eff, k = 0.5 * rho * CdA, b = mass * G * (sin + Crr * cos);
  const f = v => { const va = v + w; return k * va * Math.abs(va) * v + b * v - P; };
  let lo = 0.3, hi = 40;
  if (f(lo) > 0) return lo;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (f(mid) > 0) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}
export const BASE = { chill: 0.68, diesel: 0.75, perf: 0.80 };
// descending level → lateral acceleration accepted in corners (g) and absolute cap (km/h)
export const DESC_LEVELS = { prudent: { aLat: 0.25, cap: 50 }, standard: { aLat: 0.32, cap: 58 }, confirme: { aLat: 0.40, cap: 66 }, expert: { aLat: 0.50, cap: 75 } };
export const DRAFT_LEVELS = { seul: 0, groupe: 0.20, peloton: 0.40 };
// flat / descent model presets per objective; 'adv' uses the user's own settings
const PRESETS = { chill: { flatIF: 0.58, draft: 0.20, descLevel: 'prudent' }, diesel: { flatIF: 0.62, draft: 0.20, descLevel: 'standard' }, perf: { flatIF: 0.66, draft: 0.20, descLevel: 'confirme' } };
export function modelParams() {
  const s = S.settings;
  const p = s.obj !== 'adv' ? (PRESETS[s.obj] || PRESETS.diesel) : { flatIF: s.flatIF, draft: DRAFT_LEVELS[s.draftLevel] != null ? DRAFT_LEVELS[s.draftLevel] : (s.draft || 0.2), descLevel: DESC_LEVELS[s.descLevel] ? s.descLevel : 'standard' };
  const lv = DESC_LEVELS[p.descLevel] || DESC_LEVELS.standard;
  return { flatIF: p.flatIF, draft: p.draft, descLevel: p.descLevel, aLat: lv.aLat, capKmh: lv.cap };
}
export function baseIntensity() { const s = S.settings; return s.obj === 'adv' ? s.advIF : (BASE[s.obj] || BASE.diesel); }
export function ftpVal() { return Math.max(60, +S.settings.ftp || 0); }
export function kgVal() { return Math.max(35, +S.settings.kg || 0); }

// wind (m/s, headwind positive) at a km given the wind function (km → {speed km/h at 10 m, dir from} | null)
function headwind(race, D, km, windFn) {
  if (!windFn) return 0;
  const w = windFn(km); if (!w || !(w.speed > 0)) return 0;
  const br = bearingAtKm(race, D, km);
  return Math.max(-15, Math.min(15, w.speed / 3.6 * MODEL.windHeightFactor * Math.cos((w.dir - br) * Math.PI / 180)));
}
// cornering speed limit (m/s) at profile index i, smoothed over ±1 step
function cornerLimit(D, i, aLat) {
  if (!D.radius) return Infinity;
  let r = Infinity; for (let j = Math.max(0, i - 1); j <= Math.min(D.radius.length - 1, i + 1); j++) r = Math.min(r, D.radius[j]);
  return isFinite(r) ? Math.sqrt(aLat * G * r) : Infinity;
}
// speed of one 100 m sub-step. mode: 'climb' (constant power w) | 'flat' | 'descent'
function stepSpeed(mode, g, alt, ctx) {
  const { ftp, mass, st, w, wind } = ctx, rho = airDensity(alt);
  let v;
  if (g <= -1.5) v = Math.min(solveSpeed(ftp * MODEL.coastIF, mass, g, { CdA: MODEL.CdAdesc, rho, wind }), st.capKmh / 3.6);
  else if (mode === 'climb') v = solveSpeed(w, mass, g, { rho, wind });
  else v = solveSpeed(ftp * st.flatIF, mass, g, { CdA: MODEL.CdA * (1 - st.draft), rho, wind });
  return Math.max(mode === 'climb' && g > -1.5 ? 0.5 : MODEL.vMin, Math.min(v, MODEL.vMax)); // no floor on climbs (steep walls are slow)
}

// Enriched segments: spd (m/s), tSec, w, pct, flatW, ravitos, barrier, warn.
// opt.windFn: km → {speed, dir} | null (built by compute() from the forecast at estimated pass times).
export function computeSegc(race, D, opt) {
  const st = modelParams(), ftp = ftpVal(), kg = kgVal(), mass = kg + (S.settings.bikeKg || 8), base = baseIntensity();
  const windFn = opt && opt.windFn, wps = race.waypoints || [];
  return race.segments.map(s => {
    const len = s.to - s.from; let spd, w = null, pct = null;
    if (s.type === 'climb') { pct = Math.max(0.55, base + (s.delta || 0)); w = Math.round(ftp * pct); }
    if (s.speedKmh && s.type !== 'climb') spd = s.speedKmh / 3.6;
    else if (D && len > 0) {
      let tsum = 0, k = s.from;
      while (k < s.to - 1e-9) {
        const k2 = Math.min(s.to, k + PROFILE_STEP_KM), km = (k + k2) / 2;
        const g = D.hasEle ? (altAtKm(D, k2) - altAtKm(D, k)) / ((k2 - k) * 1000) * 100 : 0;
        let v = stepSpeed(s.type, g, D.hasEle ? altAtKm(D, km) : 0, { ftp, mass, st, w, wind: headwind(race, D, km, windFn) });
        if (g < 0) v = Math.min(v, cornerLimit(D, Math.round(km / PROFILE_STEP_KM), st.aLat));
        tsum += (k2 - k) * 1000 / v; k = k2;
      }
      spd = len * 1000 / tsum;
    } else spd = stepSpeed(s.type, s.grad || 0, 0, { ftp, mass, st, w, wind: 0 });
    const inSeg = wp => wp.km >= s.from - 1e-6 && wp.km < s.to + (s.to >= D.totalKm - 1e-6 ? 1 : 0) + 1e-6;
    const ravitos = wps.filter(w2 => w2.kind === 'ravito' && inSeg(w2)).map(w2 => ({ k: w2.code, km: w2.km, t: w2.name + (w2.desc ? ' · ' + w2.desc : '') }));
    const bars = wps.filter(w2 => w2.kind === 'barrier' && w2.time && inSeg(w2));
    const barrier = bars.length ? { km: bars[0].km, time: bars[0].time, label: bars[0].name } : null;
    const dangers = wps.filter(w2 => w2.kind === 'danger' && inSeg(w2));
    const warn = dangers.map(d => d.name).filter(Boolean).join(' · ');
    const flatW = s.type === 'flat' ? Math.round(ftp * st.flatIF) : null;
    return Object.assign({}, s, { spd, tSec: len * 1000 / spd, w, pct, wkg: w != null ? w / kg : null, flatW, flatPct: flatW != null ? st.flatIF : null, ravitos, barrier, barriers: bars, warn, dangers });
  });
}
// Segments with the wind function established by the last compute() (same result for every consumer)
export function currentSegc() { return computeSegc(S.race, S.D, { windFn: S.windFn || null }); }
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
