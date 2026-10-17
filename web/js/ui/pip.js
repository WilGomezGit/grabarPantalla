// Mini controlador flotante con Document Picture-in-Picture: pausa, detener y notas del orador.
// Solo existe en navegadores Chromium recientes; si no está disponible, todo sigue funcionando desde la página.
import { mk, clamp } from '../lib/dom.js';

const pad = (n) => String(n).padStart(2, '0');
const fmt = (ms) => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600); return (h ? pad(h) + ':' : '') + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60); };

export const pipSupported = () => 'documentPictureInPicture' in window;

// Debe llamarse dentro de un gesto del usuario (el clic en "Empezar").
export async function openPip({ notes = '', onPause, onStop }) {
  if (!pipSupported()) return null;
  let win;
  try { win = await window.documentPictureInPicture.requestWindow({ width: 360, height: notes ? 380 : 78 }); } catch { return null; }
  const doc = win.document;
  for (const l of document.querySelectorAll('link[rel="stylesheet"]')) { const c = doc.createElement('link'); c.rel = 'stylesheet'; c.href = l.href; doc.head.appendChild(c); }
  doc.title = 'Capturo';

  const root = doc.createElement('div'); root.className = 'pip';
  const top = mk('div', 'pip-top');
  const dot = mk('i', 'pip-dot'), time = mk('span', 'pip-time', '00:00'), stat = mk('span', 'pip-stat', 'Preparando…');
  const pause = mk('button', '', '⏸ Pausa'), stop = mk('button', 'stop', '■ Detener');
  pause.disabled = true; stop.disabled = true;
  top.append(dot, time, stat, mk('span', 'pip-sp'), pause, stop);
  root.appendChild(top);

  let noteBox = null, playing = false, last = 0, speed = 40, acc = 0;
  if (notes) {
    noteBox = mk('div', 'pip-notes', notes);
    root.appendChild(noteBox);
    const tick = (t) => {
      if (!playing) return;
      const dt = last ? (t - last) / 1000 : 0; last = t;
      acc += speed * dt; const px = Math.floor(acc); acc -= px;
      noteBox.scrollTop += px;
      win.requestAnimationFrame(tick);
    };
    noteBox.addEventListener('click', () => { playing = !playing; last = 0; if (playing) win.requestAnimationFrame(tick); });
    noteBox.title = 'Clic: iniciar o detener el desplazamiento · Rueda: mover manualmente';
    win.addEventListener('keydown', (e) => { if (e.key === 'ArrowUp') speed = clamp(speed + 5, 5, 200); else if (e.key === 'ArrowDown') speed = clamp(speed - 5, 5, 200); });
  }
  doc.body.style.margin = '0';
  doc.body.appendChild(root);

  pause.addEventListener('click', () => onPause && onPause());
  stop.addEventListener('click', () => onStop && onStop());
  let closed = false;
  win.addEventListener('pagehide', () => { closed = true; });

  return {
    update({ state, elapsed, fps, target }) {
      if (closed) return;
      root.classList.toggle('rec', state === 'recording'); root.classList.toggle('paused', state === 'paused');
      time.textContent = fmt(elapsed);
      pause.textContent = state === 'paused' ? '▶ Reanudar' : '⏸ Pausa';
      pause.disabled = false; stop.disabled = false;
      const slow = state === 'recording' && fps && target && fps < target * 0.8;
      stat.textContent = (fps ? fps + ' fps' : '') + (slow ? ' ⚠' : '');
      stat.classList.toggle('warn', !!slow);
    },
    setText(t) { if (!closed) stat.textContent = t; },
    close() { if (!closed) { closed = true; try { win.close(); } catch { /* ya cerrada */ } } },
    get closed() { return closed; },
  };
}
