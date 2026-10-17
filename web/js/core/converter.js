// Información, recorte y conversión de videos en el navegador (WebCodecs vía mediabunny).
import {
  Input, ALL_FORMATS, BlobSource, Output, Mp4OutputFormat, WebMOutputFormat, StreamTarget, BufferTarget, Conversion, canEncodeVideo,
} from '../../vendor/mediabunny.min.mjs';
import * as storage from './storage.js';

// Lee la duración, el tamaño y si tiene audio de un archivo.
export async function probe(file) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const v = await input.getPrimaryVideoTrack(), a = await input.getPrimaryAudioTrack();
    const dur = await input.computeDuration();
    return { durationMs: Math.round(dur * 1000), width: v ? v.displayWidth : null, height: v ? v.displayHeight : null, hasVideo: !!v, hasAudio: !!a, codec: v ? v.codec : null };
  } finally { input.dispose(); }
}

// opts: { file, name, format: 'mp4'|'webm', startMs, endMs, height, onProgress }
// Devuelve { promise, cancel }. promise → { ok, name, size, durationMs, width, height, cancelled, error }
export function exportCopy(opts) {
  let conversion = null, cancelled = false;
  const promise = (async () => {
    const { file, name, format, startMs = 0, endMs = null, height = null, onProgress } = opts;
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    let sink = null;
    try {
      const v = await input.getPrimaryVideoTrack();
      if (!v) return { ok: false, error: 'Este archivo no tiene video.' };
      const outH = height ? Math.max(120, Math.min(4320, height)) : null;
      const outW = outH ? Math.round((v.displayWidth * outH) / v.displayHeight / 2) * 2 : null;
      const vcodec = format === 'mp4' ? 'avc' : 'vp9';
      if (!(await canEncodeVideo(vcodec, { width: outW || v.displayWidth, height: outH || v.displayHeight, bitrate: 6e6 }))) {
        return { ok: false, error: `Este navegador no puede codificar ${format.toUpperCase()} a ese tamaño. Prueba otro formato o resolución.` };
      }
      sink = await storage.openSink(name);
      const target = sink.opfs ? new StreamTarget(sink.writable) : new BufferTarget();
      const output = new Output({ format: format === 'mp4' ? new Mp4OutputFormat({ fastStart: false }) : new WebMOutputFormat(), target });
      const trim = {};
      if (startMs > 0) trim.start = startMs / 1000;
      if (endMs) trim.end = endMs / 1000;
      conversion = await Conversion.init({
        input, output,
        video: { codec: vcodec, ...(outH ? { height: outH, width: outW, fit: 'fill' } : {}), forceTranscode: !!outH || startMs > 0 || !!endMs },
        ...(Object.keys(trim).length ? { trim } : {}),
      });
      if (!conversion.isValid) return { ok: false, error: 'No se puede convertir este archivo.' };
      if (cancelled) throw new Error('cancelled');
      if (onProgress) conversion.onProgress = (p) => onProgress(p);
      await conversion.execute();
      let size, blob = null;
      if (sink.opfs) size = (await storage.getFile(name)).size;
      else { blob = new Blob([target.buffer], { type: format === 'mp4' ? 'video/mp4' : 'video/webm' }); size = blob.size; await storage.saveBlob(name, blob); }
      const f = sink.opfs ? await storage.getFile(name) : blob;
      const info = await probe(f);
      return { ok: true, name, size, durationMs: info.durationMs, width: info.width, height: info.height };
    } catch (e) {
      try { await storage.removeFile(name); } catch { /* no existe */ }
      if (cancelled || (e && e.message === 'cancelled')) return { ok: false, cancelled: true };
      return { ok: false, error: (e && e.message) || String(e) };
    } finally { input.dispose(); }
  })();
  return { promise, cancel: () => { cancelled = true; if (conversion) conversion.cancel().catch(() => {}); } };
}
