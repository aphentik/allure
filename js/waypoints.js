// <wpt> classification and snapping to the track.
import { nearestKm } from './gpx.js';
import { uid } from './state.js';

export const KINDS = ['ravito', 'fountain', 'barrier', 'danger', 'summit', 'foot', 'other'];
const RULES = [
  ['ravito', /ravit|aid|feed|food|refresh|nutrition|buffet/],
  ['barrier', /barri|contr[oô]|cut.?off|checkpoint|limite|time limit|hors delai|pointage/],
  ['danger', /danger|attention|caution|hazard|prudence|chute|gravel|tunnel|virage|travaux/],
  ['fountain', /fontaine|fountain|water|eau|source|bouteille|drink|robinet|cimetiere|cemetery/],
  ['summit', /^col |^col$|^cold |summit|sommet|\bpass\b|^mont |^pas de|^port de|^puerto|^passo/],
  ['foot', /pied|foot|bottom|base|debut|start of/]
];
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
export function classifyWpt(w) {
  const txt = norm(w.name + ' ' + w.desc + ' ' + w.sym);
  if (/^water$/i.test(w.type || '') || /water/i.test(w.sym || '')) return 'fountain';
  for (const [k, re] of RULES) if (re.test(txt)) return k;
  return 'other';
}
export function snapWpts(race, D, wpts) {
  return wpts.map(w => {
    const n = nearestKm(race, D, w.lat, w.lon);
    return { id: uid('w'), kind: classifyWpt(w), km: +n.km.toFixed(1), name: w.name || '', desc: w.desc || '', time: '', srcName: w.name, dist: Math.round(n.dist), matched: n.dist <= 150, truncated: (w.name || '').length === 15 };
  });
}
// use summit (first) then foot waypoints to name climbs, then drop them
export function nameClimbs(race) {
  const climbs = race.segments.filter(s => s.type === 'climb');
  const cands = race.waypoints.filter(w => (w.kind === 'summit' || w.kind === 'foot') && w.matched !== false);
  cands.sort((a, b) => (a.kind === 'summit' ? 0 : 1) - (b.kind === 'summit' ? 0 : 1));
  cands.forEach(w => {
    let best = null, bd = Infinity;
    climbs.forEach(c => { const d = Math.abs((w.kind === 'summit' ? c.to : c.from) - w.km); if (d < bd) { bd = d; best = c; } });
    if (best && bd <= 2 && !best.name) best.name = cleanName(w.name);
  });
}
// strip "Pied (de/du) …" / "Sommet (du) …" prefixes; keep "Col …" as is
function cleanName(n) { return String(n || '').replace(/^(pied|foot|bottom|sommet|summit|top)\s+(of\s+)?(du|de la|de l'|de|des|the)?\s*/i, '').trim() || n; }
