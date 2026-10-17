// Aro de luz: paletas + utilidades compartidas (DOM/CSS y canvas).
// Este archivo no depende de Electron, así se reutiliza tal cual en la versión web.
(function (root) {
  const RING_STYLES = {
    neon:  { label: 'Neón',  c1: '#00f0ff', c2: '#ff00e5' },
    fire:  { label: 'Fuego', c1: '#ff3d00', c2: '#ffd600' },
    toxic: { label: 'Tóxico', c1: '#00ff6a', c2: '#d4ff00' },
    ice:   { label: 'Hielo', c1: '#7df9ff', c2: '#7b61ff' },
    rgb:   { label: 'RGB',   rainbow: true, c1: '#ff0055', c2: '#00ffcc' },
  };
  const RAINBOW = ['#ff0040', '#ffae00', '#e8ff00', '#00ff6a', '#00d0ff', '#6a00ff', '#ff00d4', '#ff0040'];

  // Aplica el estilo a un elemento con la clase .ring-wrap (CSS en ring.css).
  function applyRingStyle(el, name) {
    const s = RING_STYLES[name] || RING_STYLES.neon;
    const grad = s.rainbow
      ? `conic-gradient(from 0deg, ${RAINBOW.join(', ')})`
      : `conic-gradient(from 0deg, transparent 0 45%, ${s.c1} 72%, ${s.c2} 94%, #ffffff 100%)`;
    el.style.setProperty('--ring-grad', grad);
    el.style.setProperty('--c1', s.c1);
    el.style.setProperty('--c2', s.c2);
  }

  // Dibuja el aro en un canvas 2D (para el video grabado). t = segundos.
  function drawRing(ctx, cx, cy, r, t, name, speed) {
    const s = RING_STYLES[name] || RING_STYLES.neon;
    const lw = Math.max(3, r * 0.045);
    const rr = r + lw * 0.9;
    const angle = (t * (Math.PI * 2)) / (speed || 2.2);

    // base tenue
    ctx.save();
    ctx.lineWidth = Math.max(1.5, lw * 0.35);
    ctx.strokeStyle = s.rainbow ? 'rgba(255,255,255,.25)' : hexA(s.c1, 0.35);
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    const grad = ctx.createConicGradient(angle, cx, cy);
    if (s.rainbow) {
      RAINBOW.forEach((c, i) => grad.addColorStop(i / (RAINBOW.length - 1), c));
    } else {
      grad.addColorStop(0.00, hexA(s.c1, 0));
      grad.addColorStop(0.45, hexA(s.c1, 0));
      grad.addColorStop(0.72, s.c1);
      grad.addColorStop(0.94, s.c2);
      grad.addColorStop(1.00, '#ffffff');
    }
    // resplandor + trazo nítido
    for (const pass of [{ blur: r * 0.35, w: lw * 1.6 }, { blur: 0, w: lw }]) {
      ctx.save();
      ctx.lineWidth = pass.w;
      ctx.strokeStyle = grad;
      ctx.shadowColor = s.rainbow ? '#ffffff' : s.c1;
      ctx.shadowBlur = pass.blur;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  root.Ring = { RING_STYLES, applyRingStyle, drawRing };
})(typeof window !== 'undefined' ? window : globalThis);
