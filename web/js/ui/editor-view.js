// Editor y reproductor: línea de tiempo con recorte y exportación de una copia (MP4/WebM, resolución a elegir).
import { $, mk, toast, clamp, fmtClock, fmtSize } from '../lib/dom.js';
import * as lib from '../core/library.js';
import * as conv from '../core/converter.js';

let item = null, file = null, url = null, dur = 0, trimIn = 0, trimOut = 0, info = null, busy = false, job = null, dragging = null;
let hooks = { onSaved: () => {} };
const v = () => $('edVideo');

function msg(t) { $('edMsg').textContent = t || ''; $('edMsg').hidden = !t; }
const tl = () => $('edTl');
const xOf = (t) => (dur ? (t / dur) * tl().clientWidth : 0);
const tOf = (x) => clamp((x / tl().clientWidth) * dur, 0, dur);

function draw() {
  const vid = v();
  $('edHs').style.left = xOf(trimIn) + 'px'; $('edHe').style.left = xOf(trimOut) + 'px';
  $('edSel').style.left = xOf(trimIn) + 'px'; $('edSel').style.width = Math.max(0, xOf(trimOut) - xOf(trimIn)) + 'px';
  $('edPh').style.left = xOf(vid.currentTime || 0) + 'px';
  $('edClock').textContent = `${fmtClock(vid.currentTime || 0)} / ${fmtClock(dur)}`;
  $('edRange').textContent = '';
  const b = (t) => { const e = mk('b', '', t); return e; };
  $('edRange').append('Inicio ', b(fmtClock(trimIn)), ' · Fin ', b(fmtClock(trimOut)), ' · Dura ', b(fmtClock(trimOut - trimIn)));
  $('edHs').setAttribute('aria-valuenow', trimIn.toFixed(1)); $('edHe').setAttribute('aria-valuenow', trimOut.toFixed(1));
}

function updateExportUi() {
  const h = +$('edHeight').value;
  let note = '', warn = false;
  if (info && info.height && h && h > info.height) { note = `El original es de ${info.height}p: ${h}p solo reescala la imagen, no añade nitidez.`; warn = true; }
  else if ($('edFmt').value === 'webm' && h >= 1440) { note = 'Convertir a WebM en 1440p/4K puede tardar bastante.'; warn = true; }
  else if (trimIn > 0.01 || (dur && trimOut < dur - 0.05)) note = `Se exportarán ${fmtClock(trimOut - trimIn)} de ${fmtClock(dur)}.`;
  $('edNote').textContent = note; $('edNote').classList.toggle('warn', warn);
}

export async function open(it) {
  item = it; busy = false; job = null;
  $('editor').hidden = false; document.body.style.overflow = 'hidden';
  $('edName').textContent = it.title; $('edMeta').textContent = ''; msg(''); $('edResult').hidden = true; $('edProg').hidden = true;
  $('edHeight').value = ''; $('edFmt').value = 'mp4';
  dur = 0; trimIn = 0; trimOut = 0; info = null;
  try {
    file = await lib.getFile(it);
    info = await conv.probe(file);
  } catch (e) { msg('No se pudo abrir el archivo: ' + e.message); return; }
  dur = info.durationMs / 1000; trimOut = dur;
  $('edMeta').textContent = [info.width ? `${info.width}×${info.height}` : '', fmtSize(file.size), info.hasAudio ? 'con audio' : 'sin audio'].filter(Boolean).join(' · ');
  $('edMute').disabled = !info.hasAudio;
  if (url) URL.revokeObjectURL(url);
  url = URL.createObjectURL(file);
  const vid = v(); vid.muted = false; $('edMute').textContent = '🔊';
  vid.src = url;
  vid.onerror = () => msg('No se puede reproducir este archivo en el editor. Aun así puedes exportarlo o descargarlo.');
  updateExportUi(); draw();
}

export function close() {
  if (busy && job) job.cancel();
  const vid = v(); vid.pause(); vid.removeAttribute('src'); vid.load();
  if (url) { URL.revokeObjectURL(url); url = null; }
  $('editor').hidden = true; document.body.style.overflow = '';
  item = null; file = null;
}
export const isOpen = () => !$('editor').hidden;

function toggle() {
  const vid = v();
  if (!info || !info.hasVideo) return;
  if (vid.paused) {
    if ($('edLoop').checked && (vid.currentTime < trimIn || vid.currentTime >= trimOut - 0.05)) vid.currentTime = trimIn;
    else if (vid.currentTime >= dur - 0.05) vid.currentTime = 0;
    vid.play().catch(() => {});
  } else vid.pause();
}
function tick() {
  const vid = v();
  if (vid.paused) return;
  if ($('edLoop').checked && vid.currentTime >= trimOut) { vid.pause(); vid.currentTime = trimIn; }
  draw(); requestAnimationFrame(tick);
}
const setIn = (t) => { trimIn = clamp(t, 0, trimOut - 0.2); draw(); updateExportUi(); };
const setOut = (t) => { trimOut = clamp(t, trimIn + 0.2, dur); draw(); updateExportUi(); };

function setBusy(on) {
  busy = on;
  for (const id of ['edExport', 'edDownload', 'edFmt', 'edHeight', 'edMarkIn', 'edMarkOut', 'edReset']) $(id).disabled = on;
  $('edProg').hidden = !on;
  if (on) { $('edResult').hidden = true; $('edBar').style.width = '0%'; $('edPct').textContent = '0%'; }
}

async function exportCopy() {
  if (busy || !item || !file) return;
  const fmt = $('edFmt').value, h = $('edHeight').value ? +$('edHeight').value : null;
  const whole = trimIn <= 0.01 && trimOut >= dur - 0.05;
  const name = `${crypto.randomUUID()}.${fmt}`;
  setBusy(true);
  job = conv.exportCopy({
    file, name, format: fmt, height: h, startMs: whole ? 0 : Math.round(trimIn * 1000), endMs: whole ? null : Math.round(trimOut * 1000),
    onProgress: (p) => { const pct = Math.round(clamp(p, 0, 1) * 100); $('edBar').style.width = pct + '%'; $('edPct').textContent = pct + '%'; },
  });
  const r = await job.promise;
  job = null; setBusy(false);
  const box = $('edResult');
  if (r.cancelled) { box.hidden = true; return; }
  // primero se añade la copia a la biblioteca y solo después se muestra el resultado: así nunca se ve un cuadro vacío
  let added = null, addErr = null;
  if (r.ok) {
    try {
      const base = item.title.replace(/ \((editado|recorte)\)$/, '');
      added = await lib.addItem({ name, kind: 'video', title: `${base} (editado)`, size: r.size, durationMs: r.durationMs, width: r.width, height: r.height, mime: fmt === 'mp4' ? 'video/mp4' : 'video/webm' });
    } catch (e) { addErr = e; }
  }
  box.textContent = '';
  box.hidden = false; box.className = 'result' + (added ? '' : ' err');
  if (added) { box.append('✔ Copia guardada en la biblioteca: ' + added.title); hooks.onSaved(added); }
  else box.textContent = 'No se pudo exportar. ' + ((addErr && addErr.message) || r.error || '');
}

export function init({ onSaved }) {
  hooks = { onSaved };
  const vid = v();
  $('edClose').addEventListener('click', close);
  $('edPlay').addEventListener('click', toggle); vid.addEventListener('click', toggle);
  vid.addEventListener('play', () => { $('edPlay').textContent = '⏸'; tick(); });
  vid.addEventListener('pause', () => { $('edPlay').textContent = '▶'; draw(); });
  vid.addEventListener('ended', () => { $('edPlay').textContent = '▶'; draw(); });
  vid.addEventListener('timeupdate', () => { if (vid.paused) draw(); });
  vid.addEventListener('seeked', draw);
  $('edMute').addEventListener('click', () => { vid.muted = !vid.muted; $('edMute').textContent = vid.muted ? '🔇' : '🔊'; });
  $('edMarkIn').addEventListener('click', () => setIn(vid.currentTime));
  $('edMarkOut').addEventListener('click', () => setOut(vid.currentTime));
  $('edReset').addEventListener('click', () => { trimIn = 0; trimOut = dur; draw(); updateExportUi(); });
  $('edFmt').addEventListener('change', updateExportUi); $('edHeight').addEventListener('change', updateExportUi);
  $('edExport').addEventListener('click', exportCopy);
  $('edDownload').addEventListener('click', () => { if (item) lib.download(item).catch((e) => toast('No se pudo descargar: ' + e.message, 'error')); });
  $('edCancel').addEventListener('click', () => { if (job) job.cancel(); });

  const t = tl();
  t.addEventListener('pointerdown', (e) => {
    if (!dur) return;
    const x = e.clientX - t.getBoundingClientRect().left;
    dragging = e.target.id === 'edHs' ? 'in' : e.target.id === 'edHe' ? 'out' : 'seek';
    t.setPointerCapture(e.pointerId);
    if (dragging === 'seek') vid.currentTime = tOf(x);
    t.focus(); draw();
  });
  t.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const tt = tOf(e.clientX - t.getBoundingClientRect().left);
    if (dragging === 'in') { trimIn = clamp(tt, 0, trimOut - 0.2); vid.currentTime = trimIn; }
    else if (dragging === 'out') { trimOut = clamp(tt, trimIn + 0.2, dur); vid.currentTime = Math.max(0, trimOut - 0.05); }
    else vid.currentTime = tt;
    draw(); updateExportUi();
  });
  const end = () => { dragging = null; };
  t.addEventListener('pointerup', end); t.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => { if (isOpen()) draw(); });

  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (['SELECT', 'INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && e.code !== 'Space') return;
    const step = e.shiftKey ? 5 : 1;
    if (e.code === 'Space') { if (document.activeElement.tagName === 'BUTTON') return; e.preventDefault(); toggle(); }
    else if (e.key === 'i' || e.key === 'I') setIn(vid.currentTime);
    else if (e.key === 'o' || e.key === 'O') setOut(vid.currentTime);
    else if (e.key === 'ArrowLeft') { e.preventDefault(); vid.currentTime = clamp(vid.currentTime - step, 0, dur); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); vid.currentTime = clamp(vid.currentTime + step, 0, dur); }
    else if (e.key === 'Home') vid.currentTime = 0;
    else if (e.key === 'End') vid.currentTime = dur;
  });
}
