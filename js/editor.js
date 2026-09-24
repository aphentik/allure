// Race tab: GPX / JSON import, detection settings, segment + waypoint editors.
import { S, emit, saveRace, raceFromJSON, raceToJSON, uid } from './state.js';
import { t, fmtn, esc, segName, fmtDate } from './i18n.js';
import { parseGPX, buildTrack } from './gpx.js';
import { autoSegments, mergeWithNext, splitAt, reattachEdits, applyDefaults } from './segment.js';
import { snapWpts, nameClimbs, KINDS } from './waypoints.js';
import { assignCodes } from './physics.js';
import { dl, slug } from './export.js';
import { nameClimbsFromOSM, fountainsFromOSM } from './osm.js';

const DELTAS = Array.from({ length: 17 }, (_, i) => (i - 8) / 100); // -8 % … +8 % vs the objective's base intensity
const deltaLabel = d => Math.abs(d) < 1e-9 ? t('d0') : (d > 0 ? '+' : '−') + Math.round(Math.abs(d) * 100) + ' %';
let importInfo = null; // {n, unmatched}

export function raceFromGPXText(text) {
  const g = parseGPX(text);
  if (!g.pts.length) throw new Error('nopts');
  const race = { name: g.name || '', date: '', start: '07:00', track: { pts: g.pts }, segments: [], waypoints: [] };
  const D = buildTrack(g.pts);
  race.segments = autoSegments(D, S.settings.seg);
  const wp = snapWpts(race, D, g.wpts);
  importInfo = { n: wp.length, unmatched: wp.filter(w => !w.matched).length };
  race.waypoints = wp.filter(w => w.matched);
  nameClimbs(race);
  race.waypoints = race.waypoints.filter(w => w.kind !== 'summit' && w.kind !== 'foot');
  return { race, D };
}

export function handleFile(file, setRace) {
  const st = document.getElementById('rcStatus'); if (st) { st.textContent = t('rcParsing'); st.className = 'rc-status'; }
  return file.text().then(text => {
    let race, D;
    if (/^\s*\{/.test(text)) { race = raceFromJSON(text); D = buildTrack(race.track.pts); if (race._settings) { Object.assign(S.settings, race._settings); delete race._settings; } importInfo = null; }
    else ({ race, D } = raceFromGPXText(text));
    if (!race.name) race.name = file.name.replace(/\.(gpx|json)$/i, '');
    setRace(race, D);
    if (st) { st.textContent = D.hasEle ? '' : t('rcErrNoEle'); st.className = 'rc-status' + (D.hasEle ? '' : ' warn'); }
  }).catch(e => { console.error(e); if (st) { st.textContent = e.message === 'nopts' ? t('rcErrPts') : t('rcErrParse'); st.className = 'rc-status err'; } });
}

function commit(structural) { assignCodes(S.race, S.D); saveRace(); emit('race-edit', { structural: !!structural }); }

let osmStatus = '';
export function runOSM(opt) {
  const race = S.race, D = S.D; if (!race || !D) return Promise.resolve();
  const doF = !(opt && opt.fountains === false);
  osmStatus = t('osmBusy'); paintStatus();
  // sequential: public Overpass instances throttle concurrent requests per IP
  return nameClimbsFromOSM(race, D).catch(() => null).then(c => (doF ? fountainsFromOSM(race, D).catch(() => null) : Promise.resolve(0)).then(f => [c, f])).then(([c, f]) => {
    if (S.race !== race) return;
    osmStatus = (c == null && (f == null || !doF)) ? t('osmErr') : fmtn(t('osmDone'), { c: c || 0, f: f || 0 });
    commit(true); renderConfig();
  });
}
function paintStatus() { const e = document.getElementById('osmStatus'); if (e) e.textContent = osmStatus; }

export function dropZoneHtml() {
  return '<div class="drop" id="dropZone"><div>' + t('rcDrop') + ' <label class="browse">' + t('rcBrowse') + '<input type="file" id="fileInp" accept=".gpx,.json,application/gpx+xml,application/json" hidden></label></div><div class="drop-sub">' + t('rcOrJson') + '</div><div id="rcStatus" class="rc-status"></div></div>';
}
export function renderEmpty() { const z = document.getElementById('emptyZone'); if (!z) return; z.innerHTML = dropZoneHtml(); wireDrop(z); }

export function renderConfig() {
  const box = document.getElementById('cfgBody'); if (!box) return;
  const race = S.race, D = S.D;
  if (!race) { box.innerHTML = ''; return; }
  const nClimb = race.segments.filter(s => s.type === 'climb').length;
  let h = '<div class="panel"><div class="panel-title">' + t('rcTitle') + '</div>';
  h += '<div class="fields3"><div><label>' + t('rcName') + '</label><div class="inp"><input id="rcName" type="text" value="' + esc(race.name) + '"></div></div>';
  h += '<div><label>' + t('rcDate') + '</label><div class="inp"><input id="rcDate" type="date" value="' + esc(race.date) + '"></div></div>';
  h += '<div><label>' + t('rcStart') + '</label><div class="inp"><input id="rcStart" type="time" value="' + esc(race.start) + '"></div></div></div>';
  h += '<div class="rc-sum">' + fmtn(t('rcSummary'), { km: D.totalKm.toFixed(1), dp: D.hasEle ? D.dplus : '–', n: nClimb }) + (importInfo ? ' · ' + fmtn(t('rcWptImported'), { n: importInfo.n, u: importInfo.unmatched }) : '') + '</div>';
  h += '<div class="rc-status" id="osmStatus">' + esc(osmStatus) + '</div>';
  if (!D.hasEle) h += '<div class="rc-status warn">' + t('rcErrNoEle') + '</div>';
  h += '</div>';
  // waypoints (quick add first)
  h += '<div class="panel"><div class="panel-title">' + t('rcWpts') + '</div>';
  h += '<div class="qa"><span class="qa-t">' + t('qaTitle') + '</span><label class="ed-lab">' + t('qaKm') + ' <input id="qaKm" class="ed-num" type="number" min="0" max="' + D.totalKm.toFixed(1) + '" step="0.1" placeholder="0.0"></label>' +
    '<select id="qaKind" class="ed-sel">' + KINDS.filter(k => k !== 'summit' && k !== 'foot').map(k => '<option value="' + k + '">' + t('k' + k[0].toUpperCase() + k.slice(1)) + '</option>').join('') + '</select>' +
    '<input id="qaName" class="ed-name" type="text" placeholder="' + t('qaName') + '"><button class="actbtn prim" id="qaAdd">' + t('qaAdd') + '</button></div>';
  const wps = race.waypoints.slice().sort((a, b) => a.km - b.km);
  if (!wps.length) h += '<div class="nutri-sub" style="margin-top:12px">' + t('rcWptNone') + '</div>';
  h += '<div class="ed-list" style="margin-top:12px">' + wps.map(w => '<div class="ed-wp k-' + w.kind + '" data-id="' + w.id + '">' +
    '<select data-f="kind" class="ed-sel">' + KINDS.map(k => '<option value="' + k + '"' + (w.kind === k ? ' selected' : '') + '>' + t('k' + k[0].toUpperCase() + k.slice(1)) + '</option>').join('') + '</select>' +
    '<label class="ed-lab">km <input data-f="km" class="ed-num" type="number" min="0" max="' + D.totalKm.toFixed(1) + '" step="0.1" value="' + w.km + '"></label>' +
    '<input data-f="name" class="ed-name" type="text" placeholder="' + t('rcWptName') + '" value="' + esc(w.name) + '">' +
    '<input data-f="desc" class="ed-cue" type="text" placeholder="' + t('rcWptDesc') + '" value="' + esc(w.desc || '') + '">' +
    (w.kind === 'barrier' ? '<label class="ed-lab">' + t('rcWptTime') + ' <input data-f="time" type="time" value="' + esc(w.time || '') + '"></label>' : '') +
    (w.kind === 'ravito' && w.code ? '<span class="ed-code">' + esc(w.code) + '</span>' : '') +
    '<button data-a="del" class="ed-del" title="' + t('del') + '">✕</button></div>').join('') + '</div></div>';
  // detection
  if (D.hasEle) {
    const sg = S.settings.seg;
    h += '<div class="panel"><div class="panel-title">' + t('rcDetect') + '</div><div class="sliders">' +
      slider('sgGrad', t('rcMinGrad'), sg.minGrad, 2, 5, 0.5, ' %') + slider('sgKm', t('rcMinKm'), sg.minKm, 1, 5, 0.5, ' km') + slider('sgDip', t('rcDipKm'), sg.dipKm, 0.5, 3, 0.5, ' km') +
      '</div><div class="rc-actions"><button class="actbtn prim" id="sgRun">' + t('rcRedetect') + '</button><span class="nc-note">' + t('rcDetectHint') + '</span></div></div>';
  }
  // segments
  h += '<div class="panel"><div class="panel-title">' + t('rcSegs') + '</div><div class="ed-list">';
  let ci = 0;
  race.segments.forEach((s, i) => { if (s.type === 'climb') ci++;
    h += '<div class="ed-seg ' + s.type + (s.key ? ' key' : '') + '" data-i="' + i + '">' +
      '<div class="ed-row1"><select data-f="type" class="ed-sel">' + ['climb', 'flat', 'descent'].map(ty => '<option value="' + ty + '"' + (s.type === ty ? ' selected' : '') + '>' + t(ty === 'climb' ? 'segClimb' : ty === 'flat' ? 'segFlat' : 'segDescent') + '</option>').join('') + '</select>' +
      '<input data-f="name" class="ed-name" type="text" placeholder="' + esc(segName(s, s.type === 'climb' ? ci : null)) + '" value="' + esc(s.name) + '">' +
      (s.type === 'climb' && s.name && s.nameSrc && s.nameSrc !== 'user' ? '<span class="ed-src' + (s.nameSrc === 'pass' || s.nameSrc === 'wpt' ? '' : ' weak') + '" title="' + t('src_' + s.nameSrc) + '">' + t('src_' + s.nameSrc) + '</span>' : '') +
      '<span class="ed-km">km ' + s.from + ' → ' + s.to + ' · ' + (s.to - s.from).toFixed(1) + ' km' + (D.hasEle ? ' · ' + s.grad + ' %' : '') + '</span></div>' +
      '<div class="ed-row2">' +
      (s.type === 'climb' ? '<label class="ed-chk"><input type="checkbox" data-f="key"' + (s.key ? ' checked' : '') + '> ' + t('rcSegKey') + '</label>' +
        '<label class="ed-lab">' + t('rcSegDelta') + ' <select data-f="delta" class="ed-sel">' + DELTAS.map(d => '<option value="' + d + '"' + (Math.abs((s.delta || 0) - d) < 0.005 ? ' selected' : '') + '>' + deltaLabel(d) + '</option>').join('') + '</select></label>'
        : '<label class="ed-lab">' + t('rcSegSpeed') + ' <input data-f="speedKmh" class="ed-num" type="number" min="8" max="80" step="1" placeholder="' + t('rcSpeedAuto') + '" value="' + (s.speedKmh || '') + '"> km/h</label>') +
      '<input data-f="cue" class="ed-cue" type="text" placeholder="' + t('rcSegCue') + '" value="' + esc(s.cue) + '">' +
      '<span class="ed-btns">' + (i < race.segments.length - 1 ? '<button data-a="merge" title="' + t('rcMerge') + '">⤵ ' + t('rcMerge') + '</button>' : '') + (s.to - s.from >= 1 ? '<button data-a="split" title="' + t('rcSplit') + '">✂ ' + t('rcSplit') + '</button>' : '') + '</span></div></div>';
  });
  h += '</div></div>';
  // file actions
  h += '<div class="panel"><div class="rc-actions"><button class="actbtn" id="osmBtn">' + t('osmRefresh') + '</button><button class="actbtn" id="rcExport">' + t('rcExport') + '</button><button class="actbtn" id="rcImportBtn">' + t('rcImport') + '</button><button class="actbtn danger" id="rcReset">' + t('rcReset') + '</button></div>';
  h += '<div id="rcDropWrap" style="display:none;margin-top:14px">' + dropZoneHtml() + '</div></div>';
  box.innerHTML = h; wire(box);
}
function slider(id, lab, v, mn, mx, st, unit) { return '<div class="slider-row"><div class="shead"><span class="slabel">' + lab + '</span><span class="sval"><span id="' + id + 'V">' + v + '</span><small>' + unit + '</small></span></div><input type="range" id="' + id + '" min="' + mn + '" max="' + mx + '" step="' + st + '" value="' + v + '"></div>'; }

let setRaceFn = null;
export function initEditor(setRace) { setRaceFn = setRace; }

function wireDrop(box) {
  const dz = box.querySelector('#dropZone'), fi = box.querySelector('#fileInp');
  if (fi) fi.addEventListener('change', () => { if (fi.files[0]) handleFile(fi.files[0], setRaceFn); });
  if (dz) { ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); })); ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', e => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) handleFile(f, setRaceFn); }); }
}
function wire(box) {
  wireDrop(box);
  if (!S.race) return;
  const race = S.race, D = S.D;
  const q = id => box.querySelector('#' + id);
  q('rcName').addEventListener('input', e => { race.name = e.target.value; commit(); });
  q('rcDate').addEventListener('change', e => { race.date = e.target.value; commit(); emit('race-date'); });
  q('rcStart').addEventListener('change', e => { race.start = e.target.value || '07:00'; commit(); });
  q('rcExport').addEventListener('click', () => dl(new Blob([raceToJSON()], { type: 'application/json' }), 'allure-' + slug() + '.json'));
  q('rcImportBtn').addEventListener('click', () => { const w = q('rcDropWrap'); w.style.display = w.style.display === 'none' ? '' : 'none'; });
  q('osmBtn').addEventListener('click', () => runOSM());
  q('rcReset').addEventListener('click', e => { const b = e.currentTarget; if (b.dataset.armed) { emit('race-reset'); } else { b.dataset.armed = '1'; b.textContent = t('rcResetConfirm'); setTimeout(() => { b.dataset.armed = ''; b.textContent = t('rcReset'); }, 4000); } });
  if (D.hasEle) {
    [['sgGrad', 'minGrad'], ['sgKm', 'minKm'], ['sgDip', 'dipKm']].forEach(([id, k]) => { const r = q(id); r.addEventListener('input', () => { S.settings.seg[k] = +r.value; q(id + 'V').textContent = r.value; }); });
    q('sgRun').addEventListener('click', () => { const ns = autoSegments(D, S.settings.seg); reattachEdits(race.segments, ns); race.segments = ns; commit(true); renderConfig(); runOSM({ fountains: false }); });
  }
  box.querySelectorAll('.ed-seg').forEach(row => {
    const i = +row.dataset.i, s = race.segments[i];
    row.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener(inp.type === 'text' ? 'input' : 'change', () => {
      const f = inp.dataset.f;
      if (f === 'key') s.key = inp.checked; else if (f === 'delta') s.delta = +inp.value; else if (f === 'speedKmh') s.speedKmh = inp.value ? Math.max(8, Math.min(80, +inp.value)) : null;
      else if (f === 'type') { s.type = inp.value; if (s.type === 'climb') { s.speedKmh = null; } commit(true); renderConfig(); if (s.type === 'climb' && !s.name) runOSM({ fountains: false }); return; }
      else { s[f] = inp.value; if (f === 'name') s.nameSrc = 'user'; }
      commit(f === 'key');
    }));
    row.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.a === 'merge') mergeWithNext(race.segments, D, i); else splitAt(race.segments, D, i, (s.from + s.to) / 2);
      commit(true); renderConfig(); if (b.dataset.a === 'split' && s.type === 'climb') runOSM({ fountains: false });
    }));
  });
  box.querySelectorAll('.ed-wp').forEach(row => {
    const w = race.waypoints.find(x => x.id === row.dataset.id); if (!w) return;
    row.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener(inp.type === 'text' ? 'input' : 'change', () => {
      const f = inp.dataset.f;
      if (f === 'km') { w.km = Math.max(0, Math.min(D.totalKm, +inp.value || 0)); commit(); renderConfig(); return; }
      if (f === 'kind') { w.kind = inp.value; commit(); renderConfig(); return; }
      w[f] = inp.value; commit(f === 'time');
    }));
    row.querySelector('[data-a=del]').addEventListener('click', () => { race.waypoints = race.waypoints.filter(x => x.id !== w.id); commit(); renderConfig(); });
  });
  const qaKm = q('qaKm'), qaKind = q('qaKind'), qaName = q('qaName');
  const quickAdd = () => { const km = parseFloat(String(qaKm.value).replace(',', '.')); if (!isFinite(km)) { qaKm.focus(); return; }
    race.waypoints.push({ id: uid('w'), kind: qaKind.value, km: +Math.max(0, Math.min(D.totalKm, km)).toFixed(1), name: qaName.value.trim(), desc: '', time: '' });
    commit(qaKind.value === 'barrier'); renderConfig(); const k = document.getElementById('qaKm'); if (k) { document.getElementById('qaKind').value = qaKind.value; k.focus(); } };
  q('qaAdd').addEventListener('click', quickAdd);
  [qaKm, qaName].forEach(el => el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); quickAdd(); } }));
}
