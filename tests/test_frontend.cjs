const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('static/app.js', 'utf8');
const grid = { innerHTML: '', querySelectorAll: () => [] };
const context = vm.createContext({
  document: { getElementById: () => grid },
  requestAnimationFrame: () => {},
  _logAbiertos: new Set(), _extLogStreams: {},
  buildCita: () => '', ico: () => '',
  esc: text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
  state: { validacion: { anotaciones: [
    { objeto_anotado: 'c_1', nota: 'Glosa', autor_nombre: '<script>autor</script>', creada_en: '2026-11-12' },
    { objeto_anotado: 'c_1', nota: 'Antigua', creada_en: '2026-11-11' },
    { objeto_anotado: 'otro', nota: 'Otro concepto', creada_en: '2026-11-12' },
  ] } },
});
vm.runInContext(source.slice(source.indexOf('function renderBiblioteca('), source.indexOf('let _pollingBiblioteca')), context);
context.renderBiblioteca([{ slug: 'recibido', titulo: 'Recibido', procesado: true, compartido: true }]);
for (const action of ['compartir', 'publicar', 'repro']) {
  assert.match(grid.innerHTML, new RegExp(`bib-btn-${action}`));
}
vm.runInContext(source.slice(source.indexOf('function buildAnnotationPanelHTML('), source.indexOf('function bindPanelListeners(')), context);
const panel = context.buildAnnotationPanelHTML({ id: 'c_1' });
assert.match(panel, /&lt;script>autor&lt;\/script>/);
assert.match(panel, /Autoría no registrada/);
assert.doesNotMatch(panel, /Otro concepto|<script>/);
console.log('OK: acciones en textos recibidos y autoría de glosas escapada.');
