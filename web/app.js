'use strict';
/* WAG Rec — grabador de pantalla (web + escritorio) */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const desktop = window.wagDesktop || null;

/* ---------- utilidades ---------- */
const fmtTime = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(ss).padStart(2, '0'); };
const fmtSize = b => b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), ms); }
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem('wag.' + k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem('wag.' + k, JSON.stringify(v)); } catch { } } };

/* ---------- IndexedDB ---------- */
const dbp = new Promise((res, rej) => {
  const rq = indexedDB.open('wagrec', 1);
  rq.onupgradeneeded = () => rq.result.createObjectStore('videos', { keyPath: 'id' });
  rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
});
const tx = async (mode, fn) => { const db = await dbp; return new Promise((res, rej) => { const t = db.transaction('videos', mode); const r = fn(t.objectStore('videos')); t.oncomplete = () => res(r.result); t.onerror = () => rej(t.error); }); };
const dbAll = () => tx('readonly', s => s.getAll());
const dbGet = id => tx('readonly', s => s.get(id));
const dbPut = v => tx('readwrite', s => s.put(v));
const dbDel = id => tx('readwrite', s => s.delete(id));

/* ---------- pestañas ---------- */
$$('.tabs button').forEach(b => b.onclick = () => {
  $$('.tabs button').forEach(x => x.classList.toggle('active', x === b));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'lib') renderLib();
});

/* ---------- ajustes ---------- */
const settingIds = ['quality', 'format', 'bubShape', 'bubSize', 'bubPos', 'bubColor', 'camSel', 'micSel'];
const checkIds = ['optMic', 'optSys', 'optCount', 'optTrans', 'optNoise', 'optMirror'];
let mode = store.get('mode', 'both');
function loadSettings() {
  settingIds.forEach(id => { const v = store.get(id); if (v != null && $('#' + id).querySelector?.(`option[value="${CSS.escape(v)}"]`) !== null) $('#' + id).value = v; else if (v != null && $('#' + id).type === 'color') $('#' + id).value = v; });
  checkIds.forEach(id => { const v = store.get(id); if (v != null) $('#' + id).checked = v; });
  $$('#modeSeg button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}
function bindSettings() {
  settingIds.forEach(id => $('#' + id).addEventListener('change', e => store.set(id, e.target.value)));
  checkIds.forEach(id => $('#' + id).addEventListener('change', e => store.set(id, e.target.checked)));
  $$('#modeSeg button').forEach(b => b.onclick = () => { mode = b.dataset.mode; store.set('mode', mode); $$('#modeSeg button').forEach(x => x.classList.toggle('active', x === b)); });
}

/* ---------- formatos y dispositivos ---------- */
const FORMATS = [
  ['video/webm;codecs=vp9,opus', 'WebM · VP9 (mejor calidad/peso)'],
  ['video/webm;codecs=vp8,opus', 'WebM · VP8 (compatible)'],
  ['video/mp4;codecs=avc1,mp4a.40.2', 'MP4 · H.264 (universal)'],
  ['video/webm', 'WebM · automático']
];
function fillFormats() {
  const sel = $('#format'); sel.innerHTML = '';
  FORMATS.filter(f => window.MediaRecorder && MediaRecorder.isTypeSupported(f[0])).forEach(f => sel.add(new Option(f[1], f[0])));
}
async function fillDevices() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const fill = (id, kind, none) => {
      const sel = $('#' + id), cur = sel.value; sel.innerHTML = '';
      sel.add(new Option(none, ''));
      devs.filter(d => d.kind === kind).forEach((d, i) => sel.add(new Option(d.label || (kind === 'videoinput' ? 'Cámara ' : 'Micrófono ') + (i + 1), d.deviceId)));
      sel.value = store.get(id) ?? cur;
      if (sel.value !== (store.get(id) ?? cur)) sel.value = '';
    };
    fill('camSel', 'videoinput', 'Predeterminada'); fill('micSel', 'audioinput', 'Predeterminado');
  } catch { }
}
const QH = { 720: 720, 1080: 1080, 1440: 1440, 2160: 2160 };
const QBITS = { 720: 5e6, 1080: 9e6, 1440: 18e6, 2160: 40e6 };

/* ---------- estado de grabación ---------- */
let R = null;
const preview = $('#preview');

async function startRecording() {
  if (R) return;
  const q = $('#quality').value, wantScreen = mode !== 'cam', wantCam = mode !== 'screen';
  const s = { mode, q, shape: $('#bubShape').value, size: +$('#bubSize').value, pos: $('#bubPos').value, color: $('#bubColor').value, mirror: $('#optMirror').checked, mime: $('#format').value };
  const r = { s, streams: [], chunks: [], elapsed: 0, paused: false, transcript: [], thumb: null };
  stopCamTest();
  try {
    if (wantScreen) {
      if (desktop) { const id = await pickSource(); if (!id) return; await desktop.setSource(id, $('#optSys').checked); r.overlay = mode === 'both' && id.startsWith('screen:'); }
      r.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30, width: { ideal: QH[q] * 16 / 9 }, height: { ideal: QH[q] } }, audio: $('#optSys').checked });
      r.streams.push(r.screenStream);
    }
    if (r.overlay) {
      // escritorio: la burbuja es una ventana overlay propia (como Loom); la cámara la abre esa ventana
      await desktop.bubbleOpen({ cam: $('#camSel').value, shape: s.shape, color: s.color, mirror: s.mirror, size: s.size, pos: s.pos });
    } else if (wantCam) {
      r.camStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: $('#camSel').value ? { exact: $('#camSel').value } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } } });
      r.streams.push(r.camStream);
    }
    if ($('#optMic').checked) {
      try {
        const n = $('#optNoise').checked;
        r.micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: $('#micSel').value ? { exact: $('#micSel').value } : undefined, echoCancellation: n, noiseSuppression: n, autoGainControl: n } });
        r.streams.push(r.micStream);
      } catch { toast('No se pudo acceder al micrófono; se grabará sin él'); }
    }
  } catch (e) {
    r.streams.forEach(st => st.getTracks().forEach(t => t.stop()));
    toast(e.name === 'NotAllowedError' ? 'Permiso denegado o cancelado' : 'Error: ' + e.message, 4000); return;
  }
  fillDevices();
  R = r;

  // vídeos fuente
  const mkVideo = st => { const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = st; v.play().catch(() => { }); return v; };
  if (r.screenStream) r.sv = mkVideo(r.screenStream);
  if (r.camStream) r.cv = mkVideo(new MediaStream(r.camStream.getVideoTracks()));
  await sleep(250);

  // lienzo
  let W, H;
  if (r.sv && r.sv.videoWidth) { W = r.sv.videoWidth; H = r.sv.videoHeight; }
  else { H = QH[q]; W = Math.round(H * 16 / 9); }
  if (H > QH[q]) { W = Math.round(W * QH[q] / H); H = QH[q]; }
  W -= W % 2; H -= H % 2;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  r.cv2 = cv; r.ctx = cv.getContext('2d', { alpha: false });
  preview.width = W; preview.height = H;

  // audio
  const tracks = [];
  const aTracks = [...(r.screenStream?.getAudioTracks() || []), ...(r.micStream?.getAudioTracks() || [])];
  if (aTracks.length) {
    r.ac = new AudioContext(); const dest = r.ac.createMediaStreamDestination();
    if (r.screenStream?.getAudioTracks().length) r.ac.createMediaStreamSource(new MediaStream(r.screenStream.getAudioTracks())).connect(dest);
    if (r.micStream) r.ac.createMediaStreamSource(r.micStream).connect(dest);
    tracks.push(...dest.stream.getAudioTracks());
  }

  // ticker en worker (no se frena con la pestaña en segundo plano)
  const wk = new Worker(URL.createObjectURL(new Blob(['let t;onmessage=e=>{clearInterval(t);if(e.data)t=setInterval(()=>postMessage(0),e.data)}'], { type: 'text/javascript' })));
  r.wk = wk; wk.onmessage = () => drawFrame(r); wk.postMessage(1000 / 30);
  drawFrame(r);

  const out = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...tracks]);
  const opts = { videoBitsPerSecond: QBITS[q] }; if (s.mime && MediaRecorder.isTypeSupported(s.mime)) opts.mimeType = s.mime;
  r.rec = new MediaRecorder(out, opts);
  r.mime = r.rec.mimeType || 'video/webm';
  r.rec.ondataavailable = e => e.data.size && r.chunks.push(e.data);
  r.rec.onstop = () => finishRecording(r);

  if ($('#optCount').checked) { if (!(await countdown())) { cancelRecording(r); return; } }

  r.screenStream?.getVideoTracks()[0].addEventListener('ended', () => stopRecording());
  r.rec.start(1000); bubbleState('rec');
  r.t0 = performance.now(); r.pausedAt = 0; r.pausedTotal = 0;
  r.timer = setInterval(tick, 250);
  if ($('#optTrans').checked) startSpeech(r);
  setTimeout(() => { if (R === r) r.thumb = thumbFrom(r.cv2); }, 1500);

  $('#recPanel').classList.remove('hidden', 'paused'); $('#btnStart').disabled = true; $('#btnPause').textContent = '⏸ Pausar'; $('#recState').textContent = 'Grabando';
  if (desktop) { $('#camMini').srcObject = r.camStream ? new MediaStream(r.camStream.getVideoTracks()) : null; $('#camMini').play?.(); $('#camMini').style.display = r.camStream ? '' : 'none'; document.body.classList.add('compactmode'); $('#compactBar').classList.remove('hidden'); desktop.compact(true); }
  else if (window.documentPictureInPicture) $('#btnPip').classList.remove('hidden');
}

function thumbFrom(c) { const t = document.createElement('canvas'); t.width = 480; t.height = Math.round(480 * c.height / c.width); t.getContext('2d').drawImage(c, 0, 0, t.width, t.height); return t.toDataURL('image/jpeg', .75); }

async function countdown() {
  const o = $('#countdown'), n = $('#countNum'); o.classList.remove('hidden'); let cancelled = false;
  const esc = e => { if (e.key === 'Escape') cancelled = true; }; addEventListener('keydown', esc);
  for (let i = 3; i > 0 && !cancelled; i--) { n.textContent = i; n.style.animation = 'none'; void n.offsetWidth; n.style.animation = ''; await sleep(1000); }
  removeEventListener('keydown', esc); o.classList.add('hidden'); return !cancelled;
}

function drawFrame(r) {
  const { ctx, s } = r, W = r.cv2.width, H = r.cv2.height;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const cover = (v, x, y, w, h, mirror) => {
    const vw = v.videoWidth, vh = v.videoHeight; if (!vw) return;
    const sc = Math.max(w / vw, h / vh), sw = w / sc, sh = h / sc, sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    ctx.save(); if (mirror) { ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h); } else ctx.drawImage(v, sx, sy, sw, sh, x, y, w, h); ctx.restore();
  };
  if (r.sv && r.sv.videoWidth) {
    const vw = r.sv.videoWidth, vh = r.sv.videoHeight, sc = Math.min(W / vw, H / vh), dw = vw * sc, dh = vh * sc;
    ctx.drawImage(r.sv, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  if (r.cv && s.mode === 'cam') cover(r.cv, 0, 0, W, H, s.mirror);
  else if (r.cv && s.mode === 'both' && r.cv.videoWidth) {
    const d = Math.round(Math.min(W, H) * s.size), m = Math.round(Math.min(W, H) * .03);
    const x = s.pos.includes('l') ? m : W - d - m, y = s.pos.includes('t') ? m : H - d - m;
    WAGRing.bubble(ctx, r.cv, x, y, d, s, r.paused ? 'paused' : 'rec', performance.now() / 1000);
  }
  const p = preview.getContext('2d'); p.drawImage(r.cv2, 0, 0);
}

function tick() {
  if (!R) return;
  const el = R.paused ? R.pausedAt - R.t0 - R.pausedTotal : performance.now() - R.t0 - R.pausedTotal;
  R.elapsed = el / 1000; const t = fmtTime(R.elapsed); $('#timer').textContent = t; $('#timerMini').textContent = t;
}
function togglePause() {
  if (!R) return; const r = R;
  if (!r.paused) { r.rec.pause(); r.paused = true; r.pausedAt = performance.now(); r.speech?.stop?.(); }
  else { r.rec.resume(); r.paused = false; r.pausedTotal += performance.now() - r.pausedAt; if ($('#optTrans').checked) startSpeech(r); }
  $('#recPanel').classList.toggle('paused', r.paused); bubbleState(r.paused ? 'paused' : 'rec');
  const lab = r.paused ? '▶ Reanudar' : '⏸ Pausar'; $('#btnPause').textContent = lab; $('#btnPauseMini').textContent = r.paused ? '▶' : '⏸'; $('#recState').textContent = r.paused ? 'En pausa' : 'Grabando';
}
function stopRecording() { if (R?.rec && R.rec.state !== 'inactive') { if (R.paused) R.pausedTotal += performance.now() - R.pausedAt; tick(); R.stopping = true; R.rec.stop(); } }
function cancelRecording(r) { cleanup(r); R = null; }
function cleanup(r) {
  clearInterval(r.timer); r.wk?.terminate(); desktop?.bubbleClose(); r.stopSpeech = true; try { r.speech?.stop(); } catch { }
  r.streams.forEach(st => st.getTracks().forEach(t => t.stop())); r.ac?.close().catch(() => { });
  $('#recPanel').classList.add('hidden'); $('#btnStart').disabled = false; $('#btnPip').classList.add('hidden');
  document.body.classList.remove('compactmode'); $('#compactBar').classList.add('hidden'); $('#camMini').srcObject = null; if (desktop) desktop.compact(false);
  pipWin?.close();
}
async function finishRecording(r) {
  const blob = new Blob(r.chunks, { type: r.mime.split(';')[0] });
  const dur = r.elapsed, thumb = r.thumb || thumbFrom(r.cv2);
  cleanup(r); R = null;
  if (!blob.size) { toast('La grabación quedó vacía'); return; }
  const rec = { id: uid(), title: 'Grabación ' + new Date().toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' }), created: Date.now(), duration: dur, size: blob.size, mime: blob.type, blob, thumb, transcript: r.transcript, comments: [] };
  await dbPut(rec); await refreshCount(); toast('✔ Grabación guardada en la biblioteca'); openViewer(rec.id);
}

/* ---------- vista previa de la burbuja + aro de luz ---------- */
const bubbleState = st => desktop?.bubbleState(st);
let testStream = null, testVid = null;
const prevCv = $('#bubPrev');
async function toggleCamTest() {
  if (testStream) return stopCamTest();
  try {
    testStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: $('#camSel').value ? { exact: $('#camSel').value } : undefined, width: { ideal: 640 } } });
    testVid = document.createElement('video'); testVid.muted = true; testVid.playsInline = true; testVid.srcObject = testStream; testVid.play();
    $('#btnCamTest').textContent = '⏹ Apagar cámara'; fillDevices();
  } catch (e) { toast('No se pudo abrir la cámara'); }
}
function stopCamTest() { testStream?.getTracks().forEach(t => t.stop()); testStream = testVid = null; $('#btnCamTest').textContent = '📷 Probar cámara'; }
(function prevLoop() {
  const c = prevCv.getContext('2d'), W = prevCv.width; c.clearRect(0, 0, W, W); const pd = Math.round(W * .1);
  const st = R ? (R.paused ? 'paused' : 'rec') : 'idle';
  WAGRing.bubble(c, R?.cv || testVid, pd, pd, W - 2 * pd, { shape: $('#bubShape').value, color: $('#bubColor').value, mirror: $('#optMirror').checked }, st, performance.now() / 1000);
  requestAnimationFrame(prevLoop);
})();
$('#btnCamTest').onclick = toggleCamTest;

/* ---------- transcripción (Web Speech API, si el navegador la ofrece) ---------- */
function startSpeech(r) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR || desktop) { if (!r.warnedSR) { r.warnedSR = 1; toast('Transcripción no disponible en este entorno (usa Chrome/Edge web)', 4000); } return; }
  const sp = new SR(); sp.continuous = true; sp.interimResults = false; sp.lang = navigator.language || 'es-ES'; r.speech = sp;
  sp.onresult = e => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) r.transcript.push({ t: r.elapsed, text: e.results[i][0].transcript.trim() }); };
  sp.onend = () => { if (R === r && !r.paused && !r.stopSpeech && r.rec.state === 'recording') try { sp.start(); } catch { } };
  try { sp.start(); } catch { }
}

/* ---------- selector de fuente (escritorio) ---------- */
function pickSource() {
  return new Promise(async res => {
    const dlg = $('#pickDlg'), grid = $('#pickGrid'); grid.innerHTML = 'Cargando…'; dlg.showModal();
    const srcs = await desktop.getSources(); grid.innerHTML = '';
    srcs.forEach(s => { const d = document.createElement('div'); d.className = 'pickitem'; d.dataset.id = s.id; d.innerHTML = `<img src="${s.thumb}"><span>${s.name.replace(/</g, '&lt;')}</span>`; d.onclick = () => { dlg.close(); res(s.id); }; grid.append(d); });
    $('#pickCancel').onclick = () => { dlg.close(); res(null); }; dlg.oncancel = () => res(null);
  });
}

/* ---------- mini ventana PiP (web) ---------- */
let pipWin = null;
async function openPip() {
  try {
    pipWin = await documentPictureInPicture.requestWindow({ width: 360, height: 160 });
    const st = document.createElement('style'); st.textContent = [...document.styleSheets].map(s => [...s.cssRules].map(r => r.cssText).join('')).join('');
    pipWin.document.head.append(st); const bar = $('#compactBar'); bar.classList.remove('hidden'); bar.style.position = 'static'; bar.style.height = '100vh';
    if (R.camStream) { $('#camMini').srcObject = new MediaStream(R.camStream.getVideoTracks()); $('#camMini').play(); } else $('#camMini').style.display = 'none';
    pipWin.document.body.append(bar);
    pipWin.addEventListener('pagehide', () => { bar.classList.add('hidden'); bar.style.cssText = ''; document.body.append(bar); pipWin = null; });
  } catch (e) { toast('No se pudo abrir la mini ventana'); }
}

/* ---------- biblioteca ---------- */
async function refreshCount() { $('#libCount').textContent = (await dbAll()).length; }
async function renderLib() {
  let list = await dbAll(); const q = $('#search').value.toLowerCase(), so = $('#sort').value;
  list = list.filter(v => v.title.toLowerCase().includes(q));
  list.sort((a, b) => so === 'old' ? a.created - b.created : so === 'long' ? b.duration - a.duration : b.created - a.created);
  const g = $('#libGrid'); g.innerHTML = '';
  $('#libEmpty').classList.toggle('hidden', list.length > 0); $('#libCount').textContent = (await dbAll()).length;
  list.forEach(v => {
    const c = document.createElement('div'); c.className = 'vcard';
    c.innerHTML = `<div class="vthumb"><img alt=""><span class="dur">${fmtTime(v.duration)}</span></div><div class="vinfo"><b></b><small>${new Date(v.created).toLocaleDateString('es')} · ${fmtSize(v.size)}</small></div>`;
    c.querySelector('img').src = v.thumb || ''; c.querySelector('b').textContent = v.title; c.onclick = () => openViewer(v.id); g.append(c);
  });
}

/* ---------- visor / editor ---------- */
let cur = null, curUrl = null;
const player = $('#vPlayer');
async function openViewer(id) {
  cur = await dbGet(id); if (!cur) return;
  if (curUrl) URL.revokeObjectURL(curUrl);
  curUrl = URL.createObjectURL(cur.blob); player.src = curUrl; player.playbackRate = 1; $('#vSpeed').value = '1';
  player.onloadedmetadata = () => { if (!isFinite(player.duration)) { player.currentTime = 1e101; player.ontimeupdate = () => { player.ontimeupdate = null; player.currentTime = 0; }; } };
  $('#vTitle').value = cur.title;
  const d = cur.duration || 1; ['trimStart', 'trimEnd'].forEach(i => { $('#' + i).max = d; }); $('#trimStart').value = 0; $('#trimEnd').value = d; updTrim();
  $('#trimStatus').textContent = ''; renderTranscript(); renderComments();
  if (!$('#viewDlg').open) $('#viewDlg').showModal();
}
function closeViewer() { player.pause(); $('#viewDlg').close(); player.removeAttribute('src'); renderLib(); }
function renderTranscript() {
  const p = $('#vt-tr'); p.innerHTML = '';
  if (!cur.transcript?.length) { p.innerHTML = '<p class="hint">Sin transcripción. Actívala antes de grabar (disponible en Chrome/Edge web).</p>'; return; }
  cur.transcript.forEach(l => { const d = document.createElement('div'); d.className = 'line'; d.innerHTML = `<i>${fmtTime(l.t)}</i><span></span>`; d.lastChild.textContent = l.text; d.onclick = () => { player.currentTime = l.t; player.play(); }; p.append(d); });
}
function renderComments() {
  const p = $('#cmList'); p.innerHTML = ''; if (!cur.comments?.length) p.innerHTML = '<p class="hint">Sin comentarios todavía.</p>';
  cur.comments.sort((a, b) => a.t - b.t).forEach(c => { const d = document.createElement('div'); d.className = 'line'; d.innerHTML = `<i>${fmtTime(c.t)}</i><span></span>`; d.lastChild.textContent = c.text; d.onclick = () => { player.currentTime = c.t; }; p.append(d); });
}
async function addComment(text) { text = text.trim(); if (!text) return; cur.comments.push({ t: player.currentTime || 0, text }); await dbPut(cur); renderComments(); $('#cmInput').value = ''; }
function updTrim() { let a = +$('#trimStart').value, b = +$('#trimEnd').value; if (a > b) { [a, b] = [b, a]; } $('#tS').textContent = fmtTime(a); $('#tE').textContent = fmtTime(b); return [a, b]; }

const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
const ext = m => m.includes('mp4') ? 'mp4' : 'webm';
const safe = s => s.replace(/[\\/:*?"<>|]+/g, '_');
const srtTime = t => { const ms = Math.floor(t * 1000); const p = (n, l = 2) => String(n).padStart(l, '0'); return `${p(ms / 3600000 | 0)}:${p(ms / 60000 % 60 | 0)}:${p(ms / 1000 % 60 | 0)},${p(ms % 1000, 3)}`; };

async function trimClip(rec, a, b, onProg) {
  const url = URL.createObjectURL(rec.blob), v = document.createElement('video'); v.src = url; v.playsInline = true;
  await new Promise(r => v.onloadedmetadata = r);
  if (!isFinite(v.duration)) { v.currentTime = 1e101; await new Promise(r => v.ontimeupdate = r); v.ontimeupdate = null; }
  v.currentTime = a; await new Promise(r => v.onseeked = r);
  const st = v.captureStream(); const mr = new MediaRecorder(st, { mimeType: rec.mime, videoBitsPerSecond: 12e6 }); const ch = [];
  mr.ondataavailable = e => e.data.size && ch.push(e.data);
  const done = new Promise(r => mr.onstop = r); mr.start(1000); await v.play();
  await new Promise(r => { const iv = setInterval(() => { onProg?.((v.currentTime - a) / (b - a)); if (v.currentTime >= b || v.ended) { clearInterval(iv); r(); } }, 100); });
  v.pause(); mr.stop(); await done; URL.revokeObjectURL(url);
  return new Blob(ch, { type: rec.mime.split(';')[0] });
}

function bindViewer() {
  $('#vClose').onclick = closeViewer; $('#viewDlg').addEventListener('cancel', e => { e.preventDefault(); closeViewer(); });
  $('#vTitle').onchange = async () => { cur.title = $('#vTitle').value.trim() || cur.title; await dbPut(cur); };
  $('#vSpeed').onchange = e => player.playbackRate = +e.target.value;
  $('#vDownload').onclick = () => dl(cur.blob, safe(cur.title) + '.' + ext(cur.mime));
  $('#vShare').onclick = async () => {
    const f = new File([cur.blob], safe(cur.title) + '.' + ext(cur.mime), { type: cur.blob.type });
    if (navigator.canShare?.({ files: [f] })) { try { await navigator.share({ files: [f], title: cur.title }); } catch { } }
    else { dl(cur.blob, f.name); toast('Compartir directo no está disponible: se descargó el archivo'); }
  };
  $('#vDelete').onclick = async () => { if (confirm('¿Eliminar este video definitivamente?')) { await dbDel(cur.id); closeViewer(); refreshCount(); } };
  ['trimStart', 'trimEnd'].forEach(i => $('#' + i).oninput = () => { const [a] = updTrim(); player.currentTime = i === 'trimStart' ? a : +$('#trimEnd').value; });
  $('#trimPreview').onclick = () => { const [a, b] = updTrim(); player.currentTime = a; player.play(); const f = () => { if (player.currentTime >= b) { player.pause(); player.removeEventListener('timeupdate', f); } }; player.addEventListener('timeupdate', f); };
  $('#trimApply').onclick = async () => {
    const [a, b] = updTrim(); if (b - a < 0.5) return toast('Selecciona al menos medio segundo'); player.pause();
    $('#trimApply').disabled = true;
    try {
      const blob = await trimClip(cur, a, b, p => $('#trimStatus').textContent = 'Recortando… ' + Math.round(p * 100) + '%');
      const rec = { ...cur, id: uid(), title: cur.title + ' (recorte)', created: Date.now(), duration: b - a, size: blob.size, blob, comments: [], transcript: (cur.transcript || []).filter(l => l.t >= a && l.t <= b).map(l => ({ ...l, t: l.t - a })) };
      await dbPut(rec); refreshCount(); toast('✔ Copia recortada guardada'); openViewer(rec.id);
    } catch (e) { $('#trimStatus').textContent = 'Error: ' + e.message; }
    $('#trimApply').disabled = false;
  };
  $$('[data-vt]').forEach(b => b.addEventListener('click', () => { $$('[data-vt]').forEach(x => x.classList.toggle('active', x === b)); $('#vt-tr').classList.toggle('hidden', b.dataset.vt !== 'tr'); $('#vt-cm').classList.toggle('hidden', b.dataset.vt !== 'cm'); }));
  $('#cmAdd').onclick = () => addComment($('#cmInput').value); $('#cmInput').onkeydown = e => e.key === 'Enter' && addComment($('#cmInput').value);
  $$('.emojis button').forEach(b => b.onclick = () => addComment(b.textContent));
  $('#exTxt').onclick = () => dl(new Blob([(cur.transcript || []).map(l => `[${fmtTime(l.t)}] ${l.text}`).join('\n')], { type: 'text/plain' }), safe(cur.title) + '.txt');
  $('#exSrt').onclick = () => { const t = cur.transcript || []; dl(new Blob([t.map((l, i) => `${i + 1}\n${srtTime(l.t)} --> ${srtTime(t[i + 1] ? t[i + 1].t : l.t + 3)}\n${l.text}\n`).join('\n')], { type: 'text/plain' }), safe(cur.title) + '.srt'); };
}

/* ---------- importar ---------- */
$('#importFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const url = URL.createObjectURL(f), v = document.createElement('video'); v.src = url; v.muted = true;
  await new Promise(r => v.onloadedmetadata = r);
  if (!isFinite(v.duration)) { v.currentTime = 1e101; await new Promise(r => v.ontimeupdate = r); v.ontimeupdate = null; }
  v.currentTime = Math.min(1, v.duration / 2); await new Promise(r => v.onseeked = r);
  const c = document.createElement('canvas'); c.width = v.videoWidth || 640; c.height = v.videoHeight || 360;
  c.getContext('2d').drawImage(v, 0, 0); const thumb = thumbFrom(c); const dur = v.duration; URL.revokeObjectURL(url);
  await dbPut({ id: uid(), title: f.name.replace(/\.[^.]+$/, ''), created: Date.now(), duration: dur, size: f.size, mime: f.type || 'video/webm', blob: f, thumb, transcript: [], comments: [] });
  e.target.value = ''; renderLib(); toast('✔ Video importado');
};
$('#search').oninput = renderLib; $('#sort').onchange = renderLib;

/* ---------- arranque ---------- */
$('#btnStart').onclick = startRecording; $('#btnStop').onclick = $('#btnStopMini').onclick = stopRecording;
$('#btnPause').onclick = $('#btnPauseMini').onclick = togglePause; $('#btnPip').onclick = openPip;
addEventListener('keydown', e => { if (R && e.altKey && e.shiftKey && e.code === 'KeyP') togglePause(); if (R && e.altKey && e.shiftKey && e.code === 'KeyS') stopRecording(); });
if (desktop) { desktop.onGlobal?.(a => a === 'stop' ? stopRecording() : togglePause()); }

fillFormats(); loadSettings(); bindSettings(); bindViewer(); fillDevices(); refreshCount();
$('#envHint').textContent = desktop ? 'Versión de escritorio · Atajos globales: Ctrl+Shift+S detener, Ctrl+Shift+P pausar.' : (navigator.mediaDevices?.getDisplayMedia ? 'Versión web · Atajos: Alt+Shift+S detener, Alt+Shift+P pausar.' : 'Tu navegador no soporta grabación de pantalla.');
if (!desktop && 'serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
