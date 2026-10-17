// Punto de entrada de Capturo Web
import { $, toast } from './lib/dom.js';
import * as settings from './lib/store.js';
import { checkSupport, unsupportedMessage } from './lib/support.js';
import * as storage from './core/storage.js';
import * as record from './ui/record-view.js';
import * as library from './ui/library-view.js';
import * as editor from './ui/editor-view.js';

function showTab(name) {
  document.querySelectorAll('.tab').forEach((x) => { const on = x.dataset.tab === name; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); });
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === name));
  if (name === 'lib') { record.stopPreview(); record.stopMeter(); library.refresh(); }
  else { record.startPreview(); record.startMeter(); }
}

async function boot() {
  settings.load();
  const support = checkSupport();
  if (!support.ok) { $('unsupported').textContent = unsupportedMessage(support); $('unsupported').hidden = false; }

  library.init({ onEdit: (item) => editor.open(item) });
  editor.init({ onSaved: () => library.refresh() });
  record.init({ supportInfo: support, onSaved: () => library.refresh() });
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  if (support.ok) {
    storage.requestPersistence();                     // evita que el navegador borre las grabaciones al faltar espacio
    await record.loadDevices();
    record.startPreview(); record.startMeter();
  }
  library.refresh();
  window.addEventListener('unhandledrejection', (e) => { console.warn('[sin capturar]', e.reason); });
  window.capturoReady = true;                          // lo usan las pruebas automáticas
}
boot().catch((e) => { console.error(e); toast('No se pudo iniciar la aplicación: ' + e.message, 'error', 10000); });
