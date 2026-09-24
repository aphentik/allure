import { S, on, emit, loadPrefs, savePrefs, loadRace, saveRace, clearRace } from './state.js';
import { t, fmtn, fmtDate, STR } from './i18n.js';
import { buildTrack } from './gpx.js';
import { assignCodes, computeSegc, DESC_LEVELS, DRAFT_LEVELS } from './physics.js';
import { compute } from './plan.js';
import { nutSync, computeNutrition } from './nutrition.js';
import { fetchWeather, renderWeather, buildWxPoints } from './weather.js';
import { buildProfile, initProfile } from './profile.js';
import { initMap, buildMap, relabelMap } from './map.js';
import { renderChecklist, resetChecklist } from './checklist.js';
import { generatePlanPDF, generateStickerPDF, buildStickerPreview, stSyncControls, generateExport, gxSync, busy, routeText } from './export.js';
import { renderConfig, renderEmpty, initEditor, handleFile, runOSM } from './editor.js';
import { VERSION, REPO } from './version.js';

const $ = id => document.getElementById(id);
function setText(id, k) { const e = $(id); if (e) e.textContent = t(k); }

// ---- race lifecycle ----
function setRace(race, D) {
  S.race = race; S.D = D || buildTrack(race.track.pts);
  assignCodes(S.race, S.D);
  saveRace();
  renderAll(); fetchWeather(); showTab('plan'); openConfig(); runOSM();
}
function openConfig() { if (!S.race) return; renderConfig(); $('cfgModal').classList.add('open'); }
function closeModals() { document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open')); }
function renderAll() {
  const has = !!S.race;
  $('viewEmpty').style.display = has ? 'none' : '';
  ['profile', 'wxSumPanel', 'actionBar', 'hdrActions'].forEach(id => { $(id).style.display = has ? '' : 'none'; });
  document.querySelectorAll('.tab[data-tab]').forEach(b => { if (b.dataset.tab !== 'check') b.style.display = has ? '' : 'none'; });
  renderHeader(); renderConfig(); if (!has) { renderEmpty(); $('mapWrap').style.display = 'none'; }
  if (!has) return;
  syncInputs(); buildProfile(); compute(); buildMap();
}
function renderHeader() {
  const r = S.race;
  $('event').textContent = r ? (r.name || t('rcTitle')) : t('tagline');
  $('route').innerHTML = r ? routeText() : '';
  document.title = 'Allure' + (r && r.name ? ' · ' + r.name : '');
}
function syncInputs() {
  const st = S.settings;
  if (document.activeElement !== $('ftp')) $('ftp').value = st.ftp;
  if (document.activeElement !== $('kg')) $('kg').value = st.kg;
  $('start').value = S.race ? S.race.start : '07:00';
  document.querySelectorAll('#obj button').forEach(b => b.setAttribute('aria-pressed', b.dataset.o === st.obj));
  $('advWrap').style.display = st.obj === 'adv' ? '' : 'none';
  $('advRange').value = Math.round(st.advIF * 100); updateAdv();
  $('flatIF').value = Math.round(st.flatIF * 100); $('flatIFV').textContent = Math.round(st.flatIF * 100);
  syncLevels();
  $('profFount').setAttribute('aria-pressed', st.showFountains); $('gxFount').setAttribute('aria-pressed', st.showFountains);
  nutSync();
}
function syncLevels() {
  const st = S.settings;
  document.querySelectorAll('#draftSel button').forEach(b => { b.setAttribute('aria-pressed', b.dataset.dr === st.draftLevel); b.innerHTML = t('dr_' + b.dataset.dr) + '<small>' + t('dr_' + b.dataset.dr + '_h') + '</small>'; });
  document.querySelectorAll('#descSel button').forEach(b => { b.setAttribute('aria-pressed', b.dataset.dl === st.descLevel); b.innerHTML = t('dl_' + b.dataset.dl) + ' · ' + DESC_LEVELS[b.dataset.dl] + ' km/h<small>' + t('dl_' + b.dataset.dl + '_h') + '</small>'; });
}
function updateAdv() {
  const r = $('advRange'), v = +r.value; $('advVal').textContent = v;
  const c = v < 65 ? 'var(--ice)' : (v > 80 ? 'var(--flamme)' : 'var(--ok)'); $('advVal').style.color = c;
  const k = v < 65 ? 'advLow' : (v > 80 ? 'advHigh' : 'advOk');
  const D = S.D; $('advReco').innerHTML = (D ? fmtn(t('advReco'), { km: Math.round(D.totalKm), dp: D.dplus, lo: 65, hi: 80 }) + ' ' : '') + '<b style="color:' + c + '">(' + t(k) + ')</b>';
}
function showTab(w) {
  S.ui.tab = w; savePrefs();
  ['plan', 'nutri', 'weather', 'check'].forEach(k => { const v = $('view' + k[0].toUpperCase() + k.slice(1)); if (v) v.style.display = w === k ? '' : 'none'; });
  document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-pressed', x.dataset.tab === w));
}

// ---- language / static texts ----
function applyLang() {
  document.documentElement.setAttribute('lang', S.lang);
  ['eyebrow', 'profcap', 'dataTitle', 'labFtp', 'labKg', 'labStart', 'goalTitle', 'o1', 'o1s', 'o2', 'o2s', 'o3', 'o3s', 'o4', 'o4s', 'advLabel', 'advUnit', 'advMore', 'labFlatIF', 'flatHint', 'labDraft', 'labDescCap', 'modelNote',
    'nutTitle', 'labGph', 'labGel', 'labBidon', 'labBsize', 'nutIsoTitle', 'nutIsoLab', 'nutRvTitle', 'rv1', 'rv2', 'nutRatesT', 'nutCarryT', 'nutPlanT',
    'mTitle', 'mHint', 'soP', 'soL', 'gxTitle', 'gxAutre', 'gxHint', 'wxTitle', 'wxDetail',
    'tabPlan', 'tabNutri', 'tabWx', 'tabCheck', 'chkTitle', 'chkIntro', 'chkReset', 'emptyTitle', 'emptyText', 'cfgTitle'].forEach(id => setText(id, id));
  setText('pdfBtn', 'btnPdf'); setText('stickerBtn', 'btnSticker'); setText('stickerPdfBtn', 'mDl'); setText('mClose', 'mClose'); setText('gxClose', 'mClose'); setText('gpxBtn', 'gpxBtn');
  setText('profFount', 'gxFountBtn'); setText('gxFountInc', 'gxFountInc'); $('gxFount').textContent = t('gxFountInc'); setText('cfgBtn', 'cfgBtn'); setText('cfgBtn2', 'cfgBtn'); setText('cfgClose', 'mClose');
  $('wxRefresh').textContent = t('wxRefresh'); $('wxSumRefresh').textContent = t('wxRefresh'); $('wxSumDetail').textContent = t('wxDetail');
  $('sodium').innerHTML = t('sodium');
  $('foot').innerHTML = fmtn(t('foot'), { bike: S.settings.bikeKg });
  renderVersion();
  $('themeBtn').textContent = S.theme === 'light' ? t('theme_dark') : t('theme_light');
  $('wxSub').innerHTML = fmtn(t('wxSub'), { date: S.race && S.race.date ? fmtDate(S.race.date) : '…' });
  $('wxSumTitle').textContent = fmtn(t('wxSumTitle'), { date: S.race && S.race.date ? fmtDate(S.race.date) : '' });
  document.querySelectorAll('.langsel button').forEach(b => b.setAttribute('aria-pressed', b.dataset.l === S.lang));
  stSyncControls(); gxSync(); renderChecklist(); relabelMap();
  savePrefs(); renderAll();
}
let verInfo = null; // {sha, date} of latest commit on main, from the GitHub API
function renderVersion() {
  const e = $('version'); if (!e) return;
  const base = 'https://github.com/' + REPO, build = VERSION.build ? new Date(VERSION.build) : null;
  let h = fmtn(t('verLine'), { tag: VERSION.tag, date: fmtDate(VERSION.date), url: base + '/releases/tag/v' + VERSION.tag });
  if (build) h += ' · build ' + build.toLocaleString(S.lang === 'en' ? 'en-GB' : 'fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  if (verInfo && build) { const behind = new Date(verInfo.date) - build > 90 * 1000; // main committed after this build
    h += ' · <span class="' + (behind ? 'ver-warn' : 'ver-ok') + '">' + (behind ? fmtn(t('verBehind'), { sha: verInfo.sha.slice(0, 7), url: base + '/commits/main' }) : t('verOk')) + '</span>'; }
  e.innerHTML = h;
  $('eyebrow').textContent = t('eyebrow') + ' · v' + VERSION.tag;
}
function checkVersion() {
  fetch('https://api.github.com/repos/' + REPO + '/commits/main', { headers: { Accept: 'application/vnd.github+json' } })
    .then(r => r.ok ? r.json() : null).then(j => { if (j && j.sha) { verInfo = { sha: j.sha, date: j.commit.committer.date }; renderVersion(); } }).catch(() => {});
}
function applyTheme(th) { S.theme = th; document.documentElement.setAttribute('data-theme', th); $('themeBtn').textContent = th === 'light' ? t('theme_dark') : t('theme_light'); savePrefs(); }

// ---- events ----
function wire() {
  document.querySelectorAll('.langsel button').forEach(b => b.addEventListener('click', () => { S.lang = b.dataset.l; applyLang(); }));
  $('themeBtn').addEventListener('click', () => applyTheme(S.theme === 'light' ? 'dark' : 'light'));
  document.querySelectorAll('.tab').forEach(tb => tb.addEventListener('click', () => showTab(tb.dataset.tab)));
  $('cfgBtn').addEventListener('click', openConfig); $('cfgBtn2').addEventListener('click', openConfig);
  $('cfgClose').addEventListener('click', () => $('cfgModal').classList.remove('open'));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });
  ['ftp', 'kg'].forEach(id => $(id).addEventListener('input', () => { S.settings[id] = +$(id).value || S.settings[id]; savePrefs(); compute(); }));
  $('start').addEventListener('change', () => { if (!S.race) return; S.race.start = $('start').value || '07:00'; saveRace(); compute(); renderConfig(); });
  $('obj').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.settings.obj = b.dataset.o; savePrefs(); syncInputs(); compute(); });
  $('advRange').addEventListener('input', () => { S.settings.advIF = (+$('advRange').value) / 100; updateAdv(); savePrefs(); compute(); });
  $('flatIF').addEventListener('input', () => { S.settings.flatIF = (+$('flatIF').value) / 100; $('flatIFV').textContent = $('flatIF').value; savePrefs(); compute(); });
  $('draftSel').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.settings.draftLevel = b.dataset.dr; savePrefs(); syncLevels(); compute(); });
  $('descSel').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.settings.descLevel = b.dataset.dl; savePrefs(); syncLevels(); compute(); });
  ['gph', 'gGel', 'gBidon', 'bsize'].forEach(id => $(id).addEventListener('input', () => { S.settings.nut[id] = +$(id).value || S.settings.nut[id]; savePrefs(); computeNutrition(); }));
  $('isoPct').addEventListener('input', function () { S.settings.nut.isoPct = +this.value; savePrefs(); nutSync(); computeNutrition(); });
  $('nutRv').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.settings.nut.ravito = b.dataset.rv; savePrefs(); nutSync(); computeNutrition(); });
  $('wxRefresh').addEventListener('click', fetchWeather); $('wxSumRefresh').addEventListener('click', fetchWeather);
  $('wxSumDetail').addEventListener('click', () => showTab('weather'));
  $('chkReset').addEventListener('click', resetChecklist);
  $('pdfBtn').addEventListener('click', function () { const done = busy(this, t('busy')); try { generatePlanPDF(); } catch (e) { console.error(e); alert('PDF error: ' + e.message); } setTimeout(done, 600); });
  $('stickerBtn').addEventListener('click', () => { stSyncControls(); buildStickerPreview(); $('stickerModal').classList.add('open'); });
  document.querySelectorAll('#stickerModal [data-so]').forEach(b => b.addEventListener('click', () => { S.ui.stOrient = b.dataset.so; savePrefs(); stSyncControls(); buildStickerPreview(); }));
  $('stSize').addEventListener('input', function () { const p = S.ui.stOrient === 'portrait', mn = p ? 25 : 18, mx = p ? 55 : 40, v = Math.max(mn, Math.min(mx, +this.value || S.ui.stDim[S.ui.stOrient])); S.ui.stDim[S.ui.stOrient] = v; savePrefs(); buildStickerPreview(); });
  $('mClose').addEventListener('click', () => $('stickerModal').classList.remove('open'));
  $('stickerPdfBtn').addEventListener('click', function () { const done = busy(this, t('busy')); try { generateStickerPDF(); } catch (e) { console.error(e); alert('PDF error: ' + e.message); } setTimeout(done, 600); });
  $('gpxBtn').addEventListener('click', () => { $('gxMsg').textContent = ''; gxSync(); $('gpxModal').classList.add('open'); });
  $('gxClose').addEventListener('click', () => $('gpxModal').classList.remove('open'));
  document.querySelectorAll('#gxDev button').forEach(b => b.addEventListener('click', () => { S.ui.gxDev = b.dataset.dev; savePrefs(); gxSync(); }));
  $('gxDl').addEventListener('click', function () { const done = busy(this, t('gxLoading')); generateExport().then(done, done); });
  const setF = v => { S.settings.showFountains = v; savePrefs(); $('profFount').setAttribute('aria-pressed', v); $('gxFount').setAttribute('aria-pressed', v); buildProfile(); buildMap(); };
  $('profFount').addEventListener('click', () => setF(!S.settings.showFountains)); $('gxFount').addEventListener('click', () => setF(!S.settings.showFountains));
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); }));
  // race edits from the editor
  let wxTimer = null;
  on('race-edit', d => { renderHeader(); syncInputs(); buildProfile(); compute(); buildMap();
    if (d && d.structural && S.wx.data) { const np = buildWxPoints(S.race, S.D), old = S.wx.pts.slice(0, S.wx.nWx); const same = np.length === old.length && np.every((p, i) => Math.abs(p.km - old[i].km) < 0.05);
      if (same) { np.forEach((p, i) => { old[i].name = p.name; old[i].key = p.key; }); renderWeather(); } else { clearTimeout(wxTimer); wxTimer = setTimeout(fetchWeather, 1500); } } });
  on('race-date', () => { $('wxSub').innerHTML = fmtn(t('wxSub'), { date: fmtDate(S.race.date) }); $('wxSumTitle').textContent = fmtn(t('wxSumTitle'), { date: fmtDate(S.race.date) }); fetchWeather(); });
  on('race-reset', () => { clearRace().then(() => { S.race = null; S.D = null; S.wx.data = null; closeModals(); renderAll(); renderWeather(); showTab('plan'); }); });
}

// ---- boot ----
(function boot() {
  if (location.protocol === 'file:') { $('fileBanner').style.display = ''; }
  loadPrefs();
  if (!DESC_LEVELS[S.settings.descLevel]) { const c = S.settings.descentCapKmh || 48; S.settings.descLevel = c < 44 ? 'prudent' : c < 52 ? 'standard' : c < 59 ? 'confirme' : 'expert'; }
  if (DRAFT_LEVELS[S.settings.draftLevel] == null) { const d = S.settings.draft || 0.2; S.settings.draftLevel = d < 0.1 ? 'seul' : d < 0.3 ? 'groupe' : 'peloton'; }
  document.documentElement.setAttribute('data-theme', S.theme);
  wire(); initProfile(); initMap(); initEditor(setRace); checkVersion();
  const qs = new URLSearchParams(location.search);
  if (qs.has('debug')) { const log = m => { let e = $('errlog'); if (!e) { e = document.createElement('pre'); e.id = 'errlog'; e.className = 'banner'; e.style.cssText = 'white-space:pre-wrap;position:fixed;bottom:70px;left:8px;right:8px;z-index:99;max-height:40vh;overflow:auto'; document.body.appendChild(e); } e.textContent += m + '\n'; };
    window.addEventListener('error', e => log('ERR ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno)); window.addEventListener('unhandledrejection', e => log('REJ ' + (e.reason && e.reason.stack || e.reason))); window.__log = log; }
  const deep = qs.get('gpx') || qs.get('race');
  loadRace().then(r => {
    if (deep) return fetch(deep).then(x => { if (!x.ok) throw new Error('http ' + x.status); return x.text(); }).then(txt => { applyLang(); return handleFile(new File([txt], deep.split('/').pop() || 'course.gpx'), setRace); })
      .catch(e => { console.error(e); applyLang(); const st = $('rcStatus'); if (st) { st.textContent = t('rcErrParse') + ' (' + deep + ')'; st.className = 'rc-status err'; } });
    if (r && r.track && r.track.pts && r.track.pts.length) { S.race = r; S.D = buildTrack(r.track.pts); assignCodes(S.race, S.D); }
    applyLang();
    if (S.race) { fetchWeather(); showTab(S.ui.tab && S.ui.tab !== 'race' ? S.ui.tab : 'plan'); }
    else { renderWeather(); showTab('plan'); }
  });
})();
