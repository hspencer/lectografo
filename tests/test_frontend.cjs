const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { ReadableStream } = require('node:stream/web');

const source = fs.readFileSync('static/app.js', 'utf8');
const grid = { innerHTML: '', querySelectorAll: () => [] };
const context = vm.createContext({
  document: { getElementById: () => grid },
  requestAnimationFrame: () => {},
  buildCita: () => '', ico: () => '',
  esc: text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
  state: { validacion: { anotaciones: [
    { objeto_anotado: 'c_1', nota: 'Glosa', autor_nombre: '<script>autor</script>', creada_en: '2026-11-12' },
    { objeto_anotado: 'c_1', nota: 'Antigua', creada_en: '2026-11-11' },
    { objeto_anotado: 'otro', nota: 'Otro concepto', creada_en: '2026-11-12' },
  ] } },
});
vm.runInContext(source.slice(source.indexOf('function _menuBiblioteca('), source.indexOf('let _pollingBiblioteca')), context);
context.renderBiblioteca([{ slug: 'recibido', titulo: 'Recibido', procesado: true, compartido: true }]);
for (const action of ['compartir', 'publicar', 'repro', 'fusionar', 'simplificar']) {
  assert.match(grid.innerHTML, new RegExp(`bib-btn-${action}`));
}
assert.match(grid.innerHTML, /bib-btn-acceso/);
assert.doesNotMatch(grid.innerHTML, /Compartido por/);
assert.match(grid.innerHTML, /<hr[^>]*>[\s\S]*Operaciones en el grafo/);
const html = fs.readFileSync('static/index.html', 'utf8');
assert.doesNotMatch(html, /id="btn-consolidar"|id="btn-simplificar-grafo"/);
context.renderBiblioteca([{ slug: 'nuevo', titulo: 'Nuevo', procesado: false }]);
assert.match(grid.innerHTML, /menu-acciones-item btn-procesar/);
assert.doesNotMatch(grid.innerHTML, /bib-btn-fusionar|bib-btn-simplificar/);
context.renderBiblioteca([{ slug: 'nuevo', titulo: 'Nuevo', procesado: false, procesando: true, texto_llm: 'detalle privado del modal' }]);
assert.match(grid.innerHTML, /bib-btn-progreso/);
assert.doesNotMatch(grid.innerHTML, /detalle privado del modal|bib-log-panel/);
vm.runInContext(source.slice(source.indexOf('function buildAnnotationPanelHTML('), source.indexOf('function bindPanelListeners(')), context);
const panel = context.buildAnnotationPanelHTML({ id: 'c_1' });
assert.match(panel, /&lt;script>autor&lt;\/script>/);
assert.match(panel, /Autoría no registrada/);
assert.doesNotMatch(panel, /Otro concepto|<script>/);
console.log('OK: acciones en textos recibidos y autoría de glosas escapada.');

async function probarModal() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      hidden: true, textContent: '', disabled: false, style: {},
      classList: { add() {}, remove() {} }, focus() {},
      scrollHeight: 0, scrollTop: 0, clientHeight: 0,
    });
    return elements.get(id);
  }
  let completar;
  const pendiente = new Promise(resolve => { completar = resolve; });
  let detener = 0, continuar = 0;
  const uiContext = vm.createContext({
    document: { getElementById: element, activeElement: { focus() {} } },
    state: {}, TextDecoder, window: {},
  });
  vm.runInContext(source.slice(source.indexOf('let _iaTarea ='), source.indexOf('async function publicarDocumento(')), uiContext);
  uiContext.abrirTareaIA({
    titulo: 'Fusionar conceptos', detener: async () => { detener++; },
    continuar: () => { continuar++; },
    ejecutar: async ui => { ui.append('detalle '.repeat(5000)); await pendiente; return 'Completado'; },
  });
  assert.equal(element('repro-modal').hidden, false);
  assert.equal(element('repro-modal-cerrar').disabled, true);
  uiContext._reproCerrar();
  assert.equal(element('repro-modal').hidden, false, 'No se cierra una tarea activa');
  await element('repro-btn-detener').onclick();
  assert.equal(detener, 1);
  assert.equal(element('repro-btn-cerrar').hidden, true, 'Cancelar espera confirmación del servidor');
  completar();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(element('repro-log').textContent, /detalle /);
  assert.ok(element('repro-log').textContent.length > 35000, 'Se conserva todo el log');
  assert.equal(element('repro-estado-proc').hidden, false, 'El log sigue visible al terminar');
  assert.equal(element('repro-btn-cerrar').hidden, false);
  uiContext._reproCerrar();
  assert.equal(continuar, 1);
  assert.equal(element('repro-modal').hidden, true);
  uiContext.abrirTareaIA({ titulo: 'Error', ejecutar: async () => { throw new Error('Proveedor caído'); } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element('repro-fin-msg').textContent, 'Proveedor caído');
  assert.equal(element('repro-progress-inner').style.width, '0%');
  uiContext._reproCerrar();

  const texto = 'data: {"chunk":"Análisis ñ"}\n\ndata: {"tokens":8}\n\ndata: {"done":true}\n\n';
  const bytes = new TextEncoder().encode(texto);
  uiContext.apiFetch = async () => ({ body: new ReadableStream({ start(c) {
    for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
    c.close();
  } }) });
  const eventos = [];
  await uiContext._streamSimplificacion('lectura', { progreso: d => eventos.push(d) });
  assert.equal(eventos[0].chunk, 'Análisis ñ', 'Acepta cortes entre bytes UTF-8');
  assert.equal(eventos.at(-1).done, true);
  uiContext.apiFetch = async () => ({ body: new ReadableStream({ start(c) { c.close(); } }) });
  await assert.rejects(() => uiContext._streamSimplificacion('lectura', { progreso() {} }), /sin confirmar/);
  let conexion, reinicios = 0;
  uiContext.EventSource = class {
    constructor() { conexion = this; this.readyState = 0; }
    close() { this.readyState = 2; }
  };
  const stream = uiContext._streamTareaIA('/stream', { reset: () => { reinicios++; }, progreso() {} });
  await new Promise(resolve => setImmediate(resolve));
  conexion.onopen();
  conexion.onerror();
  assert.notEqual(conexion.readyState, 2, 'Un corte transitorio permite reconectar');
  conexion.onopen();
  assert.equal(reinicios, 1, 'El log reenviado no se duplica');
  conexion.onmessage({ data: '{"done":true}' });
  await stream;
  const cfg = { api: slug => `/api/grafo/${slug}/consolidacion` };
  const rutas = [];
  let consultas = 0, abierto = null, revisado = false;
  uiContext.SESION_CONSOLIDACION = cfg;
  uiContext.apiFetch = async (path, opts = {}) => {
    rutas.push(path);
    if (path.endsWith('/sesion')) {
      if (!consultas++) throw new Error('404: Sin sesión');
      return { estado: 'en_revision', propuestas: [] };
    }
    return { ok: true };
  };
  uiContext._streamTareaIA = async () => ({ done: true });
  uiContext.abrirTexto = async slug => { abierto = slug; uiContext.state.slug = slug; };
  uiContext.renderPanelSesion = () => { revisado = true; };
  vm.runInContext(source.slice(source.indexOf('async function abrirPanelSesion('), source.indexOf('function renderPanelSesion(')), uiContext);
  await uiContext.abrirPanelSesion(cfg, 'recibido');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(rutas.every(path => path.includes('/recibido/')), 'La operación usa el texto de la tarjeta');
  await uiContext._reproCerrar();
  assert.equal(abierto, 'recibido');
  assert.equal(revisado, true, 'La fusión pasa del modal al grafo para revisión');
  console.log('OK: modal activo, cancelación, errores y registro SSE completo.');
}
probarModal().catch(err => { console.error(err); process.exitCode = 1; });
