// Adquisición de pantalla, cámara y micrófono, con mensajes de error comprensibles.
const SURFACE = { full: 'monitor', region: 'monitor', window: 'window', tab: 'browser' };

export function friendlyError(e) {
  const n = e && e.name, m = (e && e.message) || String(e);
  if (n === 'NotAllowedError') return 'Se canceló o no se dio permiso. Si quieres grabar, acepta el aviso del navegador.';
  if (n === 'NotFoundError') return 'No se encontró el dispositivo (cámara o micrófono). Compruébalo y vuelve a intentarlo.';
  if (n === 'NotReadableError') return 'La cámara o el micrófono está siendo usado por otra aplicación. Ciérrala e inténtalo de nuevo.';
  if (n === 'OverconstrainedError') return 'El dispositivo elegido ya no está disponible. Elige otro.';
  if (n === 'AbortError') return 'La captura se interrumpió. Inténtalo de nuevo.';
  if (n === 'SecurityError') return 'El navegador bloqueó la captura. Abre la página con https o desde localhost.';
  return m;
}

export function getDisplay(cfg) {
  // Sin restricciones de tamaño: con "ideal" o "max" Chromium informa en getSettings() el tamaño pedido en vez del real
  // (probado: 1920×1080 reales aparecían como 3840×2160 o 96×96). Sin ellas la captura es nativa y la información es veraz.
  const video = { frameRate: { ideal: cfg.fps, max: cfg.fps }, cursor: 'always' };
  if (SURFACE[cfg.target]) video.displaySurface = SURFACE[cfg.target];
  const opts = { video, audio: cfg.systemAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false, selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'include' };
  if (cfg.systemAudio) opts.systemAudio = 'include';
  return navigator.mediaDevices.getDisplayMedia(opts);
}
export const getCamera = (camId) => navigator.mediaDevices.getUserMedia({
  audio: false,
  video: { deviceId: camId ? { exact: camId } : undefined, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
});
export const getMic = (micId) => navigator.mediaDevices.getUserMedia({
  audio: { deviceId: micId && micId !== 'default' ? { exact: micId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
});

// Un <video> silencioso alimentado por el stream; espera a conocer sus dimensiones.
export async function videoFrom(stream, timeoutMs = 8000) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.srcObject = stream;
  await v.play();
  if (!v.videoWidth) {
    await new Promise((resolve, reject) => {
      v.addEventListener('loadedmetadata', resolve, { once: true });
      setTimeout(() => reject(new Error('La captura no entregó imagen.')), timeoutMs);
    });
  }
  return v;
}
export const stopStream = (s) => { if (s) s.getTracks().forEach((t) => { try { t.stop(); } catch { /* ya parado */ } }); };
