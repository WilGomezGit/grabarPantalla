// Biblioteca: metadatos en IndexedDB, archivos en OPFS, miniaturas generadas al guardar.
import * as storage from './storage.js';
import { safeName } from '../lib/dom.js';

const THUMB_W = 320;

export async function list() {
  const items = await storage.listItems();
  return items.sort((a, b) => b.created - a.created);
}

// Miniatura a partir de un fotograma del video (o la propia imagen).
export async function makeThumb(file, kind) {
  const url = URL.createObjectURL(file);
  try {
    if (kind === 'image') {
      const img = new Image(); img.src = url; await img.decode();
      return drawScaled(img, img.naturalWidth, img.naturalHeight);
    }
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.src = url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('sin miniatura')); setTimeout(() => rej(new Error('sin miniatura')), 8000); });
    const t = Math.min(0.5, (isFinite(v.duration) ? v.duration : 1) / 2);
    if (t > 0) { v.currentTime = t; await new Promise((res) => { v.onseeked = res; setTimeout(res, 2000); }); }
    return drawScaled(v, v.videoWidth, v.videoHeight);
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}
function drawScaled(src, w, h) {
  if (!w || !h) return null;
  const c = document.createElement('canvas'); c.width = THUMB_W; c.height = Math.max(1, Math.round((THUMB_W * h) / w));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.72);
}

export async function addItem({ name: fileName, kind = 'video', title, size, durationMs = null, width = null, height = null, mime }) {
  const file = await storage.getFile(fileName);
  const item = {
    id: crypto.randomUUID(), file: fileName, kind, title: safeName(title || fileName.replace(/\.[^.]+$/, '')), mime: mime || file.type,
    size, durationMs, width, height, created: Date.now(), thumb: await makeThumb(file, kind),
  };
  await storage.putItem(item);
  return item;
}

export async function rename(id, newTitle) {
  const clean = safeName(newTitle);
  if (!clean) throw new Error('Nombre no válido');
  const item = await storage.getItem(id);
  if (!item) throw new Error('No existe');
  item.title = clean;
  await storage.putItem(item);
  return item;
}

export async function remove(id) {
  const item = await storage.getItem(id);
  if (!item) return;
  await storage.removeFile(item.file);
  await storage.deleteItem(id);
}

export const getFile = (item) => storage.getFile(item.file);

export function extFor(item) {
  const m = /\.([a-z0-9]+)$/i.exec(item.file);
  return m ? m[1].toLowerCase() : (item.kind === 'image' ? 'png' : 'mp4');
}

// Descarga el archivo con su nombre legible
export async function download(item) {
  const file = await getFile(item);
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = `${item.title}.${extFor(item)}`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
