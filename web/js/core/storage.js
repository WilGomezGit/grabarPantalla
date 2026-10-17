// Almacenamiento local: los archivos grandes van al sistema de archivos privado del navegador (OPFS) y los
// datos de la biblioteca a IndexedDB. Si OPFS no existe, los archivos se guardan como Blob en IndexedDB.
const DB_NAME = 'capturo-web', DB_VER = 1;
let dbPromise = null;

const hasOpfs = () => !!(navigator.storage && navigator.storage.getDirectory);
export const supportsOpfs = hasOpfs;

function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('La base de datos está bloqueada por otra pestaña.'));
  });
  return dbPromise;
}
const tx = async (store, mode, fn) => {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    let out;
    Promise.resolve(fn(t.objectStore(store))).then((v) => { out = v; }, reject);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transacción cancelada'));
  });
};
const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

// ---- metadatos de la biblioteca ----
export const listItems = () => tx('items', 'readonly', (s) => req2p(s.getAll()));
export const putItem = (item) => tx('items', 'readwrite', (s) => req2p(s.put(item)));
export const getItem = (id) => tx('items', 'readonly', (s) => req2p(s.get(id)));
export const deleteItem = (id) => tx('items', 'readwrite', (s) => req2p(s.delete(id)));

// ---- archivos ----
// Abre un destino de escritura. Devuelve { writable|null, finish(): Promise<void>, fallbackBlob(): Blob|null }
export async function openSink(name) {
  if (hasOpfs()) {
    const root = await navigator.storage.getDirectory();
    const h = await root.getFileHandle(name, { create: true });
    const writable = await h.createWritable();
    return { opfs: true, writable };
  }
  return { opfs: false, writable: null };
}
export async function saveBlob(name, blob) {
  if (hasOpfs()) {
    const root = await navigator.storage.getDirectory();
    const h = await root.getFileHandle(name, { create: true });
    const w = await h.createWritable();
    await w.write(blob); await w.close();
    return;
  }
  await tx('blobs', 'readwrite', (s) => req2p(s.put(blob, name)));
}
export async function getFile(name) {
  if (hasOpfs()) {
    const root = await navigator.storage.getDirectory();
    const h = await root.getFileHandle(name);
    return h.getFile();
  }
  const blob = await tx('blobs', 'readonly', (s) => req2p(s.get(name)));
  if (!blob) throw new Error('Archivo no encontrado');
  return blob;
}
export async function removeFile(name) {
  if (hasOpfs()) {
    try { const root = await navigator.storage.getDirectory(); await root.removeEntry(name); } catch (e) { if (e.name !== 'NotFoundError') throw e; }
    return;
  }
  await tx('blobs', 'readwrite', (s) => req2p(s.delete(name)));
}
export async function usage() {
  try { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } catch { return { used: 0, quota: 0 }; }
}
export async function requestPersistence() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
