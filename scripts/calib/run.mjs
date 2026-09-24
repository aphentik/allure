#!/usr/bin/env node
// Model calibration on real activities (FIT or timestamped GPX). Usage: node scripts/calib/run.mjs activites/ [--ftp 250 --kg 75]
// Output: scripts/calib/REPORT.md. Never part of the web app.
import fs from 'fs'; import path from 'path';
import { parseFIT, fitToPoints } from './fit.mjs';
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const { buildTrack, altAtKm, PROFILE_STEP_KM } = await import(ROOT + '/js/gpx.js');
const { autoSegments } = await import(ROOT + '/js/segment.js');
const { S } = await import(ROOT + '/js/state.js');
const { computeSegc, solveSpeed, airDensity, MODEL } = await import(ROOT + '/js/physics.js');

const args = process.argv.slice(2); const dir = args.find(a => !a.startsWith('--')) || 'activites';
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? +args[i + 1] : null; };
const FTP = opt('ftp') || 250, KG = opt('kg') || 75, BIKE = opt('bike') || 8;
S.settings.ftp = FTP; S.settings.kg = KG; S.settings.bikeKg = BIKE; S.settings.obj = 'diesel';

function loadGPX(txt) { const re = /<trkpt lat="([-\d.]+)" lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g; let m; const pts = []; while ((m = re.exec(txt))) { const b = m[3], e = /<ele>([-\d.]+)<\/ele>/.exec(b), t = /<time>([^<]+)<\/time>/.exec(b), pw = /<(?:ns3:|gpxtpx:)?power>(\d+)</.exec(b), hr = /<(?:ns3:|gpxtpx:)?hr>(\d+)</.exec(b); pts.push({ lat: +m[1], lon: +m[2], ele: e ? +e[1] : null, t: t ? Date.parse(t[1]) / 1000 : null, power: pw ? +pw[1] : null, hr: hr ? +hr[1] : null }); } return pts; }
function loadActivity(file) { const buf = fs.readFileSync(file); return /\.fit$/i.test(file) ? fitToPoints(parseFIT(buf)) : loadGPX(buf.toString('utf8')); }

// moving time between two indices (pauses = speed < 2 km/h for > 20 s excluded)
function movingTime(pts, i0, i1) { let t = 0; for (let i = i0 + 1; i <= i1; i++) { const dt = pts[i].t - pts[i - 1].t; if (dt <= 0 || dt > 120) continue; const d = hav(pts[i - 1], pts[i]); if (d / dt * 3.6 < 2 && dt > 20) continue; t += dt; } return t; }
function hav(a, b) { const R = 6371000, r = Math.PI / 180, d1 = (b.lat - a.lat) * r, d2 = (b.lon - a.lon) * r, x = Math.sin(d1 / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(d2 / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
function idxAtKm(D, km) { const d = km * 1000; let lo = 0, hi = D.cum.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (D.cum[mid] < d) lo = mid + 1; else hi = mid; } return lo; }
function avgPower(pts, i0, i1) { let s = 0, n = 0; for (let i = i0; i <= i1; i++) if (pts[i].power != null) { s += pts[i].power; n++; } return n > (i1 - i0) * 0.5 ? s / n : null; }

// predicted time of a segment at a given constant power (physics only), same integration as the app
function predictAtPower(D, s, power, mass, params) {
  let t = 0, k = s.from; const p = Object.assign({ CdA: MODEL.CdA, Crr: MODEL.Crr, coastIF: MODEL.coastIF, aLat: 0.32, cap: 58 }, params);
  while (k < s.to - 1e-9) { const k2 = Math.min(s.to, k + PROFILE_STEP_KM), g = (altAtKm(D, k2) - altAtKm(D, k)) / ((k2 - k) * 1000) * 100, alt = altAtKm(D, (k + k2) / 2), rho = airDensity(alt);
    let v; if (g <= -1.5) { v = Math.min(solveSpeed(FTP * p.coastIF, mass, g, { CdA: MODEL.CdAdesc, rho, Crr: p.Crr }), p.cap / 3.6); const i = Math.round(((k + k2) / 2) / PROFILE_STEP_KM); let r = Infinity; for (let j = Math.max(0, i - 1); j <= Math.min(D.radius.length - 1, i + 1); j++) r = Math.min(r, D.radius[j]); v = Math.min(v, Math.sqrt(p.aLat * 9.81 * r)); }
    else v = solveSpeed(power, mass, g, { CdA: p.CdA, rho, Crr: p.Crr });
    t += (k2 - k) * 1000 / Math.max(0.5, v); k = k2; }
  return t;
}

const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(fit|gpx)$/i.test(f)).map(f => path.join(dir, f)) : [];
if (!files.length) { console.error('Aucun fichier .fit/.gpx dans', dir); process.exit(1); }
const rows = []; let report = '# Calibration Allure — ' + new Date().toISOString().slice(0, 10) + '\n\nFTP ' + FTP + ' W · ' + KG + ' kg · vélo ' + BIKE + ' kg · ' + files.length + ' activité(s)\n';
for (const file of files) {
  const pts = loadActivity(file).filter(p => p.t != null); if (pts.length < 100) { report += '\n## ' + path.basename(file) + '\nfichier ignoré (pas de points horodatés)\n'; continue; }
  const D = buildTrack(pts.map(p => [p.lat, p.lon, p.ele])); const race = { start: '07:00', track: { pts: pts.map(p => [p.lat, p.lon, p.ele]) }, segments: autoSegments(D, {}), waypoints: [] };
  S.race = race; S.D = D; const segc = computeSegc(race, D);
  const hasPower = pts.filter(p => p.power != null).length > pts.length * 0.5;
  report += '\n## ' + path.basename(file) + '\n' + D.totalKm.toFixed(1) + ' km · ' + D.dplus + ' m D+ · puissance ' + (hasPower ? 'oui' : 'non') + ' · temps en mouvement réel ' + (movingTime(pts, 0, pts.length - 1) / 3600).toFixed(2) + ' h · prévu (pacing Gérer) ' + (segc.reduce((a, s) => a + s.tSec, 0) / 3600).toFixed(2) + ' h\n\n';
  report += '| type | km | pente | réel | prévu pacing | écart | P réelle | prévu à P réelle | écart phys. |\n|---|---|---|---|---|---|---|---|---|\n';
  segc.forEach(s => { const i0 = idxAtKm(D, s.from), i1 = idxAtKm(D, s.to), real = movingTime(pts, i0, i1), pw = hasPower ? avgPower(pts, i0, i1) : null;
    const phys = pw != null && s.type === 'climb' ? predictAtPower(D, s, pw, KG + BIKE, {}) : null;
    rows.push({ file: path.basename(file), type: s.type, from: s.from, to: s.to, grad: s.grad, real, pred: s.tSec, pw, phys, D, s });
    report += `| ${s.type} | ${s.from}→${s.to} | ${s.grad}% | ${(real / 60).toFixed(0)} min | ${(s.tSec / 60).toFixed(0)} min | ${real ? ((s.tSec / real - 1) * 100).toFixed(0) : '–'} % | ${pw != null ? Math.round(pw) + ' W' : '–'} | ${phys != null ? (phys / 60).toFixed(0) + ' min' : '–'} | ${phys != null ? ((phys / real - 1) * 100).toFixed(0) + ' %' : '–'} |\n`; });
}
// aggregate
const agg = {}; rows.forEach(r => { if (!r.real) return; const k = r.type; agg[k] = agg[k] || { n: 0, sum: 0, sq: 0 }; const e = r.pred / r.real - 1; agg[k].n++; agg[k].sum += e; agg[k].sq += e * e; });
report += '\n## Synthèse (prévu au pacing Gérer vs réel)\n\n| type | n | écart moyen | écart-type |\n|---|---|---|---|\n';
Object.entries(agg).forEach(([k, a]) => { const m = a.sum / a.n, sd = Math.sqrt(Math.max(0, a.sq / a.n - m * m)); report += `| ${k} | ${a.n} | ${(m * 100).toFixed(1)} % | ${(sd * 100).toFixed(1)} % |\n`; });
// grid search on physics constants for climbs with power
const climbs = rows.filter(r => r.type === 'climb' && r.pw != null && r.real > 300);
if (climbs.length) {
  let best = null;
  for (const CdA of [0.30, 0.34, 0.38]) for (const Crr of [0.004, 0.005, 0.006]) for (const bike of [8, 10, 12]) { let se = 0; climbs.forEach(r => { const p = predictAtPower(r.D, r.s, r.pw, KG + bike, { CdA, Crr }); const e = p / r.real - 1; se += e * e; }); const rm = Math.sqrt(se / climbs.length); if (!best || rm < best.rm) best = { CdA, Crr, bike, rm }; }
  report += `\n## Physique en montée (${climbs.length} montées avec puissance)\n\nMeilleur jeu : CdA ${best.CdA} · Crr ${best.Crr} · masse vélo+équipement ${best.bike} kg → erreur RMS ${(best.rm * 100).toFixed(1)} % (défauts actuels : CdA ${MODEL.CdA}, Crr ${MODEL.Crr}, ${BIKE} kg).\n`;
}
const descents = rows.filter(r => r.type === 'descent' && r.real > 120);
if (descents.length) {
  let best = null;
  for (const aLat of [0.25, 0.32, 0.4, 0.5]) for (const cap of [50, 58, 66, 75]) for (const coastIF of [0.2, 0.3, 0.4]) { let se = 0; descents.forEach(r => { const p = predictAtPower(r.D, r.s, 0, KG + BIKE, { aLat, cap, coastIF }); const e = p / r.real - 1; se += e * e; }); const rm = Math.sqrt(se / descents.length); if (!best || rm < best.rm) best = { aLat, cap, coastIF, rm }; }
  report += `\n## Descentes (${descents.length})\n\nMeilleur jeu : a_lat ${best.aLat} g · plafond ${best.cap} km/h · relance ${Math.round(best.coastIF * 100)} % FTP → erreur RMS ${(best.rm * 100).toFixed(1)} %.\n`;
}
fs.writeFileSync(path.join(ROOT, 'scripts/calib/REPORT.md'), report); console.log(report);
