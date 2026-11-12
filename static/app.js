// ════════════════════════════════════════════════════════════════════════
// Estado global
// ════════════════════════════════════════════════════════════════════════
const state = {
  slug:        null,
  validacion:  null,
  grafo:       null,
  tabActivo:   "mapa",
  grafoUpdate: null,   // fn updateVisuals() exportada por initGrafo/initGrafo3D
  grafoHighlight: null, // fn highlightPath() exportada por initGrafo/initGrafo3D
  grafoCenter: null,   // fn centerOnNode(nodeId) del renderer activo
  grafoPan:    null,   // fn panBy(dx, dy) del renderer activo
  grafoFit:    null,   // fn fitView() del renderer activo
  grafoDestroy: null,  // fn destroy() del renderer 3D activo (null en modo 2D)
  modo3d:      true,   // vista activa del mapa: 2D (D3/SVG) o 3D (three.js) — 3D por defecto
  mapaCards:   null,   // instancia activa de createFloatingCards (tarjetas del Mapa)
  soloLectura: false,  // vista pública (#publico:ID): sin sesión, sin escritura
  pubId:       null,   // id de publicación activo cuando soloLectura
};

const tabsInit = new Set();
const conceptosState  = { sort:{ col:"menciones", dir:"desc" }, filtroTipo:"todos", busqueda:"", seleccionados: new Set() };
const relacionesState = { sort:{ col:"confianza",  dir:"desc" }, filtroTipo:"todos", busqueda:"" };
let relacionExpandidaId = null;
let conceptosListeners = false;
let relacionesListeners = false;

// ════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════
function _formatElapsed(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Feather icon helper — returns inline SVG string
function ico(name, size=14) {
  const P = {
    "book-a":         `<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/><path d="m8 13 4-7 4 7"/><path d="M9.1 11h5.7"/>`,
    "check":          `<polyline points="20 6 9 17 4 12"/>`,
    "corner-up-left": `<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>`,
    "edit-2":         `<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>`,
    "graph-star":     `<path d="m12.342 9.316 1.764-3.527"/><path d="m12.59 14.545 2.35 3.759"/><path d="m13.982 12.332 4.03.447"/><path d="M5.414 17.586 8.88 14.12"/><path d="M9.025 9.742 5.317 5.505"/><circle cx="11" cy="12" r="3"/><circle cx="15" cy="4" r="2"/><circle cx="16" cy="20" r="2"/><circle cx="20" cy="13" r="2"/><circle cx="4" cy="19" r="2"/><circle cx="4" cy="4" r="2"/>`,
    "link":           `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
    "notebook-pen":   `<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>`,
    "maximize-2":     `<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>`,
    "more-vertical":  `<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>`,
    "refresh-cw":     `<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>`,
    "skip-forward":   `<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>`,
    "terminal":       `<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>`,
    "trash-2":        `<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>`,
    "users":          `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
    "x":              `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
    "x-circle":       `<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>`,
    "zap":            `<polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]||""}</svg>`;
}

// Menú de acciones (⋮) de las tarjetas de biblioteca: un solo listener
// global cierra cualquier menú abierto al hacer clic afuera o Escape.
function cerrarMenusAcciones() {
  document.querySelectorAll(".menu-acciones-drop").forEach(d => d.hidden = true);
  document.querySelectorAll(".bib-acceso-lista").forEach(d => d.hidden = true);
  document.querySelectorAll(".bib-btn-acceso").forEach(b => b.setAttribute("aria-expanded", "false"));
}
document.addEventListener("click", cerrarMenusAcciones);
document.addEventListener("keydown", e => { if (e.key === "Escape") cerrarMenusAcciones(); });

// ════════════════════════════════════════════════════════════════════════
// API helpers
// ════════════════════════════════════════════════════════════════════════
// EventSource no admite headers custom; el token va como query param
// (el backend lo acepta como fallback -- ver contexto_biblioteca.py).
function sseUrl(path) {
  const t = window.lectografoAuth?.idToken;
  if (!t) return path;
  return `${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(t)}`;
}
// Vista pública de solo lectura (#publico:ID, ver abrirTextoPublico): no hay
// sesión ni biblioteca propia, así que las 3 lecturas que la vista necesita
// se redirigen a su equivalente público; cualquier escritura se corta acá
// además de no tener botón que la dispare.
function _rutaPublica(path) {
  const m = path.match(/^\/api\/(validacion|grafo|transcripts)\/[^/?]+$/);
  return m ? `/api/publico/${state.pubId}/${m[1]}` : path;
}

async function apiFetch(path, opts={}, raw=false) {
  if (state.soloLectura) {
    if (opts.method && opts.method !== "GET") throw new Error("Vista de solo lectura");
    path = _rutaPublica(path);
  }
  const headers = { "Content-Type":"application/json", ...(opts.headers||{}) };
  const token = await window.lectografoAuth?.getIdToken?.();
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(path, { ...opts, headers });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return raw ? r : r.json();
}
async function cargarGrafo() {
  state.grafo = await apiFetch(`/api/grafo/${encodeURIComponent(state.slug)}`);
  // Toda carga de grafo implica un posible cambio — invalidar miniatura
  if (state.slug) delete _miniGrafoCache[state.slug];
}

// ════════════════════════════════════════════════════════════════════════
// Tab switching
// ════════════════════════════════════════════════════════════════════════
function activarTab(nombre) {
  state.tabActivo = nombre;
  document.querySelectorAll(".tab-btn").forEach(b=>b.classList.toggle("active",b.dataset.tab===nombre));
  document.querySelectorAll(".tab-panel").forEach(p=>{ p.hidden = p.id!==`tab-${nombre}`; });
  if (nombre === "texto" && state.slug) { if (!_textoModoEdicion) initTab("texto"); return; }
  if (!tabsInit.has(nombre) && state.slug) { tabsInit.add(nombre); initTab(nombre); }
}
async function initTab(nombre) {
  if (nombre==="mapa")        await initMapa();
  if (nombre==="conceptos")   await initConceptos();
  if (nombre==="relaciones")  await initRelaciones();
  if (nombre==="texto")       await initTexto();
}

// ════════════════════════════════════════════════════════════════════════
// Boot
// ════════════════════════════════════════════════════════════════════════
async function init() {
  const h = location.hash.slice(1);
  if (h.startsWith("publico:")) {
    // Vista pública: ni biblioteca ni sesión -- no se llama /api/extracciones.
    await abrirTextoPublico(h.slice(8));
    initMapaArrows();
    return;
  }
  const exts = await apiFetch("/api/extracciones");
  initSettingsPanel();
  if (h === "config") {
    await mostrarBiblioteca(exts);
    abrirConfig();
  } else if (h && exts.find(e => e.slug === h)) {
    await abrirTexto(h);
  } else {
    await mostrarBiblioteca(exts);
  }
  initFichaModal();
  initMapaArrows();
}

// Navegación del mapa con flechas del teclado
function initMapaArrows() {
  const STEP = 60;
  document.addEventListener("keydown", ev => {
    if (state.tabActivo !== "mapa") return;
    if (!document.getElementById("repro-modal").hidden) return;
    if (!state.grafoPan) return;
    // No interceptar si el foco está en un campo de texto
    if (["INPUT","TEXTAREA","SELECT"].includes(ev.target.tagName)) return;
    let dx = 0, dy = 0;
    if (ev.key === "ArrowLeft")  dx = -STEP;
    if (ev.key === "ArrowRight") dx =  STEP;
    if (ev.key === "ArrowUp")    dy =  STEP;
    if (ev.key === "ArrowDown")  dy = -STEP;
    if (!dx && !dy) return;
    ev.preventDefault();
    state.grafoPan(dx, dy);
  });
}

// ════════════════════════════════════════════════════════════════════════
// Biblioteca (vista primaria)
// ════════════════════════════════════════════════════════════════════════
async function mostrarBiblioteca(extData) {
  const exts = extData ?? await apiFetch("/api/extracciones");

  _aplicarFaviconDefault();

  // Topbar: modo biblioteca
  document.getElementById("btn-biblioteca").hidden = true;
  document.getElementById("tabs").hidden = true;
  document.getElementById("topbar-chevron").hidden = true;
  document.getElementById("mapa-buscar-wrap").hidden = true;
  document.getElementById("transcripcion-titulo").textContent = "";

  // Ocultar paneles de texto, mostrar biblioteca
  document.querySelectorAll(".tab-panel").forEach(p => { p.hidden = true; });
  document.getElementById("vista-biblioteca").hidden = false;

  // Arrancar polling si hay algo procesando
  if (exts.some(e => e.procesando)) _arrancarPolling();

  // Reset estado de texto
  state.grafoDestroy?.();
  state.grafoDestroy = null;
  state.slug = null;
  state.validacion = null;
  state.grafo = null;
  state.grafoUpdate = null;
  state.grafoHighlight = null;
  state.grafoCenter = null;
  state.grafoPan = null;
  state.tabActivo = null;
  state.mapaCards?.closeAll();
  state.mapaCards = null;
  tabsInit.clear();

  history.replaceState(null, "", location.pathname);
  renderBiblioteca(exts);
}

function _menuBiblioteca(e) {
  const slug = esc(e.slug), titulo = esc(e.titulo);
  return `<div class="menu-acciones">
    <button class="btn-inline bib-btn-menu" data-slug="${slug}" title="Acciones">${ico("more-vertical")}</button>
    <div class="menu-acciones-drop" hidden>
      <button class="menu-acciones-item bib-btn-ficha" data-slug="${slug}">${ico("edit-2")} Ficha</button>
      ${e.procesado ? `
        <button class="menu-acciones-item bib-btn-compartir" data-slug="${slug}" data-titulo="${titulo}">${ico("users")} Compartir</button>
        <button class="menu-acciones-item bib-btn-publicar" data-slug="${slug}" data-titulo="${titulo}" data-publicado="0">${ico("link")} Publicar</button>` : ""}
      <hr class="menu-acciones-separador">
      <span class="menu-acciones-rotulo">Operaciones en el grafo</span>
      ${e.procesando
        ? `<button class="menu-acciones-item bib-btn-progreso" data-slug="${slug}">Ver progreso IA</button>`
        : e.procesado ? `
          <button class="menu-acciones-item bib-btn-repro" data-slug="${slug}">Reprocesar texto</button>
          <button class="menu-acciones-item bib-btn-fusionar" data-slug="${slug}">Fusionar conceptos</button>
          <button class="menu-acciones-item bib-btn-simplificar" data-slug="${slug}">Simplificar grafo</button>`
        : `<button class="menu-acciones-item btn-procesar" data-slug="${slug}">Procesar texto</button>`}
    </div>
  </div>`;
}

function renderBiblioteca(exts) {
  const grid = document.getElementById("biblioteca-grid");

  // Preservar SVGs de minimaps ya renderizados para evitar parpadeo en cada polling
  const _svgSalvados = {};
  grid.querySelectorAll(".bib-mini-mapa[data-slug]").forEach(el => {
    if (el.childElementCount > 0) _svgSalvados[el.dataset.slug] = el.innerHTML;
  });

  if (!exts.length) {
    grid.innerHTML = `<div class="bib-vacia">
      <div class="bib-vacia-icono">☁</div>
      <p>No hay textos disponibles.</p>
      <p class="muted">Añade archivos <code>.txt</code> a la carpeta <code>transcripts/</code>.</p>
    </div>`;
    return;
  }

  grid.innerHTML = exts.map(e => {
    if (!e.procesado) {
      if (e.procesando) {
        return `<div class="bib-card bib-card-procesando">
          ${_menuBiblioteca(e)}
          <div class="bib-card-inner">
            <div class="bib-card-titulo">${esc(e.titulo)}</div>
            <div class="bib-progress-indeterminate"></div>
            <span class="muted">Procesando con IA…</span>
          </div>
        </div>`;
      }
      const errorMsg = e.error ? `<span class="bib-error">${esc(e.error.replace("error:",""))}</span>` : "";
      const citaSP = e.metadatos ? buildCita(e.metadatos) : "";
      return `<div class="bib-card bib-card-sin-procesar">
        ${_menuBiblioteca(e)}
        <div class="bib-card-inner">
          <div class="bib-card-titulo">${esc(e.titulo)}</div>
          ${citaSP ? `<div class="bib-card-cita muted">${esc(citaSP)}</div>` : ""}
          ${errorMsg}
          <div class="bib-card-meta">
            <span class="bib-fase bib-fase-sin_validar">Sin procesar</span>
          </div>
        </div>
      </div>`;
    }

    // Transcript ya extraído — card clicable con footer de acciones
    const citaCard = e.metadatos ? buildCita(e.metadatos) : "";

    return `<div class="bib-card" data-slug="${esc(e.slug)}">
      <div class="bib-mini-mapa bib-card-click" data-slug="${esc(e.slug)}"></div>
      ${_menuBiblioteca(e)}
      <div class="bib-card-click bib-card-body">
        <div class="bib-card-titulo">${esc(e.titulo)}</div>
        <div class="bib-acceso">
          <button class="btn-inline bib-btn-acceso" data-slug="${esc(e.slug)}" aria-label="Personas con acceso" aria-expanded="false">${ico("users",14)}</button>
          <div class="bib-acceso-lista" hidden></div>
        </div>
        ${citaCard
          ? `<div class="bib-card-cita muted">${esc(citaCard)}</div>`
          : `<div class="bib-card-cita muted bib-sin-ficha">Sin ficha bibliográfica</div>`}
      </div>
    </div>`;
  }).join("");

  // Clic en área principal de tarjeta → abrir texto
  grid.querySelectorAll(".bib-card-click").forEach(el =>
    el.addEventListener("click", () => abrirTexto(el.closest(".bib-card").dataset.slug))
  );

  // Botones procesar para transcripts aún no extraídos
  grid.querySelectorAll(".btn-procesar[data-slug]").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); procesarTexto(btn.dataset.slug); })
  );

  // Ficha bibliográfica
  grid.querySelectorAll(".bib-btn-ficha").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); abrirFichaModal(btn.dataset.slug); })
  );

  // Re-procesar
  grid.querySelectorAll(".bib-btn-repro").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); reprocesarDesdeLibreria(btn.dataset.slug); })
  );

  grid.querySelectorAll(".bib-btn-fusionar").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); abrirPanelSesion(SESION_CONSOLIDACION, btn.dataset.slug); })
  );
  grid.querySelectorAll(".bib-btn-simplificar").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); _simplificarConModal(btn.dataset.slug); })
  );

  // Listado de personas con acceso
  grid.querySelectorAll(".bib-btn-acceso").forEach(btn => {
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      const lista = btn.nextElementSibling;
      const abrir = lista.hidden;
      cerrarMenusAcciones();
      if (!abrir) return;
      btn.setAttribute("aria-expanded", "true");
      lista.hidden = false;
      lista.textContent = "Cargando personas…";
      try {
        const { emails } = await apiFetch(`/api/compartir/${encodeURIComponent(btn.dataset.slug)}`);
        lista.innerHTML = `<strong>Personas con acceso</strong><ul>${emails.map(email => `<li>${esc(email)}</li>`).join("")}</ul>`;
      } catch (err) {
        lista.textContent = `No se pudo cargar: ${err.message}`;
      }
    });
    btn.nextElementSibling.addEventListener("click", e => e.stopPropagation());
  });

  // Compartir con otra persona
  grid.querySelectorAll(".bib-btn-compartir").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); compartirDocumento(btn.dataset.slug, btn.dataset.titulo); })
  );

  // Publicar / despublicar
  grid.querySelectorAll(".bib-btn-publicar").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); publicarDocumento(btn.dataset.slug, btn.dataset.titulo, btn); })
  );

  // Menú de acciones (⋮): abrir/cerrar, y cerrar al elegir una acción
  grid.querySelectorAll(".bib-btn-menu").forEach(btn => {
    const drop = btn.nextElementSibling;
    drop.addEventListener("click", e => e.stopPropagation());  // menú vive sobre el minimapa clicable
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const abrir = drop.hidden;
      cerrarMenusAcciones();
      drop.hidden = !abrir;
    });
    drop.querySelectorAll(".menu-acciones-item").forEach(item =>
      item.addEventListener("click", () => { drop.hidden = true; })
    );
  });

  grid.querySelectorAll(".bib-btn-progreso").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); _procesarConModal(btn.dataset.slug, null); })
  );

  // Restaurar SVGs salvados — evita parpadeo durante polling
  Object.entries(_svgSalvados).forEach(([slug, svg]) => {
    const el = grid.querySelector(`.bib-mini-mapa[data-slug="${CSS.escape(slug)}"]`);
    if (el && el.childElementCount === 0) el.innerHTML = svg;
  });

  // Mini-mapas para textos ya procesados que aún no tienen SVG
  const slugsProcesados = exts.filter(x => x.procesado && !x.procesando).map(x => x.slug);
  if (slugsProcesados.length) requestAnimationFrame(() => _renderMiniGrafos(slugsProcesados));
}

let _pollingBiblioteca = null;
const _miniGrafoCache = {};         // slug → { nodes, links } ya cargado

// ── Mini-mapa en tarjetas de biblioteca ────────────────────────────────
const REL_PALETTE_MINI = [
  "#2a6da1","#7b4899","#c07030","#166e5a","#ae2d13","#2a6e40","#8a6012","#5c5049","#3d6b6b"
];

// Cache persistente (localStorage) del SVG ya armado: evita re-correr la
// simulación D3 -- cara -- en cada carga si la topología (qué nodos existen
// y cómo se conectan) no cambió. Edits de label/confianza no invalidan.
function _topoFingerprint(nodes, links) {
  const s = nodes.map(n => n.id).sort().join(",") + "|"
    + links.map(l => `${l.source}>${l.target}`).sort().join(",");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}
function _miniSvgCacheKey(slug) { return `lectografo:minimapa:${slug}`; }
function _cargarMiniSvgCache(slug) {
  try { return JSON.parse(localStorage.getItem(_miniSvgCacheKey(slug))); }
  catch { return null; }
}
function _guardarMiniSvgCache(slug, fp, svgEl) {
  try {
    const html = new XMLSerializer().serializeToString(svgEl);
    localStorage.setItem(_miniSvgCacheKey(slug), JSON.stringify({ fp, html }));
  } catch { /* localStorage lleno o deshabilitado: no es crítico */ }
}

// Construye la malla de aristas coloreadas de un grafo, como elemento SVG
// desconectado del DOM (S×S). Reutilizado por las tarjetas de biblioteca y
// por el favicon dinámico. Devuelve null si no hay nada que dibujar.
async function _construirMallaSVG(rawNodes, rawLinks, S, { maxNodes = 150, porGrado = false, dedupePares = false } = {}) {
  if (!rawNodes?.length) return null;
  const d3 = await import("https://cdn.jsdelivr.net/npm/d3@7/+esm");

  // Solo nodos conectados (misma lógica que grafo.js)
  const rNById = Object.fromEntries(rawNodes.map(n => [n.id, n]));
  const validLinks = rawLinks.filter(l => rNById[l.source] && rNById[l.target]);
  const connectedIds = new Set(validLinks.flatMap(l => [l.source, l.target]));
  let candidatos = rawNodes.filter(n => connectedIds.has(n.id));
  if (porGrado) {
    // A escala de ícono, mostrar los nodos más conectados da una malla más
    // legible que un corte arbitrario del orden de llegada.
    const grado = {};
    validLinks.forEach(l => {
      grado[l.source] = (grado[l.source] || 0) + 1;
      grado[l.target] = (grado[l.target] || 0) + 1;
    });
    candidatos = [...candidatos].sort((a, b) => (grado[b.id] || 0) - (grado[a.id] || 0));
  }
  const nodes = candidatos.slice(0, maxNodes).map(n => ({ ...n }));
  if (!nodes.length) return null;
  const byId  = Object.fromEntries(nodes.map(n => [n.id, n]));
  let links = validLinks.filter(l => byId[l.source] && byId[l.target]).map(l => ({ ...l }));
  if (dedupePares) {
    // A escala de ícono, varias relaciones paralelas entre el mismo par se
    // dibujan literalmente superpuestas — con una basta para insinuar la malla.
    const vistos = new Set();
    links = links.filter(l => {
      const par = [l.source, l.target].sort().join("~");
      if (vistos.has(par)) return false;
      vistos.add(par);
      return true;
    });
  }

  const relTypes = [...new Set(links.map(l => l.tipo || "_"))];
  const relColor = t => REL_PALETTE_MINI[relTypes.indexOf(t) % REL_PALETTE_MINI.length] || "#888";

  // Layout: simulación sincrónica con repulsión fuerte para que llene el espacio
  const sim = d3.forceSimulation(nodes)
    .force("link",    d3.forceLink(links).id(d => d.id).distance(S * 0.15).strength(0.5))
    .force("charge",  d3.forceManyBody().strength(-S * 0.8))
    .force("center",  d3.forceCenter(S / 2, S / 2))
    .stop();
  for (let i = 0; i < 450; i++) sim.tick();

  // Normalizar al cuadrado con margen uniforme
  const pad = S * 0.08;
  const xs  = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const x0  = Math.min(...xs), x1 = Math.max(...xs);
  const y0  = Math.min(...ys), y1 = Math.max(...ys);
  const sc  = Math.min((S - pad*2) / (x1 - x0 || 1), (S - pad*2) / (y1 - y0 || 1));
  const ox  = S/2 - sc * (x0 + x1) / 2;
  const oy  = S/2 - sc * (y0 + y1) / 2;
  const px  = n => Math.round(ox + sc * n.x);
  const py  = n => Math.round(oy + sc * n.y);

  // SVG con viewBox cuadrado — coordenadas enteras para nitidez
  const ns  = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${S} ${S}`);
  svg.setAttribute("width",  S);
  svg.setAttribute("height", S);
  svg.style.cssText = "display:block;";

  links.forEach(l => {
    const s = byId[l.source?.id ?? l.source];
    const t = byId[l.target?.id ?? l.target];
    if (!s || !t) return;
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", px(s)); line.setAttribute("y1", py(s));
    line.setAttribute("x2", px(t)); line.setAttribute("y2", py(t));
    line.setAttribute("stroke",       relColor(l.tipo));
    line.setAttribute("stroke-width", "1.5");
    svg.appendChild(line);
  });

  return svg;
}

const _miniGrafoEnProgreso = new Set();  // slugs cuya construcción async ya está en vuelo

async function _renderMiniGrafos(slugs) {
  for (const slug of slugs) {
    const container = document.querySelector(`.bib-mini-mapa[data-slug="${CSS.escape(slug)}"]`);
    if (!container || container.childElementCount > 0) continue;
    // El polling llama a esto cada 1200ms; en un grafo denso la construcción
    // (fetch + simulación d3) puede tardar más que eso. Sin esta guardia
    // sincrónica, dos llamadas superpuestas pasan ambas el check de arriba
    // -- cada una de novo-sheets, luego ambas appendChild sobre el mismo
    // contenedor final cuando el polling se detiene: el grafo queda duplicado.
    if (_miniGrafoEnProgreso.has(slug)) continue;
    _miniGrafoEnProgreso.add(slug);

    try {
      if (!_miniGrafoCache[slug]) {
        _miniGrafoCache[slug] = await apiFetch(`/api/grafo/${encodeURIComponent(slug)}`);
      }
      const { nodes: rawNodes, links: rawLinks } = _miniGrafoCache[slug];
      const fp = _topoFingerprint(rawNodes, rawLinks);
      const cached = _cargarMiniSvgCache(slug);
      if (cached && cached.fp === fp) {
        // Misma topología que la última vez: reusar el SVG ya armado, sin
        // volver a correr la simulación D3 (cara) ni reimportarla.
        container.innerHTML = cached.html;
        continue;
      }
      // Cuadrado: el contenedor tiene aspect-ratio:1, pero leemos el ancho real
      const S = container.clientWidth || 260;
      const svg = await _construirMallaSVG(rawNodes, rawLinks, S);
      // replaceChildren, no appendChild: si algo más ya dejó contenido acá
      // (restoreSvgs, otra pasada), no se apila -- un contenedor, un grafo.
      if (svg) { container.replaceChildren(svg); _guardarMiniSvgCache(slug, fp, svg); }
    } catch(_) { /* ignorar errores por tarjeta */ }
    finally { _miniGrafoEnProgreso.delete(slug); }
  }
}

// ── Favicon dinámico: minimapa del texto abierto ────────────────────────
const FAVICON_S = 64;
const FAVICON_MAX_NODES = 9;    // a escala de ícono, menos nodos = malla más legible
const FAVICON_OPTS = { maxNodes: FAVICON_MAX_NODES, porGrado: true, dedupePares: true };

function _svgAFaviconHref(svg) {
  const ns = "http://www.w3.org/2000/svg";
  const bg = document.createElementNS(ns, "rect");
  bg.setAttribute("width", FAVICON_S);
  bg.setAttribute("height", FAVICON_S);
  bg.setAttribute("rx", FAVICON_S * 0.18);
  bg.setAttribute("fill", "#f4f2ed");
  svg.insertBefore(bg, svg.firstChild);
  svg.querySelectorAll("line").forEach(l => l.setAttribute("stroke-width", "2.5"));
  const xml = new XMLSerializer().serializeToString(svg);
  return "data:image/svg+xml," + encodeURIComponent(xml);
}

function _aplicarFaviconHref(href) {
  const link = document.getElementById("favicon");
  if (link) link.href = href;
}

// Malla abstracta fija — favicon por defecto cuando no hay un texto abierto.
function _faviconDefaultSVG() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${FAVICON_S} ${FAVICON_S}`);
  svg.setAttribute("width",  FAVICON_S);
  svg.setAttribute("height", FAVICON_S);
  const pts = [[14,18],[40,10],[54,26],[46,50],[22,54],[8,38],[30,32]];
  const edges = [[0,1],[1,2],[2,3],[3,4],[4,5],[5,0],[0,6],[2,6],[4,6],[1,3]];
  edges.forEach(([a, b], i) => {
    const [x1, y1] = pts[a], [x2, y2] = pts[b];
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", x1); line.setAttribute("y1", y1);
    line.setAttribute("x2", x2); line.setAttribute("y2", y2);
    line.setAttribute("stroke", REL_PALETTE_MINI[i % REL_PALETTE_MINI.length]);
    svg.appendChild(line);
  });
  return svg;
}

function _aplicarFaviconDefault() {
  _aplicarFaviconHref(_svgAFaviconHref(_faviconDefaultSVG()));
}

async function _actualizarFaviconParaTexto(slug) {
  try {
    if (!_miniGrafoCache[slug]) {
      _miniGrafoCache[slug] = await apiFetch(`/api/grafo/${encodeURIComponent(slug)}`);
    }
    const { nodes: rawNodes, links: rawLinks } = _miniGrafoCache[slug];
    const svg = await _construirMallaSVG(rawNodes, rawLinks, FAVICON_S, FAVICON_OPTS);
    if (svg) _aplicarFaviconHref(_svgAFaviconHref(svg));
    else _aplicarFaviconDefault();
  } catch(_) { _aplicarFaviconDefault(); }
}

async function procesarTexto(slug) {
  _procesarConModal(slug, {});
}

function _arrancarPolling() {
  if (_pollingBiblioteca) return;   // ya hay un poll activo
  _pollingBiblioteca = setInterval(async () => {
    const exts = await apiFetch("/api/extracciones");
    renderBiblioteca(exts);
    // Parar si ya no hay nada procesando
    if (!exts.some(e => e.procesando)) {
      clearInterval(_pollingBiblioteca);
      _pollingBiblioteca = null;
    }
  }, 1200);
}

async function abrirTextoPublico(pubId) {
  state.soloLectura = true;
  state.pubId = pubId;
  document.body.classList.add("solo-lectura");

  document.getElementById("vista-biblioteca").hidden = true;
  document.getElementById("vista-config").hidden = true;
  document.getElementById("topbar-right").hidden = true;
  document.getElementById("btn-biblioteca").hidden = true;
  document.getElementById("tabs").hidden = false;
  document.getElementById("topbar-chevron").hidden = true;
  document.getElementById("mapa-buscar-wrap").hidden = false;

  try {
    await cargarValidacion(pubId);  // pubId hace de slug; apiFetch lo reescribe
  } catch(e) {
    document.getElementById("transcripcion-titulo").textContent = "";
    document.querySelector("#tab-mapa").innerHTML =
      `<p class="muted" style="padding:var(--sn-s-6)">Este grafo no está disponible o ya no es público.</p>`;
    activarTab("mapa");
    return;
  }
  activarTab("mapa");
}

async function abrirTexto(slug) {
  // Ocultar biblioteca
  document.getElementById("vista-biblioteca").hidden = true;

  // Topbar: modo texto
  document.getElementById("btn-biblioteca").hidden = false;
  document.getElementById("tabs").hidden = false;
  document.getElementById("topbar-chevron").hidden = false;
  document.getElementById("mapa-buscar-wrap").hidden = false;

  // Cargar datos del texto
  await cargarValidacion(slug);

  // Activar primer tab
  activarTab("mapa");

  // Deep-link
  history.pushState(null, "", `#${slug}`);

  // Favicon: minimapa del texto abierto
  _actualizarFaviconParaTexto(slug);
}

function abrirConfig() {
  document.getElementById("vista-biblioteca").hidden = true;
  document.getElementById("vista-config").hidden = false;
  document.getElementById("btn-biblioteca").hidden = false;
  document.getElementById("tabs").hidden = true;
  document.getElementById("topbar-chevron").hidden = true;
  document.getElementById("mapa-buscar-wrap").hidden = true;
  history.pushState(null, "", "#config");
  window._cargarConfig?.();
}

function volverBiblioteca() {
  if (_pollingBiblioteca) { clearInterval(_pollingBiblioteca); _pollingBiblioteca = null; }
  const vistaConfig = document.getElementById("vista-config");
  if (!vistaConfig.hidden) {
    vistaConfig.hidden = true;
    mostrarBiblioteca();
    return;
  }
  // Invalidar caché del mini-mapa del texto activo para que se recargue con cambios
  if (state.slug) delete _miniGrafoCache[state.slug];
  mostrarBiblioteca();
}

async function cargarValidacion(slug) {
  state.slug       = slug;
  state.validacion = await apiFetch(`/api/validacion/${encodeURIComponent(slug)}`);
  renderTopbar();
}

// ════════════════════════════════════════════════════════════════════════
// Topbar
// ════════════════════════════════════════════════════════════════════════
function renderTopbar() {
  document.getElementById("transcripcion-titulo").textContent = state.validacion.titulo;
}

function buildCita(m) {
  const partes = [];
  if (m.autores?.length) partes.push(m.autores.join("; "));
  if (m.anio)            partes.push(`(${m.anio})`);
  if (m.titulo)          partes.push(m.titulo);
  if (m.editorial)       partes.push(m.editorial);
  return partes.join(". ");
}

async function refrescarValidacion() {
  state.validacion = await apiFetch(`/api/validacion/${encodeURIComponent(state.slug)}`);
}

// ════════════════════════════════════════════════════════════════════════
// Tab: Mapa
// ════════════════════════════════════════════════════════════════════════
async function initMapa() {
  if (!state.grafo) await cargarGrafo();

  // ── Tarjetas flotantes de concepto ──────────────────────────────────
  const overlayEl = document.getElementById("mapa-overlay");
  const arrowsEl  = document.getElementById("mapa-arrows");
  if (overlayEl && arrowsEl && !state.mapaCards) {
    const { createFloatingCards } = await import("./floatcards.js");
    // Sin onFocus: traer una tarjeta al frente no mueve el mapa (respeta el encuadre del usuario).
    state.mapaCards = createFloatingCards(overlayEl, arrowsEl);
  }

  // ── Buscador de conceptos (en la topbar: debe quedar listo aunque la
  // inicialización del mapa de fuerza falle, p.ej. sin WebGL) ──────────
  initMapaBuscar();

  // ── Grafo de fuerza (raíz de la navegación) ────────────────────────
  await initMapaForce();

  // ── Botones de mantenimiento del grafo ─────────────────────────────
  await actualizarBotonSesion(SESION_RECONEXION);
  const btnRec = document.getElementById("btn-reconectar");
  if (btnRec) btnRec.onclick = () => abrirPanelSesion(SESION_RECONEXION);
}

async function initMapaForce() {
  if (!state.grafo) return;
  const svgEl = document.getElementById("grafo-svg");
  const el3d  = document.getElementById("grafo-3d");
  if (!svgEl || !el3d) return;

  // Si ya estábamos en 3D es un refresco de datos, no un cambio de modo:
  // no hacer auto-fit para no resetear la vista del usuario.
  const yaEn3D = state.modo3d && state.grafoDestroy !== null;

  state.grafoDestroy?.();
  state.grafoDestroy = null;

  if (state.modo3d) {
    svgEl.setAttribute("hidden", ""); el3d.removeAttribute("hidden");
    const { initGrafo3D } = await import("./grafo3d.js");
    let res;
    try {
      res = initGrafo3D(el3d, state.grafo, onNodoSeleccionado, { autoFit: !yaEn3D });
    } catch (e) {
      // WebGL puede fallar en tiempo de init (GPU no disponible/bloqueada).
      // En vez de dejar el mapa en blanco, caer a la vista 2D.
      console.warn("Vista 3D no disponible, se usa 2D:", e.message);
      state.modo3d = false;
      return initMapaForce();
    }
    const { updateVisuals, highlightPath, centerOnNode, panBy, fitView, destroy, relColorScale, relTypes } = res;
    state.grafoUpdate    = updateVisuals;
    state.grafoHighlight = highlightPath;
    state.grafoCenter    = centerOnNode;
    state.grafoPan       = panBy;
    state.grafoFit       = fitView;
    state.grafoDestroy   = destroy;
    state.relColor       = relColorScale;
    renderLeyenda(relColorScale, relTypes);
  } else {
    svgEl.removeAttribute("hidden"); el3d.setAttribute("hidden", "");
    const { initGrafo } = await import("./grafo.js");
    const { relColorScale, relTypes, updateVisuals, highlightPath, centerOnNode, panBy, fitView } = initGrafo(svgEl, state.grafo, onNodoSeleccionado);
    state.grafoUpdate    = updateVisuals;
    state.grafoHighlight = highlightPath;
    state.grafoCenter    = centerOnNode;
    state.grafoPan       = panBy;
    state.grafoFit       = fitView;
    state.relColor       = relColorScale;
    renderLeyenda(relColorScale, relTypes);
  }
  refrescarHighlight();

  const btnFit = document.getElementById("btn-fit");
  if (btnFit) btnFit.onclick = () => state.grafoFit?.();

  const btnModo3d = document.getElementById("btn-modo3d");
  if (btnModo3d) {
    btnModo3d.title = state.modo3d ? "Cambiar a vista 2D" : "Cambiar a vista 3D";
    btnModo3d.classList.toggle("active", state.modo3d);
    btnModo3d.onclick = () => { state.modo3d = !state.modo3d; initMapaForce(); };
  }
}

function renderLeyenda(relColorScale, relTypes) {
  const fmt = t => t.replace(/_/g," ").replace(/\b\w/g, c => c.toUpperCase());
  const el = document.getElementById("leyenda-tipos");
  if (!el) return;
  el.innerHTML = relTypes.slice(0,10).map(t =>
    `<div class="leyenda-item">
       <span class="leyenda-line" style="background:${relColorScale(t)}"></span>
       <span>${esc(fmt(t))}</span>
     </div>`
  ).join("");
}

const TIPOS_REL = ["fundamenta","amplifica","especifica","contraposicion","constituye","genera","presupone","evoca","pertenece"];

/**
 * Autocomplete genérico para inputs (buscador del mapa, formulario de
 * "Vincular"). getPool() → [{ label, meta, onSelect(inputEl) }]
 * Options: minChars (default 1), showAllOnFocus (default false)
 */
function _gpWireAutocomplete(inputEl, dropdownEl, getPool, { minChars = 1, showAllOnFocus = false } = {}) {
  let activeIdx = -1;
  let items = [];

  function render(query) {
    const q = query.toLowerCase().trim();
    items = (q.length < minChars && !showAllOnFocus)
      ? []
      : getPool().filter(p => q.length < 1 || p.label.toLowerCase().includes(q)).slice(0, 12);
    dropdownEl.innerHTML = items.map((p, i) => `
      <li class="gp-ac-item${i === activeIdx ? " active" : ""}" role="option" data-idx="${i}"${i === activeIdx ? ' aria-selected="true"' : ""}>
        <span class="gp-ac-item-label">${esc(p.label)}</span>
        ${p.meta ? `<span class="gp-ac-item-meta">${esc(p.meta)}</span>` : ""}
      </li>
    `).join("");
    dropdownEl.hidden = items.length === 0;
    dropdownEl.querySelectorAll(".gp-ac-item").forEach(li => {
      li.addEventListener("mousedown", e => {
        e.preventDefault();
        select(parseInt(li.dataset.idx, 10));
      });
    });
  }

  function select(idx) {
    if (idx < 0 || idx >= items.length) return;
    items[idx].onSelect(inputEl);
    close();
  }

  function close() {
    activeIdx = -1;
    items = [];
    dropdownEl.hidden = true;
    dropdownEl.innerHTML = "";
  }

  inputEl.addEventListener("input", () => { activeIdx = -1; render(inputEl.value); });
  inputEl.addEventListener("focus", () => {
    if (showAllOnFocus) render("");
    else if (inputEl.value.length >= minChars) render(inputEl.value);
  });
  inputEl.addEventListener("focusout", () => {
    setTimeout(() => {
      if (document.activeElement !== inputEl && !dropdownEl.contains(document.activeElement)) close();
    }, 80);
  });
  inputEl.addEventListener("keydown", e => {
    if (dropdownEl.hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
      render(inputEl.value);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      render(inputEl.value);
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault(); e.stopPropagation();
      select(activeIdx);
    } else if (e.key === "Escape") {
      close();
    }
  });
}

// ── Buscador de conceptos en el mapa ─────────────────────────────────────

function initMapaBuscar() {
  const inp  = document.getElementById("mapa-buscar");
  const drop = document.getElementById("mapa-buscar-dropdown");
  if (!inp || !drop) return;
  if (inp.dataset.wired) return;
  inp.dataset.wired = "1";

  _gpWireAutocomplete(inp, drop,
    () => (state.grafo?.nodes || []).map(n => ({
      label: n.label,
      meta:  n.menciones ? `${n.menciones} mens.` : undefined,
      onSelect: () => {
        inp.value = "";
        drop.hidden = true;
        // Asegurar que estamos en la pestaña mapa
        if (state.tabActivo !== "mapa") activarTab("mapa");
        // Centrar en el nodo
        if (state.grafoCenter) state.grafoCenter(n.id);
        // Seleccionar el nodo (abre panel/columnas)
        onNodoSeleccionado(n);
      },
    })),
    { minChars: 1, showAllOnFocus: false }
  );
}

// ── Tarjetas flotantes: nodo del grafo → tarjeta flotante de concepto,
// encadenadas por flechas que respetan la dirección de la relación ──────

const DIR_SYM = { saliente: "→", entrante: "←", bidireccional: "↔" };

function onNodoSeleccionado(nodo) {
  if (!nodo || !state.mapaCards) return;
  const existente = state.mapaCards.findByNodeId(nodo.id);
  if (existente) { state.mapaCards.bringToFront(existente); return; }
  abrirCardMapa(nodo);
  refrescarHighlight();
}

function limpiarCamino() {
  state.mapaCards?.closeAll();
  refrescarHighlight();
}

function abrirCardMapa(nodo, parentCardId = null, link = null, dir = null) {
  if (!state.mapaCards) return null;
  const relLabel = link ? (link.tipo ? link.tipo.replace(/_/g, " ") : "") : null;
  return state.mapaCards.open({
    nodeId:   nodo.id,
    title:    esc(nodo.label),
    bodyHtml: buildPanelHTML(nodo),
    onBind:   (el, cardId) => bindPanelListeners(el, nodo, cardId),
    parentCardId, linkId: link?.id || null, relLabel, dir,
  });
}

function refrescarHighlight() {
  if (!state.grafoHighlight || !state.mapaCards) return;
  state.grafoHighlight(state.mapaCards.highlightList());
}

function buildPanelHTML(nodo) {
  let h="";

  if (nodo.editado) {
    h+=`<div class="panel-editado"><span class="edited-mark" title="Editado por investigador">${ico("edit-2",11)} editado</span></div>`;
  }

  // ── Detalles del concepto (colapsado: tarjeta mínima al abrir) ────────
  h+=`<details class="panel-seccion panel-seccion-concepto"><summary class="panel-seccion-titulo panel-seccion-summary">${ico("book-a",13)} Concepto</summary>`;
  if (nodo.descripcion) h+=`<p class="concepto-definicion">${esc(nodo.descripcion)}</p>`;
  if (nodo.cita_directa) h+=campo("Cita directa",`<p class="cita">"${esc(nodo.cita_directa)}"</p>`);
  h+=`<div class="campo"><span class="campo-etiq">Menciones · Confianza</span>
    <div>${nodo.menciones} menciones &ensp;<span style="color:var(--badge-conf-text)">${nodo.confianza.toFixed(2)}</span></div></div>`;
  if (nodo.sinonimos_candidatos?.length) h+=`<div class="campo"><span class="campo-etiq">Sinónimos candidatos</span><div class="sinonimos-lista">${nodo.sinonimos_candidatos.map(s=>`<span class="tag">${esc(s)}</span>`).join("")}</div></div>`;
  h+=`</details>`;

  // ── Relaciones (clicables: cada una encadena una tarjeta flotante) ────
  h+=buildRelacionesHTML(nodo);

  // ── Anotaciones ───────────────────────────────────────────────────────
  h+=buildAnnotationPanelHTML(nodo);

  // ── Vincular con otro concepto ─────────────────────────────────────────
  h+=buildNuevaRelacionHTML(nodo);

  return h;
}

// Conexiones de un nodo, salientes+bidireccionales primero, entrantes puras
// después; una relación bidireccional aparece una sola vez. Misma lógica que
// usaba el extinto lector.js ("Ruta").
function conexionesDe(nodoId) {
  const links = state.grafo?.links || [];
  const seen  = new Set();
  const out   = [];
  links.forEach(l => {
    if (l.source !== nodoId || seen.has(l.id)) return;
    seen.add(l.id);
    out.push({ link: l, neighbor: l.target, dir: l.bidireccional ? "bidireccional" : "saliente" });
  });
  links.forEach(l => {
    if (l.target !== nodoId || seen.has(l.id)) return;
    seen.add(l.id);
    out.push({ link: l, neighbor: l.source, dir: l.bidireccional ? "bidireccional" : "entrante" });
  });
  return out;
}

function buildRelacionesHTML(nodo) {
  const color = state.relColor || (() => "#888");
  const nodeById = Object.fromEntries((state.grafo?.nodes||[]).map(n=>[n.id,n]));
  const conex = conexionesDe(nodo.id);

  if (!conex.length) {
    return `<div class="panel-seccion">
      <div class="panel-seccion-titulo">${ico("graph-star",13)} Relaciones</div>
      <p class="muted" style="font-size:var(--sn-fs-xs)">Sin conexiones.</p>
    </div>`;
  }

  const grupos = { saliente: [], bidireccional: [], entrante: [] };
  conex.forEach(item => grupos[item.dir]?.push(item));
  const grupoMeta = {
    saliente:      { label: "Salientes",       sym: DIR_SYM.saliente },
    bidireccional: { label: "Bidireccionales", sym: DIR_SYM.bidireccional },
    entrante:      { label: "Entrantes",       sym: DIR_SYM.entrante },
  };

  let h = `<details class="panel-seccion"><summary class="panel-seccion-titulo panel-seccion-summary">${ico("graph-star",13)} Relaciones (${conex.length})</summary>`;
  ["saliente", "bidireccional", "entrante"].forEach(dir => {
    const items = grupos[dir];
    if (!items.length) return;
    const { label, sym } = grupoMeta[dir];

    h += `<details class="panel-rel-grupo">
      <summary class="panel-rel-grupo-hdr">
        <span class="panel-rel-dir">${sym}</span>
        <span class="panel-rel-grupo-nombre">${label}</span>
        <span class="panel-rel-grupo-cnt">${items.length}</span>
      </summary>
      <div class="panel-rel-grupo-items">`;

    items.forEach(({ link, neighbor }) => {
      const nb = nodeById[neighbor];
      if (!nb) return;
      const frase   = link.frase_completa || link.etiqueta || (link.tipo ? link.tipo.replace(/_/g, " ") : "");
      const tipo    = link.tipo ? link.tipo.replace(/_/g, " ") : "";
      const c       = color(link.tipo || "_");

      h += `<button class="panel-rel-fila panel-rel-fila--clicable"
        data-link-id="${esc(link.id)}" data-neighbor-id="${esc(neighbor)}" data-dir="${esc(dir)}">
        <span class="panel-rel-frase">${esc(frase)}</span>
        <span class="panel-rel-pie">
          <span class="panel-rel-nodo" style="color:${c}">${esc(nb.label)}</span>
          ${tipo ? `<span class="panel-rel-tipo">${esc(tipo)}</span>` : ""}
        </span>
      </button>`;
    });

    h += `</div></details>`;
  });
  h += `</details>`;
  return h;
}

function buildNuevaRelacionHTML(nodo) {
  return `<details class="panel-seccion panel-seccion-escritura">
    <summary class="panel-seccion-titulo panel-seccion-summary">${ico("link",13)} Vincular</summary>
    <div class="campo">
      <span class="campo-etiq">Concepto destino</span>
      <div style="position:relative">
        <input id="nr-destino-txt" class="edit-input" placeholder="Buscar concepto…" autocomplete="off" style="width:100%">
        <input type="hidden" id="nr-destino">
        <ul class="gp-ac-dropdown" id="nr-destino-drop" hidden></ul>
      </div>
    </div>
    <div class="campo">
      <span class="campo-etiq">Tipo</span>
      <div style="position:relative">
        <input id="nr-tipo" class="edit-input" placeholder="Tipo…" autocomplete="off" value="${esc(TIPOS_REL[0])}" style="width:100%">
        <ul class="gp-ac-dropdown" id="nr-tipo-drop" hidden></ul>
      </div>
    </div>
    <div class="campo">
      <span class="campo-etiq">Etiqueta de la relación</span>
      <input id="nr-etiqueta" class="edit-input" placeholder="ej. reduce, implica, requiere…" style="width:100%">
    </div>
    <div class="campo" style="display:flex;align-items:center;gap:8px">
      <input type="checkbox" id="nr-bidir" style="cursor:pointer">
      <label for="nr-bidir" class="campo-etiq" style="margin-bottom:0;cursor:pointer">Bidireccional ↔</label>
    </div>
    <button id="nr-crear" class="btn btn-aceptar small" style="width:100%;margin-top:4px">
      + Crear relación
    </button>
  </details>`;
}

function buildAnnotationPanelHTML(nodo) {
  const anotaciones=(state.validacion?.anotaciones||[]).filter(a=>a.objeto_anotado===nodo.id);
  let h=`<details class="panel-seccion">
    <summary class="panel-seccion-titulo panel-seccion-summary">${ico("notebook-pen",13)} Anotaciones</summary>`;
  if (anotaciones.length) {
    h+=anotaciones.map(a=>`<div class="panel-anotacion">
      <p class="cita">${esc(a.nota)}</p>
      <span class="muted">${esc(a.autor_nombre || (a.autor_uid ? "Colaborador" : "Autoría no registrada"))}</span>
      <span class="muted" style="font-size:10px">${new Date(a.creada_en).toLocaleDateString("es",{day:"numeric",month:"short",year:"numeric"})}</span>
    </div>`).join("");
  }
  h+=`<div class="panel-seccion-escritura">
    <textarea id="pb-anotacion" class="panel-nota-input" rows="2" placeholder="Añadir mi glosa…" style="margin-top:8px"></textarea>
    <button id="pb-anotar" class="btn btn-neutro small" style="margin-top:6px;width:100%">Guardar nota</button>
  </div></details>`;
  return h;
}

function bindPanelListeners(el, nodo, cardId) {
  el.querySelector("#pb-anotar")?.addEventListener("click", () => {
    const t = el.querySelector("#pb-anotacion")?.value.trim();
    if (t) anotarEnPanel(nodo.id, t, cardId);
  });

  // Nueva relación: autocompletar concepto destino
  const nrDestTxt  = el.querySelector("#nr-destino-txt");
  const nrDestId   = el.querySelector("#nr-destino");
  const nrDestDrop = el.querySelector("#nr-destino-drop");
  if (nrDestTxt) {
    const conectados = new Set(
      (state.grafo?.links || [])
        .filter(l => l.source === nodo.id || l.target === nodo.id)
        .flatMap(l => [l.source, l.target])
    );
    _gpWireAutocomplete(nrDestTxt, nrDestDrop, () =>
      (state.grafo?.nodes || []).filter(n => n.id !== nodo.id)
        .map(n => ({ label: n.label, meta: conectados.has(n.id) ? "vinculado" : "", onSelect: inp => { inp.value = n.label; nrDestId.value = n.id; } }))
    );
    nrDestTxt.addEventListener("input", () => { nrDestId.value = ""; });
  }

  // Tipo: autocompletar con el vocabulario orientativo + los tipos ya usados
  // en el grafo, pero acepta cualquier texto libre (ontología abierta).
  const nrTipo     = el.querySelector("#nr-tipo");
  const nrTipoDrop = el.querySelector("#nr-tipo-drop");
  if (nrTipo) {
    _gpWireAutocomplete(nrTipo, nrTipoDrop, () => {
      const tipos = new Set(TIPOS_REL);
      (state.grafo?.links || []).forEach(l => { if (l.tipo) tipos.add(l.tipo); });
      return [...tipos].sort().map(t => ({ label: t, meta: "", onSelect: inp => { inp.value = t; } }));
    }, { showAllOnFocus: true });
  }

  el.querySelector("#nr-crear")?.addEventListener("click", () => {
    const destino  = el.querySelector("#nr-destino")?.value;
    const tipo     = el.querySelector("#nr-tipo")?.value;
    const etiqueta = el.querySelector("#nr-etiqueta")?.value.trim();
    const bidir    = el.querySelector("#nr-bidir")?.checked || false;
    if (!destino)  { nrDestTxt?.focus();  return; }
    if (!etiqueta) { el.querySelector("#nr-etiqueta").focus(); return; }
    crearRelacion(nodo.id, destino, tipo, etiqueta, bidir, cardId);
  });

  // Relaciones: cada una encadena (o trae al frente) una tarjeta flotante
  el.querySelectorAll(".panel-rel-fila--clicable").forEach(btn => {
    btn.addEventListener("click", () => {
      const link     = (state.grafo?.links || []).find(l => l.id === btn.dataset.linkId);
      const neighbor = (state.grafo?.nodes || []).find(n => n.id === btn.dataset.neighborId);
      if (!link || !neighbor) return;
      const existente = state.mapaCards?.findChildByLink(cardId, link.id);
      if (existente) { state.mapaCards.bringToFront(existente); return; }
      abrirCardMapa(neighbor, cardId, link, btn.dataset.dir);
      refrescarHighlight();
    });
  });
}

function refrescarCardMapa(cardId, nodoId) {
  const nodo = state.grafo?.nodes.find(n => n.id === nodoId);
  if (!nodo || !state.mapaCards) return;
  state.mapaCards.refresh(cardId, {
    title:    esc(nodo.label),
    bodyHtml: buildPanelHTML(nodo),
    onBind:   (el, cid) => bindPanelListeners(el, nodo, cid),
  });
}

async function crearRelacion(origenId, destinoId, tipo, etiqueta, bidireccional, cardId) {
  try {
    await apiFetch(
      `/api/validacion/${encodeURIComponent(state.slug)}/relaciones`,
      { method: "POST", body: JSON.stringify({ origen_id: origenId, destino_id: destinoId, tipo, etiqueta, bidireccional }) }
    );
    await cargarGrafo();
    // Re-init mapa: new link must be added to the simulation
    state.grafoUpdate = null;
    tabsInit.delete("mapa");
    tabsInit.delete("relaciones");
    if (state.tabActivo === "mapa") {
      tabsInit.add("mapa");
      await initMapa();
    }
    // Las relaciones de cualquier tarjeta abierta pueden haber cambiado.
    state.mapaCards?.listOpen().forEach(({ cardId: id, nodeId }) => refrescarCardMapa(id, nodeId));
    refrescarHighlight();
  } catch(e) { alert("Error al crear relación: " + e.message); }
}

async function anotarEnPanel(nodoId, nota, cardId) {
  try {
    await apiFetch(`/api/validacion/${encodeURIComponent(state.slug)}/anotar`,{method:"POST",body:JSON.stringify({objeto_anotado:nodoId,nota})});
    await refrescarValidacion();
    refrescarCardMapa(cardId, nodoId);
  } catch(e) { alert("Error al anotar: "+e.message); }
}

// ════════════════════════════════════════════════════════════════════════
// getYourStuffTogether — reconexión de nodos sueltos
// ════════════════════════════════════════════════════════════════════════

// ── Configuración por tipo de sesión (reconexión / consolidación) ─────────────
// El motor de abajo (actualizarBotonSesion, abrirPanelSesion, renderPanelSesion,
// streaming SSE) es genérico; sólo cambian estos hooks por tipo.

const SESION_RECONEXION = {
  prefix: "rec",
  panelId: "panel-reconexion",
  contentId: "panel-reconexion-content",
  footerId: "panel-reconexion-footer",
  tituloId: "panel-reconexion-titulo",
  descId: "panel-reconexion-desc",
  btnId: "btn-reconectar",
  btnConfirmarId: "btn-confirmar-reconexion",
  btnCancelarId: "btn-cancelar-reconexion",
  btnCerrarId: "btn-cerrar-reconexion",
  api: slug => `/api/grafo/${encodeURIComponent(slug)}/reconexion`,
  tituloTexto: "Reconexión de nodos",
  campoEditable: "frase_editada",
  hidden: info => info.es_conexo,
  tooltip: info => `${info.nodos_sueltos_count} nodo(s) desconectado(s) del núcleo principal — clic para reconectar`,
  descSesion: sesion => {
    const n = (sesion.nodos_sueltos_ids || []).length;
    return n > 0 ? `${n} nodo${n !== 1 ? "s" : ""} sin conexión detectado${n !== 1 ? "s" : ""}` : "";
  },
  mensajeVacio: `<p>El LLM no encontró conexiones posibles para estos nodos.</p>
    <p class="muted">Es posible que los conceptos sean demasiado específicos o periféricos al argumento principal. Puedes crear relaciones manualmente desde el panel de cada nodo.</p>`,
  instruccion: total => `El LLM propone <strong>${total}</strong> conexión${total !== 1 ? "es" : ""}. Selecciona las que sean válidas y edita la etiqueta si es necesario.`,
  botonConfirmarTexto: sel => sel > 0 ? `Añadir ${sel} al grafo` : "Nada seleccionado",
  renderTarjeta: renderTarjetaReconexion,
  mensajeResultado: res => `<div class="rec-resultado">
      <p><strong>${res.relaciones_agregadas} conexión${res.relaciones_agregadas !== 1 ? "es" : ""} añadida${res.relaciones_agregadas !== 1 ? "s" : ""} al grafo.</strong></p>
      ${res.es_conexo
        ? `<p class="muted">El grafo está ahora completamente conectado.</p>`
        : `<p class="muted">Quedan ${res.nodos_sueltos_restantes} nodo${res.nodos_sueltos_restantes !== 1 ? "s" : ""} desconectado${res.nodos_sueltos_restantes !== 1 ? "s" : ""}. Puedes volver a reconectar.</p>`
      }
    </div>`,
};

const SESION_CONSOLIDACION = {
  prefix: "cons",
  panelId: "panel-consolidacion",
  contentId: "panel-consolidacion-content",
  footerId: "panel-consolidacion-footer",
  tituloId: "panel-consolidacion-titulo",
  descId: "panel-consolidacion-desc",
  btnConfirmarId: "btn-confirmar-consolidacion",
  btnCancelarId: "btn-cancelar-consolidacion",
  btnCerrarId: "btn-cerrar-consolidacion",
  api: slug => `/api/grafo/${encodeURIComponent(slug)}/consolidacion`,
  tituloTexto: "Consolidación de sinónimos",
  campoEditable: "label_editado",
  descSesion: sesion => {
    const n = (sesion.candidatos_ids || []).length;
    return n > 0 ? `${n} nodo${n !== 1 ? "s" : ""} candidato${n !== 1 ? "s" : ""} a fusión` : "";
  },
  mensajeVacio: `<p>El LLM no confirmó ninguno de los grupos candidatos como el mismo concepto.</p>
    <p class="muted">La detección por similitud de texto puede tener falsos positivos; es normal si los conceptos son sólo parecidos, no duplicados.</p>`,
  instruccion: total => `El LLM confirma <strong>${total}</strong> fusión${total !== 1 ? "es" : ""} de conceptos duplicados. Revisa y edita el label final si es necesario.`,
  botonConfirmarTexto: sel => sel > 0 ? `Fusionar ${sel}` : "Nada seleccionado",
  renderTarjeta: renderTarjetaConsolidacion,
  mensajeResultado: res => `<div class="rec-resultado">
      <p><strong>${res.fusiones_aplicadas} fusión${res.fusiones_aplicadas !== 1 ? "es" : ""} aplicada${res.fusiones_aplicadas !== 1 ? "s" : ""}.</strong></p>
      <p class="muted">El grafo ahora tiene ${res.nodos_totales} nodo${res.nodos_totales !== 1 ? "s" : ""}.</p>
    </div>`,
};

function renderTarjetaReconexion(p, sesion) {
  const sueltos = new Set(sesion.nodos_sueltos_ids || []);
  const orig = esc(p.conexion.origen_label || p.conexion.origen_id);
  const dest = esc(p.conexion.destino_label || p.conexion.destino_id);
  const esSueltoOrig = sueltos.has(p.conexion.origen_id);
  const esSueltoDest = sueltos.has(p.conexion.destino_id);
  const conf   = Math.round((p.conexion.confianza ?? 0.8) * 100);
  const confCl = conf >= 80 ? "alta" : conf >= 60 ? "media" : "baja";
  const tipoLabel = (p.conexion.tipo || "relacionado con").replace(/_/g, " ");
  return `<div class="rec-propuesta${p.seleccionada ? "" : " rec-deseleccionada"}" data-pid="${esc(p.id)}">
    <label class="rec-check-label">
      <input type="checkbox" class="rec-check" data-pid="${esc(p.id)}" ${p.seleccionada ? "checked" : ""}>
      <div class="rec-nodos-wrap">
        <div class="rec-nodos">
          <span class="tag${esSueltoOrig ? " suelto" : ""}"${esSueltoOrig ? ' title="nodo desconectado"' : ""}>${orig}</span>
          <span class="rec-flecha">→</span>
          <span class="tag${esSueltoDest ? " suelto" : ""}"${esSueltoDest ? ' title="nodo desconectado"' : ""}>${dest}</span>
        </div>
        <div class="rec-meta">
          <span class="tag rec-tipo">${esc(tipoLabel)}</span>
          <span class="rec-conf rec-conf-${confCl}" title="Confianza del LLM">${conf}%</span>
        </div>
      </div>
    </label>
    <input class="edit-input rec-frase" data-pid="${esc(p.id)}"
           value="${esc(p.frase_editada)}" placeholder="etiqueta de la relación…">
  </div>`;
}

function renderTarjetaConsolidacion(p) {
  const canon = esc(p.propuesta.nodo_canonico_label || p.propuesta.nodo_canonico_id);
  const absorbidosLabels = p.propuesta.nodos_absorbidos_labels || p.propuesta.nodos_absorbidos_ids;
  const absorbidos = absorbidosLabels.map(l => `<span class="tag suelto">${esc(l)}</span>`).join(" ");
  const conf   = Math.round((p.propuesta.confianza ?? 0.8) * 100);
  const confCl = conf >= 80 ? "alta" : conf >= 60 ? "media" : "baja";
  return `<div class="rec-propuesta${p.seleccionada ? "" : " rec-deseleccionada"}" data-pid="${esc(p.id)}">
    <label class="rec-check-label">
      <input type="checkbox" class="rec-check" data-pid="${esc(p.id)}" ${p.seleccionada ? "checked" : ""}>
      <div class="rec-nodos-wrap">
        <div class="rec-nodos">
          ${absorbidos}
          <span class="rec-flecha">→</span>
          <span class="tag rec-tipo">${canon}</span>
        </div>
        <div class="rec-meta">
          <span class="rec-conf rec-conf-${confCl}" title="Confianza del LLM">${conf}%</span>
        </div>
      </div>
    </label>
    <p class="rec-justificacion muted" style="font-size:var(--sn-fs-xs);margin:2px 0 6px">${esc(p.propuesta.justificacion || "")}</p>
    <input class="edit-input rec-frase" data-pid="${esc(p.id)}"
           value="${esc(p.label_editado)}" placeholder="label canónico…">
  </div>`;
}

// ── Motor genérico de sesión (reconexión / consolidación) ─────────────────────

async function actualizarBotonSesion(cfg) {
  const btn = document.getElementById(cfg.btnId);
  if (!btn || !state.slug) return;
  try {
    const info = await apiFetch(`${cfg.api(state.slug)}/estado`);
    btn.hidden = cfg.hidden(info);
    if (!btn.hidden) btn.title = cfg.tooltip(info);
    // Si hay sesión activa: mostrar según estado
    if (info.sesion_activa) {
      if (info.sesion_activa.estado === "en_revision") {
        renderPanelSesion(cfg, info.sesion_activa);
      } else if (info.sesion_activa.estado === "procesando") {
        abrirStreamExistente(cfg);
      }
    }
  } catch(e) { btn.hidden = true; }
}

// Los paneles de sesión (reconexión/consolidación) comparten la misma
// posición absoluta sobre el grafo — sólo uno puede estar abierto a la vez.
const _PANELES_SESION = [SESION_RECONEXION, SESION_CONSOLIDACION];
function _cerrarOtrosPaneles(cfg) {
  _PANELES_SESION.forEach(otro => {
    if (otro.panelId === cfg.panelId) return;
    const p = document.getElementById(otro.panelId);
    if (p) p.hidden = true;
  });
}

function abrirStreamExistente(cfg) {
  _sesionConModal(cfg, false);
}

async function abrirPanelSesion(cfg, slug = state.slug) {
  if (_iaTarea) return;
  let sesion = null;
  try { sesion = await apiFetch(`${cfg.api(slug)}/sesion`); }
  catch (err) {
    if (!err.message.startsWith("404:")) {
      abrirTareaIA({ titulo: "Consultar tarea con IA", ejecutar: async () => { throw err; } });
      return;
    }
  }
  if (sesion?.estado === "en_revision") {
    if (state.slug !== slug) await abrirTexto(slug);
    renderPanelSesion(cfg, sesion);
    return;
  }
  _sesionConModal(cfg, sesion?.estado !== "procesando", slug);
}

function _sesionConModal(cfg, iniciar, slug = state.slug) {
  const api = cfg.api(slug);
  abrirTareaIA({
    titulo: cfg === SESION_CONSOLIDACION ? "Fusionar conceptos" : "Reconectar conceptos",
    detener: () => apiFetch(`${api}/sesion`, { method: "DELETE" }),
    ejecutar: async ui => {
      if (iniciar) await apiFetch(`${api}/iniciar`, { method: "POST", body: "{}" });
      await _streamTareaIA(`${api}/stream`, ui);
      const sesion = await apiFetch(`${api}/sesion`);
      if (sesion.estado !== "en_revision") throw new Error(sesion.razon_falla || "Tarea cancelada");
      _iaTarea.continuar = async () => {
        if (state.slug !== slug) await abrirTexto(slug);
        renderPanelSesion(cfg, sesion);
      };
      _iaTarea.textoContinuar = "Revisar propuestas";
      return `${sesion.propuestas.length} propuesta(s) listas para revisar.`;
    },
  });
}

function renderPanelSesion(cfg, sesion) {
  const panel   = document.getElementById(cfg.panelId);
  const content = document.getElementById(cfg.contentId);
  const footer  = document.getElementById(cfg.footerId);
  const titulo  = document.getElementById(cfg.tituloId);
  const desc    = document.getElementById(cfg.descId);
  if (!panel || !content) return;
  _cerrarOtrosPaneles(cfg);
  panel.hidden = false;

  const total = (sesion.propuestas || []).length;

  if (titulo) titulo.textContent = cfg.tituloTexto;
  if (desc) desc.textContent = cfg.descSesion(sesion);

  // ── Estado vacío ────────────────────────────────────────────────────
  if (total === 0) {
    if (footer) footer.hidden = true;
    content.innerHTML = `<div class="rec-vacio">${cfg.mensajeVacio}</div>`;
    const btnCer = document.getElementById(cfg.btnCerrarId);
    if (btnCer) btnCer.onclick = () => { panel.hidden = true; };
    return;
  }

  if (footer) footer.hidden = false;

  // ── Propuestas ──────────────────────────────────────────────────────
  content.innerHTML = `<p class="rec-instruccion">${cfg.instruccion(total)}</p>`
    + sesion.propuestas.map(p => cfg.renderTarjeta(p, sesion)).join("");

  // ── Actualizar label del botón según selección ──────────────────────
  function _updateBtn() {
    const btnConf = document.getElementById(cfg.btnConfirmarId);
    if (!btnConf) return;
    const sel = content.querySelectorAll(".rec-check:checked").length;
    btnConf.textContent = cfg.botonConfirmarTexto(sel);
    btnConf.disabled    = sel === 0;
  }

  content.querySelectorAll(".rec-check").forEach(cb => {
    cb.addEventListener("change", () => {
      const card = content.querySelector(`.rec-propuesta[data-pid="${esc(cb.dataset.pid)}"]`);
      if (card) card.classList.toggle("rec-deseleccionada", !cb.checked);
      _updateBtn();
    });
  });
  _updateBtn();

  // ── Botones ─────────────────────────────────────────────────────────
  const btnConf = document.getElementById(cfg.btnConfirmarId);
  const btnCan  = document.getElementById(cfg.btnCancelarId);
  const btnCer  = document.getElementById(cfg.btnCerrarId);

  if (btnConf) btnConf.onclick = async () => {
    const items = sesion.propuestas.map(p => {
      const check = content.querySelector(`.rec-check[data-pid="${p.id}"]`);
      const input = content.querySelector(`.rec-frase[data-pid="${p.id}"]`);
      const original = p[cfg.campoEditable];
      return {
        propuesta_id: p.id,
        seleccionada: check ? check.checked : false,
        [cfg.campoEditable]: input ? (input.value.trim() || original) : original,
      };
    });
    const orig = btnConf.textContent;
    btnConf.disabled    = true;
    btnConf.textContent = "Guardando…";
    try {
      const res = await apiFetch(
        `${cfg.api(state.slug)}/confirmar`,
        { method: "POST", body: JSON.stringify({ items }) }
      );
      // Mostrar resultado dentro del panel antes de cerrar
      content.innerHTML = cfg.mensajeResultado(res);
      if (footer) footer.hidden = true;
      // Recargar grafo en segundo plano
      delete _miniGrafoCache[state.slug];
      state.grafo = null; tabsInit.delete("mapa");
      state.mapaCards?.closeAll();
      await cargarGrafo(); await initMapa();
      actualizarBotonSesion(cfg);
      setTimeout(() => { panel.hidden = true; }, 2200);
    } catch(e) {
      btnConf.textContent = orig;
      btnConf.disabled    = false;
      content.insertAdjacentHTML("afterbegin",
        `<p class="rec-error">Error al guardar: ${esc(e.message)}</p>`);
    }
  };

  if (btnCan) btnCan.onclick = async () => {
    try {
      await apiFetch(`${cfg.api(state.slug)}/sesion`, { method: "DELETE" });
    } catch(_) {}
    panel.hidden = true;
    actualizarBotonSesion(cfg);
  };

  if (btnCer) btnCer.onclick = () => { panel.hidden = true; };
}


// ════════════════════════════════════════════════════════════════════════
// Tab: Conceptos
// ════════════════════════════════════════════════════════════════════════
let conceptoExpandidoId = null;
let _textoBusqueda = null; // { slug, oraciones: string[] } — cache de oraciones para buscar pasajes

// Divide el texto fuente en oraciones (conserva el signo de puntuación final).
function _dividirEnOraciones(texto) {
  return (texto || "").replace(/\s+/g, " ").match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
}

async function _cargarTextoBusqueda() {
  if (_textoBusqueda?.slug === state.slug) return _textoBusqueda;
  try {
    const { texto } = await apiFetch(`/api/transcripts/${encodeURIComponent(state.slug)}`);
    _textoBusqueda = { slug: state.slug, oraciones: _dividirEnOraciones(texto) };
  } catch (e) {
    _textoBusqueda = { slug: state.slug, oraciones: [] };
  }
  return _textoBusqueda;
}

// Oraciones del texto que mencionan el concepto (por su label o sinónimos).
function _pasajesDeConcepto(nodo, oraciones) {
  const terminos = [nodo.label, ...(nodo.sinonimos_candidatos || [])]
    .filter(Boolean).map(t => t.toLowerCase());
  const vistos = new Set();
  const pasajes = [];
  for (const o of oraciones) {
    const limpio = o.trim();
    const lo = limpio.toLowerCase();
    if (limpio && !vistos.has(limpio) && terminos.some(t => lo.includes(t))) {
      vistos.add(limpio);
      pasajes.push(limpio);
    }
  }
  return pasajes;
}

async function initConceptos() {
  if (!state.grafo) await cargarGrafo();
  renderConceptos();
  if (!conceptosListeners) {
    conceptosListeners=true;
    document.getElementById("buscar-concepto").addEventListener("input",e=>{
      conceptosState.busqueda=e.target.value.toLowerCase(); renderConceptos();
    });
    document.querySelectorAll("#tabla-conceptos th.sortable").forEach(th=>th.addEventListener("click",()=>{
      const c=th.dataset.col;
      if (conceptosState.sort.col===c) conceptosState.sort.dir=conceptosState.sort.dir==="asc"?"desc":"asc";
      else { conceptosState.sort.col=c; conceptosState.sort.dir="asc"; }
      renderConceptos();
    }));
    document.getElementById("concepto-check-todos").addEventListener("change", e => {
      conceptosState.seleccionados = e.target.checked ? new Set(state.grafo.nodes.map(n=>n.id)) : new Set();
      renderConceptos();
    });
    document.getElementById("btn-agregar-concepto").addEventListener("click", async () => {
      const label = prompt("Nombre del concepto:");
      if (!label || !label.trim()) return;
      try {
        await apiFetch(`/api/validacion/${encodeURIComponent(state.slug)}/conceptos`, {
          method: "POST", body: JSON.stringify({ label: label.trim() }),
        });
        await cargarGrafo(); tabsInit.delete("mapa"); renderConceptos();
      } catch(e) { alert("Error al agregar concepto: " + e.message); }
    });
    document.getElementById("btn-eliminar-grafo").addEventListener("click", async () => {
      if (!confirm("¿Eliminar el grafo completo de este texto? El texto fuente se conserva y podés volver a procesarlo o armar el grafo a mano.")) return;
      try {
        await apiFetch(`/api/extracciones/${encodeURIComponent(state.slug)}`, { method: "DELETE" });
        volverBiblioteca();
      } catch(e) { alert("Error al eliminar el grafo: " + e.message); }
    });
    document.getElementById("btn-procesar-seleccion").addEventListener("click", async () => {
      const labels = state.grafo.nodes.filter(n => conceptosState.seleccionados.has(n.id)).map(n => n.label);
      if (!labels.length) return;
      _procesarConModal(state.slug, { force: true, conceptos_objetivo: labels },
        `Buscar relaciones para estos ${labels.length} conceptos: ${labels.join(", ")}.`);
    });
  }
}

function renderConceptos() {
  let rows=state.grafo.nodes;
  if (conceptosState.busqueda) { const q=conceptosState.busqueda; rows=rows.filter(n=>n.label.toLowerCase().includes(q)||(n.descripcion||"").toLowerCase().includes(q)); }
  const {col,dir}=conceptosState.sort;
  rows=[...rows].sort((a,b)=>{ let av=a[col]??"",bv=b[col]??""; if(typeof av==="string")av=av.toLowerCase(); if(typeof bv==="string")bv=bv.toLowerCase(); return dir==="asc"?(av>bv?1:av<bv?-1:0):(av<bv?1:av>bv?-1:0); });
  document.querySelectorAll("#tabla-conceptos th.sortable").forEach(th=>{ th.classList.remove("sort-asc","sort-desc"); if(th.dataset.col===conceptosState.sort.col) th.classList.add(conceptosState.sort.dir==="asc"?"sort-asc":"sort-desc"); });
  const tbody=document.getElementById("conceptos-tbody"); tbody.innerHTML="";
  const btnProcesarSel = document.getElementById("btn-procesar-seleccion");
  if (btnProcesarSel) btnProcesarSel.hidden = conceptosState.seleccionados.size === 0;
  const todosEl = document.getElementById("concepto-check-todos");
  if (todosEl) todosEl.checked = rows.length > 0 && rows.every(n => conceptosState.seleccionados.has(n.id));
  rows.forEach(n=>{
    const tr=document.createElement("tr"); tr.dataset.id=n.id;
    tr.className = "concepto-fila" + (n.id===conceptoExpandidoId ? " active" : "");
    const cw=Math.round(n.confianza*56);
    const sins=(n.sinonimos_candidatos||[]).slice(0,4).map(s=>`<span class="tag">${esc(s)}</span>`).join("");
    const mas=(n.sinonimos_candidatos||[]).length>4?`<span class="muted" style="font-size:11px">+${n.sinonimos_candidatos.length-4}</span>`:"";
    const checked = conceptosState.seleccionados.has(n.id) ? "checked" : "";
    tr.innerHTML=`<td><input type="checkbox" class="concepto-check" ${checked}></td><td class="mono muted" style="font-size:11px">${esc(n.id)}</td><td class="c-label">${esc(n.label)}${n.editado?` <span class="edited-mark">${ico("edit-2",11)}</span>`:""}</td><td style="text-align:right">${n.menciones}</td><td><div class="conf-bar-wrap"><span class="conf-bar" style="width:${cw}px"></span><span class="conf-val">${n.confianza.toFixed(2)}</span></div></td><td>${sins}${mas}</td><td><button class="btn-inline btn-icon" data-edit-c="${esc(n.id)}" title="Editar">${ico("edit-2")}</button> <button class="btn-inline danger" data-del-c="${esc(n.id)}">${ico("trash-2")} Eliminar</button></td>`;
    tbody.appendChild(tr);
    tr.querySelector(".concepto-check").addEventListener("click", e => {
      e.stopPropagation();
      if (e.target.checked) conceptosState.seleccionados.add(n.id);
      else conceptosState.seleccionados.delete(n.id);
      renderConceptos();
    });
    tr.querySelector("[data-del-c]").addEventListener("click", async e => {
      e.stopPropagation();
      if (!confirm(`¿Eliminar el concepto "${n.label}"?`)) return;
      try {
        await apiFetch(`/api/validacion/${encodeURIComponent(state.slug)}/conceptos/${encodeURIComponent(n.id)}`, { method: "DELETE" });
        conceptosState.seleccionados.delete(n.id);
        await cargarGrafo(); tabsInit.delete("mapa"); renderConceptos();
      } catch(err) { alert("Error al eliminar: " + err.message); }
    });
    tr.addEventListener("click", e => {
      if (e.target.closest("[data-edit-c]") || e.target.closest("[data-del-c]") || e.target.closest(".concepto-check")) return;
      conceptoExpandidoId = conceptoExpandidoId === n.id ? null : n.id;
      renderConceptos();
    });
    tr.querySelector("[data-edit-c]").addEventListener("click",()=>abrirEditorConcepto(n,tr));

    if (n.id === conceptoExpandidoId) {
      const trDet = document.createElement("tr");
      trDet.className = "concepto-detalle-fila";
      trDet.innerHTML = `<td colspan="7"><div class="concepto-detalle">Buscando pasajes…</div></td>`;
      tbody.appendChild(trDet);
      const detEl = trDet.querySelector(".concepto-detalle");
      _cargarTextoBusqueda().then(({ oraciones }) => {
        if (conceptoExpandidoId !== n.id) return; // se cerró/cambió mientras cargaba
        const pasajes = _pasajesDeConcepto(n, oraciones);
        detEl.innerHTML = pasajes.length
          ? pasajes.map(p => `<p class="cita">"${esc(p)}"</p>`).join("")
          : `<p class="muted" style="font-size:var(--sn-fs-xs)">No se encontraron pasajes literales en el texto.</p>`;
      });
    }
  });
}

function abrirEditorConcepto(n,tr) {
  const lc=tr.querySelector(".c-label");
  const oL=n.label;
  lc.innerHTML=`<input class="edit-input" value="${esc(n.label)}">`;
  const inp=lc.querySelector("input");
  inp.focus(); inp.select();
  async function save() {
    const nl=inp.value.trim()||oL;
    if (nl===oL) { renderConceptos(); return; }
    try {
      await apiFetch(`/api/validacion/${encodeURIComponent(state.slug)}/conceptos/${encodeURIComponent(n.id)}`,{method:"PATCH",body:JSON.stringify({label:nl})});
      await cargarGrafo(); tabsInit.delete("mapa"); renderConceptos();
    } catch(e) { alert("Error: "+e.message); renderConceptos(); }
  }
  inp.addEventListener("keydown",e=>{ if(e.key==="Enter"){e.preventDefault();save();} if(e.key==="Escape")renderConceptos(); });
  inp.addEventListener("blur",()=>save());
}

// ════════════════════════════════════════════════════════════════════════
// Tab: Relaciones
// ════════════════════════════════════════════════════════════════════════
async function initRelaciones() {
  if (!state.grafo) await cargarGrafo();
  // El tipo es texto libre (ontología abierta): puede haber cientos de
  // valores casi únicos, así que va en un <select> y no en una fila de
  // chips (que antes crecía sin límite y rompía el layout de la pestaña).
  const tipos=[...new Set(state.grafo.links.map(l=>l.tipo).filter(Boolean))].sort();
  const fe=document.getElementById("filtro-rel-tipo");
  fe.innerHTML=`<option value="todos">Todos los tipos</option>`+
    tipos.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("");
  renderRelaciones();
  if (!relacionesListeners) {
    relacionesListeners=true;
    document.getElementById("buscar-relacion").addEventListener("input",e=>{
      relacionesState.busqueda=e.target.value.toLowerCase(); renderRelaciones();
    });
    document.querySelectorAll("#tabla-relaciones th.sortable").forEach(th=>th.addEventListener("click",()=>{
      const c=th.dataset.col;
      if(relacionesState.sort.col===c) relacionesState.sort.dir=relacionesState.sort.dir==="asc"?"desc":"asc";
      else{relacionesState.sort.col=c;relacionesState.sort.dir="asc";}
      renderRelaciones();
    }));
    fe.addEventListener("change",()=>{ relacionesState.filtroTipo=fe.value; renderRelaciones(); });
  }
  fe.value = relacionesState.filtroTipo;
}

function renderRelaciones() {
  const nById=Object.fromEntries(state.grafo.nodes.map(n=>[n.id,n]));
  let rows=state.grafo.links;
  if(relacionesState.filtroTipo!=="todos") rows=rows.filter(l=>l.tipo===relacionesState.filtroTipo);
  if(relacionesState.busqueda) { const q=relacionesState.busqueda; rows=rows.filter(l=>{ const lo=nById[l.source]?.label||"",ld=nById[l.target]?.label||""; return (l.etiqueta||"").toLowerCase().includes(q)||(l.tipo||"").toLowerCase().includes(q)||lo.toLowerCase().includes(q)||ld.toLowerCase().includes(q); }); }
  const {col,dir}=relacionesState.sort;
  rows=[...rows].sort((a,b)=>{ let av=a[col]??"",bv=b[col]??""; if(typeof av==="string")av=av.toLowerCase(); if(typeof bv==="string")bv=bv.toLowerCase(); return dir==="asc"?(av>bv?1:av<bv?-1:0):(av<bv?1:av>bv?-1:0); });
  document.querySelectorAll("#tabla-relaciones th.sortable").forEach(th=>{ th.classList.remove("sort-asc","sort-desc"); if(th.dataset.col===relacionesState.sort.col) th.classList.add(relacionesState.sort.dir==="asc"?"sort-asc":"sort-desc"); });
  const tbody=document.getElementById("relaciones-tbody"); tbody.innerHTML="";
  rows.forEach(l=>{
    const lo=nById[l.source]?.label||l.source, ld=nById[l.target]?.label||l.target;
    const cw=Math.round(l.confianza*56);
    const tr=document.createElement("tr"); tr.dataset.id=l.id;
    tr.className = "relacion-fila" + (l.id===relacionExpandidaId ? " active" : "");
    tr.innerHTML=`<td class="mono muted" style="font-size:11px">${esc(l.id)}</td><td style="text-align:center"><button class="bidir-toggle ${l.bidireccional?"on":""}" data-bidir="${l.id}" title="${l.bidireccional?"Bidireccional":"Unidireccional"}">${l.bidireccional?"↔":"→"}</button></td><td><span class="rel-concepto-fijo">${esc(lo)}</span></td><td class="r-tipo"><span class="tag">${esc(l.tipo||"—")}</span></td><td class="r-etiqueta">${esc(l.etiqueta||"")}${l.editado?` <span class="edited-mark">${ico("edit-2",11)}</span>`:""}</td><td><span class="rel-concepto-fijo">${esc(ld)}</span></td><td><div class="conf-bar-wrap"><span class="conf-bar" style="width:${cw}px"></span><span class="conf-val">${l.confianza.toFixed(2)}</span></div></td><td><button class="btn-inline" data-edit-r="${esc(l.id)}">${ico("edit-2")} Editar</button> <button class="btn-inline danger" data-del-r="${esc(l.id)}">${ico("trash-2")} Eliminar</button></td>`;
    tbody.appendChild(tr);
    tr.querySelector("[data-bidir]").addEventListener("click",e=>{
      e.stopPropagation();
      apiFetch(`/api/validacion/${encodeURIComponent(state.slug)}/relaciones/${encodeURIComponent(l.id)}`,{method:"PATCH",body:JSON.stringify({bidireccional:!l.bidireccional})})
        .then(()=>cargarGrafo()).then(()=>{ tabsInit.delete("mapa"); renderRelaciones(); })
        .catch(e=>alert("Error: "+e.message));
    });
    tr.querySelector("[data-edit-r]").addEventListener("click",e=>{ e.stopPropagation(); abrirEditorRelacion(l,tr); });
    tr.querySelector("[data-del-r]").addEventListener("click", async e => {
      e.stopPropagation();
      if (!confirm(`¿Eliminar la relación "${lo} → ${ld}"?`)) return;
      try {
        await apiFetch(`/api/validacion/${encodeURIComponent(state.slug)}/relaciones/${encodeURIComponent(l.id)}`, { method: "DELETE" });
        await cargarGrafo(); tabsInit.delete("mapa"); renderRelaciones();
      } catch(err) { alert("Error al eliminar: " + err.message); }
    });
    tr.addEventListener("click", e => {
      if (e.target.closest("[data-edit-r], [data-bidir]")) return;
      relacionExpandidaId = relacionExpandidaId === l.id ? null : l.id;
      renderRelaciones();
    });

    if (l.id === relacionExpandidaId) {
      const trDet = document.createElement("tr");
      trDet.className = "relacion-detalle-fila";
      trDet.innerHTML = `<td colspan="8"><div class="relacion-detalle">
        <button class="concepto-link" data-goto-concepto="${esc(l.source)}">${esc(lo)}</button>
        <span class="relacion-detalle-tipo">${esc(l.tipo||"—")}</span>
        <button class="concepto-link" data-goto-concepto="${esc(l.target)}">${esc(ld)}</button>
      </div></td>`;
      tbody.appendChild(trDet);
      trDet.querySelectorAll("[data-goto-concepto]").forEach(btn =>
        btn.addEventListener("click", () => irAConcepto(btn.dataset.gotoConcepto)));
    }
  });
}

// Lleva a la pestaña Conceptos con el concepto dado expandido y a la vista.
function irAConcepto(conceptoId) {
  conceptoExpandidoId = conceptoId;
  activarTab("conceptos");
  renderConceptos();
  requestAnimationFrame(() => {
    document.querySelector(`#conceptos-tbody tr[data-id="${CSS.escape(conceptoId)}"]`)
      ?.scrollIntoView({ block: "center" });
  });
}

function abrirEditorRelacion(l,tr) {
  const tc=tr.querySelector(".r-tipo"), ec=tr.querySelector(".r-etiqueta");
  const oT=l.tipo||"", oE=l.etiqueta||"";
  // tipo es ahora libre (ontología abierta)
  tc.innerHTML=`<input class="edit-input" value="${esc(oT)}" placeholder="tipo de relación…">`;
  ec.innerHTML=`<input class="edit-input" value="${esc(l.etiqueta||"")}">`;
  const sel=tc.querySelector("input"), inp=ec.querySelector("input");
  sel.focus(); sel.select();
  async function save() {
    const nt=sel.value.trim(), ne=inp.value.trim();
    const p={}; if(nt!==oT)p.tipo=nt; if(ne!==oE)p.etiqueta=ne;
    if (!Object.keys(p).length) { renderRelaciones(); return; }
    try { await apiFetch(`/api/validacion/${encodeURIComponent(state.slug)}/relaciones/${encodeURIComponent(l.id)}`,{method:"PATCH",body:JSON.stringify(p)}); await cargarGrafo(); tabsInit.delete("mapa"); renderRelaciones(); } catch(e){alert("Error: "+e.message);renderRelaciones();}
  }
  const cancel=()=>renderRelaciones();
  [inp,sel].forEach(el=>{ el.addEventListener("keydown",e=>{ if(e.key==="Enter"){e.preventDefault();save();} if(e.key==="Escape")cancel(); }); });
  inp.addEventListener("blur",()=>setTimeout(()=>{ if(document.activeElement!==sel)save(); },80));
  sel.addEventListener("blur",()=>setTimeout(()=>{ if(document.activeElement!==inp)save(); },80));
}

// ════════════════════════════════════════════════════════════════════════
// Event listeners
// ════════════════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", async () => {

  document.querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click", () => activarTab(b.dataset.tab)));

  document.getElementById("btn-biblioteca").addEventListener("click", volverBiblioteca);

  window.addEventListener("popstate", () => {
    const h = location.hash.slice(1);
    if (!h) volverBiblioteca();
    else if (h === "config") abrirConfig();
  });

  // Firebase restaura la sesión de forma async (lee IndexedDB); sin esto
  // init() pega a la API antes de que haya token y siempre recibe 401.
  if (window.lectografoAuthReady) await window.lectografoAuthReady;
  init();
});

// ════════════════════════════════════════════════════════════════════════
// Utility
// ════════════════════════════════════════════════════════════════════════
function campo(etiq, valor) {
  return `<div class="campo"><span class="campo-etiq">${etiq}</span><div class="campo-valor">${valor}</div></div>`;
}

function esc(str) {
  if (str==null) return "";
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ════════════════════════════════════════════════════════════════════════
// Settings panel
// ════════════════════════════════════════════════════════════════════════

function initSettingsPanel() {
  const btn       = document.getElementById("btn-settings");
  const modelSel  = document.getElementById("settings-model-sel");
  const modelCustom = document.getElementById("settings-model-custom");
  const keyStatus = document.getElementById("settings-key-status");
  const status    = document.getElementById("settings-model-status");
  const guardar   = document.getElementById("settings-guardar");

  // Modelos conocidos por proveedor (preset + opción personalizada)
  const MODELOS = {
    ollama:    [],   // se pueblan desde la API
    lmstudio:  [],   // se pueblan desde la API
    anthropic: ["claude-opus-4-6", "claude-sonnet-4-5", "claude-haiku-4-5-20251001"],
    openai:    ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o1-mini"],
    // Catálogos verificados a mano -- Vertex AI y AI Studio NO comparten
    // modelos ni nombres (nov-2026). gemini-2.x quedó deprecado para cuentas
    // nuevas en AI Studio ("no longer available to new users"); en Vertex,
    // en cambio, 2.5 es lo único que responde hoy -- todo lo demás 404.
    gemini:    ["gemini-flash-latest", "gemini-pro-latest", "gemini-flash-lite-latest", "gemini-3.8-flash", "gemini-4-argon", "gemini-4-carbon"],
    vertexai:  ["gemini-2.5-flash", "gemini-2.5-pro"],
  };

  let _cfg = null;       // última config recibida del servidor
  let _loading = false;  // evitar cargas simultáneas

  // ── Renderizar UI a partir de _cfg ───────────────────────────────
  function _render() {
    if (!_cfg) return;
    const provider = _cfg.provider;
    const ps = _cfg.providers_status || {};

    // Radios: marcar proveedor activo
    document.querySelectorAll('input[name="settings-provider"]').forEach(r => {
      r.checked = r.value === provider;
    });

    // Indicadores ✓/✗ de API keys
    ["anthropic", "openai", "gemini", "vertexai"].forEach(p => {
      const ind = document.getElementById(`settings-key-${p}`);
      if (!ind) return;
      const ok = (ps[p] || {}).has_key;
      ind.textContent = ok ? "✓" : "✗";
      ind.style.color = ok ? "var(--sn-ok)" : "var(--sn-danger)";
    });

    // Actualizar lista de modelos locales si la tenemos
    if (_cfg.available_models?.length) {
      if (_cfg.provider === "lmstudio") MODELOS.lmstudio = _cfg.available_models;
      else MODELOS.ollama = _cfg.available_models;
    }

    // Poblar selector con el proveedor activo
    _poblarModelos(provider, _cfg.model);
  }

  // ── Poblar el selector de modelos para un proveedor ─────────────
  function _poblarModelos(provider, modelActual) {
    const ps = (_cfg?.providers_status || {})[provider] || {};
    const isLocal = provider === "ollama" || provider === "lmstudio";
    const modelos = isLocal
      ? (MODELOS[provider].length ? MODELOS[provider] : (modelActual ? [modelActual] : []))
      : MODELOS[provider] || [];

    modelSel.innerHTML = "";

    if (isLocal && !modelos.length) {
      const label = provider === "lmstudio" ? "LM Studio" : "Ollama";
      modelSel.innerHTML = `<option value="">${label} no responde</option>`;
      modelSel.disabled = true;
      keyStatus.textContent = "";
    } else {
      modelSel.disabled = false;
      modelos.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m; opt.textContent = m;
        if (m === modelActual) opt.selected = true;
        modelSel.appendChild(opt);
      });
      // Opción personalizada para proveedores cloud
      if (!isLocal) {
        const optCustom = document.createElement("option");
        optCustom.value = "__custom__";
        optCustom.textContent = "Otro…";
        modelSel.appendChild(optCustom);
        // Si el modelo actual no está en la lista preset, seleccionar "Otro…"
        if (modelActual && !modelos.includes(modelActual)) {
          modelSel.value = "__custom__";
          modelCustom.value = modelActual;
        }
      }
      // Si nada quedó seleccionado, seleccionar el primero
      if (!modelSel.value && modelos.length) modelSel.value = modelos[0];
    }

    _toggleCustomInput();

    // Estado: locales no necesitan API key; Vertex AI factura al proyecto
    if (isLocal) {
      keyStatus.textContent = "";
    } else if (provider === "vertexai") {
      keyStatus.innerHTML = ico("check", 10) + " Factura a la cuenta de Google Cloud del proyecto";
      keyStatus.style.color = "var(--sn-ok)";
    } else {
      const ok = ps.has_key;
      keyStatus.innerHTML = ok
        ? ico("check", 10) + " API key configurada"
        : "⚠ API key no configurada en .env";
      keyStatus.style.color = ok ? "var(--sn-ok)" : "var(--sn-warn)";
    }
  }

  function _toggleCustomInput() {
    const custom = modelSel.value === "__custom__";
    modelCustom.style.display = custom ? "block" : "none";
    if (custom && !modelCustom.value) modelCustom.focus();
  }

  // ── Cargar configuración del servidor (no bloqueante) ────────────
  async function _cargar() {
    if (_loading) return;
    _loading = true;
    try {
      _cfg = await apiFetch("/api/settings");
      _render();
      status.textContent = "";
    } catch(e) {
      status.textContent = "Error al cargar configuración";
    } finally {
      _loading = false;
    }
  }

  // ── Abrir la vista de configuración (página propia, no overlay) ──
  btn.addEventListener("click", abrirConfig);
  window._cargarConfig = () => { if (_cfg) _render(); _cargar(); };

  // ── Cambio de proveedor ──────────────────────────────────────────
  document.querySelectorAll('input[name="settings-provider"]').forEach(r => {
    r.addEventListener("change", () => {
      if (!r.checked) return;
      const ps = (_cfg?.providers_status || {})[r.value] || {};
      _poblarModelos(r.value, ps.model || "");
    });
  });

  // Cambio en el selector de modelo
  modelSel.addEventListener("change", _toggleCustomInput);

  // ── Guardar ──────────────────────────────────────────────────────
  guardar.addEventListener("click", async () => {
    const provider = document.querySelector('input[name="settings-provider"]:checked')?.value;
    if (!provider) return;
    const model = modelSel.value === "__custom__"
      ? modelCustom.value.trim()
      : modelSel.value;
    if (!model) { status.textContent = "Elige un modelo"; return; }
    status.textContent = "Guardando…";
    guardar.disabled = true;
    try {
      const r = await apiFetch("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ provider, model }),
      });
      if (_cfg) { _cfg.provider = r.provider; _cfg.model = r.model; }
      status.innerHTML = ico("check", 12) + " Guardado";
      setTimeout(() => { status.textContent = ""; }, 2000);
    } catch(e) {
      status.textContent = "Error: " + e.message;
    } finally {
      guardar.disabled = false;
    }
  });
}

// ════════════════════════════════════════════════════════════════════════
// Ficha bibliográfica (modal desde la biblioteca)
// ════════════════════════════════════════════════════════════════════════

let _fichaSlug = null;

async function abrirFichaModal(slug) {
  _fichaSlug = slug;

  // Usar el endpoint universal de metadatos (funciona con o sin extracción)
  let m = {};
  try {
    m = await apiFetch(`/api/metadatos/${encodeURIComponent(slug)}`);
  } catch { /* slug no reconocido — empezar vacío */ }

  // Rellenar campos
  document.getElementById("fm-titulo").value    = m.titulo    || "";
  document.getElementById("fm-autores").value   = (m.autores  || []).join("; ");
  document.getElementById("fm-anio").value      = m.anio      || "";
  document.getElementById("fm-editorial").value = m.editorial || "";
  document.getElementById("fm-url").value       = m.url       || "";
  document.getElementById("fm-notas").value     = m.notas     || "";
  _actualizarPreviewCita();

  // Título del modal
  const titulo = m.titulo || slug.replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase());
  document.getElementById("ficha-modal-titulo").textContent = `Ficha — ${titulo}`;

  // Compartido con: la colaboración es plana, esto es solo informativo
  const compartidosEl = document.getElementById("fm-compartidos");
  compartidosEl.hidden = true;
  apiFetch(`/api/compartir/${encodeURIComponent(slug)}`).then(({ emails }) => {
    if (!emails?.length) return;
    compartidosEl.innerHTML = `${ico("users",11)} Compartido con: ${emails.map(esc).join(", ")}`;
    compartidosEl.hidden = false;
  }).catch(() => {});

  document.getElementById("ficha-modal").hidden = false;
}

function cerrarFichaModal() {
  document.getElementById("ficha-modal").hidden = true;
  _fichaSlug = null;
}

function _actualizarPreviewCita() {
  const autoresRaw = document.getElementById("fm-autores").value.trim();
  const autores = autoresRaw ? autoresRaw.split(";").map(a=>a.trim()).filter(Boolean) : [];
  const anio    = document.getElementById("fm-anio").value;
  const titulo  = document.getElementById("fm-titulo").value.trim();
  const editorial = document.getElementById("fm-editorial").value.trim();
  const cita = buildCita({ autores, anio: anio ? parseInt(anio) : null, titulo, editorial });
  const prev = document.getElementById("fm-cita-preview");
  prev.textContent = cita ? `Cita: ${cita}` : "";
}

async function guardarFichaModal() {
  if (!_fichaSlug) return;
  const autoresRaw = document.getElementById("fm-autores").value.trim();
  const autores = autoresRaw ? autoresRaw.split(";").map(a=>a.trim()).filter(Boolean) : [];
  const anioVal = document.getElementById("fm-anio").value;
  const payload = {
    titulo:    document.getElementById("fm-titulo").value.trim()    || null,
    autores,
    anio:      anioVal ? parseInt(anioVal, 10) : null,
    editorial: document.getElementById("fm-editorial").value.trim() || null,
    url:       document.getElementById("fm-url").value.trim()       || null,
    notas:     document.getElementById("fm-notas").value.trim()     || null,
  };
  Object.keys(payload).forEach(k => { if (payload[k] === null) delete payload[k]; });
  try {
    await apiFetch(`/api/metadatos/${encodeURIComponent(_fichaSlug)}`,
      { method: "PATCH", body: JSON.stringify(payload) });
    cerrarFichaModal();
    // Refrescar biblioteca para mostrar la cita actualizada
    const exts = await apiFetch("/api/extracciones");
    renderBiblioteca(exts);
  } catch(e) { alert("Error al guardar ficha: " + e.message); }
}

function initFichaModal() {
  document.getElementById("ficha-modal-cerrar").addEventListener("click", cerrarFichaModal);
  document.getElementById("ficha-modal-bg").addEventListener("click", cerrarFichaModal);
  document.getElementById("ficha-modal-cancelar").addEventListener("click", cerrarFichaModal);
  document.getElementById("ficha-modal-guardar").addEventListener("click", guardarFichaModal);

  // Preview en tiempo real
  ["fm-titulo","fm-autores","fm-anio","fm-editorial"].forEach(id =>
    document.getElementById(id).addEventListener("input", _actualizarPreviewCita)
  );

  // Cerrar con Escape
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !document.getElementById("ficha-modal").hidden) cerrarFichaModal();
  });
}

// ── Un mismo diálogo para las tareas con IA ─────────────────────────

let _iaTarea = null;

function abrirTareaIA(tarea) {
  if (_iaTarea || state.soloLectura) return;
  _iaTarea = tarea;
  tarea.focoAnterior = document.activeElement;
  const el = id => document.getElementById(id);
  const log = el("repro-log");
  const barra = el("repro-progress-inner");
  el("repro-modal-titulo").textContent = tarea.titulo;
  el("repro-confirm-titulo").textContent = tarea.titulo;
  el("repro-confirm-aviso").textContent = tarea.aviso || "";
  el("repro-estado-confirm").hidden = !tarea.aviso;
  el("repro-estado-proc").hidden = true;
  el("repro-estado-fin").hidden = true;
  el("repro-btn-ok").hidden = !tarea.aviso;
  el("repro-btn-ok").textContent = "Comenzar";
  el("repro-btn-cancelar").hidden = !tarea.aviso;
  el("repro-btn-cerrar").hidden = true;
  el("repro-modal-cerrar").disabled = false;
  el("repro-modal").hidden = false;
  log.textContent = "";
  el("repro-btn-ok").onclick = iniciar;
  el("repro-btn-ok").focus();

  async function iniciar() {
    if (tarea.activa) return;
    tarea.activa = true;
    el("repro-estado-confirm").hidden = true;
    el("repro-estado-proc").hidden = false;
    el("repro-btn-ok").hidden = true;
    el("repro-btn-cancelar").hidden = true;
    el("repro-modal-cerrar").disabled = true;
    const detener = el("repro-btn-detener");
    detener.hidden = !tarea.detener;
    detener.disabled = false;
    detener.textContent = "Detener";
    el("repro-fase").textContent = "Iniciando…";
    el("repro-tokens").textContent = "";
    barra.className = "repro-progress-indeterminate";
    barra.style.width = "";
    log.classList.add("rec-log-pre--active");
    log.focus();
    const ui = {
      reset() { log.textContent = ""; },
      append(texto) {
        const abajo = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
        log.textContent += texto;
        if (abajo) log.scrollTop = log.scrollHeight;
      },
      progreso(d) {
        if (d.chunk) ui.append(d.chunk);
        if (typeof d.tokens === "number") el("repro-tokens").textContent = `${d.tokens} tokens`;
        if (d.fase) el("repro-fase").textContent = d.fase;
      },
    };
    detener.onclick = async () => {
      detener.disabled = true;
      detener.textContent = "Deteniendo…";
      try {
        await tarea.detener();
        ui.append("\nCancelación solicitada. Esperando confirmación…\n");
      } catch (err) {
        ui.append(`\nNo se pudo detener: ${err.message}\n`);
        detener.disabled = false;
      }
    };
    let exito = false;
    try {
      el("repro-fin-msg").textContent = await tarea.ejecutar(ui);
      el("repro-fase").textContent = "Completado";
      exito = true;
    } catch (err) {
      el("repro-fin-msg").textContent = err.message;
      el("repro-fase").textContent = "Tarea interrumpida";
    } finally {
      tarea.activa = false;
      log.classList.remove("rec-log-pre--active");
      barra.className = "repro-progress-determinate";
      barra.style.width = exito ? "100%" : "0%";
      detener.hidden = true;
      el("repro-estado-fin").hidden = false;
      el("repro-modal-cerrar").disabled = false;
      el("repro-btn-cerrar").hidden = false;
      el("repro-btn-cerrar").textContent = tarea.textoContinuar || "Cerrar";
      el("repro-btn-cerrar").focus();
    }
  }
  if (!tarea.aviso) iniciar();
}

async function _reproCerrar() {
  if (_iaTarea?.activa) return;
  const tarea = _iaTarea;
  _iaTarea = null;
  document.getElementById("repro-modal").hidden = true;
  tarea?.focoAnterior?.focus();
  try { await tarea?.continuar?.(); } catch (err) { alert(`No se pudo abrir el resultado: ${err.message}`); }
}

async function _streamTareaIA(path, ui) {
  const token = await window.lectografoAuth?.getIdToken?.();
  const url = token ? `${path}?token=${encodeURIComponent(token)}` : path;
  return new Promise((resolve, reject) => {
    const es = new EventSource(url);
    let reconectando = false, fallos = 0;
    es.onopen = () => {
      // Cada conexión del servidor vuelve a enviar el registro desde el inicio.
      if (reconectando) ui.reset?.();
      reconectando = false;
      fallos = 0;
      ui.progreso({ fase: "Generando…" });
    };
    es.onmessage = ev => {
      try {
        const d = JSON.parse(ev.data);
        ui.progreso(d);
        if (d.done) { es.close(); resolve(d); }
      } catch (err) { es.close(); reject(err); }
    };
    es.onerror = () => {
      if (es.readyState !== 2 && ++fallos < 3) {
        reconectando = true;
        ui.progreso({ fase: "Reconectando con la tarea…" });
        return;
      }
      es.close();
      reject(new Error("Se perdió la conexión. La tarea puede seguir en el servidor; comprueba su estado antes de repetirla."));
    };
  });
}

async function _streamSimplificacion(slug, ui) {
  const r = await apiFetch(`/api/grafo/${encodeURIComponent(slug)}/simplificar/stream`, { method: "POST" }, true);
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let pendiente = "", terminado = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      pendiente += decoder.decode(value, { stream: !done });
      const eventos = pendiente.split("\n\n");
      pendiente = eventos.pop();
      for (const evento of eventos) {
        if (!evento.startsWith("data: ")) continue;
        const d = JSON.parse(evento.slice(6));
        ui.progreso(d);
        if (d.error) throw new Error(d.error);
        if (d.done) terminado = true;
      }
      if (done) break;
    }
    if (!terminado) throw new Error("La conexión terminó sin confirmar el resultado de la simplificación.");
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

function _procesarConModal(slug, payload, aviso) {
  const api = `/api/extracciones/${encodeURIComponent(slug)}`;
  abrirTareaIA({
    titulo: payload?.force ? "Reprocesar texto" : "Procesar texto",
    aviso,
    detener: () => apiFetch(`${api}/procesar`, { method: "DELETE" }),
    ejecutar: async ui => {
      if (payload) await apiFetch(`${api}/procesar`, { method: "POST", body: JSON.stringify(payload) });
      const d = await _streamTareaIA(`${api}/stream`, ui);
      if (d.estado !== "listo") throw new Error(d.estado || "El servidor no confirmó el resultado.");
      delete _miniGrafoCache[slug];
      if (state.slug === slug) {
        await refrescarValidacion(); await cargarGrafo();
        tabsInit.clear();
        state.mapaCards?.closeAll();
        await initTab(state.tabActivo);
      } else {
        renderBiblioteca(await apiFetch("/api/extracciones"));
      }
      return "Texto procesado. Los conceptos y relaciones están en el grafo común.";
    },
  });
}

function _simplificarConModal(slug) {
  abrirTareaIA({
    titulo: "Simplificar grafo",
    aviso: "Se ocultarán los conceptos menos seguros. Los datos se conservan.",
    ejecutar: async ui => {
      await _streamSimplificacion(slug, ui);
      delete _miniGrafoCache[slug];
      if (state.slug === slug) {
        await cargarGrafo(); tabsInit.delete("mapa"); renderConceptos();
      } else {
        renderBiblioteca(await apiFetch("/api/extracciones"));
      }
      return "Simplificación completada. El grafo común está actualizado.";
    },
  });
}

function reprocesarDesdeLibreria(slug) {
  _procesarConModal(slug, { force: true },
    "Se analizará el texto otra vez. Los conceptos, relaciones y glosas existentes se conservarán.");
}

async function publicarDocumento(slug, titulo, btn) {
  if (btn.dataset.publicado === "1") {
    if (!confirm(`¿Despublicar «${titulo}»? El link dejará de funcionar.`)) return;
    try {
      await apiFetch(`/api/publicar/${encodeURIComponent(slug)}`, { method: "DELETE" });
      btn.dataset.publicado = "0";
      btn.innerHTML = `${ico("link")} Publicar`;
    } catch(e) { alert("Error al despublicar: " + e.message); }
    return;
  }
  try {
    const r = await apiFetch("/api/publicar", { method: "POST", body: JSON.stringify({ slug }) });
    btn.dataset.publicado = "1";
    btn.innerHTML = `${ico("link")} Despublicar`;
    prompt(`"${titulo}" ya es público -- cualquiera puede leerlo (sin editar) con este link:`, location.origin + r.url);
  } catch(e) { alert("Error al publicar: " + e.message); }
}

async function compartirDocumento(slug, titulo) {
  const email = prompt(`Compartir «${titulo}» -- email de la persona:`);
  if (!email || !email.trim()) return;
  try {
    await apiFetch("/api/compartir", { method: "POST", body: JSON.stringify({ slug, email: email.trim() }) });
    alert(`Compartido con ${email.trim()}.`);
  } catch (e) { alert("Error al compartir: " + e.message); }
}

function _initReproModal() {
  ["repro-modal-cerrar", "repro-modal-bg", "repro-btn-cancelar", "repro-btn-cerrar"].forEach(id =>
    document.getElementById(id).addEventListener("click", _reproCerrar)
  );
  document.addEventListener("keydown", e => {
    const modal = document.getElementById("repro-modal");
    if (modal.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); _reproCerrar(); }
    if (e.key === "Tab") {
      const botones = [...modal.querySelectorAll("button, [tabindex='0']")].filter(b => !b.disabled && b.getClientRects().length);
      const primero = botones[0], ultimo = botones[botones.length - 1];
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo?.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero?.focus(); }
    }
  });
}
document.addEventListener("DOMContentLoaded", _initReproModal);

// ════════════════════════════════════════════════════════════════════════
// Tab: Texto (editor MD → HTML)
// ════════════════════════════════════════════════════════════════════════

let _textoData = null;   // datos cargados del API: { texto, es_editado, revisiones, … }
let _textoModoEdicion = false;

async function initTexto() {
  const metaEl       = document.getElementById("texto-meta");
  const renderEl     = document.getElementById("texto-render");
  const editorEl     = document.getElementById("texto-editor");
  const bannerEl     = document.getElementById("texto-desync-banner");
  const badgeEl      = document.getElementById("texto-revisiones-badge");
  const historialEl  = document.getElementById("texto-historial");
  const listaEl      = document.getElementById("texto-historial-lista");
  const btnEditar    = document.getElementById("btn-texto-editar");
  const btnGuardar   = document.getElementById("btn-texto-guardar");
  const btnCancelar  = document.getElementById("btn-texto-cancelar");

  renderEl.innerHTML = `<span class="muted">Cargando…</span>`;
  _textoModoEdicion = false;

  try {
    _textoData = await apiFetch(`/api/transcripts/${encodeURIComponent(state.slug)}`);
  } catch(e) {
    renderEl.innerHTML = `<span class="muted">No se pudo cargar el texto: ${esc(e.message)}</span>`;
    return;
  }

  // ── Metadatos / cita ──────────────────────────────────────────────
  const m = state.validacion?.metadatos;
  const cita = m ? buildCita(m) : "";
  metaEl.innerHTML = cita
    ? `<div class="texto-ficha"><span class="campo-etiq">Fuente</span> <em>${esc(cita)}</em></div>`
    : `<div class="texto-ficha muted" style="font-size:var(--sn-fs-xs)">Sin ficha bibliográfica —
         <button class="btn-inline" id="btn-abrir-ficha-texto">${ico("edit-2")} Añadir</button></div>`;
  document.getElementById("btn-abrir-ficha-texto")?.addEventListener("click", () => {
    abrirFichaModal(state.slug);
  });

  _renderTextoLectura();
  _renderTextoDesync();
  _renderTextoRevisiones();

  const textoWrap = document.getElementById("texto-wrap");
  const tabTexto  = document.getElementById("tab-texto");

  // Scroll sincronizado entre editor y preview (proporcional, codo a codo).
  // El guard se libera en el siguiente frame, no de inmediato: el scroll
  // programático de dst dispara su propio evento "scroll" de forma
  // asíncrona, y si limpiáramos la bandera antes de que llegue, ese evento
  // re-entra y arma un loop que dispara el scroll contrario a los extremos.
  let _syncingScroll = false;
  function _scrollSync(src, dst) {
    if (_syncingScroll || !_textoModoEdicion) return;
    _syncingScroll = true;
    const srcRange = src.scrollHeight - src.clientHeight;
    const ratio = srcRange > 0 ? src.scrollTop / srcRange : 0;
    dst.scrollTop = ratio * (dst.scrollHeight - dst.clientHeight);
    requestAnimationFrame(() => { _syncingScroll = false; });
  }
  editorEl.addEventListener("scroll", () => _scrollSync(editorEl, renderEl));
  renderEl.addEventListener("scroll", () => _scrollSync(renderEl, editorEl));

  function _entrarEdicion() {
    _textoModoEdicion = true;
    editorEl.value = _textoData.texto;
    editorEl.hidden = false;
    renderEl.hidden = false;          // visible como preview en vivo
    textoWrap.classList.add("editando");
    tabTexto.classList.add("editando");
    btnEditar.hidden = true;
    btnGuardar.hidden = false;
    btnCancelar.hidden = false;
    historialEl.open = false;
    editorEl.focus();
    // Live preview: actualizar render mientras se escribe
    editorEl.oninput = () => _renderDesdeEditor();
  }

  function _salirEdicion() {
    _textoModoEdicion = false;
    editorEl.hidden = true;
    editorEl.oninput = null;
    textoWrap.classList.remove("editando");
    tabTexto.classList.remove("editando");
    renderEl.hidden = false;
    btnEditar.hidden = false;
    btnGuardar.hidden = true;
    btnCancelar.hidden = true;
  }

  function _renderDesdeEditor() {
    const texto = editorEl.value;
    if (window._marked) {
      renderEl.innerHTML = window._marked.parse(texto);
    } else {
      renderEl.innerHTML = texto
        .split(/\n{2,}/)
        .map(p => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`)
        .join("");
    }
  }

  // ── Botón Editar ──────────────────────────────────────────────────
  btnEditar.onclick = _entrarEdicion;

  // ── Botón Cancelar ────────────────────────────────────────────────
  btnCancelar.onclick = () => {
    _salirEdicion();
    _renderTextoLectura();  // restaurar render original
  };

  // ── Botón Guardar ─────────────────────────────────────────────────
  btnGuardar.onclick = async () => {
    const textoNuevo = editorEl.value;
    btnGuardar.disabled = true;
    btnGuardar.textContent = "Guardando…";
    try {
      const res = await apiFetch(`/api/transcripts/${encodeURIComponent(state.slug)}`, {
        method: "PATCH",
        body: JSON.stringify({ texto: textoNuevo }),
      });
      // Actualizar datos locales
      _textoData.revisiones = [
        ..._textoData.revisiones,
        { fecha: new Date().toISOString(), nota_autor: null }
      ];
      _textoData.texto = textoNuevo;
      _textoData.es_editado = true;
      if (res.texto_desincronizado_desde) {
        _textoData.texto_desincronizado_desde = res.texto_desincronizado_desde;
      }

      // Volver a modo lectura
      _salirEdicion();
      _renderTextoLectura();
      _renderTextoDesync();
      _renderTextoRevisiones();
    } catch(e) {
      alert("Error al guardar: " + e.message);
    } finally {
      btnGuardar.disabled = false;
      btnGuardar.textContent = "Guardar";
    }
  };

  // ── Zona de peligro ───────────────────────────────────────────────
  document.getElementById("btn-texto-desprocesar").onclick = async () => {
    const titulo = state.validacion?.titulo || state.slug;
    if (!confirm(`¿Des-procesar "${titulo}"?\nSe borrará el grafo extraído. El texto fuente se conserva y podrás volver a procesarlo.`)) return;
    try {
      await apiFetch(`/api/extracciones/${encodeURIComponent(state.slug)}`, { method: "DELETE" });
      await mostrarBiblioteca();
    } catch(e) { alert("Error: " + e.message); }
  };

  document.getElementById("btn-texto-borrar").onclick = async () => {
    const titulo = state.validacion?.titulo || state.slug;
    if (!confirm(`¿Eliminar completamente "${titulo}"?\nSe borrará el texto y su grafo de forma permanente. Esta acción no tiene vuelta atrás.`)) return;
    try {
      await apiFetch(`/api/transcripts/${encodeURIComponent(state.slug)}`, { method: "DELETE" });
      await mostrarBiblioteca();
    } catch(e) { alert("Error: " + e.message); }
  };

  function _renderTextoLectura() {
    // Renderizar MD → HTML usando marked si está disponible, texto plano en caso contrario
    const texto = _textoData.texto || "";
    if (window._marked) {
      renderEl.innerHTML = window._marked.parse(texto);
    } else {
      // Fallback: párrafos separados por doble salto + escapado
      renderEl.innerHTML = texto
        .split(/\n{2,}/)
        .map(p => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`)
        .join("");
    }
  }

  function _renderTextoDesync() {
    const desync = _textoData.texto_desincronizado_desde;
    bannerEl.hidden = !desync;
    if (desync) {
      const fecha = new Date(desync).toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
      document.getElementById("texto-desync-msg").textContent =
        `El texto fue editado el ${fecha}. El grafo puede no reflejar la versión actual.`;
    }
  }

  function _renderTextoRevisiones() {
    const revs = _textoData.revisiones || [];
    badgeEl.hidden = revs.length === 0;
    if (revs.length > 0) {
      badgeEl.textContent = `${revs.length} revisión${revs.length !== 1 ? "es" : ""}`;
      badgeEl.hidden = false;
    }
    historialEl.hidden = revs.length === 0;
    listaEl.innerHTML = [...revs].reverse().map((r, i) => {
      const fecha = new Date(r.fecha).toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
      const nota = r.nota_autor ? ` — <em>${esc(r.nota_autor)}</em>` : "";
      return `<li class="texto-rev-item"><span class="muted">${fecha}</span>${nota}</li>`;
    }).join("");
  }
}

// Cargar marked.js de forma diferida (solo cuando se usa el tab de texto)
(async () => {
  try {
    const { marked } = await import("https://cdn.jsdelivr.net/npm/marked@12/+esm");
    window._marked = { parse: marked };
  } catch(_) { /* fallback a párrafos planos */ }
})();

