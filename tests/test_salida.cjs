const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/app.js', 'utf8');

async function probar(ultima, confirma, conflicto = false) {
  const llamadas = [], avisos = [], preguntas = [];
  let biblioteca = 0;
  const context = vm.createContext({
    apiFetch: async (url, options) => {
      llamadas.push([url, options]);
      if (!options) return { ultima_persona: ultima };
      if (conflicto) throw Error('409: Ahora eres la última persona. Confirma el borrado definitivo.');
      return { ok: true };
    },
    confirm: texto => { preguntas.push(texto); return confirma; },
    alert: texto => avisos.push(texto),
    mostrarBiblioteca: async () => { biblioteca++; },
    _miniGrafoCache: { timeo: 'previo' },
  });
  vm.runInContext(source.slice(source.indexOf('async function eliminarDeMiBiblioteca('),
                              source.indexOf('let _pollingBiblioteca')), context);
  await context.eliminarDeMiBiblioteca('timeo', 'Timeo');
  assert.match(preguntas[0], ultima ? /borrarán definitivamente/ : /demás personas conservarán/);
  assert.equal(llamadas.length, confirma ? 2 : 1);
  assert.equal(biblioteca, confirma && !conflicto ? 1 : 0);
  if (confirma) {
    assert.equal(llamadas[1][1].method, 'DELETE');
    assert.match(llamadas[1][0], new RegExp(`confirmar_borrado=${ultima}$`));
  }
  assert.equal(avisos.length, conflicto ? 1 : 0);
}

(async () => {
  for (const ultima of [false, true]) {
    await probar(ultima, false);
    await probar(ultima, true);
  }
  await probar(false, true, true);
  assert.match(source, /bib-btn-eliminar[\s\S]*Eliminar de mi biblioteca/);
  console.log('OK: salida compartida, borrado final, cancelación y cambio de última persona.');
})().catch(error => { console.error(error); process.exitCode = 1; });
