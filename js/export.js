// PDF plan, stickers, GPX/TCX export.
import { S } from './state.js';
import { t, fmtn, fmtDur, fmtClock, fmtDate, segName, esc } from './i18n.js';
import { computeSegc, cumSecAt, parseStart, ftpVal, kgVal } from './physics.js';
import { nutritionPlan } from './nutrition.js';
import { computePlanData, objLabel } from './plan.js';
import { llAtKm, altAtKm } from './gpx.js';

export function pdfSafe(s) { return String(s).replace(/🏁/g, 'ARR').replace(/≈/g, '~').replace(/✓/g, '').replace(/→/g, '->').replace(/↓/g, '').replace(/[←-⇿☀-➿]/g, '').replace(/[\uD800-\uDFFF]/g, '').trim(); }
export function busy(btn, txt) { const o = btn.textContent; btn.textContent = txt; btn.disabled = true; return () => { btn.textContent = o; btn.disabled = false; }; }
export function dl(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000); }
export function slug() { return (S.race.name || 'course').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'course'; }
export function routeText() { const D = S.D, n = S.race.segments.filter(s => s.type === 'climb').length; return Math.round(D.totalKm) + ' km' + (D.hasEle ? ' · ' + D.dplus + ' m D+' : '') + ' · ' + (n === 1 ? t('col1') : n ? fmtn(t('cols'), { n }) : t('noCols')) + (S.race.date ? ' · ' + fmtDate(S.race.date) : ''); }
function nColsShort() { const n = S.race.segments.filter(s => s.type === 'climb').length; return n ? fmtn(t('cols'), { n }) : ''; }

// ---- PDF ----
export function generatePlanPDF() {
  const jsPDF = window.jspdf.jsPDF, d = computePlanData(), doc = new jsPDF({ unit: 'mm', format: 'a4' }), M = 14, Wp = 210; let y = 18;
  const gray = [110, 110, 110], ink = [20, 20, 20], gold = [184, 120, 20], red = [196, 44, 40], blue = [36, 110, 140], green = [40, 130, 80];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...ink); doc.text(pdfSafe('Allure · ' + (S.race.name || t('rcTitle'))), M, y); y += 6;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...gray); doc.text(pdfSafe(routeText()), M, y); y += 6;
  doc.setDrawColor(220, 220, 220); doc.line(M, y, Wp - M, y); y += 6;
  doc.setFontSize(9.5); doc.setTextColor(...ink); doc.text(pdfSafe('FTP ' + d.ftp + ' W  ·  ' + d.kg + ' kg  ·  ' + objLabel() + '  ·  ' + t('pdfStart') + ' ' + fmtClock(d.startSec)), M, y); y += 7;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...gold); doc.text(pdfSafe(t('pdfMoving') + ' ' + fmtDur(d.totalSec)), M, y);
  doc.setFontSize(10); doc.setTextColor(...ink); doc.text(pdfSafe(t('pdfArr') + fmtClock(d.arrival)), Wp - M, y, { align: 'right' }); y += 8;
  const LH = 4.3;
  d.rows.forEach(r => {
    const nl = (r.type === 'climb' ? 2 : 1) + (r.cue ? 1 : 0) + (r.warn ? 1 : 0) + (r.rav && r.rav.length ? 2 : 0) + (r.bar ? 1 : 0);
    if (y + nl * LH + 6 > 287) { doc.addPage(); y = 18; }
    if (r.type === 'climb') {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...ink); doc.text(pdfSafe(r.idx + '. ' + r.name), M, y);
      doc.setTextColor(...(r.key ? red : gold)); doc.text(r.w + ' W', Wp - M, y, { align: 'right' }); y += 5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...gray);
      doc.text(pdfSafe('km ' + r.from + '→' + r.to + ' · ' + r.grad + '% · ' + Math.round(r.pct * 100) + '% FTP'), M, y);
      doc.text(pdfSafe(r.wkg.toFixed(1) + ' W/kg · ' + (r.to - r.from).toFixed(1) + ' km · ' + fmtDur(r.tSec) + ' · ' + t('tlPass') + ' ' + fmtClock(r.passSec)), Wp - M, y, { align: 'right' }); y += LH;
    } else {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...ink); doc.text(pdfSafe(r.name + '  ·  km ' + r.from + '→' + r.to), M, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...gray); doc.text(pdfSafe('~' + fmtDur(r.tSec) + ' · ' + t('tlPass') + ' ' + fmtClock(r.passSec)), Wp - M, y, { align: 'right' }); y += LH;
    }
    if (r.cue) { doc.setFontSize(8); doc.setTextColor(90, 120, 150); doc.text(pdfSafe(r.cue), M, y); y += LH; }
    if (r.warn) { doc.setFontSize(8); doc.setTextColor(...red); doc.text(pdfSafe('! ' + r.warn), M, y); y += LH; }
    if (r.rav && r.rav.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6); doc.setTextColor(...blue);
      const rt = doc.splitTextToSize(pdfSafe(r.rav.map(x => x.k + ' (km ' + x.km + ') ' + x.t).join('    |    ')), Wp - 2 * M); doc.text(rt, M, y); y += rt.length * 3.7 + 0.6; }
    if (r.bar) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6); doc.setTextColor(...(r.bar.ok ? green : red)); doc.text(pdfSafe(fmtn(t('tlBarr'), { label: r.bar.label, km: r.bar.km, time: r.bar.time, pass: fmtClock(r.bar.pass), m: (r.bar.ok ? t('tlMargin') : t('tlLate')) + fmtDur(r.bar.margin) })), M, y); y += LH; }
    y += 1.6; doc.setDrawColor(232, 232, 232); doc.line(M, y, Wp - M, y); y += 4;
  });
  if (y + 30 > 287) { doc.addPage(); y = 18; } else y += 3;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...ink); doc.text(t('pdfNut'), M, y); y += 5.5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6); doc.setTextColor(...gray); doc.text(pdfSafe(fmtn(t('pdfNutLine'), { need: d.nutri.need, gph: d.nutri.gph, water: d.nutri.water })), M, y); y += 4.7;
  const isoTxt = d.nutri.iso > 0 ? d.nutri.iso + ' ' + t('pdfIso') : t('pdfWaterB');
  const gelsTxt = d.nutri.gels + (d.nutri.ravito === 'ravitos' && d.nutri.ravitoGels > 0 ? fmtn(t('pdfAtRav'), { n: d.nutri.ravitoGels }) : '');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...ink); doc.text(pdfSafe(fmtn(t('pdfNutCarry'), { gels: gelsTxt, iso: isoTxt })), M, y); y += 4.6;
  if (d.nutri.gelsPerH > 0.05) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.2); doc.setTextColor(...gray); doc.text(pdfSafe(fmtn(t('pdfRhythm'), { m: Math.round(d.nutri.perGelMin), w: d.nutri.waterBottles })), M, y); y += 6; } else y += 1.5;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.6); doc.setTextColor(...ink); doc.text(pdfSafe(t('nutPlanT')), M, y); y += 4.4;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.7);
  d.nutri.stops.forEach(l => { if (!l.required) return; if (y > 286) { doc.addPage(); y = 18; }
    doc.setTextColor(...(l.tooLong ? red : gray));
    doc.text(pdfSafe((l.finish ? t('nlFinish') : l.code) + ' km' + l.km + ' · ' + l.clock + ' · ' + fmtDur(l.durSec) + ' : ' + l.waterL.toFixed(1) + ' L, ' + Math.round(l.gels) + ' gel' + (l.tooLong ? '  ' + t('nlTooLongShort') : '')), M + 2, y); y += 3.7; });
  if (d.nutri.optCodes.length) { doc.setTextColor(150, 150, 150); doc.text(pdfSafe(t('nlSkipList') + ' ' + d.nutri.optCodes.join(', ')), M + 2, y); y += 3.7; }
  const founts = (S.race.waypoints || []).filter(w => w.kind === 'fountain');
  if (S.settings.showFountains && founts.length) { doc.setTextColor(38, 150, 110); doc.text(pdfSafe(t('pdfFount') + ' km ' + founts.map(w => Math.round(w.km)).join(', km ')), M + 2, y); y += 3.7; }
  y += 2.5; doc.setFont('helvetica', 'normal'); doc.setFontSize(7.3); doc.setTextColor(140, 140, 140);
  [fmtn(t('pdfN1'), { bike: S.settings.bikeKg }), t('pdfN2')].forEach(n => { const w = doc.splitTextToSize(pdfSafe(n), Wp - 2 * M); doc.text(w, M, y); y += w.length * 3.4 + 1.2; });
  dl(doc.output('blob'), 'allure-' + slug() + '-plan.pdf');
}

// ---- stickers ----
function stickerHeader() { const D = S.D; return Math.round(D.totalKm) + 'km' + (D.hasEle ? '/' + D.dplus + 'm' : ''); }
export function stickerCells() {
  const ftp = ftpVal(), race = S.race, D = S.D, segc = computeSegc(race, D), startSec = parseStart(race.start), np = nutritionPlan(), stopMap = {};
  np.stops.forEach(x => { stopMap[x.code] = x; });
  const founts = (race.waypoints || []).filter(w => w.kind === 'fountain');
  function ravTxt(s) { const parts = (s.ravitos || []).map(r => { const st = stopMap[r.k], lab = r.k === 'ARR' ? 'ARR' : r.k + ' km' + r.km; return (st && !st.required) ? '(' + lab + ')' : lab; });
    if (S.settings.showFountains) { const nf = founts.filter(w => w.km >= s.from && w.km < s.to).length; if (nf) parts.push('+' + nf + ' ' + t('stFount')); }
    return parts.join('  '); }
  const cells = []; let ci = 0;
  segc.forEach((s, i) => { const rav = ravTxt(s), warn = s.warn || '';
    if (s.type === 'climb') { ci++; cells.push({ t: s.key ? 'k' : 'c', km: Math.round(s.from) + '-' + Math.round(s.to), nm: segName(s, ci), w: s.w + 'w', key: s.key, tm: fmtDur(s.tSec), pass: fmtClock(startSec + cumSecAt(segc, s.to)), warn, rav }); }
    else if (i === 0) cells.push({ t: 'f', km: Math.round(s.from) + '-' + Math.round(s.to), nm: segName(s), w: t('stWarm'), rav, warn });
    else if (rav || warn) cells.push({ t: 'd', km: Math.round(s.from) + '-' + Math.round(s.to), nm: s.type === 'descent' ? t('stDesc') : segName(s), w: t('stDrink'), warn, rav }); });
  const nutri = { l1: fmtn(t('stNut1'), { g: np.gelsPerH.toFixed(1), b: np.bottlesPerH.toFixed(1) }), l2: fmtn(t('stNut2'), { gph: np.gph, water: np.water.toFixed(1) }) };
  return { ftp, cells, nutri, title: (race.name || 'ALLURE').toUpperCase().slice(0, 22), sub: stickerHeader() };
}
const STBG = { k: [255, 244, 214], c: [251, 233, 233], d: [238, 244, 250], f: [245, 245, 245] };
function drawStickerPortrait(doc, sc) {
  const W = S.ui.stDim.portrait, f = W / 35, GAP = 10, hdr = 12 * f, rowH = 10.5 * f, foot = 13 * f, yTop = 16, tw = W - 3.6 * f;
  const totalH = hdr + sc.cells.length * rowH + foot, copies = (W * 2 + GAP <= 200) ? 2 : 1, x0 = (210 - (W * copies + GAP * (copies - 1))) / 2;
  function strip(x) { let y = yTop;
    doc.setFillColor(28, 94, 140); doc.rect(x, y, W, hdr, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(9 * f); doc.text(pdfSafe(doc.splitTextToSize(sc.title, tw)[0]), x + W / 2, y + 5 * f, { align: 'center' }); doc.setFontSize(5.5 * f); doc.text(sc.sub + ' · FTP' + sc.ftp, x + W / 2, y + 9 * f, { align: 'center' }); y += hdr;
    sc.cells.forEach(r => { doc.setFillColor(...STBG[r.t]); doc.rect(x, y, W, rowH, 'F'); if (r.t === 'k') { doc.setFillColor(28, 94, 140); doc.rect(x, y, 1.2 * f, rowH, 'F'); }
      doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'bold'); doc.setFontSize(6.2 * f); doc.text(r.km, x + 2.3 * f, y + 3.1 * f);
      const kw = doc.getTextWidth(r.km); doc.setFont('helvetica', 'normal'); doc.text(pdfSafe(doc.splitTextToSize(r.nm, tw - kw - 1.4 * f)[0]), x + 2.3 * f + kw + 1.4 * f, y + 3.1 * f);
      const meta = []; if (r.tm) meta.push(r.tm + (r.pass ? ' · ' + r.pass : '')); if (r.warn) meta.push(r.warn);
      if (meta.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(4.5 * f); doc.setTextColor(120, 120, 120); doc.text(pdfSafe(doc.splitTextToSize(meta.join(' · '), tw)[0]), x + 2.3 * f, y + 5.4 * f); }
      const big = (r.t === 'k' || r.t === 'c');
      doc.setFont('helvetica', 'bold'); doc.setFontSize((big ? 9 : 6.5) * f); doc.setTextColor(...(r.t === 'k' ? [200, 28, 54] : (r.t === 'f' ? [120, 120, 120] : [200, 100, 26])));
      doc.text(r.w, x + W - 1.6 * f, y + 9.3 * f, { align: 'right' }); const cw = doc.getTextWidth(r.w);
      if (r.rav) { doc.setFont('helvetica', 'normal'); doc.setFontSize(4.6 * f); doc.setTextColor(28, 110, 140); doc.text(pdfSafe(doc.splitTextToSize(r.rav, W - cw - 5.4 * f)[0]), x + 2.3 * f, y + 9.3 * f); }
      doc.setDrawColor(210, 210, 210); doc.line(x, y + rowH, x + W, y + rowH); y += rowH; });
    doc.setFillColor(17, 17, 17); doc.rect(x, y, W, foot, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(5.6 * f); doc.text(pdfSafe(sc.nutri.l1), x + W / 2, y + 3.8 * f, { align: 'center' }); doc.setFont('helvetica', 'normal'); doc.setFontSize(5 * f); doc.text(pdfSafe(sc.nutri.l2), x + W / 2, y + 7 * f, { align: 'center' }); doc.setFontSize(4.8 * f); doc.setTextColor(240, 190, 120); doc.text(pdfSafe(t('stMantra')), x + W / 2, y + 10.6 * f, { align: 'center' });
    doc.setDrawColor(150, 150, 150); doc.setLineDashPattern([1, 1], 0); doc.rect(x, yTop, W, totalH); doc.setLineDashPattern([], 0); }
  for (let c = 0; c < copies; c++) strip(x0 + c * (W + GAP));
  doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text(pdfSafe(t('stNoteP')), 105, yTop + totalH + 9, { align: 'center' });
}
function drawStickerLandscape(doc, sc) {
  const H = S.ui.stDim.landscape, n = sc.cells.length; let cellW = Math.min(H * 0.92, 192 / n); if (cellW < 13) cellW = 13;
  const top = H * 0.13, bot = H * 0.26, mid = H - top - bot, totalW = cellW * n; let x0 = (210 - totalW) / 2; if (x0 < 9) x0 = 9;
  const copies = (2 * H + 16 <= 250) ? 2 : 1;
  function band(y0) {
    doc.setFillColor(28, 94, 140); doc.rect(x0, y0, totalW, top, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.min(top * 2.1, 7)); doc.text(pdfSafe(sc.title + ' · ' + sc.sub + ' · FTP' + sc.ftp), x0 + totalW / 2, y0 + top * 0.7, { align: 'center' });
    const cy = y0 + top;
    sc.cells.forEach((r, i) => { const cx = x0 + i * cellW, ww = cellW - 2.8; doc.setFillColor(...STBG[r.t]); doc.rect(cx, cy, cellW, mid, 'F'); if (r.t === 'k') { doc.setFillColor(28, 94, 140); doc.rect(cx, cy, cellW, 1.1, 'F'); }
      const px = cx + 1.5;
      doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.min(H * 0.13, 4.9)); doc.text(r.km, px, cy + mid * 0.16);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(Math.min(H * 0.12, 4.6)); doc.text(pdfSafe(doc.splitTextToSize(r.nm, ww)[0]), px, cy + mid * 0.32);
      const meta = []; if (r.tm) meta.push(r.tm + (r.pass ? ' · ' + r.pass : '')); if (r.warn) meta.push(r.warn);
      if (meta.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(Math.min(H * 0.1, 3.9)); doc.setTextColor(120, 120, 120); doc.text(doc.splitTextToSize(meta.join(' · '), ww).slice(0, 2).map(pdfSafe), px, cy + mid * 0.46); }
      if (r.rav) { doc.setFont('helvetica', 'normal'); doc.setFontSize(Math.min(H * 0.1, 3.9)); doc.setTextColor(28, 110, 140); doc.text(doc.splitTextToSize(pdfSafe(r.rav), ww).slice(0, 2), px, cy + mid * 0.64); }
      const big = (r.t === 'k' || r.t === 'c');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.min(H * (big ? 0.24 : 0.17), big ? 9.5 : 6.5)); doc.setTextColor(...(r.t === 'k' ? [200, 28, 54] : (r.t === 'f' ? [120, 120, 120] : [200, 100, 26]))); doc.text(r.w, px, cy + mid * 0.93);
      doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.3); doc.line(cx + cellW, cy, cx + cellW, cy + mid); doc.setLineWidth(0.2); });
    const by = cy + mid; doc.setFillColor(17, 17, 17); doc.rect(x0, by, totalW, bot, 'F'); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(Math.min(bot * 0.9, 6)); doc.text(pdfSafe(sc.nutri.l1 + '    ·    ' + sc.nutri.l2), x0 + totalW / 2, by + bot * 0.42, { align: 'center' }); doc.setFont('helvetica', 'normal'); doc.setFontSize(Math.min(bot * 0.8, 5.4)); doc.setTextColor(240, 190, 120); doc.text(pdfSafe(t('stMantra')), x0 + totalW / 2, by + bot * 0.82, { align: 'center' });
    doc.setDrawColor(150, 150, 150); doc.setLineDashPattern([1, 1], 0); doc.rect(x0, y0, totalW, H); doc.setLineDashPattern([], 0); }
  let yy = 18; for (let c = 0; c < copies; c++) { band(yy); yy += H + 12; }
  doc.setTextColor(120, 120, 120); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text(pdfSafe(t('stNoteL')), 105, yy + 2, { align: 'center' });
}
export function generateStickerPDF() { const jsPDF = window.jspdf.jsPDF, doc = new jsPDF({ unit: 'mm', format: 'a4' }), sc = stickerCells();
  if (S.ui.stOrient === 'portrait') drawStickerPortrait(doc, sc); else drawStickerLandscape(doc, sc);
  dl(doc.output('blob'), 'allure-' + slug() + '-sticker.pdf'); }
function metaHtml(r) { const m = []; if (r.tm) m.push(r.tm + (r.pass ? ' · ' + r.pass : '')); if (r.warn) m.push('<span class="warn">' + esc(r.warn) + '</span>'); return m.join(' · '); }
export function buildStickerPreview() {
  const sc = stickerCells(), box = document.getElementById('stickerContent');
  if (S.ui.stOrient === 'portrait') {
    const one = '<div class="tt"><div class="h"><b>' + esc(sc.title) + '</b><small>' + sc.sub + ' · FTP' + sc.ftp + '</small></div>' +
      sc.cells.map(r => { const meta = metaHtml(r); return '<div class="r ' + r.t + '"><div class="rhead"><span class="km">' + r.km + '</span> <span class="nm">' + esc(r.nm) + '</span></div>' + (meta ? '<div class="meta">' + meta + '</div>' : '') + '<div class="rbot">' + (r.rav ? '<span class="rav">' + esc(r.rav) + '</span>' : '') + '<span class="w">' + esc(r.w) + '</span></div></div>'; }).join('') +
      '<div class="foot2">' + esc(sc.nutri.l1) + '<br>' + esc(sc.nutri.l2) + '<br><span class="sos">' + esc(t('stMantra')) + '</span></div></div>';
    box.innerHTML = one + one;
  } else {
    const cells = sc.cells.map(r => { const meta = metaHtml(r); return '<div class="c ' + r.t + '"><div class="km">' + r.km + '</div><div class="nm">' + esc(r.nm) + '</div>' + (meta ? '<div class="meta">' + meta + '</div>' : '') + (r.rav ? '<div class="rav">' + esc(r.rav) + '</div>' : '') + '<div class="w">' + esc(r.w) + '</div></div>'; }).join('');
    box.innerHTML = '<div class="ttl"><div class="hh"><b>' + esc(sc.title) + '</b> · ' + sc.sub + ' · FTP' + sc.ftp + '</div><div class="lrow">' + cells + '</div><div class="foot2">' + esc(sc.nutri.l1) + ' · ' + esc(sc.nutri.l2) + '<br><span class="sos">' + esc(t('stMantra')) + '</span></div></div>';
  }
}
export function stSyncControls() {
  const isP = S.ui.stOrient === 'portrait', bp = document.getElementById('soP'), bl = document.getElementById('soL');
  if (bp) { bp.setAttribute('aria-pressed', isP); bl.setAttribute('aria-pressed', !isP); }
  const lab = document.getElementById('stSizeLab'); if (lab) lab.textContent = isP ? t('mSizeW') : t('mSizeH');
  const inp = document.getElementById('stSize'); if (inp) { inp.min = isP ? 25 : 18; inp.max = isP ? 55 : 40; inp.value = S.ui.stDim[S.ui.stOrient]; }
}

// ---- GPS export ----
function xesc(s) { return String(s).replace(/[&<>]/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'); }
export function buildWpts() {
  const race = S.race, D = S.D, segc = computeSegc(race, D), startSec = parseStart(race.start), out = []; let ci = 0;
  segc.forEach(s => {
    if (s.type === 'climb') { ci++; const nm = segName(s, ci), alt = D.hasEle ? Math.round(altAtKm(D, s.to)) : null, pass = fmtClock(startSec + cumSecAt(segc, s.to));
      out.push({ km: s.from, sym: 'Summit', pt: 'Summit', name: nm + ' ' + t('gxPied') + ' - ' + s.w + ' W (' + s.grad + '%)', desc: (s.to - s.from).toFixed(1) + ' km ' + t('gxAt') + ' ' + s.grad + '% - ' + t('gxAim') + ' ' + s.w + ' W (' + Math.round(s.pct * 100) + '% FTP)' + (s.cue ? ' - ' + s.cue : '') });
      out.push({ km: s.to, sym: 'Summit', pt: 'Summit', name: nm + ' ' + t('gxSummit') + (alt ? ' ' + alt + ' m' : '') + ' - ' + pass, desc: t('gxPass') + ' ' + pass + (s.barrier ? ' - ' + t('gxBarrier') + ' ' + s.barrier.time : '') }); }
  });
  (race.waypoints || []).forEach(w => {
    if (w.kind === 'ravito') out.push({ km: w.km, sym: w.code === 'ARR' ? 'Flag, Blue' : 'Water Source', pt: 'Water', name: w.code + ' ' + t('gxRavito') + ' - km ' + Math.round(w.km) + (w.name ? ' ' + w.name : ''), desc: w.desc || w.name || '' });
    else if (w.kind === 'danger') out.push({ km: w.km, sym: 'Danger Area', pt: 'Danger', name: t('gxDanger') + ' - ' + (w.name || ''), desc: w.desc || '' });
    else if (w.kind === 'barrier' && w.time) out.push({ km: w.km, sym: 'Flag, Blue', pt: 'Generic', name: t('gxBarrier') + ' ' + (w.name || '') + ' ' + w.time, desc: 'km ' + w.km });
    else if (w.kind === 'fountain' && S.settings.showFountains) out.push({ km: w.km, sym: 'Water Source', pt: 'Water', name: t('gxFount') + ' - km ' + Math.round(w.km) + (w.name ? ' ' + w.name : ''), desc: w.desc || t('gxFountDesc') });
  });
  out.sort((a, b) => a.km - b.km); return out;
}
function trkXml() { const D = S.D, pts = S.race.track.pts; return '<trk><name>' + xesc(S.race.name || 'Allure') + '</name><trkseg>\n' + pts.map(p => '<trkpt lat="' + p[0].toFixed(6) + '" lon="' + p[1].toFixed(6) + '">' + (D.hasEle && p[2] != null ? '<ele>' + p[2].toFixed(1) + '</ele>' : '') + '</trkpt>').join('\n') + '\n</trkseg></trk>'; }
export function buildGPX(w) {
  const race = S.race, D = S.D;
  const W = w.map(p => { const ll = llAtKm(race, D, p.km); return '  <wpt lat="' + ll.lat.toFixed(6) + '" lon="' + ll.lon.toFixed(6) + '">\n    <ele>' + ll.ele.toFixed(1) + '</ele>\n    <name>' + xesc(p.name) + '</name>\n    <desc>' + xesc(p.desc) + '</desc>\n    <sym>' + p.sym + '</sym>\n  </wpt>'; }).join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Allure" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>' + xesc(race.name || 'Allure') + '</name></metadata>\n' + W + '\n' + trkXml() + '\n</gpx>\n';
}
export function buildTCX(w) {
  const race = S.race, D = S.D, pts = race.track.pts, n = pts.length, T0 = (race.date || '2026-01-01') + 'T00:00:00Z', base = new Date(T0).getTime();
  const tAt = i => new Date(base + Math.round(D.cum[i] / 7)).toISOString().replace(/\.\d{3}Z$/, 'Z'); // synthetic 25 km/h timestamps
  const tp = pts.map((p, i) => '        <Trackpoint><Time>' + tAt(i) + '</Time><Position><LatitudeDegrees>' + p[0].toFixed(6) + '</LatitudeDegrees><LongitudeDegrees>' + p[1].toFixed(6) + '</LongitudeDegrees></Position><AltitudeMeters>' + (D.hasEle && p[2] != null ? p[2].toFixed(1) : '0.0') + '</AltitudeMeters><DistanceMeters>' + D.cum[i].toFixed(1) + '</DistanceMeters></Trackpoint>').join('\n');
  const cp = w.map(p => { const ll = llAtKm(race, D, p.km); return '      <CoursePoint><Name>' + xesc(p.name.slice(0, 40)) + '</Name><Time>' + tAt(ll.idx) + '</Time><Position><LatitudeDegrees>' + ll.lat.toFixed(6) + '</LatitudeDegrees><LongitudeDegrees>' + ll.lon.toFixed(6) + '</LongitudeDegrees></Position><PointType>' + p.pt + '</PointType><Notes>' + xesc(p.name + ' - ' + p.desc) + '</Notes></CoursePoint>'; }).join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">\n  <Courses>\n    <Course>\n      <Name>' + xesc((race.name || 'Allure').slice(0, 15)) + '</Name>\n      <Lap>\n        <TotalTimeSeconds>0</TotalTimeSeconds>\n        <DistanceMeters>' + D.cum[n - 1].toFixed(1) + '</DistanceMeters>\n        <BeginPosition><LatitudeDegrees>' + pts[0][0].toFixed(6) + '</LatitudeDegrees><LongitudeDegrees>' + pts[0][1].toFixed(6) + '</LongitudeDegrees></BeginPosition>\n        <EndPosition><LatitudeDegrees>' + pts[n - 1][0].toFixed(6) + '</LatitudeDegrees><LongitudeDegrees>' + pts[n - 1][1].toFixed(6) + '</LongitudeDegrees></EndPosition>\n        <Intensity>Active</Intensity>\n      </Lap>\n      <Track>\n' + tp + '\n      </Track>\n' + cp + '\n    </Course>\n  </Courses>\n</TrainingCenterDatabase>\n';
}
export function generateExport() {
  const msg = document.getElementById('gxMsg'); msg.textContent = t('gxLoading');
  return Promise.resolve().then(() => { const w = buildWpts(); let blob, name;
    if (S.ui.gxDev === 'garmin') { blob = new Blob([buildTCX(w)], { type: 'application/vnd.garmin.tcx+xml' }); name = 'allure-' + slug() + '-garmin.tcx'; }
    else { blob = new Blob([buildGPX(w)], { type: 'application/gpx+xml' }); name = 'allure-' + slug() + '-' + S.ui.gxDev + '.gpx'; }
    dl(blob, name); msg.textContent = ''; }).catch(e => { console.error(e); msg.textContent = t('gxError'); });
}
export function gxSync() {
  document.querySelectorAll('#gxDev button').forEach(b => b.setAttribute('aria-pressed', b.dataset.dev === S.ui.gxDev));
  const n = document.getElementById('gxNote'); if (n) n.innerHTML = t('gxNote_' + S.ui.gxDev);
  const d = document.getElementById('gxDl'); if (d) d.textContent = S.ui.gxDev === 'garmin' ? t('gxDlTcx') : t('gxDlGpx');
}
