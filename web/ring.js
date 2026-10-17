/* WAG Rec — burbuja de cámara con aro de luz (compartido por app, vista previa y overlay de escritorio) */
(function (g) {
  const COL = { rec: '#3dff7a', paused: '#ff4d4d', idle: '#ff4d4d' };
  const radOf = (shape, d) => shape === 'circle' ? d / 2 : shape === 'round' ? d * .22 : d * .05;

  // Aro: base tenue que "respira" + cometa de luz que recorre el borde (verde grabando, rojo detenido/pausa)
  function ring(ctx, x, y, d, rad, state, t) {
    const col = COL[state] || COL.idle, w = Math.max(4, d * .045), half = w / 2;
    const px = x + half, py = y + half, pd = d - w, pr = Math.max(0, Math.min(rad - half, pd / 2));
    const P = 4 * pd - 8 * pr + 2 * Math.PI * pr;
    const path = () => { ctx.beginPath(); ctx.roundRect(px, py, pd, pd, pr); };
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = w; ctx.strokeStyle = col; ctx.shadowColor = col;
    const breathe = state === 'rec' ? .5 + .12 * Math.sin(t * 3) : .28 + .3 * (.5 + .5 * Math.sin(t * (state === 'paused' ? 5 : 2)));
    ctx.globalAlpha = breathe; ctx.shadowBlur = w * 2.4; ctx.setLineDash([]); path(); ctx.stroke();
    const speed = state === 'rec' ? 1 / 1.8 : state === 'paused' ? 1 / 7 : 1 / 5, head = ((t * speed) % 1) * P, L = P * (state === 'rec' ? .38 : .24), N = 16;
    for (let i = 0; i < N; i++) {
      const len = Math.max(.5, L * (1 - i / N)); ctx.setLineDash([len, P]); ctx.lineDashOffset = len - head;
      ctx.globalAlpha = .17; ctx.shadowBlur = w * 1.8; path(); ctx.stroke();
    }
    ctx.setLineDash([L * .07, P]); ctx.lineDashOffset = L * .07 - head; ctx.strokeStyle = '#fff'; ctx.lineWidth = w * .45; ctx.globalAlpha = .95; ctx.shadowBlur = w * 2.6; path(); ctx.stroke();
    ctx.restore();
  }

  function cover(ctx, v, x, y, w, h, mirror) {
    const vw = v.videoWidth, vh = v.videoHeight; if (!vw) return false;
    const sc = Math.max(w / vw, h / vh), sw = w / sc, sh = h / sc, sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    ctx.save(); if (mirror) { ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h); } else ctx.drawImage(v, sx, sy, sw, sh, x, y, w, h); ctx.restore(); return true;
  }

  // s: {shape, color, mirror}; video puede ser null (muestra marcador)
  function bubble(ctx, video, x, y, d, s, state, t) {
    const rad = radOf(s.shape, d), w = Math.max(4, d * .045), ins = w * .8, ir = Math.max(0, rad - ins);
    ctx.save(); ctx.shadowColor = '#000a'; ctx.shadowBlur = d * .08; ctx.shadowOffsetY = d * .02; ctx.fillStyle = '#10151c';
    ctx.beginPath(); ctx.roundRect(x + ins, y + ins, d - 2 * ins, d - 2 * ins, ir); ctx.fill(); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.roundRect(x + ins, y + ins, d - 2 * ins, d - 2 * ins, ir); ctx.clip();
    if (!video || !cover(ctx, video, x + ins, y + ins, d - 2 * ins, d - 2 * ins, s.mirror)) {
      ctx.fillStyle = '#9aa7b4'; ctx.font = (d * .3) + 'px Segoe UI Emoji, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('📷', x + d / 2, y + d / 2);
    }
    ctx.restore();
    ctx.save(); ctx.lineWidth = Math.max(2, d * .008); ctx.strokeStyle = s.color || '#79c0ff'; ctx.globalAlpha = .9; ctx.beginPath(); ctx.roundRect(x + ins * 1.9, y + ins * 1.9, d - 3.8 * ins, d - 3.8 * ins, Math.max(0, rad - ins * 1.9)); ctx.stroke(); ctx.restore();
    ring(ctx, x, y, d, rad, state, t);
  }
  g.WAGRing = { COL, ring, bubble, radOf };
})(window);
