import { S } from './state.js';
import { CHECK } from './i18n.js';
const KEY = 'allure-check';
function chkState() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
function chkSave(st) { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }
export function renderChecklist() {
  const box = document.getElementById('chkList'); if (!box) return;
  const st = chkState(), lang = S.lang; let h = '';
  CHECK.forEach((g, gi) => { h += '<div class="chk-group"><h4>' + g.g[lang] + '</h4>'; g.items.forEach((it, ii) => { const id = 'c' + gi + '_' + ii; h += '<div class="chk-item ' + (st[id] ? 'done' : '') + '"><input type="checkbox" id="' + id + '" ' + (st[id] ? 'checked' : '') + '><label for="' + id + '">' + it[lang] + (it.h ? '<span class="chk-hint">' + it.h[lang] + '</span>' : '') + '</label></div>'; }); h += '</div>'; });
  box.innerHTML = h;
  box.querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => { const s2 = chkState(); s2[cb.id] = cb.checked; chkSave(s2); cb.closest('.chk-item').classList.toggle('done', cb.checked); }));
}
export function resetChecklist() { chkSave({}); renderChecklist(); }
