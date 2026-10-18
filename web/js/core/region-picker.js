// Selector de área: muestra en vivo lo compartido y deja dibujar, mover y redimensionar un rectángulo.
// Devuelve { x, y, w, h } en píxeles del vídeo original (pares), o null si se cancela.
import { $, clamp } from '../lib/dom.js';

const MIN = 32;

export function pickRegion(stream, { title = 'Arrastra sobre la imagen para elegir el área', goLabel = '● Grabar', last = null } = {}) {
  return new Promise((resolve) => {
    const root = $('picker'), stage = $('pickStage'), video = $('pickVideo'), selEl = $('pickSel');
    const goBtn = $('pickGo'), sizeEl = $('pickSize');
    let sel = null, drag = null, done = false;
    $('pickTitle').textContent = title;
    goBtn.textContent = goLabel;
    video.srcObject = stream;
    video.play().catch(() => {});
    root.hidden = false;
    document.body.style.overflow = 'hidden';

    const box = () => ({ w: video.clientWidth, h: video.clientHeight });
    const scale = () => (video.videoWidth || 1) / Math.max(1, video.clientWidth);   // píxeles de origen por píxel de pantalla

    const render = () => {
      const valid = sel && sel.w >= 2 && sel.h >= 2;
      stage.classList.toggle('has-sel', !!valid);
      selEl.hidden = !valid;
      if (!valid) { sizeEl.textContent = ''; goBtn.disabled = true; return; }
      Object.assign(selEl.style, { left: sel.x + 'px', top: sel.y + 'px', width: sel.w + 'px', height: sel.h + 'px' });
      const k = scale();
      const ev = (n) => Math.max(2, Math.round(n / 2) * 2);          // lo que se obtendrá: las dimensiones se ajustan a pares
      sizeEl.textContent = `${ev(sel.w * k)} × ${ev(sel.h * k)} px`;
      goBtn.disabled = sel.w * k < MIN || sel.h * k < MIN;
    };

    // restaura la última área si cabe en esta fuente
    const initFromLast = () => {
      if (!last || !video.videoWidth) return;
      const k = scale();
      const r = { x: last.x / k, y: last.y / k, w: last.w / k, h: last.h / k };
      if (r.x + r.w <= box().w + 1 && r.y + r.h <= box().h + 1) { sel = r; render(); }
    };
    video.addEventListener('loadedmetadata', initFromLast, { once: true });
    if (video.videoWidth) initFromLast();

    const local = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

    const onDown = (e) => {
      if (e.button !== 0 || e.target.closest('.picker-bar')) return;
      const p = local(e), h = e.target.dataset && e.target.dataset.h;
      if (h && sel) drag = { type: h, sx: p.x, sy: p.y, o: { ...sel } };
      else if (sel && selEl.contains(e.target)) drag = { type: 'move', sx: p.x, sy: p.y, o: { ...sel } };
      else { drag = { type: 'new', sx: p.x, sy: p.y }; sel = { x: p.x, y: p.y, w: 0, h: 0 }; }
      stage.setPointerCapture(e.pointerId);
      render();
    };
    const onMove = (e) => {
      if (!drag) return;
      const p = local(e), { w: W, h: H } = box();
      const dx = p.x - drag.sx, dy = p.y - drag.sy, o = drag.o;
      if (drag.type === 'new') {
        const x = clamp(p.x, 0, W), y = clamp(p.y, 0, H);
        sel = { x: Math.min(drag.sx, x), y: Math.min(drag.sy, y), w: Math.abs(x - drag.sx), h: Math.abs(y - drag.sy) };
      } else if (drag.type === 'move') {
        sel = { ...o, x: clamp(o.x + dx, 0, W - o.w), y: clamp(o.y + dy, 0, H - o.h) };
      } else {
        let { x, y, w, h } = o; const t = drag.type;
        if (t.includes('w')) { x = o.x + dx; w = o.w - dx; }
        if (t.includes('e')) w = o.w + dx;
        if (t.includes('n')) { y = o.y + dy; h = o.h - dy; }
        if (t.includes('s')) h = o.h + dy;
        if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
        x = clamp(x, 0, W); y = clamp(y, 0, H);
        sel = { x, y, w: Math.min(w, W - x), h: Math.min(h, H - y) };
      }
      render();
    };
    const onUp = () => { drag = null; render(); };

    const onBar = (e) => {
      const r = e.target.dataset && e.target.dataset.r;
      if (!r) return;
      const { w: W, h: H } = box();
      if (r === 'full') { sel = { x: 0, y: 0, w: W, h: H }; return render(); }
      const [a, b] = r.split(':').map(Number), ratio = a / b;
      const w = Math.min(W * 0.6, H * 0.6 * ratio), h = w / ratio;
      const cx = sel ? sel.x + sel.w / 2 : W / 2, cy = sel ? sel.y + sel.h / 2 : H / 2;
      sel = { x: clamp(cx - w / 2, 0, W - w), y: clamp(cy - h / 2, 0, H - h), w, h };
      render();
    };

    const finish = (result) => {
      if (done) return; done = true;
      stage.removeEventListener('pointerdown', onDown); stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp); stage.removeEventListener('pointercancel', onUp);
      document.removeEventListener('keydown', onKey, true);
      $('pickCancel').removeEventListener('click', onCancel); goBtn.removeEventListener('click', onGo);
      root.querySelector('.picker-bar').removeEventListener('click', onBar);
      video.srcObject = null; root.hidden = true; document.body.style.overflow = '';
      resolve(result);
    };
    const onCancel = () => finish(null);
    const onGo = () => {
      if (goBtn.disabled || !sel) return;
      const k = scale(), even = (n) => Math.max(2, Math.round(n / 2) * 2);
      const vw = video.videoWidth, vh = video.videoHeight;
      let x = even(sel.x * k), y = even(sel.y * k), w = even(sel.w * k), h = even(sel.h * k);
      x = Math.min(x, vw - 2); y = Math.min(y, vh - 2);
      w = Math.min(w, vw - x); h = Math.min(h, vh - y);
      w -= w % 2; h -= h % 2;
      finish({ x, y, w, h });
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(null); } else if (e.key === 'Enter') { e.preventDefault(); onGo(); } };

    stage.addEventListener('pointerdown', onDown); stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp); stage.addEventListener('pointercancel', onUp);
    document.addEventListener('keydown', onKey, true);
    $('pickCancel').addEventListener('click', onCancel); goBtn.addEventListener('click', onGo);
    root.querySelector('.picker-bar').addEventListener('click', onBar);
    window.addEventListener('resize', render);
    render();
  });
}
