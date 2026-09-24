// <wpt> classification and snapping to the track.
import { nearestKm } from './gpx.js';
import { uid } from './state.js';

export const KINDS = ['ravito', 'fountain', 'barrier', 'danger', 'summit', 'foot', 'other'];
// word-boundary based rules on normalised text (accents stripped, lowercase)
const RULES = [
  ['ravito', /\b(ravito|ravitaillement|ravit\w*|aid station|feed( zone| station)?|food|refreshment|nutrition|buffet|stand|assistance)\b/],
  ['barrier', /\b(barriere|barrier|controle|checkpoint|cut.?off|limite horaire|time limit|hors delai|pointage|point de contro\w*)\b/],
  ['danger', /\b(danger|dangereux|attention|caution|hazard|prudence|chute|gravier|gravel|tunnel|virage serre|travaux|passage a niveau)\b/],
  ['fountain', /\b(fontaine|fountain|drinking water|water( point| tap)?|point d.?eau|eau potable|eau|robinet|source|bouteille d.?eau|cimetiere|cemetery)\b/],
  ['summit', /^(col|cold|pas|port|puerto|passo|passo di|mont|sommet|summit)\b|\b(summit|sommet|pass)$/],
  ['foot', /^(pied|foot|bottom|base|debut)\b/]
];
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
export function classifyWpt(w) {
  const txt = norm(w.name + ' ' + w.desc + ' ' + (/^\d+$/.test(w.sym || '') ? '' : w.sym));
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
