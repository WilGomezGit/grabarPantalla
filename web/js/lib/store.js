// Ajustes persistentes con validación: solo se aceptan claves conocidas y del tipo correcto.
const KEY = 'capturo-web-settings-v1';

export const DEFAULTS = {
  mode: 'screen-cam',        // screen-cam | screen | cam
  target: 'full',            // full | region | window | tab
  micId: 'default',          // null = sin micrófono
  camId: null,
  systemAudio: true,
  ringStyle: 'neon',
  ringEnabled: true,
  bubbleSize: 0.24,
  corner: 'bl',              // bl | br | tl | tr
  mirror: true,
  countdown: true,
  resolution: 'native',      // native | 2160 | 1440 | 1080 | 720 | 480
  fps: 30,
  format: 'mp4',
  quality: 'high',
  pip: true,
  notesEnabled: false,
  notes: '',
};

const SCHEMA = {
  mode: (v) => ['screen-cam', 'screen', 'cam'].includes(v),
  target: (v) => ['full', 'region', 'window', 'tab'].includes(v),
  micId: (v) => v === null || typeof v === 'string',
  camId: (v) => v === null || typeof v === 'string',
  systemAudio: (v) => typeof v === 'boolean',
  ringStyle: (v) => ['neon', 'fire', 'toxic', 'ice', 'rgb'].includes(v),
  ringEnabled: (v) => typeof v === 'boolean',
  bubbleSize: (v) => [0.16, 0.24, 0.34].includes(v),
  corner: (v) => ['bl', 'br', 'tl', 'tr'].includes(v),
  mirror: (v) => typeof v === 'boolean',
  countdown: (v) => typeof v === 'boolean',
  resolution: (v) => ['native', '2160', '1440', '1080', '720', '480'].includes(v),
  fps: (v) => [24, 30, 60].includes(v),
  format: (v) => ['mp4', 'webm'].includes(v),
  quality: (v) => ['standard', 'high', 'max'].includes(v),
  pip: (v) => typeof v === 'boolean',
  notesEnabled: (v) => typeof v === 'boolean',
  notes: (v) => typeof v === 'string' && v.length <= 50000,
};

let data = { ...DEFAULTS };
const listeners = new Set();

export const get = () => data;
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    patch(raw, { silent: true });
  } catch { /* primera vez, archivo dañado o almacenamiento bloqueado: valores por defecto */ }
  return data;
}

function persist() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* almacenamiento bloqueado */ } }

// Devuelve { ok, rejected }. Las claves inválidas se ignoran y nunca contaminan los ajustes.
export function patch(p, { silent = false } = {}) {
  const rejected = [];
  for (const [k, v] of Object.entries(p || {})) {
    if (!SCHEMA[k] || !SCHEMA[k](v)) { if (!silent || k in SCHEMA) rejected.push(k); continue; }
    data[k] = v;
  }
  if (!silent) { persist(); listeners.forEach((fn) => fn(data)); }
  return { ok: rejected.length === 0, rejected };
}
