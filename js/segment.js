// Automatic segmentation of a resampled profile into climb / descent / flat.
import { PROFILE_STEP_KM } from './gpx.js';
import { S, uid } from './state.js';
import { solveSpeed, ftpVal, kgVal } from './physics.js';

export const SEG_DEFAULTS = { minGrad: 2.5, minKm: 1.5, dipKm: 2.5 };
const DIP_MAX_LOSS_M = 80, SHORT_LINK_KM = 3.5, CLIMB_MIN_GAIN_M = 70;

function meanGrad(P, i0, i1) { // % between profile indices
  const dk = P[i1][0] - P[i0][0]; return dk > 0 ? (P[i1][1] - P[i0][1]) / (dk * 1000) * 100 : 0;
}

export function autoSegments(D, params) {
  const p = Object.assign({}, SEG_DEFAULTS, params || {});
  const P = D.profile, n = P.length, total = D.totalKm;
  if (!D.hasEle || n < 3) return [mk('flat', 0, total, 0)];
  // 1. class per step using a 1 km sliding mean grade
  const half = Math.max(1, Math.round(0.5 / PROFILE_STEP_KM));
  const cls = new Int8Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const a = Math.max(0, i - half), b = Math.min(n - 1, i + 1 + half);
    const g = meanGrad(P, a, b);
    cls[i] = g >= 2 ? 1 : (g <= -2 ? -1 : 0);
  }
  // runs
  let runs = [];
  let s = 0;
  for (let i = 1; i <= n - 1; i++) { if (i === n - 1 || cls[i] !== cls[s]) { runs.push({ c: cls[s], i0: s, i1: i }); s = i; } }
  // 2. absorb short interruptions (one or more non-climb runs) between two climb runs
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < runs.length; i++) {
      if (runs[i].c !== 1) continue;
      let j = i + 1; while (j < runs.length && runs[j].c !== 1) j++;
      if (j >= runs.length || j === i + 1) continue;
      const a = runs[i], c = runs[j], len = P[c.i0][0] - P[a.i1][0], loss = P[a.i1][1] - P[c.i0][1];
      if (len <= p.dipKm && loss < DIP_MAX_LOSS_M) { runs.splice(i, j - i + 1, { c: 1, i0: a.i0, i1: c.i1 }); changed = true; break; }
    }
  }
  // 3. qualify climbs / 4. descents
  runs.forEach(r => {
    const len = P[r.i1][0] - P[r.i0][0], g = meanGrad(P, r.i0, r.i1), gain = P[r.i1][1] - P[r.i0][1];
    if (r.c === 1 && !(len >= p.minKm && g >= p.minGrad && gain >= CLIMB_MIN_GAIN_M)) r.c = 0;
    if (r.c === -1 && !(len >= 2 && g <= -3)) r.c = 0;
  });
  // 5. merge same-type neighbours
  const merged = [];
  runs.forEach(r => { const l = merged[merged.length - 1]; if (l && l.c === r.c) l.i1 = r.i1; else merged.push(Object.assign({}, r)); });
  // short non-climb links: fold into the adjacent non-climb run (longer one), then re-merge same types
  let again = true;
  while (again) {
    again = false;
    for (let i = 0; i < merged.length; i++) {
      const r = merged[i], len = P[r.i1][0] - P[r.i0][0];
      if (r.c === 1 || len >= SHORT_LINK_KM || merged.length < 2) continue;
      const prev = merged[i - 1], next = merged[i + 1];
      const cand = [prev, next].filter(x => x && x.c !== 1);
      if (!cand.length) { if (len < 0.3) { (prev || next).i0 = Math.min((prev || next).i0, r.i0); (prev || next).i1 = Math.max((prev || next).i1, r.i1); merged.splice(i, 1); again = true; break; } continue; }
      const tgt = cand.length === 2 ? ((P[prev.i1][0] - P[prev.i0][0]) >= (P[next.i1][0] - P[next.i0][0]) ? prev : next) : cand[0];
      tgt.i0 = Math.min(tgt.i0, r.i0); tgt.i1 = Math.max(tgt.i1, r.i1);
      const g = meanGrad(P, tgt.i0, tgt.i1); tgt.c = g <= -2 ? -1 : (g >= 2 ? 1 : 0); if (tgt.c === 1) tgt.c = 0;
      merged.splice(i, 1); again = true; break;
    }
    if (!again) { for (let i = 0; i < merged.length - 1; i++) { if (merged[i].c === merged[i + 1].c) { merged[i].i1 = merged[i + 1].i1; merged.splice(i + 1, 1); again = true; break; } } }
  }
  const out = merged.map(r => {
    const from = i2km(P, r.i0), to = r.i1 >= n - 1 ? total : i2km(P, r.i1);
    return mk(r.c === 1 ? 'climb' : (r.c === -1 ? 'descent' : 'flat'), from, to, +meanGrad(P, r.i0, r.i1).toFixed(1));
  });
  applyDefaults(out, D);
  return out;
}
function i2km(P, i) { return +P[Math.min(P.length - 1, i)][0].toFixed(1); }
function mk(type, from, to, grad) { return { id: uid('s'), type, name: '', from: +from.toFixed(1), to: +to.toFixed(1), grad, delta: 0, key: false, cue: '', speedKmh: null }; }

// Default intensity offset per climb (vs the objective's base), from the estimated climb duration
// (power-duration logic: short efforts sustain more), altitude and fatigue (position in the race).
export function defaultDelta(D, s, refMin) {
  const min = refMin != null ? refMin : estMinutes(D, s), summit = altAt(D, s.to), pos = s.from / D.totalKm;
  let d = min <= 5 ? 0.08 : min <= 10 ? 0.06 : min <= 20 ? 0.04 : min <= 40 ? 0.02 : min <= 75 ? 0 : min <= 120 ? -0.02 : -0.04;
  if (summit > 2000) d -= 0.02;
  if (pos > 0.8) d -= 0.03; else if (pos > 0.6) d -= 0.01;
  return Math.max(-0.08, Math.min(0.08, Math.round(d * 100) / 100));
}
function estMinutes(D, s) { const ftp = ftpVal(), mass = kgVal() + (S.settings.bikeKg || 8); return (s.to - s.from) * 1000 / solveSpeed(ftp * 0.75, mass, Math.max(1, s.grad)) / 60; }
export function applyDefaults(segs, D) {
  const climbs = segs.filter(s => s.type === 'climb');
  climbs.forEach(s => { s.delta = defaultDelta(D, s); s.key = false; });
  climbs.map(s => ({ s, gain: altAt(D, s.to) - altAt(D, s.from) })).sort((a, b) => b.gain - a.gain).slice(0, 2).forEach(x => { x.s.key = true; });
}
function altAt(D, km) { const P = D.profile, i = Math.max(0, Math.min(P.length - 1, Math.round(km / PROFILE_STEP_KM))); return P[i][1]; }

// recompute grad of a segment from the profile
export function refreshGrad(D, s) { const dk = s.to - s.from; s.grad = dk > 0 ? +((altAt(D, s.to) - altAt(D, s.from)) / (dk * 1000) * 100).toFixed(1) : 0; }

export function mergeWithNext(segs, D, i) {
  if (i < 0 || i >= segs.length - 1) return segs;
  const a = segs[i], b = segs[i + 1];
  const m = Object.assign({}, a, { to: b.to, name: a.name || b.name, cue: a.cue || b.cue, key: a.key || b.key, type: a.type === 'climb' || b.type === 'climb' ? 'climb' : a.type });
  refreshGrad(D, m);
  segs.splice(i, 2, m); return segs;
}
export function splitAt(segs, D, i, km) {
  const s = segs[i]; if (!s || km <= s.from + 0.2 || km >= s.to - 0.2) return segs;
  const a = Object.assign({}, s, { to: +km.toFixed(1) }), b = Object.assign({}, s, { id: uid('s'), from: +km.toFixed(1), name: '', cue: '', key: false });
  refreshGrad(D, a); refreshGrad(D, b);
  segs.splice(i, 1, a, b); return segs;
}

// carry user edits (name, key, delta, cue, speedKmh) from old segments to new ones by nearest `from`
export function reattachEdits(oldSegs, newSegs) {
  const edited = oldSegs.filter(s => s.name || s.cue || s.speedKmh || s.key);
  edited.forEach(o => {
    let best = null, bd = Infinity;
    newSegs.forEach(nw => { if (nw.type !== o.type) return; const d = Math.abs(nw.from - o.from) + Math.abs(nw.to - o.to) * 0.5; if (d < bd) { bd = d; best = nw; } });
    if (best && bd < 6) { if (o.name && !best.name) best.name = o.name; if (o.cue && !best.cue) best.cue = o.cue; if (o.speedKmh) best.speedKmh = o.speedKmh; if (o.key) best.key = true; if (o.delta != null) best.delta = o.delta; }
  });
  return newSegs;
}
