const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/app.js', 'utf8');

async function main() {
  const elementos = new Map();
  const elemento = id => {
    if (!elementos.has(id)) elementos.set(id, { hidden: true, textContent: '' });
    return elementos.get(id);
  };
  const llamadas = [];
  let destino, inicios = 0;
  const context = vm.createContext({
    window: { lectografoAuth: { uid: null } },
    document: { getElementById: elemento },
    location: { pathname: '/', hash: '#invitacion:token' },
    history: { replaceState: (_, __, url) => { destino = url; } },
    init: async () => { inicios++; },
    apiFetch: async (path, opts = {}) => {
      llamadas.push([path, opts.method || 'GET']);
      return path.includes('/publico/')
        ? { titulo: 'Timeo', email: 'invitada@example.org', invitado_por: 'Herbert' }
        : { slug: 'timeo', titulo: 'Timeo' };
    },
  });
  vm.runInContext(source.slice(source.indexOf('async function abrirInvitacion('), source.indexOf('let _sesionIniciada')), context);
  await context.abrirInvitacion('token');
  assert.match(elemento('auth-gate-mensaje').textContent, /invitada@example.org/);
  assert.equal(elemento('auth-gate').hidden, false);
  assert.equal(llamadas.length, 1, 'Antes de autenticarse solo consulta la invitación');
  context.window.lectografoAuth = { uid: 'otra', email: 'otra@example.org' };
  await context.abrirInvitacion('token');
  assert.match(elemento('auth-gate-mensaje').textContent, /Elige la cuenta invitada/);
  assert.ok(llamadas.every(([, method]) => method === 'GET'));
  context.window.lectografoAuth = { uid: 'correcta', email: 'INVITADA@example.org' };
  await context.abrirInvitacion('token');
  assert.equal(destino, '/#timeo');
  assert.equal(elemento('auth-gate').hidden, true);
  assert.deepEqual(llamadas.at(-1), ['/api/invitaciones/token/aceptar', 'POST']);
  assert.equal(inicios, 1);

  vm.runInContext(source.slice(source.indexOf('let _sesionIniciada'), source.indexOf('window.addEventListener("lectografo:auth-listo"')), context);
  inicios = 0;
  context.location.hash = '';
  context.window.lectografoAuth = { uid: null };
  await context.iniciarConSesion();
  assert.equal(inicios, 0);
  context.window.lectografoAuth = { uid: 'registrada' };
  await Promise.all([context.iniciarConSesion(), context.iniciarConSesion()]);
  assert.equal(inicios, 1, 'El primer login inicia la app una sola vez, sin recargar');
  context.window.lectografoAuth = { uid: null };
  await context.iniciarConSesion();
  context.window.lectografoAuth = { uid: 'registrada' };
  await context.iniciarConSesion();
  assert.equal(inicios, 2, 'Volver a ingresar con la misma cuenta reinicia la app');
  console.log('OK: invitación antes del login, cuenta equivocada y destino tras autenticarse.');
}
main().catch(err => { console.error(err); process.exitCode = 1; });
