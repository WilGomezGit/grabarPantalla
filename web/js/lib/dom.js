// Utilidades de DOM y formato
export const $ = (id) => document.getElementById(id);

export function mk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

let toastTimer = 0;
export function toast(msg, type = 'info', ms = 4200) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

export function fmtDur(ms) {
  if (ms == null || !isFinite(ms)) return '';
  const s = Math.round(ms / 1000), h = Math.floor(s / 3600);
  return (h ? h + ':' : '') + String(Math.floor(s / 60) % 60).padStart(h ? 2 : 1, '0') + ':' + String(s % 60).padStart(2, '0');
}
export function fmtClock(sec) {
  if (!isFinite(sec)) sec = 0;
  const m = Math.floor(sec / 60), r = sec - m * 60;
  return String(m).padStart(2, '0') + ':' + r.toFixed(1).padStart(4, '0');
}
export const fmtSize = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB' : (b / 1048576).toFixed(1) + ' MB');

// Nombre de archivo seguro (sin caracteres que el sistema operativo rechaza)
export function safeName(s, max = 120) {
  return String(s).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\.+$/, '').trim().slice(0, max);
}
export const stamp = () => {
  const d = new Date(), z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}.${z(d.getMinutes())}.${z(d.getSeconds())}`;
};
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
