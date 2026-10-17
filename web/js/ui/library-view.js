// Vista "Biblioteca": tarjetas con miniatura, filtros, búsqueda, renombrar, descargar y eliminar.
import { $, mk, toast, fmtDur, fmtSize } from '../lib/dom.js';
import * as lib from '../core/library.js';
import * as storage from '../core/storage.js';

let items = [], filter = 'all', query = '';
let hooks = { onEdit: () => {} };

let renaming = false, pending = false;     // mientras se renombra no se repinta: se perdería lo que el usuario está escribiendo
export async function refresh() {
  if (renaming) { pending = true; return; }
  try { items = await lib.list(); } catch (e) { toast('No se pudo leer la biblioteca: ' + e.message, 'error'); items = []; }
  $('libCount').textContent = items.length;
  render();
  const u = await storage.usage();
  $('usage').textContent = u.quota ? `Espacio usado: ${fmtSize(u.used)} de ${fmtSize(u.quota)}` : '';
}

async function showImage(item) {
  const file = await lib.getFile(item);
  const url = URL.createObjectURL(file);
  const w = window.open(url, '_blank', 'noopener');
  if (!w) { URL.revokeObjectURL(url); toast('El navegador bloqueó la ventana emergente. Descarga la imagen.', 'error'); }
  else setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function startRename(titleEl, item) {
  const inp = mk('input', 'rename'); inp.value = item.title; inp.maxLength = 120; inp.setAttribute('aria-label', 'Nuevo nombre');
  titleEl.replaceWith(inp); inp.focus(); inp.select();
  renaming = true;
  let done = false;
  const finish = async (commit) => {
    if (done) return; done = true;
    if (commit && inp.value.trim() && inp.value.trim() !== item.title) {
      try { await lib.rename(item.id, inp.value.trim()); } catch (e) { toast(e.message, 'error'); }
    }
    renaming = false; pending = false;
    refresh();
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
}

function render() {
  const list = items.filter((f) => (filter === 'all' || (filter === 'image' ? f.kind === 'image' : f.kind !== 'image')) && (!query || f.title.toLowerCase().includes(query)));
  $('empty').hidden = list.length > 0;
  $('empty').textContent = items.length ? 'Nada coincide con tu búsqueda.' : 'Todavía no hay nada aquí. ¡Haz tu primera grabación!';
  const g = $('grid'); g.textContent = '';
  for (const f of list) {
    const card = mk('div', 'card'); card.dataset.id = f.id;
    const th = mk('button', 'thumb'); th.type = 'button'; th.title = f.kind === 'image' ? 'Ver imagen' : 'Abrir en el editor';
    if (f.thumb) { const img = new Image(); img.src = f.thumb; img.alt = ''; th.appendChild(img); } else th.appendChild(document.createTextNode('🎞️'));
    th.appendChild(mk('span', 'kind', f.kind === 'image' ? 'Captura' : lib.extFor(f).toUpperCase()));
    if (f.durationMs) th.appendChild(mk('span', 'dur', fmtDur(f.durationMs)));
    th.appendChild(mk('span', 'play', f.kind === 'image' ? '🔍' : '▶'));
    th.addEventListener('click', () => (f.kind === 'image' ? showImage(f) : hooks.onEdit(f)));

    const meta = mk('div', 'cmeta');
    const title = mk('div', 'title', f.title); title.title = f.title;
    const small = mk('small', '', [f.width ? `${f.width}×${f.height}` : '', fmtSize(f.size), new Date(f.created).toLocaleString()].filter(Boolean).join(' · '));
    const acts = mk('div', 'acts');
    const main = mk('button', 'grow', f.kind === 'image' ? '🔍 Ver' : '✂ Editar'); main.type = 'button';
    main.addEventListener('click', () => (f.kind === 'image' ? showImage(f) : hooks.onEdit(f)));
    const dl = mk('button', '', '⬇'); dl.type = 'button'; dl.title = 'Descargar'; dl.addEventListener('click', () => lib.download(f).catch((e) => toast('No se pudo descargar: ' + e.message, 'error')));
    const ren = mk('button', '', '✎'); ren.type = 'button'; ren.title = 'Cambiar nombre'; ren.addEventListener('click', () => startRename(title, f));
    const del = mk('button', 'del', '🗑'); del.type = 'button'; del.title = 'Eliminar';
    del.addEventListener('click', async () => { if (confirm(`¿Eliminar "${f.title}"? Esta acción no se puede deshacer.`)) { try { await lib.remove(f.id); } catch (e) { toast('No se pudo eliminar: ' + e.message, 'error'); } refresh(); } });
    acts.append(main, dl, ren, del);
    meta.append(title, small, acts); card.append(th, meta); g.appendChild(card);
  }
}

export function init({ onEdit }) {
  hooks = { onEdit };
  document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    filter = c.dataset.f; document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c)); render();
  }));
  $('search').addEventListener('input', () => { query = $('search').value.trim().toLowerCase(); render(); });
}
