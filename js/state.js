// Shared mutable state + persistence + tiny pub/sub.
export const S = {
  lang: 'fr',
  theme: 'dark',
  race: null,        // see README "Race file"
  D: null,           // derived from race.track: {cum, profile, totalKm, dplus, hasEle}
  settings: {
    ftp: 250, kg: 75, bikeKg: 8, obj: 'diesel', advIF: 0.75,
    flatIF: 0.62, draft: 0.20, descentCapKmh: 48, draftLevel: 'groupe', descLevel: 'standard',
    seg: { minGrad: 2.5, minKm: 1.5, dipKm: 2.5 },
    showFountains: false,
    nut: { gph: 75, gGel: 45, gBidon: 40, bsize: 0.6, isoPct: 50, ravito: 'ravitos' }
  },
  ui: { tab: 'plan', stOrient: 'portrait', stDim: { portrait: 38, landscape: 28 }, gxDev: 'coros', showWind: true, baseLayer: 'topo' },
  wx: { data: null, fetchedAt: null, loading: false, error: false, pts: [], nWx: 0 },
  totalSec: 0
};

const listeners = {};
export function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); }
export function emit(evt, data) { (listeners[evt] || []).forEach(fn => { try { fn(data); } catch (e) { console.error('[' + evt + ']', e); } }); }

// ---- localStorage (settings, ui, lang, theme) ----
const LS_KEY = 'allure-prefs';
export function savePrefs() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ lang: S.lang, theme: S.theme, settings: S.settings, ui: S.ui })); } catch (e) {}
}
export function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (!p) return;
    if (p.lang) S.lang = p.lang;
    if (p.theme) S.theme = p.theme;
    if (p.settings) { deepMerge(S.settings, p.settings); }
    if (p.ui) { deepMerge(S.ui, p.ui); }
  } catch (e) {}
}
function deepMerge(dst, src) {
  Object.keys(src).forEach(k => {
    if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && dst[k] && typeof dst[k] === 'object') deepMerge(dst[k], src[k]);
    else dst[k] = src[k];
  });
}

// ---- IndexedDB (race, incl. track points) ----
const DB_NAME = 'allure', STORE = 'race';
function openDB() {
  return new Promise((res, rej) => {
    if (!('indexedDB' in window)) return rej(new Error('no idb'));
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export function saveRace() {
  if (!S.race) return Promise.resolve();
  return openDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(S.race, 'current');
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  })).catch(e => console.warn('saveRace', e));
}
export function loadRace() {
  return openDB().then(db => new Promise((res, rej) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get('current');
    r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error);
  })).catch(() => null);
}
export function clearRace() {
  return openDB().then(db => new Promise((res) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete('current');
    tx.oncomplete = () => res();
  })).catch(() => {});
}

// ---- race JSON export / import ----
export const RACE_VERSION = 1;
export function raceToJSON() {
  const r = S.race;
  return JSON.stringify({
    v: RACE_VERSION, name: r.name, date: r.date, start: r.start,
    track: { pts: r.track.pts.map(p => [round(p[0], 6), round(p[1], 6), p[2] == null ? null : round(p[2], 1)]) },
    segments: r.segments, waypoints: r.waypoints,
    settings: S.settings
  });
}
function round(x, n) { const f = Math.pow(10, n); return Math.round(x * f) / f; }
export function raceFromJSON(txt) {
  const j = JSON.parse(txt);
  if (!j || !j.track || !Array.isArray(j.track.pts) || !j.track.pts.length) throw new Error('bad race file');
  return {
    name: j.name || '', date: j.date || '', start: j.start || '07:00',
    track: { pts: j.track.pts },
    segments: Array.isArray(j.segments) ? j.segments : [],
    waypoints: Array.isArray(j.waypoints) ? j.waypoints : [],
    _settings: j.settings || null
  };
}

export function uid(prefix) { return prefix + Math.random().toString(36).slice(2, 8); }
