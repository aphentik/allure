#!/usr/bin/env node
// Forecast vs reality on a race: node scripts/calib/compare.mjs <course.gpx> --rider "name=A,fit=path,ftp=300,kg=78,obj=perf,desc=expert" [--rider ...]
// Aligns each FIT to the course by km (direction-aware), compares predicted and actual time/power per segment. Output: markdown on stdout.
import fs from 'fs'; import path from 'path';
import { parseFIT, fitToPoints } from './fit.mjs';
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const { buildTrack, hav, llAtKm, altAtKm } = await import(ROOT + '/js/gpx.js');
const { autoSegments } = await import(ROOT + '/js/segment.js');
const { S } = await import(ROOT + '/js/state.js');
const { computeSegc, cumSecAt } = await import(ROOT + '/js/physics.js');

const args = process.argv.slice(2); const course = args.find(a => !a.startsWith('--'));
const riders = []; for (let i = 0; i < args.length; i++) if (args[i] === '--rider') riders.push(Object.fromEntries(args[i + 1].split(',').map(kv => kv.split('='))));
if (!course || !riders.length) { console.error('usage: compare.mjs course.gpx --rider "name=..,fit=..,ftp=..,kg=..,obj=perf,desc=expert"'); process.exit(1); }

const gx = fs.readFileSync(course, 'utf8'); const re = /<trkpt lat="([-\d.]+)" lon="([-\d.]+)"[^>]*>([\s\S]*?)<\/trkpt>/g; let m; const cpts = [];
while ((m = re.exec(gx))) { const e = /<ele>([-\d.]+)<\/ele>/.exec(m[3]); cpts.push([+m[1], +m[2], e ? +e[1] : null]); }
const D = buildTrack(cpts); const race = { start: '07:00', track: { pts: cpts }, segments: autoSegments(D, {}), waypoints: [] };
const fmt = s => { const h = Math.floor(s / 3600), mn = Math.round((s % 3600) / 60); return h + 'h' + String(mn).padStart(2, '0'); };
const clock = s => { s = ((s % 86400) + 86400) % 86400; return String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0'); };
const localSec = t => { const d = new Date(t * 1000); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); };

// direction-aware projection of FIT points onto course km
function alignToCourse(fpts) {
  const n = cpts.length, out = []; let idx = 0;
  for (const p of fpts) {
    let best = -1, bd = Infinity; const lo = Math.max(0, idx - 40), hi = Math.min(n - 1, idx + 400);
    for (let i = lo; i <= hi; i += 2) { const d = hav(p.lat, p.lon, cpts[i][0], cpts[i][1]); if (d < bd) { bd = d; best = i; } }
    if (bd < 80) { idx = best; out.push({ t: p.t, km: D.cum[best] / 1000, power: p.power, hr: p.hr, off: false }); } else out.push({ t: p.t, km: D.cum[idx] / 1000, power: p.power, hr: p.hr, off: true });
  }
  return out;
}
function timeAtKm(al, km) { for (const p of al) if (p.km >= km - 1e-6) return p.t; return al[al.length - 1].t; }
function avgPower(al, a, b) { let s = 0, n = 0; al.forEach(p => { if (p.km >= a && p.km < b && p.power != null) { s += p.power; n++; } }); return n ? s / n : null; }
function stops(al, a, b) { let st = 0; for (let i = 1; i < al.length; i++) { const p = al[i], q = al[i - 1]; if (p.km < a || p.km >= b) continue; const dt = p.t - q.t; if (dt > 20 && (p.km - q.km) * 1000 / dt * 3.6 < 2) st += dt; else if (dt <= 20 && dt > 0 && (p.km - q.km) * 1000 / dt * 3.6 < 2 && (p.power == null || p.power === 0)) st += dt; } return st; }

// historical wind (Open-Meteo archive) at ~12 points along the course, hourly
async function loadWind(dateISO) {
  const pts = []; for (let k = 0; k < 12; k++) { const km = (k + 0.5) * D.totalKm / 12, ll = llAtKm(race, D, km); pts.push({ km, lat: ll.lat, lon: ll.lon }); }
  const url = 'https://archive-api.open-meteo.com/v1/archive?latitude=' + pts.map(p => p.lat.toFixed(4)).join(',') + '&longitude=' + pts.map(p => p.lon.toFixed(4)).join(',') + '&start_date=' + dateISO + '&end_date=' + dateISO + '&hourly=wind_speed_10m,wind_direction_10m&timezone=auto';
  try { const r = await fetch(url); if (!r.ok) throw new Error('http ' + r.status); const j = await r.json(); const arr = Array.isArray(j) ? j : [j];
    return (km, sec) => { let i = 0; while (i < pts.length - 1 && pts[i + 1].km < km) i++; const h = Math.max(0, Math.min(23, Math.round(sec / 3600))); const d = arr[i]; if (!d || !d.hourly) return null; return { speed: d.hourly.wind_speed_10m[h], dir: d.hourly.wind_direction_10m[h] }; }; }
  catch (e) { console.error('(vent archive indisponible : ' + e.message + ')'); return null; }
}

let out = '# Prévision vs réel — ' + path.basename(course) + '\n\n' + D.totalKm.toFixed(1) + ' km · ' + D.dplus + ' m D+ · ' + race.segments.filter(s => s.type === 'climb').length + ' cols détectés\n';
for (const r of riders) {
  const fpts = fitToPoints(parseFIT(new Uint8Array(fs.readFileSync(r.fit)))).filter(p => p.t);
  const al = alignToCourse(fpts), start = al[0].t, startSec = localSec(start), dateISO = new Date(start * 1000).toISOString().slice(0, 10);
  const offPct = Math.round(al.filter(p => p.off).length / al.length * 100);
  S.settings.ftp = +r.ftp; S.settings.kg = +r.kg; S.settings.bikeKg = 11; race.start = clock(startSec);
  const runs = {};
  S.settings.obj = r.obj || 'perf'; runs.preset = computeSegc(race, D);
  S.settings.obj = 'adv'; S.settings.advIF = { chill: 0.68, diesel: 0.75, perf: 0.80 }[r.obj || 'perf']; S.settings.flatIF = { chill: 0.58, diesel: 0.62, perf: 0.66 }[r.obj || 'perf']; S.settings.draftLevel = 'groupe'; S.settings.descLevel = r.desc || 'expert';
  runs.adv = computeSegc(race, D);
  const windFn = await loadWind(dateISO); let windRun = null;
  if (windFn) { const prev = runs.adv; windRun = computeSegc(race, D, { windFn: km => windFn(km, startSec + cumSecAt(prev, km)) }); }
  const total = a => a.reduce((x, s) => x + s.tSec, 0);
  const realTotal = al[al.length - 1].t - start, realStops = stops(al, 0, D.totalKm + 1);
  out += `\n## ${r.name} — FTP ${r.ftp} W · ${r.kg} kg · objectif ${r.obj || 'perf'} · descente ${r.desc || 'expert'}\n\nDépart ${clock(startSec)} le ${dateISO} · réel ${fmt(realTotal)} dont arrêts ${fmt(realStops)} (en mouvement ${fmt(realTotal - realStops)}) · points hors trace ${offPct} %\n`;
  out += `Prévu : préréglage ${fmt(total(runs.preset))} · descente ${r.desc || 'expert'} ${fmt(total(runs.adv))}` + (windRun ? ` · + vent réel ${fmt(total(windRun))}` : '') + '\n\n';
  out += '| segment | km | prévu | réel (mvt) | arrêts | écart | W cible | W réel | passage prévu | passage réel |\n|---|---|---|---|---|---|---|---|---|---|\n';
  const base = windRun || runs.adv; let cumP = 0;
  base.forEach(s => { cumP += s.tSec; const t0 = timeAtKm(al, s.from), t1 = timeAtKm(al, s.to), st = stops(al, s.from, s.to), real = t1 - t0 - st, pw = avgPower(al, s.from, s.to);
    const target = s.type === 'climb' ? s.w : (s.flatW != null ? s.flatW : null);
    out += `| ${s.type}${s.type === 'climb' ? ' ' + Math.round(s.pct * 100) + '%' : ''} | ${s.from}→${s.to} | ${fmt(s.tSec)} | ${fmt(real)} | ${st > 30 ? fmt(st) : ''} | ${real > 0 ? ((s.tSec / real - 1) * 100).toFixed(0) + ' %' : ''} | ${target != null ? target + ' W' : ''} | ${pw != null ? Math.round(pw) + ' W' : ''} | ${clock(startSec + cumP)} | ${clock(localSec(t1))} |\n`; });
  const pwAll = avgPower(al, 0, D.totalKm + 1); out += `\nPuissance moyenne réelle ${Math.round(pwAll)} W (${Math.round(pwAll / r.ftp * 100)} % FTP).\n`;
}
console.log(out);
