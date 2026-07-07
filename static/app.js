// ════════════════════════════════════════════════════════════════════════
// Estado global
// ════════════════════════════════════════════════════════════════════════
const state = {
  slug:        null,
  validacion:  null,
  grafo:       null,
  tabActivo:   "mapa",
  path:        [],     // camino de navegación en el mapa: [{ node, link, dir }]
  grafoUpdate: null,   // fn updateVisuals() exportada por initGrafo/initGrafo3D
  grafoHighlight: null, // fn highlightPath() exportada por initGrafo/initGrafo3D
  grafoFit:    null,   // fn fitView() del renderer activo
  grafoDestroy: null,  // fn destroy() del renderer 3D activo (null en modo 2D)
  modo3d:      false,  // vista activa del mapa: 2D (D3/SVG) o 3D (three.js)
  navCols:     null,   // instancia activa de initNavCols
};

const tabsInit = new Set();
const conceptosState  = { sort:{ col:"menciones", dir:"desc" }, filtroTipo:"todos", busqueda:"" };
const relacionesState = { sort:{ col:"confianza",  dir:"desc" }, filtroTipo:"todos", busqueda:"" };
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
    "check":          `<polyline points="20 6 9 17 4 12"/>`,
    "corner-up-left": `<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>`,
    "edit-2":         `<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>`,
    "maximize-2":     `<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>`,
    "refresh-cw":     `<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>`,
    "skip-forward":   `<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>`,
    "terminal":       `<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>`,
    "trash-2":        `<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>`,
    "x":              `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
    "x-circle":       `<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>`,
    "zap":            `<polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]||""}</svg>`;
}

// ════════════════════════════════════════════════════════════════════════
// API helpers
// ════════════════════════════════════════════════════════════════════════
async function apiFetch(path, opts={}) {
  const r = await fetch(path, { headers:{"Content-Type":"application/json"}, ...opts });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  return r.json();
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
  const exts = await apiFetch("/api/extracciones");
  const h = location.hash.slice(1);
  if (h.startsWith("gp:")) {
    await abrirGrafoPersonal(h.slice(3));
  } else if (h && exts.find(e => e.slug === h)) {
    await abrirTexto(h);
  } else {
    await mostrarBiblioteca(exts);
  }
  initNuevoGPForm();
  initFichaModal();
  initSettingsPanel();
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
  document.getElementById("transcripcion-titulo").textContent = "";

  // Ocultar paneles de texto y vista GP, mostrar biblioteca
  document.querySelectorAll(".tab-panel").forEach(p => { p.hidden = true; });
  document.getElementById("vista-gp").hidden = true;
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
  state.tabActivo = null;
  state.path = [];
  if (state.navCols) { state.navCols.destruir(); state.navCols = null; }
  tabsInit.clear();

  history.replaceState(null, "", location.pathname);
  renderBiblioteca(exts);

  // Cargar grafos personales
  const grafos = await cargarGrafosPersonales();
  renderGrafosPersonales(grafos);
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
        const pct          = e.porcentaje || 0;
        const elapsed      = e.elapsed || 0;
        const tokens       = e.tokens || 0;
        const tokTotal     = e.tokens_total || 0;
        const totalLotes   = e.total_lotes || 0;
        const lotesProc    = e.lotes_procesados || 0;
        const modoInc      = e.modo_extraccion === "incremental";

        // Línea de estado: qué está haciendo (basado en datos reales de Ollama)
        const modeloEnRam = e.modelo_en_ram;  // true/false/null (null = desconocido aún)
        let estadoStr;
        if (e.fase_extraccion === "leyendo")
          estadoStr = "Leyendo texto…";
        else if (e.fase_extraccion === "guardando")
          estadoStr = "Guardando…";
        else if (e.fase_extraccion === "cargando_modelo")
          estadoStr = "Cargando modelo en memoria…";
        else if (modoInc && totalLotes > 0) {
          const loteActual = Math.min(lotesProc + 1, totalLotes);
          estadoStr = `Fragmento ${loteActual} de ${totalLotes}…`;
        } else if (tokens === 0 && elapsed < 10)
          estadoStr = "Iniciando…";
        else if (tokens === 0 && modeloEnRam === false)
          estadoStr = "Cargando modelo en memoria…";
        else if (tokens === 0 && modeloEnRam === true)
          estadoStr = "Procesando prompt…";
        else if (tokens === 0)
          estadoStr = "Esperando al modelo…";
        else
          estadoStr = "Generando…";

        // Línea de métricas
        let metricaStr;
        if (modoInc && totalLotes > 0) {
          metricaStr = `${lotesProc}/${totalLotes} lotes · ${_formatElapsed(elapsed)}`;
        } else if (pct > 0) {
          const restSec = Math.round(elapsed / (pct / 100) * (1 - pct / 100));
          metricaStr = `${pct}% · ${tokens} / ~${tokTotal} tokens · ~${_formatElapsed(restSec)} restante`;
        } else if (tokens > 0) {
          metricaStr = `${tokens} tokens · ${_formatElapsed(elapsed)}`;
        } else {
          metricaStr = _formatElapsed(elapsed);
        }

        const logAbierto = _logAbiertos.has(e.slug) || !!e.texto_llm;   // auto-mostrar cuando hay output
        const textoLog   = e.texto_llm || "";
        const conceptos  = e.conceptos_parciales  || [];
        const relaciones = e.relaciones_parciales || [];

        // Mapa id→concepto para resolver relaciones parciales
        const idAConcepto = {};
        conceptos.forEach(c => { if (c.id) idAConcepto[c.id] = c; });

        // Solo mostrar conceptos que ya tienen al menos una relación conocida
        const idsConexos = new Set(relaciones.flatMap(r => [r.origen_id, r.destino_id]));
        const conceptosConexos = relaciones.length > 0
          ? conceptos.filter(c => idsConexos.has(c.id))
          : conceptos;   // si aún no hay relaciones, mostrar todos (estado inicial)

        const conceptosTags = conceptosConexos.map(c =>
          `<span class="bib-ctag bib-ctag-${esc(c.tipo || "primitivo")}">${esc(c.label)}</span>`
        ).join("");

        const relacionesTags = relaciones.slice(0, 12).map(r => {
          const origen  = (idAConcepto[r.origen_id]  || {}).label || r.origen_id;
          const destino = (idAConcepto[r.destino_id] || {}).label || r.destino_id;
          return `<span class="bib-rtag">${esc(origen)} <span class="bib-rtag-arrow">→</span> ${esc(destino)}</span>`;
        }).join("");

        return `<div class="bib-card bib-card-procesando">
          <div class="bib-card-inner">
            <div class="bib-card-titulo">${esc(e.titulo)}</div>
            <div class="bib-procesando-wrap">
              ${pct > 0
                ? `<div class="bib-progress-wrap"><div class="bib-progress-bar" style="width:${pct}%"></div></div>`
                : `<div class="bib-progress-indeterminate"></div>`}
              <div class="bib-procesando-info">
                <span class="bib-fase-msg">${esc(estadoStr)}</span>
                <span class="bib-elapsed muted">${esc(metricaStr)}</span>
              </div>
            </div>
            ${conceptosConexos.length > 0 ? `
              <div class="bib-extraccion-live">
                <div class="bib-live-label muted">${conceptosConexos.length} concepto${conceptosConexos.length !== 1 ? "s" : ""} conectado${conceptosConexos.length !== 1 ? "s" : ""}</div>
                <div class="bib-ctags">${conceptosTags}</div>
                ${relacionesTags ? `<div class="bib-rtags">${relacionesTags}</div>` : ""}
              </div>` : ""}
            ${logAbierto ? `<pre class="bib-log-panel" data-slug="${esc(e.slug)}">${esc(textoLog)}</pre>` : ""}
          </div>
          <div class="bib-card-footer">
            <button class="btn-inline bib-btn-log ${logAbierto ? "active" : ""}" data-slug="${esc(e.slug)}" title="${logAbierto ? "Ocultar log" : "Ver log raw"}">${ico("terminal")} Log</button>
            <button class="btn-inline danger bib-btn-detener" data-slug="${esc(e.slug)}" title="Detener extracción">${ico("x")} Detener</button>
          </div>
        </div>`;
      }
      const errorMsg = e.error ? `<span class="bib-error">${esc(e.error.replace("error:",""))}</span>` : "";
      const citaSP = e.metadatos ? buildCita(e.metadatos) : "";
      return `<div class="bib-card bib-card-sin-procesar">
        <div class="bib-card-inner">
          <div class="bib-card-titulo">${esc(e.titulo)}</div>
          ${citaSP ? `<div class="bib-card-cita muted">${esc(citaSP)}</div>` : ""}
          ${errorMsg}
          <div class="bib-card-meta">
            <span class="bib-fase bib-fase-sin_validar">Sin procesar</span>
            <button class="btn-procesar" data-slug="${esc(e.slug)}">${ico("zap")} Procesar</button>
          </div>
        </div>
        <div class="bib-card-footer">
          <button class="btn-inline bib-btn-ficha" data-slug="${esc(e.slug)}" title="Editar ficha bibliográfica">${ico("edit-2")} Ficha</button>
        </div>
      </div>`;
    }

    // Transcript ya extraído — card clicable con footer de acciones
    const citaCard = e.metadatos ? buildCita(e.metadatos) : "";

    return `<div class="bib-card" data-slug="${esc(e.slug)}">
      <div class="bib-mini-mapa bib-card-click" data-slug="${esc(e.slug)}"></div>
      <div class="bib-card-click bib-card-body">
        <div class="bib-card-titulo">${esc(e.titulo)}</div>
        ${citaCard
          ? `<div class="bib-card-cita muted">${esc(citaCard)}</div>`
          : `<div class="bib-card-cita muted bib-sin-ficha">Sin ficha bibliográfica</div>`}
      </div>
      <div class="bib-card-footer">
        <button class="btn-inline bib-btn-ficha" data-slug="${esc(e.slug)}" title="Editar ficha bibliográfica">${ico("edit-2")} Ficha</button>
        <button class="btn-inline danger bib-btn-repro" data-slug="${esc(e.slug)}" title="Re-extraer con el LLM">${ico("refresh-cw")} Re-procesar</button>
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

  // Toggle log panel
  grid.querySelectorAll(".bib-btn-log").forEach(btn =>
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const slug = btn.dataset.slug;
      if (_logAbiertos.has(slug)) _logAbiertos.delete(slug);
      else _logAbiertos.add(slug);
      // Re-render inmediato para mostrar/ocultar
      apiFetch("/api/extracciones").then(renderBiblioteca);
    })
  );

  // Conectar SSE a log panels activos — se gestiona por slug (no por elemento DOM)
  grid.querySelectorAll(".bib-log-panel[data-slug]").forEach(pre => {
    const slug = pre.dataset.slug;
    if (_extLogStreams[slug]) {
      // Ya hay SSE activo: actualizar referencia al nuevo elemento DOM
      _extLogStreams[slug].pre = pre;
      return;
    }
    const stream = { pre, es: null };
    _extLogStreams[slug] = stream;
    const es = new EventSource(`/api/extracciones/${encodeURIComponent(slug)}/stream`);
    stream.es = es;
    es.onmessage = (ev) => {
      const d = JSON.parse(ev.data);
      const target = _extLogStreams[slug]?.pre;
      if (d.chunk && target) {
        target.textContent = (target.textContent + d.chunk).slice(-8000);
        target.scrollTop = target.scrollHeight;
      }
      if (d.done) {
        es.close();
        delete _extLogStreams[slug];
      }
    };
    es.onerror = () => { es.close(); delete _extLogStreams[slug]; };
  });

  // Detener extracción en curso
  grid.querySelectorAll(".bib-btn-detener").forEach(btn =>
    btn.addEventListener("click", async e => {
      e.stopPropagation();
      btn.disabled = true; btn.textContent = "Deteniendo…";
      try {
        await apiFetch(`/api/extracciones/${encodeURIComponent(btn.dataset.slug)}/procesar`, { method: "DELETE" });
      } catch(err) { alert("Error al detener: " + err.message); }
    })
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
const _logAbiertos = new Set();     // slugs cuyo log panel está visible
const _miniGrafoCache = {};         // slug → { nodes, links } ya cargado
const _extLogStreams = {};          // slug → { pre, es } SSE activo para extracción

// ── Mini-mapa en tarjetas de biblioteca ────────────────────────────────
const REL_PALETTE_MINI = [
  "#2a6da1","#7b4899","#c07030","#166e5a","#ae2d13","#2a6e40","#8a6012","#5c5049","#3d6b6b"
];

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

async function _renderMiniGrafos(slugs) {
  for (const slug of slugs) {
    const container = document.querySelector(`.bib-mini-mapa[data-slug="${CSS.escape(slug)}"]`);
    if (!container || container.childElementCount > 0) continue;

    try {
      if (!_miniGrafoCache[slug]) {
        _miniGrafoCache[slug] = await apiFetch(`/api/grafo/${encodeURIComponent(slug)}`);
      }
      const { nodes: rawNodes, links: rawLinks } = _miniGrafoCache[slug];
      // Cuadrado: el contenedor tiene aspect-ratio:1, pero leemos el ancho real
      const S = container.clientWidth || 260;
      const svg = await _construirMallaSVG(rawNodes, rawLinks, S);
      if (svg) container.appendChild(svg);
    } catch(_) { /* ignorar errores por tarjeta */ }
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
  try {
    await apiFetch(`/api/extracciones/${encodeURIComponent(slug)}/procesar`, { method: "POST", body: "{}" });
  } catch(err) {
    alert("Error al iniciar extracción: " + err.message);
    return;
  }
  // Refrescar inmediatamente para mostrar el spinner
  const exts = await apiFetch("/api/extracciones");
  renderBiblioteca(exts);
  _arrancarPolling();
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

async function abrirTexto(slug) {
  // Ocultar biblioteca
  document.getElementById("vista-biblioteca").hidden = true;

  // Topbar: modo texto
  document.getElementById("btn-biblioteca").hidden = false;
  document.getElementById("tabs").hidden = false;

  // Cargar datos del texto
  await cargarValidacion(slug);

  // Activar primer tab
  activarTab("mapa");

  // Deep-link
  history.pushState(null, "", `#${slug}`);

  // Favicon: minimapa del texto abierto
  _actualizarFaviconParaTexto(slug);
}

function volverBiblioteca() {
  if (_pollingBiblioteca) { clearInterval(_pollingBiblioteca); _pollingBiblioteca = null; }
  // Si estamos en un grafo personal, limpiar ese estado
  if (gpState.slug) { volverBibliotecaDesdeGP(); return; }
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

  // ── Navegador de columnas ──────────────────────────────────────────
  const navColsEl = document.getElementById("nav-cols");
  if (navColsEl && !state.navCols) {
    const { initNavCols } = await import("./navcols.js");
    state.navCols = initNavCols(navColsEl, {
      onCerrar: id => {
        const idx = parseInt(id.replace("col-", ""), 10);
        state.path = state.path.slice(0, idx);
        refrescarHighlight();
      },
    });
  }

  // ── Grafo de fuerza (raíz de la navegación) ────────────────────────
  await initMapaForce();

  // ── Botones de mantenimiento del grafo ─────────────────────────────
  await actualizarBotonSesion(SESION_RECONEXION);
  await actualizarBotonSesion(SESION_CONSOLIDACION);
  const btnRec = document.getElementById("btn-reconectar");
  if (btnRec) btnRec.onclick = () => abrirPanelSesion(SESION_RECONEXION);
  const btnCons = document.getElementById("btn-consolidar");
  if (btnCons) btnCons.onclick = () => abrirPanelSesion(SESION_CONSOLIDACION);
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
    const { updateVisuals, highlightPath, fitView, destroy } = initGrafo3D(el3d, state.grafo, onNodoSeleccionado, { autoFit: !yaEn3D });
    state.grafoUpdate    = updateVisuals;
    state.grafoHighlight = highlightPath;
    state.grafoFit       = fitView;
    state.grafoDestroy   = destroy;
  } else {
    svgEl.removeAttribute("hidden"); el3d.setAttribute("hidden", "");
    const { initGrafo } = await import("./grafo.js");
    const { relColorScale, relTypes, updateVisuals, highlightPath, fitView } = initGrafo(svgEl, state.grafo, onNodoSeleccionado);
    state.grafoUpdate    = updateVisuals;
    state.grafoHighlight = highlightPath;
    state.grafoFit       = fitView;
    state.relColor       = relColorScale;
    renderLeyenda(relColorScale, relTypes);
  }
  refrescarHighlight();

  const btnFit = document.getElementById("btn-fit");
  if (btnFit) btnFit.onclick = () => state.grafoFit?.();

  const btnModo3d = document.getElementById("btn-modo3d");
  const lblModo3d = document.getElementById("btn-modo3d-label");
  if (btnModo3d) {
    btnModo3d.classList.toggle("active", state.modo3d);
    if (lblModo3d) lblModo3d.textContent = state.modo3d ? "2D" : "3D";
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

// ── Navegador de columnas: nodo del grafo → columnas concepto+relaciones ──
// state.path: [{ node, link, dir }] — link/dir describen cómo se llegó a
// ese paso (null para el primero). Cada paso es una columna en #nav-cols.

const DIR_SYM = { saliente: "→", entrante: "←", bidireccional: "↔" };

function onNodoSeleccionado(nodo) {
  if (!nodo) { limpiarCamino(); return; }
  state.path = [{ node: nodo, link: null, dir: null }];
  renderColumnasDesde(0);
  refrescarHighlight();
}

function limpiarCamino() {
  state.path = [];
  state.navCols?.limpiar();
  refrescarHighlight();
}

function avanzarCamino(nodoId, link, dir, colIdx) {
  const nodo = state.grafo?.nodes.find(n => n.id === nodoId);
  if (!nodo) return;
  state.path = state.path.slice(0, colIdx + 1);
  state.path.push({ node: nodo, link, dir });
  renderColumnasDesde(colIdx + 1);
  refrescarHighlight();
}

function refrescarHighlight() {
  if (!state.grafoHighlight) return;
  state.grafoHighlight(state.path.map(p => ({ nodeId: p.node.id, linkId: p.link?.id || null })));
}

// Reata las referencias de state.path al grafo recién recargado (los objetos
// nodo/link cambian de identidad en cada cargarGrafo()); descarta pasos cuyo
// nodo ya no exista.
function resincronizarPath() {
  if (!state.grafo) { state.path = []; return; }
  const nodeById = Object.fromEntries(state.grafo.nodes.map(n => [n.id, n]));
  const linkById = Object.fromEntries(state.grafo.links.map(l => [l.id, l]));
  state.path = state.path
    .map(p => ({ node: nodeById[p.node.id], link: p.link ? linkById[p.link.id] : null, dir: p.dir }))
    .filter(p => p.node);
}

function renderColumnasDesde(idx) {
  if (!state.navCols) return;
  state.navCols.truncarDesde(`col-${idx}`);
  for (let i = idx; i < state.path.length; i++) {
    const paso = state.path[i];
    state.navCols.abrirColumna({
      id: `col-${i}`,
      headerHtml: buildColHeaderHTML(paso),
      bodyHtml:   buildPanelHTML(paso.node, i),
      onBind:     colEl => bindPanelListeners(colEl, paso.node, i),
    });
  }
}

function buildColHeaderHTML(paso) {
  const { node, link, dir } = paso;
  let h = "";
  if (link && dir) {
    const sym   = DIR_SYM[dir] || "";
    const frase = link.frase_completa || link.etiqueta || (link.tipo ? link.tipo.replace(/_/g, " ") : "");
    const tipo  = link.tipo ? link.tipo.replace(/_/g, " ") : "";
    h += `<div class="nav-col-rama">
      <span class="nav-col-dir">${sym}</span>
      <span class="nav-col-frase-wrap">
        <span class="nav-col-frase">${esc(frase)}</span>
        ${tipo ? `<span class="nav-col-tipo-tag">${esc(tipo)}</span>` : ""}
      </span>
    </div>`;
  }
  h += `<div class="nav-col-titlerow">
    <div class="nav-col-raiz">${esc(node.label)}</div>
    <button class="nav-col-close" title="Cerrar">×</button>
  </div>`;
  return h;
}

function buildPanelHTML(nodo, colIdx) {
  let h="";

  if (nodo.editado) {
    h+=`<div class="panel-editado"><span class="edited-mark" title="Editado por investigador">${ico("edit-2",11)} editado</span></div>`;
  }

  // ── Detalles del concepto ─────────────────────────────────────────────
  h+=`<div class="panel-seccion">`;
  h+=`<div class="campo"><span class="campo-etiq">Menciones · Confianza</span>
    <div>${nodo.menciones} menciones &ensp;<span style="color:var(--badge-conf-text)">${nodo.confianza.toFixed(2)}</span></div></div>`;
  if (nodo.descripcion) h+=campo("Descripción",esc(nodo.descripcion));
  if (nodo.cita_directa) h+=campo("Cita directa",`<p class="cita">"${esc(nodo.cita_directa)}"</p>`);
  if (nodo.sinonimos_candidatos?.length) h+=`<div class="campo"><span class="campo-etiq">Sinónimos candidatos</span><div class="sinonimos-lista">${nodo.sinonimos_candidatos.map(s=>`<span class="tag">${esc(s)}</span>`).join("")}</div></div>`;
  h+=`</div>`;

  // ── Relaciones (clicables: cada una abre la siguiente columna) ────────
  h+=buildRelacionesHTML(nodo, colIdx);

  // ── Nueva relación ────────────────────────────────────────────────────
  h+=buildNuevaRelacionHTML(nodo);

  // ── Anotaciones ───────────────────────────────────────────────────────
  h+=buildAnnotationPanelHTML(nodo);

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

function buildRelacionesHTML(nodo, colIdx) {
  const color = state.relColor || (() => "#888");
  const nodeById = Object.fromEntries((state.grafo?.nodes||[]).map(n=>[n.id,n]));
  const conex = conexionesDe(nodo.id);

  if (!conex.length) {
    return `<div class="panel-seccion">
      <div class="panel-seccion-titulo">Relaciones</div>
      <p class="muted" style="font-size:var(--sn-fs-xs)">Sin conexiones.</p>
    </div>`;
  }

  const siguienteLinkId = state.path[colIdx + 1]?.link?.id || null;

  const grupos = { saliente: [], bidireccional: [], entrante: [] };
  conex.forEach(item => grupos[item.dir]?.push(item));
  const grupoMeta = {
    saliente:      { label: "Salientes",       sym: DIR_SYM.saliente },
    bidireccional: { label: "Bidireccionales", sym: DIR_SYM.bidireccional },
    entrante:      { label: "Entrantes",       sym: DIR_SYM.entrante },
  };

  let h = `<div class="panel-seccion"><div class="panel-seccion-titulo">Relaciones (${conex.length})</div>`;
  let primerGrupo = true;
  ["saliente", "bidireccional", "entrante"].forEach(dir => {
    const items = grupos[dir];
    if (!items.length) return;
    const { label, sym } = grupoMeta[dir];
    const abierto = primerGrupo; primerGrupo = false;

    h += `<details class="panel-rel-grupo"${abierto ? " open" : ""}>
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
      const elegida = link.id === siguienteLinkId;

      h += `<button class="panel-rel-fila panel-rel-fila--clicable${elegida ? " panel-rel-fila--elegida" : ""}"
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
  h += `</div>`;
  return h;
}

function buildNuevaRelacionHTML(nodo) {
  const TIPOS = ["fundamenta","amplifica","especifica","contraposicion","constituye","genera","presupone"];
  // Existing links from/to this node (to mark already-connected concepts)
  const conectados = new Set(
    (state.grafo?.links || [])
      .filter(l => l.source === nodo.id || l.target === nodo.id)
      .flatMap(l => [l.source, l.target])
  );
  conectados.delete(nodo.id);

  const otros = (state.grafo?.nodes || [])
    .filter(n => n.id !== nodo.id)
    .sort((a, b) => a.label.localeCompare(b.label));

  return `<details class="panel-seccion">
    <summary class="panel-seccion-titulo panel-seccion-summary">Vincular con otro concepto</summary>
    <div class="campo">
      <span class="campo-etiq">Concepto destino</span>
      <select id="nr-destino" class="edit-select" style="width:100%">
        <option value="">— Seleccionar —</option>
        ${otros.map(n => `<option value="${esc(n.id)}" ${conectados.has(n.id)?"":""}>${esc(n.label)}${conectados.has(n.id)?" ✓":""}</option>`).join("")}
      </select>
    </div>
    <div class="campo">
      <span class="campo-etiq">Tipo</span>
      <select id="nr-tipo" class="edit-select" style="width:100%">
        ${TIPOS.map(t=>`<option value="${t}">${t}</option>`).join("")}
      </select>
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
  let h=`<details class="panel-seccion"${anotaciones.length ? " open" : ""}>
    <summary class="panel-seccion-titulo panel-seccion-summary">Anotaciones</summary>`;
  if (anotaciones.length) {
    h+=anotaciones.map(a=>`<div class="panel-anotacion">
      <p class="cita">${esc(a.nota)}</p>
      <span class="muted" style="font-size:10px">${new Date(a.creada_en).toLocaleDateString("es",{day:"numeric",month:"short",year:"numeric"})}</span>
    </div>`).join("");
  }
  h+=`<textarea id="pb-anotacion" class="panel-nota-input" rows="2" placeholder="Añadir nota…" style="margin-top:8px"></textarea>
    <button id="pb-anotar" class="btn btn-neutro small" style="margin-top:6px;width:100%">Guardar nota</button>
  </details>`;
  return h;
}

function bindPanelListeners(colEl, nodo, colIdx) {
  colEl.querySelector("#pb-anotar")?.addEventListener("click", () => {
    const t = colEl.querySelector("#pb-anotacion")?.value.trim();
    if (t) anotarEnPanel(nodo.id, t, colIdx);
  });

  // Nueva relación
  colEl.querySelector("#nr-crear")?.addEventListener("click", () => {
    const destino  = colEl.querySelector("#nr-destino")?.value;
    const tipo     = colEl.querySelector("#nr-tipo")?.value;
    const etiqueta = colEl.querySelector("#nr-etiqueta")?.value.trim();
    const bidir    = colEl.querySelector("#nr-bidir")?.checked || false;
    if (!destino)  { colEl.querySelector("#nr-destino").focus();  return; }
    if (!etiqueta) { colEl.querySelector("#nr-etiqueta").focus(); return; }
    crearRelacion(nodo.id, destino, tipo, etiqueta, bidir);
  });

  // Relaciones: cada una abre (o reemplaza) la columna siguiente
  colEl.querySelectorAll(".panel-rel-fila--clicable").forEach(btn => {
    btn.addEventListener("click", () => {
      const link = (state.grafo?.links || []).find(l => l.id === btn.dataset.linkId);
      avanzarCamino(btn.dataset.neighborId, link, btn.dataset.dir, colIdx);
    });
  });
}

async function crearRelacion(origenId, destinoId, tipo, etiqueta, bidireccional) {
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
    resincronizarPath();
    if (state.tabActivo === "mapa") {
      tabsInit.add("mapa");
      await initMapa();
    }
    renderColumnasDesde(0);
    refrescarHighlight();
  } catch(e) { alert("Error al crear relación: " + e.message); }
}

async function anotarEnPanel(nodoId, nota, colIdx) {
  try {
    await apiFetch(`/api/validacion/${encodeURIComponent(state.slug)}/anotar`,{method:"POST",body:JSON.stringify({objeto_anotado:nodoId,nota})});
    await refrescarValidacion();
    const paso = state.path[colIdx];
    if (paso && paso.node.id === nodoId) {
      state.navCols?.refrescarColumna(`col-${colIdx}`, {
        headerHtml: buildColHeaderHTML(paso),
        bodyHtml:   buildPanelHTML(paso.node, colIdx),
      }, colEl => bindPanelListeners(colEl, paso.node, colIdx));
    }
  } catch(e) { alert("Error al anotar: "+e.message); }
}

// ════════════════════════════════════════════════════════════════════════
// getYourStuffTogether — reconexión de nodos sueltos
// ════════════════════════════════════════════════════════════════════════

// ── Typewriter reveal para el log de procesamiento ───────────────────────
// Acumula texto entrante y lo revela a una velocidad fija, dando el efecto
// de "plano de texto que se llena lentamente" aunque los chunks lleguen rápido.
const _recLog = {
  queue:    "",       // texto pendiente de revelar
  shown:    "",       // texto ya visible en pantalla
  raf:      null,     // requestAnimationFrame handle
  cps:      12,       // caracteres por frame (~720/seg a 60fps)
  flushing: false,    // true cuando queremos vaciar inmediatamente

  reset() {
    this.queue = ""; this.shown = ""; this.flushing = false;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
  },

  append(text) {
    this.queue += text;
    if (!this.raf) this.raf = requestAnimationFrame(() => this._tick());
  },

  flush() {
    // Vuelca todo lo pendiente de golpe (al terminar el stream) y quita el cursor
    this.flushing = true;
    const logPre = document.getElementById("rec-log");
    if (logPre) logPre.classList.remove("rec-log-pre--active");
  },

  _tick() {
    this.raf = null;
    const logPre = document.getElementById("rec-log");
    if (!logPre || (!this.queue && !this.flushing)) return;

    const take = this.flushing ? this.queue.length : Math.min(this.cps, this.queue.length);
    if (take > 0) {
      this.shown  += this.queue.slice(0, take);
      this.queue   = this.queue.slice(take);
      logPre.textContent = this.shown;
      logPre.scrollTop   = logPre.scrollHeight;
    }
    if (this.queue.length > 0) {
      this.raf = requestAnimationFrame(() => this._tick());
    } else {
      this.flushing = false;
    }
  },
};

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
  btnId: "btn-consolidar",
  btnConfirmarId: "btn-confirmar-consolidacion",
  btnCancelarId: "btn-cancelar-consolidacion",
  btnCerrarId: "btn-cerrar-consolidacion",
  api: slug => `/api/grafo/${encodeURIComponent(slug)}/consolidacion`,
  tituloTexto: "Consolidación de sinónimos",
  campoEditable: "label_editado",
  hidden: info => info.candidatos_grupos_count === 0,
  tooltip: info => `${info.candidatos_grupos_count} grupo(s) de posibles sinónimos detectado(s) — clic para consolidar`,
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

// ── UI de procesamiento compartida ────────────────────────────────────────────
function _mostrarUIprocesando(cfg, content, footer) {
  if (footer) footer.hidden = true;
  const panel  = document.getElementById(cfg.panelId);
  const btnCer = document.getElementById(cfg.btnCerrarId);
  if (btnCer && panel) btnCer.onclick = () => { panel.hidden = true; };
  _recLog.reset();
  content.innerHTML = `
    <div class="rec-procesando-wrap">
      <div class="rec-progress-bar"></div>
      <div class="rec-status-row">
        <span class="rec-log-dot"></span>
        <span id="${cfg.prefix}-fase">Consultando al LLM…</span>
        <span id="${cfg.prefix}-token-count" class="rec-token-count"></span>
        <button id="${cfg.prefix}-btn-detener" class="btn btn-neutro small rec-detener-btn">Detener</button>
      </div>
    </div>
    <pre class="rec-log-pre rec-log-pre--active" id="${cfg.prefix}-log"></pre>`;
}

function _conectarStream(cfg, es, content, footer) {
  // Actualiza el contador de tokens y el log en tiempo real.
  es.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (d.chunk) _recLog.append(d.chunk);
    if (typeof d.tokens === "number" && d.tokens > 0) {
      const el = document.getElementById(`${cfg.prefix}-token-count`);
      if (el) el.textContent = `${d.tokens} tokens`;
      // Actualizar fase si el log ya tiene la línea de respuesta LLM
      const fase = document.getElementById(`${cfg.prefix}-fase`);
      if (fase && _recLog.shown.includes("RESPUESTA DEL LLM")) {
        fase.textContent = "Generando…";
      }
    }
    if (d.done) {
      es.close();
      _recLog.flush();
      const fase = document.getElementById(`${cfg.prefix}-fase`);
      if (fase) fase.textContent = "Procesando respuesta…";
      const tokenEl = document.getElementById(`${cfg.prefix}-token-count`);
      if (tokenEl) tokenEl.textContent = "";
      const btnDet = document.getElementById(`${cfg.prefix}-btn-detener`);
      if (btnDet) btnDet.hidden = true;
      setTimeout(() => {
        apiFetch(`${cfg.api(state.slug)}/sesion`)
          .then(s => renderPanelSesion(cfg, s))
          .catch(err => {
            content.innerHTML = `<p class="muted" style="padding:var(--sn-s-4)">Error al cargar propuestas: ${esc(err.message)}</p>`;
          });
      }, 300);
    }
  };
  es.onerror = () => {
    es.close();
    apiFetch(`${cfg.api(state.slug)}/sesion`)
      .then(s => {
        if (s.estado === "en_revision") renderPanelSesion(cfg, s);
        else content.innerHTML = `<p class="muted" style="padding:var(--sn-s-4)">Error: ${esc(s.razon_falla || "Error de conexión")}</p>`;
      })
      .catch(() => {
        content.innerHTML = `<p class="muted" style="padding:var(--sn-s-4)">Error de conexión con el servidor.</p>`;
      });
  };
}

function _conectarBotonDetener(cfg, es, content) {
  // Wireing del botón "Detener" (presente en el HTML de procesamiento).
  const btnDet = document.getElementById(`${cfg.prefix}-btn-detener`);
  if (!btnDet) return;
  btnDet.onclick = async () => {
    btnDet.disabled = true;
    btnDet.textContent = "Deteniendo…";
    es.close();
    try {
      await apiFetch(`${cfg.api(state.slug)}/sesion`, { method: "DELETE" });
    } catch(_) {}
    _recLog.flush();
    content.innerHTML = `<p class="muted" style="padding:var(--sn-s-4)">Detenido.</p>`;
    const footer = document.getElementById(cfg.footerId);
    if (footer) footer.hidden = true;
    actualizarBotonSesion(cfg);
  };
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
  const panel   = document.getElementById(cfg.panelId);
  const content = document.getElementById(cfg.contentId);
  const footer  = document.getElementById(cfg.footerId);
  if (!panel || !content) return;
  _cerrarOtrosPaneles(cfg);
  panel.hidden = false;
  _mostrarUIprocesando(cfg, content, footer);

  const es = new EventSource(`${cfg.api(state.slug)}/stream`);
  _conectarStream(cfg, es, content, footer);
  _conectarBotonDetener(cfg, es, content);
}

async function abrirPanelSesion(cfg) {
  const panel   = document.getElementById(cfg.panelId);
  const content = document.getElementById(cfg.contentId);
  const footer  = document.getElementById(cfg.footerId);
  if (!panel) return;

  // Verificar si hay sesión activa
  let sesion = null;
  try {
    sesion = await apiFetch(`${cfg.api(state.slug)}/sesion`);
  } catch(e) {}

  if (sesion && sesion.estado === "en_revision") { renderPanelSesion(cfg, sesion); return; }
  if (sesion && sesion.estado === "procesando")  { abrirStreamExistente(cfg); return; }

  // Iniciar nueva sesión
  _cerrarOtrosPaneles(cfg);
  panel.hidden = false;
  limpiarCamino();
  _mostrarUIprocesando(cfg, content, footer);

  try {
    await apiFetch(`${cfg.api(state.slug)}/iniciar`, { method: "POST", body: "{}" });
    const es = new EventSource(`${cfg.api(state.slug)}/stream`);
    _conectarStream(cfg, es, content, footer);
    _conectarBotonDetener(cfg, es, content);
  } catch(e) {
    content.innerHTML = `<p class="muted" style="padding:var(--sn-s-4)">Error al iniciar: ${esc(e.message)}</p>`;
  }
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
      state.path = [];
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
  }
}

function renderConceptos() {
  let rows=state.grafo.nodes;
  if (conceptosState.busqueda) { const q=conceptosState.busqueda; rows=rows.filter(n=>n.label.toLowerCase().includes(q)||(n.descripcion||"").toLowerCase().includes(q)); }
  const {col,dir}=conceptosState.sort;
  rows=[...rows].sort((a,b)=>{ let av=a[col]??"",bv=b[col]??""; if(typeof av==="string")av=av.toLowerCase(); if(typeof bv==="string")bv=bv.toLowerCase(); return dir==="asc"?(av>bv?1:av<bv?-1:0):(av<bv?1:av>bv?-1:0); });
  document.querySelectorAll("#tabla-conceptos th.sortable").forEach(th=>{ th.classList.remove("sort-asc","sort-desc"); if(th.dataset.col===conceptosState.sort.col) th.classList.add(conceptosState.sort.dir==="asc"?"sort-asc":"sort-desc"); });
  const tbody=document.getElementById("conceptos-tbody"); tbody.innerHTML="";
  rows.forEach(n=>{
    const tr=document.createElement("tr"); tr.dataset.id=n.id;
    const cw=Math.round(n.confianza*56);
    const sins=(n.sinonimos_candidatos||[]).slice(0,4).map(s=>`<span class="tag">${esc(s)}</span>`).join("");
    const mas=(n.sinonimos_candidatos||[]).length>4?`<span class="muted" style="font-size:11px">+${n.sinonimos_candidatos.length-4}</span>`:"";
    tr.innerHTML=`<td class="mono muted" style="font-size:11px">${esc(n.id)}</td><td class="c-label">${esc(n.label)}${n.editado?` <span class="edited-mark">${ico("edit-2",11)}</span>`:""}</td><td style="text-align:right">${n.menciones}</td><td><div class="conf-bar-wrap"><span class="conf-bar" style="width:${cw}px"></span><span class="conf-val">${n.confianza.toFixed(2)}</span></div></td><td>${sins}${mas}</td><td><button class="btn-inline" data-edit-c="${esc(n.id)}">${ico("edit-2")} Editar</button></td>`;
    tbody.appendChild(tr);
    tr.querySelector("[data-edit-c]").addEventListener("click",()=>abrirEditorConcepto(n,tr));
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
  const tipos=[...new Set(state.grafo.links.map(l=>l.tipo).filter(Boolean))].sort();
  const fe=document.getElementById("filtros-rel-tipo");
  fe.innerHTML=`<button class="tipo-filtro-btn active" data-tipo="todos">Todos</button>`+
    tipos.map(t=>`<button class="tipo-filtro-btn" data-tipo="${esc(t)}">${esc(t)}</button>`).join("");
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
  }
  fe.querySelectorAll(".tipo-filtro-btn").forEach(b=>b.addEventListener("click",()=>{
    fe.querySelectorAll(".tipo-filtro-btn").forEach(x=>x.classList.remove("active"));
    b.classList.add("active"); relacionesState.filtroTipo=b.dataset.tipo; renderRelaciones();
  }));
}

function renderRelaciones() {
  const nById=Object.fromEntries(state.grafo.nodes.map(n=>[n.id,n]));
  let rows=state.grafo.links;
  if(relacionesState.filtroTipo!=="todos") rows=rows.filter(l=>l.tipo===relacionesState.filtroTipo);
  if(relacionesState.busqueda) { const q=relacionesState.busqueda; rows=rows.filter(l=>{ const lo=nById[l.source]?.label||"",ld=nById[l.target]?.label||""; return (l.etiqueta||"").toLowerCase().includes(q)||lo.toLowerCase().includes(q)||ld.toLowerCase().includes(q); }); }
  const {col,dir}=relacionesState.sort;
  rows=[...rows].sort((a,b)=>{ let av=a[col]??"",bv=b[col]??""; if(typeof av==="string")av=av.toLowerCase(); if(typeof bv==="string")bv=bv.toLowerCase(); return dir==="asc"?(av>bv?1:av<bv?-1:0):(av<bv?1:av>bv?-1:0); });
  document.querySelectorAll("#tabla-relaciones th.sortable").forEach(th=>{ th.classList.remove("sort-asc","sort-desc"); if(th.dataset.col===relacionesState.sort.col) th.classList.add(relacionesState.sort.dir==="asc"?"sort-asc":"sort-desc"); });
  const tbody=document.getElementById("relaciones-tbody"); tbody.innerHTML="";
  rows.forEach(l=>{
    const lo=nById[l.source]?.label||l.source, ld=nById[l.target]?.label||l.target;
    const to=nById[l.source]?.tipo, td=nById[l.target]?.tipo;
    const cw=Math.round(l.confianza*56);
    const tr=document.createElement("tr"); tr.dataset.id=l.id;
    tr.innerHTML=`<td class="mono muted" style="font-size:11px">${esc(l.id)}</td><td><span class="tag ${to}">${esc(lo)}</span></td><td class="r-tipo"><span class="tag">${esc(l.tipo||"—")}</span></td><td><span class="tag ${td}">${esc(ld)}</span></td><td style="text-align:center"><button class="bidir-toggle ${l.bidireccional?"on":""}" data-bidir="${l.id}" title="${l.bidireccional?"Bidireccional":"Unidireccional"}">${l.bidireccional?"↔":"→"}</button></td><td><div class="conf-bar-wrap"><span class="conf-bar" style="width:${cw}px"></span><span class="conf-val">${l.confianza.toFixed(2)}</span></div></td><td class="r-etiqueta">${esc(l.etiqueta||"")}${l.editado?` <span class="edited-mark">${ico("edit-2",11)}</span>`:""}</td><td><button class="btn-inline" data-edit-r="${esc(l.id)}">${ico("edit-2")} Editar</button></td>`;
    tbody.appendChild(tr);
    tr.querySelector("[data-bidir]").addEventListener("click",async()=>{
      try { await apiFetch(`/api/validacion/${encodeURIComponent(state.slug)}/relaciones/${encodeURIComponent(l.id)}`,{method:"PATCH",body:JSON.stringify({bidireccional:!l.bidireccional})}); await cargarGrafo(); tabsInit.delete("mapa"); renderRelaciones(); } catch(e){alert("Error: "+e.message);}
    });
    tr.querySelector("[data-edit-r]").addEventListener("click",()=>abrirEditorRelacion(l,tr));
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
document.addEventListener("DOMContentLoaded", () => {

  document.querySelectorAll(".tab-btn").forEach(b => b.addEventListener("click", () => activarTab(b.dataset.tab)));

  document.getElementById("btn-biblioteca").addEventListener("click", volverBiblioteca);

  window.addEventListener("popstate", () => {
    const h = location.hash.slice(1);
    if (!h) volverBiblioteca();
    else if (h.startsWith("gp:")) abrirGrafoPersonal(h.slice(3));
  });

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
  const panel     = document.getElementById("settings-panel");
  const cerrar    = document.getElementById("settings-panel-cerrar");
  const modelSel  = document.getElementById("settings-model-sel");
  const modelCustom = document.getElementById("settings-model-custom");
  const keyStatus = document.getElementById("settings-key-status");
  const status    = document.getElementById("settings-model-status");
  const guardar   = document.getElementById("settings-guardar");

  // Modelos conocidos por proveedor (preset + opción personalizada)
  const MODELOS = {
    ollama:    [],   // se pueblan desde la API
    anthropic: ["claude-opus-4-6", "claude-sonnet-4-5", "claude-haiku-4-5-20251001"],
    openai:    ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1", "o1-mini"],
    gemini:    ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
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
    ["anthropic", "openai", "gemini"].forEach(p => {
      const ind = document.getElementById(`settings-key-${p}`);
      if (!ind) return;
      const ok = (ps[p] || {}).has_key;
      ind.textContent = ok ? "✓" : "✗";
      ind.style.color = ok ? "var(--sn-ok)" : "var(--sn-danger)";
    });

    // Actualizar lista de modelos Ollama si la tenemos
    if (_cfg.available_models?.length) {
      MODELOS.ollama = _cfg.available_models;
    }

    // Poblar selector con el proveedor activo
    _poblarModelos(provider, _cfg.model);
  }

  // ── Poblar el selector de modelos para un proveedor ─────────────
  function _poblarModelos(provider, modelActual) {
    const ps = (_cfg?.providers_status || {})[provider] || {};
    const modelos = provider === "ollama"
      ? (MODELOS.ollama.length ? MODELOS.ollama : (modelActual ? [modelActual] : []))
      : MODELOS[provider] || [];

    modelSel.innerHTML = "";

    if (provider === "ollama" && !modelos.length) {
      modelSel.innerHTML = '<option value="">Ollama no responde</option>';
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
      if (provider !== "ollama") {
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

    // Estado de API key
    if (provider === "ollama") {
      keyStatus.textContent = "";
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

  // ── Abrir / cerrar panel ─────────────────────────────────────────
  btn.addEventListener("click", () => {
    if (!panel.hidden) { _cerrar(); return; }
    // Abrir inmediatamente
    panel.hidden = false;
    btn.classList.add("active");
    // Renderizar con cache si existe, luego actualizar en segundo plano
    if (_cfg) _render();
    _cargar();  // no se awaita — actualiza en background
  });

  function _cerrar() {
    panel.hidden = true;
    btn.classList.remove("active");
  }

  cerrar.addEventListener("click", _cerrar);

  // Cerrar al clic fuera
  document.addEventListener("click", e => {
    if (!panel.hidden && !panel.contains(e.target) && !btn.contains(e.target)) {
      _cerrar();
    }
  });

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

// ── Re-procesar desde la biblioteca ─────────────────────────────────

let _reproSlug        = null;  // slug actual del diálogo reprocesar
let _reproEs          = null;  // EventSource SSE activo
let _reproPoll        = null;  // intervalo de polling de progreso
let _reproTerminado   = false; // true cuando la extracción finalizó

function _reproAbrirModal(slug) {
  _reproSlug      = slug;
  _reproEs        = null;
  _reproPoll      = null;
  _reproTerminado = false;

  const titulo = slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  // Resetear a estado confirmar
  document.getElementById("repro-confirm-titulo").textContent = `¿Re-procesar «${titulo}»?`;
  document.getElementById("repro-estado-confirm").hidden = false;
  document.getElementById("repro-estado-proc").hidden    = true;
  document.getElementById("repro-estado-fin").hidden     = true;

  document.getElementById("repro-btn-ok").hidden      = false;
  document.getElementById("repro-btn-cancelar").hidden = false;
  document.getElementById("repro-btn-cerrar").hidden   = true;

  document.getElementById("repro-modal").hidden = false;
}

function _reproLimpiar() {
  if (_reproEs)   { _reproEs.close(); _reproEs = null; }
  if (_reproPoll) { clearInterval(_reproPoll); _reproPoll = null; }
}

function _reproCerrar() {
  _reproLimpiar();
  document.getElementById("repro-modal").hidden = true;
  if (_reproTerminado) {
    // Refrescar la biblioteca tras un reprocesar exitoso
    apiFetch("/api/extracciones").then(exts => {
      renderBiblioteca(exts);
      _arrancarPolling();
    }).catch(() => {});
  }
  _reproSlug = null;
}

function _reproIniciar() {
  const slug = _reproSlug;
  if (!slug) return;

  // Ocultar confirm, mostrar procesando
  document.getElementById("repro-estado-confirm").hidden = true;
  document.getElementById("repro-estado-proc").hidden    = false;
  document.getElementById("repro-btn-ok").hidden         = true;
  document.getElementById("repro-btn-cancelar").hidden   = true;
  document.getElementById("repro-btn-cerrar").hidden     = true;

  const logPre      = document.getElementById("repro-log");
  const faseEl      = document.getElementById("repro-fase");
  const tokensEl    = document.getElementById("repro-tokens");
  const progressEl  = document.getElementById("repro-progress-inner");
  const btnDetener  = document.getElementById("repro-btn-detener");

  logPre.textContent = "";
  logPre.classList.add("rec-log-pre--active");
  faseEl.textContent  = "Iniciando…";
  tokensEl.textContent = "";

  // POST para arrancar el reproceso
  apiFetch(`/api/extracciones/${encodeURIComponent(slug)}/procesar`,
    { method: "POST", body: JSON.stringify({ force: true }) })
  .catch(err => {
    _reproMostrarFin(`Error al iniciar: ${err.message}`, false);
    return;
  });

  // Conectar SSE para log en tiempo real
  const es = new EventSource(`/api/extracciones/${encodeURIComponent(slug)}/stream`);
  _reproEs = es;

  es.onmessage = ev => {
    const d = JSON.parse(ev.data);
    if (d.chunk) {
      logPre.textContent = (logPre.textContent + d.chunk).slice(-12000);
      logPre.scrollTop   = logPre.scrollHeight;
    }
    if (typeof d.tokens === "number" && d.tokens > 0) {
      tokensEl.textContent = `${d.tokens} tokens`;
    }
    if (d.done) {
      _reproEs = null;
      es.close();
      _reproFinalizarProceso(d.estado);
    }
  };
  es.onerror = () => {
    if (_reproEs) { _reproEs = null; es.close(); }
    // Leer estado real antes de cerrar
    apiFetch("/api/extracciones").then(exts => {
      const ext = exts.find(x => x.slug === slug);
      _reproFinalizarProceso(ext?.estado);
    }).catch(() => _reproFinalizarProceso(null));
  };

  // Polling para barra de progreso y fase
  _reproPoll = setInterval(async () => {
    try {
      const exts = await apiFetch("/api/extracciones");
      const ext  = exts.find(x => x.slug === slug);
      if (!ext) return;

      const pct     = ext.porcentaje || 0;
      const tokens  = ext.tokens || 0;
      const elapsed = ext.elapsed || 0;
      const fase    = ext.fase_extraccion;

      // Barra de progreso: indeterminada → determinada cuando hay pct
      if (pct > 0) {
        progressEl.className = "repro-progress-determinate";
        progressEl.style.width = `${pct}%`;
      } else {
        progressEl.className = "repro-progress-indeterminate";
        progressEl.style.width = "";
      }

      // Fase
      let faseStr;
      if (fase === "leyendo")            faseStr = "Leyendo texto…";
      else if (fase === "guardando")     faseStr = "Guardando…";
      else if (fase === "cargando_modelo") faseStr = "Cargando modelo en memoria…";
      else if (tokens === 0 && elapsed < 10) faseStr = "Iniciando…";
      else if (tokens > 0)               faseStr = "Generando…";
      else                               faseStr = "Esperando al modelo…";
      faseEl.textContent = faseStr;

      if (tokens > 0) tokensEl.textContent = `${tokens} tokens`;

      if (!ext.procesando && !_reproTerminado) _reproFinalizarProceso(ext.estado);
    } catch(_) {}
  }, 600);

  // Botón Detener
  btnDetener.disabled  = false;
  btnDetener.textContent = "Detener";
  btnDetener.onclick = async () => {
    btnDetener.disabled    = true;
    btnDetener.textContent = "Deteniendo…";
    _reproLimpiar();
    try {
      await apiFetch(`/api/extracciones/${encodeURIComponent(slug)}/procesar`, { method: "DELETE" });
    } catch(_) {}
    logPre.classList.remove("rec-log-pre--active");
    _reproMostrarFin("Re-procesamiento detenido.", false);
  };
}

function _reproFinalizarProceso(estado) {
  if (_reproTerminado) return;
  _reproTerminado = true;
  _reproLimpiar();

  const logPre = document.getElementById("repro-log");
  if (logPre) logPre.classList.remove("rec-log-pre--active");

  const esError    = estado && (estado.startsWith("error:") || estado === "cancelado");
  const esCancelado = estado === "cancelado";

  const progressEl = document.getElementById("repro-progress-inner");
  if (progressEl) {
    progressEl.className = esError ? "repro-progress-determinate" : "repro-progress-determinate";
    progressEl.style.width = esError ? "0%" : "100%";
  }
  const faseEl = document.getElementById("repro-fase");
  if (faseEl) faseEl.textContent = esError ? "Error" : "Completado";

  // Pequeño delay para que el usuario vea el estado final
  setTimeout(() => {
    document.getElementById("repro-estado-proc").hidden = true;
    if (esCancelado) {
      _reproMostrarFin("Procesamiento cancelado.", false);
    } else if (esError) {
      const detalle = estado.replace(/^error:/, "").trim();
      _reproMostrarFin(`Error al procesar: ${detalle || "revisa la configuración del LLM"}`, false);
    } else {
      _reproMostrarFin("El texto ha sido re-procesado correctamente. Los nuevos conceptos y relaciones han sido añadidos al grafo.", true);
    }
  }, 600);
}

function _reproMostrarFin(msg, exito) {
  document.getElementById("repro-estado-confirm").hidden = true;
  document.getElementById("repro-estado-proc").hidden    = true;
  document.getElementById("repro-estado-fin").hidden     = false;
  document.getElementById("repro-fin-msg").textContent   = msg;
  document.getElementById("repro-btn-ok").hidden         = true;
  document.getElementById("repro-btn-cancelar").hidden   = true;
  document.getElementById("repro-btn-cerrar").hidden     = false;
}

function reprocesarDesdeLibreria(slug) {
  _reproAbrirModal(slug);
}

function _initReproModal() {
  document.getElementById("repro-modal-cerrar").addEventListener("click", _reproCerrar);
  document.getElementById("repro-modal-bg").addEventListener("click",    _reproCerrar);
  document.getElementById("repro-btn-cancelar").addEventListener("click", _reproCerrar);
  document.getElementById("repro-btn-cerrar").addEventListener("click",   _reproCerrar);
  document.getElementById("repro-btn-ok").addEventListener("click",       _reproIniciar);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !document.getElementById("repro-modal").hidden) _reproCerrar();
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

  function _entrarEdicion() {
    _textoModoEdicion = true;
    editorEl.value = _textoData.texto;
    editorEl.hidden = false;
    renderEl.hidden = false;          // visible como preview en vivo
    textoWrap.classList.add("editando");
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

// ════════════════════════════════════════════════════════════════════════
// Grafos personales
// ════════════════════════════════════════════════════════════════════════

const gpState = {
  slug: null,
  grafo: null,           // datos completos del GrafoPersonal
  grafoVis: null,        // { nodes, links } para D3
  nodoSeleccionado: null,
  gpUpdate: null,        // fn updateVisuals de initGrafo/initGrafo3D
  gpHighlight: null,     // fn highlightPath (solo 3D)
  gpFit: null,
  gpDestroy: null,       // fn destroy() del renderer 3D activo
  modo3d: false,
  textoFuenteSlug: null, // slug del texto fuente seleccionado para autocomplete
  textoFuenteNodes: [],  // nodos del texto fuente (para pool de autocomplete)
};

// ── Biblioteca: sección de grafos personales ─────────────────────────

async function cargarGrafosPersonales() {
  try {
    return await apiFetch("/api/grafos-personales");
  } catch { return []; }
}

function renderGrafosPersonales(grafos) {
  const grid = document.getElementById("gp-grid");
  if (!grafos.length) {
    grid.innerHTML = `<div class="gp-card-vacio">
      <p>Aún no tienes grafos propios.</p>
      <p class="muted" style="margin-top:4px">Crea uno para empezar a tejer tus propias conexiones conceptuales.</p>
    </div>`;
    return;
  }
  grid.innerHTML = grafos.map(g => `
    <div class="gp-card-wrap">
      <div class="gp-card" data-slug="${esc(g.slug)}">
        <div class="gp-card-titulo">${esc(g.titulo)}</div>
        ${g.descripcion ? `<div class="gp-card-desc">${esc(g.descripcion)}</div>` : ""}
        <div class="gp-card-stats">
          <span>${g.total_conceptos} conceptos</span>
          <span>${g.total_relaciones} relaciones</span>
        </div>
      </div>
      <div class="gp-card-footer">
        <button class="btn-inline gp-btn-renombrar" data-slug="${esc(g.slug)}" data-titulo="${esc(g.titulo)}" data-desc="${esc(g.descripcion||"")}">${ico("edit-2")} Renombrar</button>
        <button class="btn-inline danger gp-btn-eliminar" data-slug="${esc(g.slug)}" data-titulo="${esc(g.titulo)}">${ico("trash-2")} Eliminar</button>
      </div>
    </div>
  `).join("");

  grid.querySelectorAll(".gp-card").forEach(card =>
    card.addEventListener("click", () => abrirGrafoPersonal(card.dataset.slug))
  );
  grid.querySelectorAll(".gp-btn-renombrar").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); gpRenombrar(btn.dataset.slug, btn.dataset.titulo, btn.dataset.desc); })
  );
  grid.querySelectorAll(".gp-btn-eliminar").forEach(btn =>
    btn.addEventListener("click", e => { e.stopPropagation(); gpEliminar(btn.dataset.slug, btn.dataset.titulo); })
  );
}

async function gpRenombrar(slug, tituloActual, descActual) {
  const nuevoTitulo = prompt("Nuevo título del grafo:", tituloActual);
  if (!nuevoTitulo || nuevoTitulo.trim() === tituloActual) return;
  const nuevaDesc = prompt("Descripción (opcional):", descActual);
  try {
    await apiFetch(`/api/grafos-personales/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      body: JSON.stringify({ titulo: nuevoTitulo.trim(), descripcion: nuevaDesc }),
    });
    const grafos = await cargarGrafosPersonales();
    renderGrafosPersonales(grafos);
  } catch(e) { alert("Error al renombrar: " + e.message); }
}

async function gpEliminar(slug, titulo) {
  if (!confirm(`¿Eliminar el grafo «${titulo}»?\n\nEsta acción no se puede deshacer.`)) return;
  try {
    await apiFetch(`/api/grafos-personales/${encodeURIComponent(slug)}`, { method: "DELETE" });
    const grafos = await cargarGrafosPersonales();
    renderGrafosPersonales(grafos);
  } catch(e) { alert("Error al eliminar: " + e.message); }
}

// ── Apertura del editor de grafo personal ───────────────────────────

async function abrirGrafoPersonal(slug) {
  gpState.slug = slug;
  gpState.nodoSeleccionado = null;
  gpState.gpUpdate = null;

  // Ocultar todo lo demás, mostrar vista-gp
  document.getElementById("vista-biblioteca").hidden = true;
  document.getElementById("vista-gp").hidden = false;
  document.getElementById("btn-biblioteca").hidden = false;
  document.getElementById("tabs").hidden = true;
  document.querySelectorAll(".tab-panel").forEach(p => { p.hidden = true; });

  history.pushState(null, "", `#gp:${slug}`);

  await recargarGP();
  gpBindSidebarListeners();

  // Favicon: minimapa del grafo personal abierto
  const svg = await _construirMallaSVG(gpState.grafoVis?.nodes, gpState.grafoVis?.links, FAVICON_S, FAVICON_OPTS);
  if (svg) _aplicarFaviconHref(_svgAFaviconHref(svg));
  else _aplicarFaviconDefault();
}

async function recargarGP() {
  [gpState.grafo, gpState.grafoVis] = await Promise.all([
    apiFetch(`/api/grafos-personales/${encodeURIComponent(gpState.slug)}`),
    apiFetch(`/api/grafos-personales/${encodeURIComponent(gpState.slug)}/grafo`),
  ]);

  document.getElementById("transcripcion-titulo").textContent = gpState.grafo.titulo;
  document.getElementById("gp-titulo-text").textContent = gpState.grafo.titulo;
  document.getElementById("gp-desc-text").textContent = gpState.grafo.descripcion || "";

  renderConceptosSidebar();
  renderGPCanvas();
}

const TIPOS_REL = ["fundamenta","amplifica","especifica","contraposicion","constituye","genera","presupone","evoca","pertenece"];

/**
 * Autocomplete genérico para inputs de grafos personales.
 * getPool() → [{ label, meta, onSelect(inputEl) }]
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
      <li class="gp-ac-item${i === activeIdx ? " active" : ""}" data-idx="${i}">
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

function gpBindSidebarListeners() {
  // ── Selector de texto fuente ─────────────────────────────────────
  const selTexto = document.getElementById("gp-texto-fuente");
  if (selTexto && !selTexto.dataset.wired) {
    selTexto.dataset.wired = "1";
    // Poblar con textos disponibles (solo los ya procesados)
    apiFetch("/api/extracciones").then(lista => {
      const procesados = lista.filter(e => e.procesado);
      procesados.forEach(e => {
        const opt = document.createElement("option");
        opt.value = e.slug;
        opt.textContent = e.titulo || e.slug;
        selTexto.appendChild(opt);
      });
      // Pre-seleccionar si ya había un slug cargado en state.grafo
      if (state.grafo && state.slug && !gpState.textoFuenteSlug) {
        selTexto.value = state.slug;
        gpState.textoFuenteSlug = state.slug;
        gpState.textoFuenteNodes = state.grafo.nodes || [];
      }
    }).catch(() => {});
    selTexto.addEventListener("change", async () => {
      const slug = selTexto.value;
      gpState.textoFuenteSlug = slug || null;
      gpState.textoFuenteNodes = [];
      if (slug) {
        try {
          const datos = await apiFetch(`/api/grafo/${encodeURIComponent(slug)}`);
          gpState.textoFuenteNodes = datos.nodes || [];
        } catch { gpState.textoFuenteNodes = []; }
      }
    });
  }

  // Botón añadir concepto
  const btnAdd  = document.getElementById("btn-gp-add-concepto");
  const formNew = document.getElementById("gp-nuevo-concepto-form");
  const btnConf = document.getElementById("btn-gp-confirmar-concepto");
  const btnCanc = document.getElementById("btn-gp-cancelar-concepto");
  const inpLabel= document.getElementById("gp-concepto-label");

  btnAdd.onclick = () => {
    formNew.hidden = false;
    inpLabel.value = "";
    document.getElementById("gp-concepto-def").value = "";
    inpLabel.focus();
  };
  btnCanc.onclick = () => { formNew.hidden = true; };
  btnConf.onclick = () => crearConceptoGP();
  inpLabel.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); crearConceptoGP(); }
    if (e.key === "Escape") { formNew.hidden = true; }
  });

  // Autocomplete: label del concepto desde texto fuente seleccionado + GP propio
  if (!inpLabel.dataset.acWired) {
    inpLabel.dataset.acWired = "1";
    const inpLabelDrop = document.getElementById("gp-concepto-label-dropdown");
    _gpWireAutocomplete(inpLabel, inpLabelDrop, () => {
      const visto = new Set();
      const pool = [];
      gpState.textoFuenteNodes.forEach(n => {
        if (visto.has(n.label.toLowerCase())) return;
        visto.add(n.label.toLowerCase());
        pool.push({
          label: n.label,
          meta: n.descripcion ? n.descripcion.slice(0, 60) : "desde texto",
          onSelect: inp => {
            inp.value = n.label;
            const defEl = document.getElementById("gp-concepto-def");
            if (defEl && !defEl.value && n.descripcion) defEl.value = n.descripcion;
            const citaEl = document.getElementById("gp-concepto-cita");
            if (citaEl && !citaEl.value && n.cita_directa) citaEl.value = n.cita_directa;
          },
        });
      });
      (gpState.grafo?.conceptos_propios || []).forEach(c => {
        if (visto.has(c.label.toLowerCase())) return;
        visto.add(c.label.toLowerCase());
        pool.push({
          label: c.label,
          meta: c.definicion ? c.definicion.slice(0, 60) : "ya en este grafo",
          onSelect: inp => { inp.value = c.label; },
        });
      });
      return pool;
    });
  }

  // Cerrar panel
  document.getElementById("btn-gp-cerrar-panel").onclick = () => {
    document.getElementById("gp-panel").hidden = true;
    gpState.nodoSeleccionado = null;
    renderConceptosSidebar();
  };
}

// ── Sidebar: lista de conceptos ──────────────────────────────────────

function renderConceptosSidebar() {
  const lista = document.getElementById("gp-conceptos-lista");
  const conceptos = gpState.grafo?.conceptos_propios || [];

  if (!conceptos.length) {
    lista.innerHTML = `<li style="padding:var(--sn-s-3) var(--sn-s-4);color:var(--sn-ink-soft);font-size:var(--sn-fs-xs)">Ningún concepto todavía.</li>`;
    return;
  }

  lista.innerHTML = conceptos.map(c => `
    <li class="gp-concepto-item ${gpState.nodoSeleccionado?.id === c.id ? "active" : ""}" data-id="${esc(c.id)}">
      <div style="flex:1;min-width:0">
        <div class="gp-concepto-label">${esc(c.label)}</div>
        ${c.definicion ? `<div class="gp-concepto-def">${esc(c.definicion)}</div>` : ""}
      </div>
    </li>
  `).join("");

  lista.querySelectorAll(".gp-concepto-item").forEach(li => {
    li.addEventListener("click", () => {
      const nodo = gpState.grafoVis.nodes.find(n => n.id === li.dataset.id);
      if (nodo) gpOnNodoSeleccionado(nodo);
    });
  });
}

// ── Canvas 2D/3D ─────────────────────────────────────────────────────

async function renderGPCanvas() {
  const svgEl = document.getElementById("gp-svg");
  const el3d  = document.getElementById("gp-3d");
  const vacio = document.getElementById("gp-canvas-vacio");
  if (!svgEl || !el3d) return;

  const { nodes, links } = gpState.grafoVis;
  vacio.hidden = nodes.length > 0;

  // Si ya estábamos en 3D es un refresco (concepto añadido/editado): no auto-fit.
  const yaEn3D = gpState.modo3d && gpState.gpDestroy !== null;

  gpState.gpDestroy?.();
  gpState.gpDestroy = null;

  if (!nodes.length) { d3ClearGPSvg(svgEl); return; }

  if (gpState.modo3d) {
    svgEl.setAttribute("hidden", ""); el3d.removeAttribute("hidden");
    const { initGrafo3D } = await import("./grafo3d.js");
    const { updateVisuals, highlightPath, fitView, destroy } = initGrafo3D(el3d, { nodes, links }, gpOnNodoSeleccionado, { autoFit: !yaEn3D });
    gpState.gpUpdate    = updateVisuals;
    gpState.gpHighlight = highlightPath;
    gpState.gpFit       = fitView;
    gpState.gpDestroy   = destroy;
  } else {
    svgEl.removeAttribute("hidden"); el3d.setAttribute("hidden", "");
    const { initGrafo } = await import("./grafo.js");
    const { updateVisuals, fitView } = initGrafo(svgEl, { nodes, links }, gpOnNodoSeleccionado);
    gpState.gpUpdate    = updateVisuals;
    gpState.gpHighlight = null;
    gpState.gpFit       = fitView;
  }

  // Botones de control
  document.getElementById("btn-gp-fit").onclick = () => gpState.gpFit?.();

  const btnModo3d = document.getElementById("btn-gp-modo3d");
  const lblModo3d = document.getElementById("btn-gp-modo3d-label");
  if (btnModo3d) {
    btnModo3d.classList.toggle("active", gpState.modo3d);
    if (lblModo3d) lblModo3d.textContent = gpState.modo3d ? "2D" : "3D";
    btnModo3d.onclick = () => { gpState.modo3d = !gpState.modo3d; renderGPCanvas(); };
  }
}

function d3ClearGPSvg(svgEl) {
  // import d3 si hace falta para limpiar
  import("https://cdn.jsdelivr.net/npm/d3@7/+esm").then(d3 => d3.select(svgEl).selectAll("*").remove());
}

// ── Panel lateral: detalle del nodo seleccionado ─────────────────────

function gpOnNodoSeleccionado(nodo) {
  gpState.nodoSeleccionado = nodo;
  renderConceptosSidebar();

  const panel = document.getElementById("gp-panel");
  if (!nodo) { panel.hidden = true; return; }
  panel.hidden = false;

  const c = gpState.grafo.conceptos_propios.find(x => x.id === nodo.id);
  if (!c) return;

  // Relaciones de este nodo
  const relacionesPropias = gpState.grafoVis.links.filter(
    l => l.source === nodo.id || l.target === nodo.id ||
         (l.source?.id === nodo.id) || (l.target?.id === nodo.id)
  );
  // Otros conceptos disponibles para relacionar
  const otros = (gpState.grafoVis.nodes || []).filter(n => n.id !== nodo.id);

  document.getElementById("gp-panel-content").innerHTML = `
    <div class="panel-header" style="padding-right:44px">
      <div class="panel-titulo">${esc(c.label)}</div>
    </div>

    <!-- Editar concepto -->
    <div class="panel-seccion">
      <div class="panel-seccion-titulo">Concepto</div>
      <div class="campo">
        <span class="campo-etiq">Label</span>
        <input id="gp-edit-label" class="edit-input" value="${esc(c.label)}" style="width:100%">
      </div>
      <div class="campo">
        <span class="campo-etiq">Definición</span>
        <textarea id="gp-edit-def" class="panel-nota-input" rows="3">${esc(c.definicion || "")}</textarea>
      </div>
      ${c.citas?.length ? `
      <div style="margin-top:var(--sn-s-2)">
        <span class="campo-etiq">Citas</span>
        ${c.citas.map(cit => `
          <div style="font-size:11px;border-left:2px solid var(--sn-hairline);padding-left:6px;margin-top:4px;color:var(--sn-ink-soft)">
            "${esc(cit.texto)}"${cit.fuente ? `<span style="display:block;font-style:normal;font-size:10px;margin-top:1px">— ${esc(cit.fuente)}</span>` : ""}
          </div>
        `).join("")}
      </div>` : ""}
      <div style="display:flex;gap:var(--sn-s-2);margin-top:var(--sn-s-2)">
        <button id="gp-btn-save-concepto" class="btn btn-aceptar small">Guardar</button>
        <button id="gp-btn-del-concepto" class="btn btn-rechazar small" title="Eliminar concepto">${ico("trash-2")} Eliminar</button>
      </div>
    </div>

    <!-- Relaciones existentes -->
    ${relacionesPropias.length ? `
    <div class="panel-seccion">
      <div class="panel-seccion-titulo">Relaciones (${relacionesPropias.length})</div>
      ${relacionesPropias.map(r => {
        const srcId = r.source?.id ?? r.source;
        const tgtId = r.target?.id ?? r.target;
        const esOrigen = srcId === nodo.id;
        const otroId = esOrigen ? tgtId : srcId;
        const otro = gpState.grafoVis.nodes.find(n => n.id === otroId);
        return `<div class="panel-anotacion" style="display:flex;align-items:center;justify-content:space-between;gap:6px">
          <div style="flex:1;min-width:0">
            <span class="tag" style="font-size:10px">${esc(r.tipo)}</span>
            <span style="font-size:12px;margin-left:4px">${esOrigen ? "→" : "←"} ${esc(otro?.label || otroId)}</span>
            ${r.etiqueta ? `<div style="font-size:11px;color:var(--sn-ink-soft);font-style:italic">"${esc(r.etiqueta)}"</div>` : ""}
            ${r.cita?.texto ? `<div style="font-size:10px;color:var(--sn-ink-soft);border-left:2px solid var(--sn-hairline);padding-left:6px;margin-top:3px;white-space:pre-wrap">"${esc(r.cita.texto)}"${r.cita.fuente ? `<span style="display:block;font-style:normal;margin-top:1px">— ${esc(r.cita.fuente)}</span>` : ""}</div>` : ""}
          </div>
          <button class="btn-inline danger" data-del-rel="${esc(r.id)}" title="Eliminar relación" style="flex-shrink:0">${ico("x")}</button>
        </div>`;
      }).join("")}
    </div>` : ""}

    <!-- Nueva relación -->
    ${otros.length ? `
    <details class="panel-seccion">
      <summary class="panel-seccion-titulo panel-seccion-summary">Vincular con…</summary>
      <div class="campo">
        <span class="campo-etiq">Concepto destino</span>
        <div style="position:relative">
          <input id="gp-nr-destino-text" class="edit-input" placeholder="Buscar concepto…" autocomplete="off" style="width:100%">
          <input type="hidden" id="gp-nr-destino">
          <ul id="gp-nr-destino-dropdown" class="gp-ac-dropdown" hidden></ul>
        </div>
      </div>
      <div class="campo">
        <span class="campo-etiq">Tipo de relación</span>
        <div style="position:relative">
          <input id="gp-nr-tipo" class="edit-input" placeholder="Tipo de relación…" autocomplete="off" value="${esc(TIPOS_REL[0])}" style="width:100%">
          <ul id="gp-nr-tipo-dropdown" class="gp-ac-dropdown" hidden></ul>
        </div>
      </div>
      <div class="campo">
        <span class="campo-etiq">Etiqueta <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">(opcional)</span></span>
        <input id="gp-nr-etiqueta" class="edit-input" placeholder="ej. implica, reduce, requiere…" style="width:100%">
      </div>
      <div class="campo" style="display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="gp-nr-bidir" style="cursor:pointer">
        <label for="gp-nr-bidir" class="campo-etiq" style="margin-bottom:0;cursor:pointer">Bidireccional ↔</label>
      </div>
      <div class="campo">
        <span class="campo-etiq">Cita <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">(opcional)</span></span>
        <textarea id="gp-nr-cita" class="panel-nota-input" rows="2" placeholder="Pasaje que fundamenta esta relación…"></textarea>
        <input id="gp-nr-fuente" class="edit-input" placeholder="Fuente…" style="width:100%;margin-top:4px">
      </div>
      <button id="gp-btn-crear-relacion" class="btn btn-aceptar small" style="width:100%;margin-top:4px">+ Crear relación</button>
      <div id="gp-nr-error" style="color:var(--sn-danger);font-size:var(--sn-fs-xs);margin-top:4px;display:none">Selecciona un concepto destino.</div>
    </details>` : ""}
  `;

  // Listeners del panel
  document.getElementById("gp-btn-save-concepto").addEventListener("click", () => {
    const label = document.getElementById("gp-edit-label").value.trim();
    const def   = document.getElementById("gp-edit-def").value.trim() || null;
    if (!label) { document.getElementById("gp-edit-label").focus(); return; }
    gpEditarConcepto(c.id, label, def);
  });

  document.getElementById("gp-btn-del-concepto").addEventListener("click", () => {
    if (!confirm(`¿Eliminar el concepto "${c.label}"?`)) return;
    gpEliminarConcepto(c.id);
  });

  document.querySelectorAll("[data-del-rel]").forEach(btn =>
    btn.addEventListener("click", () => gpEliminarRelacion(btn.dataset.delRel))
  );

  if (otros.length) {
    // Autocomplete: concepto destino
    const destinoTextEl = document.getElementById("gp-nr-destino-text");
    const destinoHiddenEl = document.getElementById("gp-nr-destino");
    const destinoDropEl   = document.getElementById("gp-nr-destino-dropdown");
    _gpWireAutocomplete(destinoTextEl, destinoDropEl, () =>
      (gpState.grafoVis?.nodes || [])
        .filter(n => n.id !== c.id)
        .map(n => ({
          label: n.label, meta: "",
          onSelect: inp => { inp.value = n.label; destinoHiddenEl.value = n.id; },
        }))
    );
    destinoTextEl.addEventListener("input", () => { destinoHiddenEl.value = ""; });

    // Autocomplete: tipo de relación
    const tipoEl    = document.getElementById("gp-nr-tipo");
    const tipoDropEl = document.getElementById("gp-nr-tipo-dropdown");
    _gpWireAutocomplete(tipoEl, tipoDropEl, () => {
      const tipos = new Set(TIPOS_REL);
      (state.grafo?.links || []).forEach(l => { if (l.tipo) tipos.add(l.tipo); });
      (gpState.grafoVis?.links || []).forEach(l => { if (l.tipo) tipos.add(l.tipo); });
      return [...tipos].map(t => ({ label: t, meta: "", onSelect: inp => { inp.value = t; } }));
    }, { showAllOnFocus: true });

    document.getElementById("gp-btn-crear-relacion").addEventListener("click", () => {
      const destino    = destinoHiddenEl.value;
      const tipo       = tipoEl.value.trim() || TIPOS_REL[0];
      const etiqueta   = document.getElementById("gp-nr-etiqueta").value.trim() || tipo;
      const bidir      = document.getElementById("gp-nr-bidir").checked;
      const citaTxt    = document.getElementById("gp-nr-cita").value.trim();
      const citaFuente = document.getElementById("gp-nr-fuente").value.trim();
      const cita       = citaTxt ? { texto: citaTxt, fuente: citaFuente || null } : null;
      const errEl      = document.getElementById("gp-nr-error");
      if (!destino) {
        errEl.style.display = "block";
        destinoTextEl.focus();
        return;
      }
      errEl.style.display = "none";
      gpCrearRelacion(c.id, destino, tipo, etiqueta, bidir, cita);
    });
  }
}

// ── Acciones CRUD ────────────────────────────────────────────────────

async function crearConceptoGP() {
  const label     = document.getElementById("gp-concepto-label").value.trim();
  const def       = document.getElementById("gp-concepto-def").value.trim() || null;
  const citaTxt   = document.getElementById("gp-concepto-cita")?.value.trim() || "";
  const citaFuente= document.getElementById("gp-concepto-fuente")?.value.trim() || "";
  if (!label) { document.getElementById("gp-concepto-label").focus(); return; }
  const citas = citaTxt ? [{ texto: citaTxt, fuente: citaFuente || null }] : [];
  try {
    await apiFetch(`/api/grafos-personales/${encodeURIComponent(gpState.slug)}/conceptos`,
      { method: "POST", body: JSON.stringify({ label, definicion: def, citas }) });
    document.getElementById("gp-nuevo-concepto-form").hidden = true;
    await recargarGP();
  } catch(e) { alert("Error al crear concepto: " + e.message); }
}

async function gpEditarConcepto(cid, label, definicion) {
  try {
    await apiFetch(`/api/grafos-personales/${encodeURIComponent(gpState.slug)}/conceptos/${encodeURIComponent(cid)}`,
      { method: "PATCH", body: JSON.stringify({ label, definicion }) });
    await recargarGP();
    // Mantener panel abierto con nodo actualizado
    const updated = gpState.grafoVis.nodes.find(n => n.id === cid);
    if (updated) gpOnNodoSeleccionado(updated);
  } catch(e) { alert("Error al editar concepto: " + e.message); }
}

async function gpEliminarConcepto(cid) {
  try {
    await apiFetch(`/api/grafos-personales/${encodeURIComponent(gpState.slug)}/conceptos/${encodeURIComponent(cid)}`,
      { method: "DELETE" });
    gpState.nodoSeleccionado = null;
    document.getElementById("gp-panel").hidden = true;
    await recargarGP();
  } catch(e) { alert("Error al eliminar: " + e.message); }
}

async function gpCrearRelacion(origenId, destinoId, tipo, etiqueta, bidireccional, cita = null) {
  try {
    await apiFetch(`/api/grafos-personales/${encodeURIComponent(gpState.slug)}/relaciones`,
      { method: "POST", body: JSON.stringify({ origen_id: origenId, destino_id: destinoId, tipo, etiqueta, bidireccional, cita }) });
    await recargarGP();
    const updated = gpState.grafoVis.nodes.find(n => n.id === origenId);
    if (updated) gpOnNodoSeleccionado(updated);
  } catch(e) { alert("Error al crear relación: " + e.message); }
}

async function gpEliminarRelacion(rid) {
  try {
    await apiFetch(`/api/grafos-personales/${encodeURIComponent(gpState.slug)}/relaciones/${encodeURIComponent(rid)}`,
      { method: "DELETE" });
    await recargarGP();
    // Refrescar panel
    if (gpState.nodoSeleccionado) {
      const updated = gpState.grafoVis.nodes.find(n => n.id === gpState.nodoSeleccionado.id);
      if (updated) gpOnNodoSeleccionado(updated); else document.getElementById("gp-panel").hidden = true;
    }
  } catch(e) { alert("Error al eliminar relación: " + e.message); }
}

// ── Nuevo grafo: form en la biblioteca ───────────────────────────────

function initNuevoGPForm() {
  const btnNuevo = document.getElementById("btn-nuevo-gp");
  const form     = document.getElementById("gp-nuevo-form");
  const btnCrear = document.getElementById("btn-crear-gp");
  const btnCanc  = document.getElementById("btn-cancelar-nuevo-gp");
  const inp      = document.getElementById("gp-nuevo-titulo");

  btnNuevo.addEventListener("click", () => {
    form.hidden = false;
    inp.value = "";
    document.getElementById("gp-nuevo-desc").value = "";
    inp.focus();
    btnNuevo.hidden = true;
  });

  btnCanc.addEventListener("click", () => {
    form.hidden = true;
    btnNuevo.hidden = false;
  });

  btnCrear.addEventListener("click", async () => {
    const titulo = inp.value.trim();
    const desc   = document.getElementById("gp-nuevo-desc").value.trim() || null;
    if (!titulo) { inp.focus(); return; }
    try {
      const res = await apiFetch("/api/grafos-personales",
        { method: "POST", body: JSON.stringify({ titulo, descripcion: desc }) });
      form.hidden = true;
      btnNuevo.hidden = false;
      await abrirGrafoPersonal(res.slug);
    } catch(e) { alert("Error al crear grafo: " + e.message); }
  });

  inp.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); btnCrear.click(); }
    if (e.key === "Escape") { btnCanc.click(); }
  });
}

// ── Volver a la biblioteca desde el editor GP ────────────────────────

function volverBibliotecaDesdeGP() {
  gpState.slug = null;
  gpState.grafo = null;
  gpState.grafoVis = null;
  gpState.nodoSeleccionado = null;
  gpState.gpUpdate = null;
  gpState.textoFuenteSlug = null;
  gpState.textoFuenteNodes = [];
  // Resetear selector de texto fuente para que no muestre datos de otra sesión
  const sel = document.getElementById("gp-texto-fuente");
  if (sel) { sel.value = ""; delete sel.dataset.wired; }
  document.getElementById("gp-nuevo-concepto-form").hidden = true;
  document.getElementById("gp-panel").hidden = true;
  document.getElementById("vista-gp").hidden = true;
  mostrarBiblioteca();
}
