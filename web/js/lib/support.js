// Detección de compatibilidad del navegador, con mensajes claros para el usuario.
export function checkSupport() {
  const missing = [];
  if (!window.isSecureContext) missing.push('una conexión segura (https o localhost)');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) missing.push('captura de pantalla');
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') missing.push('codificación de video (WebCodecs)');
  if (typeof MediaStreamTrackProcessor === 'undefined') missing.push('lectura de pistas de video (MediaStreamTrackProcessor)');
  const opfs = !!(navigator.storage && navigator.storage.getDirectory);
  const pip = 'documentPictureInPicture' in window;
  return { ok: missing.length === 0, missing, opfs, pip };
}

export function unsupportedMessage(s) {
  return `Este navegador no tiene: ${s.missing.join(', ')}. Abre WilCapturo Web en Chrome, Edge u otro navegador basado en Chromium actualizado.`;
}
