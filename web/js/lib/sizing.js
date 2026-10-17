// Tamaños de salida y bitrate (mismas reglas que la app de escritorio)
export const RES_BOX = { 2160: [3840, 2160], 1440: [2560, 1440], 1080: [1920, 1080], 720: [1280, 720], 480: [854, 480] };
export const BPP = { standard: 0.06, high: 0.10, max: 0.16 };
export const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// Ajusta (sw × sh) a la caja de la resolución elegida conservando la proporción (puede reescalar hacia arriba).
export function targetSize(sw, sh, res) {
  if (res === 'native' || !RES_BOX[res]) return [even(sw), even(sh)];
  const box = RES_BOX[res], land = sw >= sh;
  const bw = land ? box[0] : box[1], bh = land ? box[1] : box[0];
  const k = Math.min(bw / sw, bh / sh);
  return [even(sw * k), even(sh * k)];
}
export const bitrateFor = (w, h, fps, quality) => Math.round(Math.min(45e6, Math.max(2e6, w * h * fps * (BPP[quality] || BPP.high))));
