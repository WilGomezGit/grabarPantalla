// Vista "Grabar": ajustes, dispositivos, vista previa con aro de luz y control de la grabación.
import { $, mk, toast, wait, fmtDur, stamp } from '../lib/dom.js';
import * as settings from '../lib/store.js';
import { targetSize, bitrateFor, RES_BOX } from '../lib/sizing.js';
import { getDisplay, getCamera, getMic, videoFrom, stopStream, friendlyError } from '../core/capture.js';
import { pickRegion } from '../core/region-picker.js';
import { Recorder } from '../core/recorder.js';
import * as lib from '../core/library.js';
import * as storage from '../core/storage.js';
import { openPip, pipSupported } from './pip.js';

let S = settings.get();
let phase = 'idle';            // idle | starting | recording | paused | finalizing
let previewStream = null, meter = null, recorder = null, pip = null, lastRegion = null;
let hooks = { onSaved: () => {}, onPhase: () => {} };
let support = { ok: true };
let screenSize = [screen.width * (window.devicePixelRatio || 1), screen.height * (window.devicePixelRatio || 1)];

const RES_NAMES = { 2160: '4K · 3840×2160', 1440: '1440p · 2560×1440', 1080: 'Full HD · 1920×1080', 720: 'HD · 1280×720', 480: 'SD · 854×480' };
const TARGET_NOTES = {
  full: 'El navegador te pedirá elegir la pantalla. Para no grabar esta página, elige "Pantalla completa" y tu monitor.',
  region: 'Eliges qué compartir y, antes de grabar, dibujas el rectángulo exacto sobre la imagen (16:9, 9:16, 1:1, 4:3). Se recuerda la última área.',
  window: 'El navegador te pedirá elegir una ventana. Solo se graba esa ventana.',
  tab: 'El navegador te pedirá elegir una pestaña. Es la opción con mejor audio.',
};

function save(patch) { settings.patch(patch); S = settings.get(); }
const busy = () => phase !== 'idle';

// ---------- salida ----------
function outputSize() {
  if (S.mode === 'cam') return S.resolution === 'native' ? [1280, 720] : RES_BOX[S.resolution];
  return targetSize(screenSize[0], screenSize[1], S.resolution);
}
function buildResolutionSelect() {
  const sel = $('resolution'); sel.textContent = '';
  const [pw, ph] = screenSize.map(Math.round);
  sel.add(new Option(S.mode === 'cam' ? 'Nativa (720p)' : `Nativa · lo que compartas (la mejor)`, 'native'));
  for (const k of ['2160', '1440', '1080', '720', '480']) sel.add(new Option(RES_NAMES[k], k));
  sel.value = S.resolution; void pw; void ph;
}
function updateOutInfo() {
  const [w, h] = outputSize();
  const mbMin = Math.round((bitrateFor(w, h, S.fps, S.quality) * 60) / 8 / 1e6);
  const parts = [S.resolution === 'native' && S.mode !== 'cam' ? 'Tamaño de lo que compartas' : `${w}×${h}`, `${S.fps} fps`, S.format === 'mp4' ? 'MP4 H.264' : 'WebM VP9', `≈ ${mbMin} MB por minuto`];
  const warns = [];
  if (S.resolution === '2160' && S.fps === 60) warns.push('4K a 60 fps exige mucho al equipo. Si ves tirones, baja a 30 fps.');
  if (S.format === 'webm' && (S.resolution === '2160' || S.resolution === '1440')) warns.push('WebM en 1440p/4K usa mucho procesador. Se recomienda MP4.');
  if (S.resolution !== 'native' && S.mode !== 'cam' && RES_BOX[S.resolution] && RES_BOX[S.resolution][1] > screenSize[1] * 1.02 && S.target === 'full') warns.push('Si tu pantalla es menor que esa resolución, el video se reescalará (más peso, sin más nitidez).');
  $('outInfo').textContent = parts.join(' · ') + (warns.length ? ' — ' + warns.join(' ') : '');
  $('outInfo').classList.toggle('warn', warns.length > 0);
}

// ---------- sincronizar interfaz ----------
export function sync() {
  S = settings.get();
  document.querySelectorAll('#mode button').forEach((b) => { const on = b.dataset.v === S.mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  document.querySelectorAll('#target button').forEach((b) => { const on = b.dataset.v === S.target; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  const screenMode = S.mode !== 'cam', camMode = S.mode !== 'screen';
  $('areaBox').hidden = !screenMode;
  $('camRow').hidden = !camMode;
  $('sysRow').hidden = !screenMode;
  $('targetNote').textContent = TARGET_NOTES[S.target] || '';
  $('sys').checked = !!S.systemAudio; $('cd').checked = !!S.countdown;
  $('ringOn').checked = !!S.ringEnabled; $('mirror').checked = !!S.mirror;
  $('corner').value = S.corner; $('bsize').value = String(S.bubbleSize);
  $('pipOn').checked = !!S.pip; $('notesOn').checked = !!S.notesEnabled; $('notes').hidden = !S.notesEnabled;
  if ($('notes').value !== S.notes && document.activeElement !== $('notes')) $('notes').value = S.notes;
  $('fps').value = String(S.fps); $('format').value = S.format; $('quality').value = S.quality;
  buildResolutionSelect();
  $('pv').querySelector('video').style.transform = S.mirror ? 'scaleX(-1)' : 'none';
  for (const c of ['.ring', '.glow', '.track']) $('pv').querySelector(c).style.display = S.ringEnabled ? '' : 'none';
  document.querySelectorAll('.sw').forEach((b) => b.classList.toggle('on', b.dataset.k === S.ringStyle));
  window.Ring.applyRingStyle($('pv'), S.ringStyle);
  $('pipRow').hidden = !pipSupported();
  updateOutInfo();
  applyPhase();
}

// ---------- estado ----------
const PHASE_TXT = { starting: 'Preparando…', recording: '● Grabando', paused: '⏸ En pausa', finalizing: 'Guardando…' };
function setPhase(p) { phase = p; applyPhase(); hooks.onPhase(p); }
function applyPhase() {
  const b = busy();
  $('pill').hidden = !b; $('pill').textContent = PHASE_TXT[phase] || ''; $('pill').classList.toggle('busy', b);
  const rec = phase === 'recording' || phase === 'paused';
  const start = $('start');
  start.classList.toggle('stop', rec);
  start.disabled = !support.ok || phase === 'starting' || phase === 'finalizing';
  $('startTxt').textContent = rec ? 'Detener y guardar' : phase === 'starting' ? 'Preparando…' : phase === 'finalizing' ? 'Guardando…' : 'Empezar a grabar';
  $('pauseBtn').hidden = !rec;
  $('pauseBtn').textContent = phase === 'paused' ? '▶ Reanudar' : '⏸ Pausa';
  $('shot').disabled = !support.ok || b;
  document.querySelectorAll('#mode button, #target button').forEach((x) => { x.disabled = b; });
  for (const id of ['resolution', 'fps', 'format', 'quality', 'cam', 'mic']) $(id).disabled = b;
  if (!rec) document.title = 'Capturo Web';
}
function showErr(msg) { const e = $('err'); e.textContent = msg || ''; e.hidden = !msg; }

// ---------- dispositivos, vista previa y medidor ----------
async function permissionState(name) { try { return (await navigator.permissions.query({ name })).state; } catch { return 'prompt'; } }

export async function loadDevices({ ask = false } = {}) {
  const cam = await permissionState('camera'), mic = await permissionState('microphone');
  if (ask || (cam === 'granted' && mic === 'granted')) {
    try { const t = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); stopStream(t); }
    catch { try { const t = await navigator.mediaDevices.getUserMedia({ audio: true }); stopStream(t); } catch { /* sin permiso */ } }
  }
  const devs = await navigator.mediaDevices.enumerateDevices();
  const hasLabels = devs.some((d) => d.label);
  const fill = (sel, list, empty, cur, label) => {
    sel.textContent = '';
    if (empty) sel.add(new Option(empty, ''));
    list.forEach((d, i) => sel.add(new Option(d.label || `${label} ${i + 1}`, d.deviceId)));
    if (cur != null && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
  };
  fill($('mic'), devs.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications'), 'Sin micrófono', S.micId === null ? '' : S.micId, 'Micrófono');
  fill($('cam'), devs.filter((d) => d.kind === 'videoinput'), null, S.camId, 'Cámara');
  const camIds = [...$('cam').options].map((o) => o.value);
  if (!camIds.length) $('cam').add(new Option('No se detectó ninguna cámara', ''));
  else if (!S.camId || !camIds.includes(S.camId)) save({ camId: camIds[0] });
  const micIds = [...$('mic').options].map((o) => o.value);
  if (S.micId && !micIds.includes(S.micId)) save({ micId: micIds.includes('default') ? 'default' : null });
  $('mic').value = S.micId === null ? '' : S.micId;
  const note = $('permNote');
  note.hidden = hasLabels;
  if (!hasLabels) {
    note.textContent = '';
    note.append('Para elegir cámara y micrófono por su nombre, ');
    const b = mk('button', 'ghost small', 'permite el acceso'); b.type = 'button'; b.addEventListener('click', async () => { await loadDevices({ ask: true }); startPreview(true); startMeter(true); });
    note.append(b, '. Solo se usan mientras grabas o ves la vista previa.');
  }
}

const recVisible = () => $('rec').classList.contains('on') && !document.hidden && phase === 'idle';
export async function startPreview(force) {
  if (previewStream && !force) return;
  stopPreview();
  if (S.mode === 'screen' || !recVisible() || !S.camId) { $('pvPh').hidden = false; return; }
  if ((await permissionState('camera')) !== 'granted') { $('pvPh').hidden = false; return; }
  try { previewStream = await getCamera(S.camId); $('pvVideo').srcObject = previewStream; $('pvPh').hidden = true; }
  catch { $('pvPh').hidden = false; }
}
export function stopPreview() { stopStream(previewStream); previewStream = null; $('pvVideo').srcObject = null; }

export async function startMeter(force) {
  if (meter && !force) return;
  stopMeter();
  if (!S.micId || !recVisible() || (await permissionState('microphone')) !== 'granted') { $('meter').style.width = '0%'; return; }
  try {
    const stream = await getMic(S.micId);
    const ctx = new AudioContext(), src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
    an.fftSize = 512; src.connect(an);
    const buf = new Uint8Array(an.fftSize), m = { stream, ctx, raf: 0 };
    const loop = () => {
      an.getByteTimeDomainData(buf);
      let peak = 0; for (const x of buf) peak = Math.max(peak, Math.abs(x - 128));
      $('meter').style.width = Math.min(100, Math.round((peak / 128) * 160)) + '%';
      m.raf = requestAnimationFrame(loop);
    };
    meter = m; loop();
  } catch { $('meter').style.width = '0%'; }
}
export function stopMeter() {
  if (!meter) return;
  cancelAnimationFrame(meter.raf); stopStream(meter.stream); meter.ctx.close().catch(() => {});
  meter = null; $('meter').style.width = '0%';
}

// ---------- cuenta atrás ----------
async function countdown() {
  const box = $('countdown'), num = $('cdNum');
  box.hidden = false;
  for (let n = 3; n >= 1; n--) {
    num.textContent = n; num.style.animation = 'none'; void num.offsetWidth; num.style.animation = '';
    await wait(1000);
    if (phase !== 'starting') break;
  }
  box.hidden = true;
}

// ---------- grabar ----------
async function start() {
  showErr('');
  if (phase === 'recording' || phase === 'paused') return stopAndSave();
  if (busy()) return;
  const cfg = { ...settings.get() };
  if (cfg.mode !== 'screen' && !cfg.camId) return showErr('No hay ninguna cámara disponible. Conecta una o elige "Solo pantalla".');
  setPhase('starting');
  let rec = null, streams = { screen: null, cam: null, mic: null };
  const abort = () => { for (const k of ['screen', 'cam', 'mic']) stopStream(streams[k]); if (pip) { pip.close(); pip = null; } };
  try {
    if (cfg.pip && pipSupported()) pip = await openPip({ notes: cfg.notesEnabled ? cfg.notes : '', onPause: togglePause, onStop: stopAndSave });   // primero: necesita el gesto del clic
    stopPreview(); stopMeter();
    await wait(150);
    let region = null;
    if (cfg.mode !== 'cam') {
      streams.screen = await getDisplay(cfg);
      if (cfg.target === 'region') {
        region = await pickRegion(streams.screen, { last: lastRegion });
        if (!region) { abort(); setPhase('idle'); startPreview(); startMeter(); return; }
        lastRegion = region;
      }
    }
    if (cfg.mode !== 'screen') streams.cam = await getCamera(cfg.camId);
    let micWarn = null;
    if (cfg.micId) { try { streams.mic = await getMic(cfg.micId); } catch (e) { micWarn = friendlyError(e); } }

    rec = new Recorder(cfg, streams, region);
    const info = await rec.prepare();
    if (micWarn) toast('Se grabará sin micrófono: ' + micWarn, 'error', 6000);
    if (cfg.countdown) await countdown();
    if (phase !== 'starting') { await rec.cancel(); abort(); setPhase('idle'); return; }   // cancelado durante la cuenta atrás
    recorder = rec;
    rec.addEventListener('tick', (e) => onTick(e.detail));
    rec.addEventListener('ended', () => { toast('Se dejó de compartir: se guarda lo grabado.'); stopAndSave(); });
    rec.addEventListener('error', (e) => failRecording(e.detail));
    await rec.start();
    setPhase('recording');
    window.dispatchEvent(new CustomEvent('capturo:recording', { detail: info }));
  } catch (e) {
    console.warn('[start]', e);
    if (rec) { try { await rec.cancel(); } catch { /* ya cancelado */ } }
    abort(); recorder = null;
    setPhase('idle');
    showErr(friendlyError(e));
    startPreview(); startMeter();
  }
}

let slow = 0;
function onTick(t) {
  const s = Math.floor(t.elapsed / 1000), p = (n) => String(n).padStart(2, '0');
  if (t.state === 'recording' && t.fps && t.target) slow = t.fps < t.target * 0.8 ? slow + 1 : 0;
  document.title = `${t.state === 'paused' ? '⏸' : '●'} ${p(Math.floor(s / 60))}:${p(s % 60)} — Capturo`;
  $('pill').textContent = (t.state === 'paused' ? '⏸ En pausa ' : '● Grabando ') + fmtDur(t.elapsed) + (slow >= 24 ? ' · ⚠ el equipo no llega a los fps elegidos' : '');
  if (pip && !pip.closed) pip.update(t);
}
function togglePause() {
  if (!recorder) return;
  if (phase === 'recording') { recorder.pause(); setPhase('paused'); }
  else if (phase === 'paused') { recorder.resume(); setPhase('recording'); }
}
async function stopAndSave() {
  if (!recorder || (phase !== 'recording' && phase !== 'paused')) return;
  const rec = recorder;
  setPhase('finalizing');
  if (pip) { pip.setText('Guardando…'); }
  try {
    const out = await rec.stop();
    const item = await lib.addItem({ name: out.name, kind: 'video', size: out.size, durationMs: out.durationMs, width: out.width, height: out.height, mime: out.container === 'mp4' ? 'video/mp4' : 'video/webm' });
    const st = out.stats, tgt = settings.get().fps;
    const lowFps = st.seconds > 3 && st.frames / st.seconds < tgt * 0.8;
    toast('Guardado en tu biblioteca' + (lowFps ? ` · ojo: se grabó a ~${Math.round(st.frames / st.seconds)} fps (objetivo ${tgt}); prueba menos resolución o fps` : ''), lowFps ? 'error' : 'ok', lowFps ? 9000 : 4200);
    hooks.onSaved(item);
  } catch (e) { showErr('No se pudo guardar la grabación: ' + friendlyError(e)); toast('No se pudo guardar la grabación', 'error', 8000); }
  finally {
    recorder = null; slow = 0;
    if (pip) { pip.close(); pip = null; }
    setPhase('idle'); startPreview(); startMeter();
  }
}
async function failRecording(e) {
  if (!recorder) return;
  const rec = recorder; recorder = null;
  try { await rec.cancel(); } catch { /* ya cancelado */ }
  if (pip) { pip.close(); pip = null; }
  setPhase('idle');
  showErr('La grabación se detuvo: ' + friendlyError(e));
  startPreview(); startMeter();
}
async function discard() {
  if (!recorder) return;
  const rec = recorder; recorder = null;
  await rec.cancel();
  if (pip) { pip.close(); pip = null; }
  setPhase('idle'); toast('Grabación descartada'); startPreview(); startMeter();
}

// ---------- captura de pantalla ----------
async function shot() {
  if (busy()) return;
  showErr('');
  const cfg = { ...settings.get(), systemAudio: false, mode: 'screen' };
  setPhase('starting');
  let stream = null;
  try {
    stream = await getDisplay(cfg);
    let region = null;
    if (cfg.target === 'region') {
      region = await pickRegion(stream, { title: 'Arrastra para capturar un área', goLabel: '📷 Capturar', last: lastRegion });
      if (!region) return;
      lastRegion = region;
    }
    const v = await videoFrom(stream);
    await new Promise((r) => { if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => r()); else setTimeout(r, 150); });
    const r = region || { x: 0, y: 0, w: v.videoWidth, h: v.videoHeight };
    const c = document.createElement('canvas'); c.width = r.w; c.height = r.h;
    c.getContext('2d').drawImage(v, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    if (!blob) throw new Error('No se pudo crear la imagen.');
    const name = `Captura ${stamp()}-${Math.random().toString(36).slice(2, 6)}.png`;
    await storage.saveBlob(name, blob);
    const item = await lib.addItem({ name, kind: 'image', title: `Captura ${stamp()}`, size: blob.size, width: r.w, height: r.h, mime: 'image/png' });
    try { if (navigator.clipboard && window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('Captura guardada y copiada al portapapeles', 'ok'); }
    catch { toast('Captura guardada en tu biblioteca', 'ok'); }
    hooks.onSaved(item);
  } catch (e) { showErr(friendlyError(e)); }
  finally { stopStream(stream); setPhase('idle'); }
}

// ---------- arranque ----------
export function init({ onSaved, onPhase, supportInfo }) {
  hooks = { onSaved, onPhase: onPhase || (() => {}) };
  support = supportInfo;
  S = settings.get();

  for (const [k, st] of Object.entries(window.Ring.RING_STYLES)) {
    const b = mk('button', 'sw'); b.type = 'button'; b.dataset.k = k; b.title = st.label;
    b.appendChild(mk('span', 'swl', st.label));      // etiqueta sobre una pastilla oscura: se lee con cualquier color de fondo
    b.style.background = st.rainbow ? 'linear-gradient(90deg,#ff0040,#ffae00,#00ff6a,#00d0ff,#ff00d4)' : `linear-gradient(90deg, ${st.c1}, ${st.c2})`;
    b.addEventListener('click', () => { save({ ringStyle: k }); sync(); });
    $('styles').appendChild(b);
  }
  const seg = (id, key, after) => $(id).querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { if (busy()) return; save({ [key]: b.dataset.v }); sync(); after && after(); }));
  seg('mode', 'mode', () => startPreview(true));
  seg('target', 'target');
  const sel = (id, key, conv = (v) => v) => $(id).addEventListener('change', () => { save({ [key]: conv($(id).value) }); sync(); });
  const chk = (id, key) => $(id).addEventListener('change', () => { save({ [key]: $(id).checked }); sync(); });
  sel('resolution', 'resolution'); sel('fps', 'fps', Number); sel('format', 'format'); sel('quality', 'quality');
  sel('corner', 'corner'); sel('bsize', 'bubbleSize', Number);
  chk('sys', 'systemAudio'); chk('cd', 'countdown'); chk('ringOn', 'ringEnabled'); chk('mirror', 'mirror'); chk('pipOn', 'pip'); chk('notesOn', 'notesEnabled');
  let nt = 0;
  $('notes').addEventListener('input', () => { clearTimeout(nt); nt = setTimeout(() => save({ notes: $('notes').value }), 300); });
  $('mic').addEventListener('change', () => { save({ micId: $('mic').value || null }); startMeter(true); });
  $('cam').addEventListener('change', () => { save({ camId: $('cam').value }); startPreview(true); });
  $('start').addEventListener('click', start);
  $('pauseBtn').addEventListener('click', togglePause);
  $('shot').addEventListener('click', shot);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (phase === 'idle') { stopPreview(); stopMeter(); } } else { startPreview(); startMeter(); } });
  navigator.mediaDevices.addEventListener('devicechange', () => { if (phase === 'idle') loadDevices().then(() => { startPreview(true); startMeter(true); }); });
  window.addEventListener('beforeunload', (e) => { if (recorder) { e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); start(); }
    else if (e.ctrlKey && e.altKey && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); togglePause(); }
  });
  sync();
}
export const api = { start, togglePause, stopAndSave, discard, shot, getPhase: () => phase, getRecorder: () => recorder };
