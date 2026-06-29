// ════════════════════════════════════════════════════════════════════════
// Estado global
// ════════════════════════════════════════════════════════════════════════
const state = {
  slug:        null,
  validacion:  null,
  grafo:       null,
  tabActivo:   "mapa",
  panelNodo:   null,   // nodo actualmente seleccionado en mapa
  grafoUpdate: null,   // fn updateVisuals() exportada por initGrafo
};

const tabsInit = new Set();
const conceptosState  = { sort:{ col:"menciones", dir:"desc" }, filtroTipo:"todos", busqueda:"" };
const relacionesState = { sort:{ col:"confianza",  dir:"desc" }, filtroTipo:"todos", busqueda:"" };
const decisionesState = { filtroTipo:"todos" };
let conceptosListeners = false;
let relacionesListeners = false;
let decisionesListeners = false;

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
  if (nombre === "texto" && state.slug) { initTab("texto"); return; }
  if (!tabsInit.has(nombre) && state.slug) { tabsInit.add(nombre); initTab(nombre); }
}
async function initTab(nombre) {
  if (nombre==="mapa")        await initMapa();
  if (nombre==="conceptos")   await initConceptos();
  if (nombre==="relaciones")  await initRelaciones();
  if (nombre==="decisiones")  await initDecisiones();
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
  state.slug = null;
  state.validacion = null;
  state.grafo = null;
  state.grafoUpdate = null;
  state.panelNodo = null;
  state.tabActivo = null;
  tabsInit.clear();

  history.replaceState(null, "", location.pathname);
  renderBiblioteca(exts);

  // Cargar grafos personales
  const grafos = await cargarGrafosPersonales();
  renderGrafosPersonales(grafos);
}

function renderBiblioteca(exts) {
  const grid = document.getElementById("biblioteca-grid");

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

  // Mini-mapas para textos ya procesados — defer one frame so clientWidth is set
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

async function _renderMiniGrafos(slugs) {
  const d3 = await import("https://cdn.jsdelivr.net/npm/d3@7/+esm");

  for (const slug of slugs) {
    const container = document.querySelector(`.bib-mini-mapa[data-slug="${CSS.escape(slug)}"]`);
    if (!container || container.childElementCount > 0) continue;

    try {
      if (!_miniGrafoCache[slug]) {
        _miniGrafoCache[slug] = await apiFetch(`/api/grafo/${encodeURIComponent(slug)}`);
      }
      const { nodes: rawNodes, links: rawLinks } = _miniGrafoCache[slug];
      if (!rawNodes.length) continue;

      // Solo nodos conectados (misma lógica que grafo.js)
      const rNById = Object.fromEntries(rawNodes.map(n => [n.id, n]));
      const validLinks = rawLinks.filter(l => rNById[l.source] && rNById[l.target]);
      const connectedIds = new Set(validLinks.flatMap(l => [l.source, l.target]));
      const nodes = rawNodes.filter(n => connectedIds.has(n.id)).slice(0, 150).map(n => ({ ...n }));
      if (!nodes.length) continue;
      const byId  = Object.fromEntries(nodes.map(n => [n.id, n]));
      const links = validLinks.filter(l => byId[l.source] && byId[l.target]).map(l => ({ ...l }));

      // Cuadrado: el contenedor tiene aspect-ratio:1, pero leemos el ancho real
      const S = container.clientWidth || 260;

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

      // Aristas primero (debajo de los nodos)
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

      // Nodos: círculos sólidos, tamaño proporcional a menciones
      nodes.forEach(n => {
        const r = Math.min(S * 0.022, S * 0.009 + Math.sqrt(n.menciones || 1) * S * 0.006);
        const c = document.createElementNS(ns, "circle");
        c.setAttribute("cx",   px(n));
        c.setAttribute("cy",   py(n));
        c.setAttribute("r",    Math.max(2.5, r));
        c.setAttribute("fill", "#221f1a");
        svg.appendChild(c);
      });

      container.appendChild(svg);
    } catch(_) { /* ignorar errores por tarjeta */ }
  }
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
  // Badge de decisiones pendientes
  const pendientes = (state.validacion.decisiones || []).filter(d => d.estado === "pendiente").length;
  const badge = document.getElementById("badge-decisiones");
  if (badge) { badge.textContent = pendientes; badge.hidden = pendientes === 0; }
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
  const svgEl=document.getElementById("grafo-svg");
  const { initGrafo }=await import("./grafo.js");
  const { relColorScale, relTypes, updateVisuals }=initGrafo(svgEl, state.grafo, onNodoSeleccionado);
  state.grafoUpdate=updateVisuals;
  state.relColor=relColorScale;
  renderLeyenda(relColorScale, relTypes);
  // Wire fit button
  const btnFit = document.getElementById("btn-fit");
  if (btnFit) btnFit.onclick = () => {};
  // Botón reconectar
  await actualizarBotonReconexion();
  const btnRec = document.getElementById("btn-reconectar");
  if (btnRec) btnRec.onclick = () => abrirPanelReconexion();
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

// ── Panel lateral del mapa: nodo + decisión + anotaciones ─────────────

function onNodoSeleccionado(nodo) {
  state.panelNodo = nodo;
  const panel = document.getElementById("panel-nodo");
  if (!nodo) { panel.hidden = true; return; }
  panel.hidden = false;
  document.getElementById("panel-nodo-content").innerHTML = buildPanelHTML(nodo);
  bindPanelListeners(nodo);
}

function buildPanelHTML(nodo) {
  let h="";

  // ── Header ────────────────────────────────────────────────────────────
  h+=`<div class="panel-header">
    <div class="panel-titulo">${esc(nodo.label)}</div>
    ${nodo.editado?`<div style="margin-top:4px"><span class="edited-mark" title="Editado por investigador">${ico("edit-2",11)} editado</span></div>`:""}
  </div>`;

  // ── Detalles del concepto ─────────────────────────────────────────────
  h+=`<div class="panel-seccion">`;
  h+=`<div class="campo"><span class="campo-etiq">Menciones · Confianza</span>
    <div>${nodo.menciones} menciones &ensp;<span style="color:var(--badge-conf-text)">${nodo.confianza.toFixed(2)}</span></div></div>`;
  if (nodo.descripcion) h+=campo("Descripción",esc(nodo.descripcion));
  if (nodo.cita_directa) h+=campo("Cita directa",`<p class="cita">"${esc(nodo.cita_directa)}"</p>`);
  if (nodo.sinonimos_candidatos?.length) h+=`<div class="campo"><span class="campo-etiq">Sinónimos candidatos</span><div class="sinonimos-lista">${nodo.sinonimos_candidatos.map(s=>`<span class="tag">${esc(s)}</span>`).join("")}</div></div>`;
  h+=`</div>`;

  // ── Relaciones ────────────────────────────────────────────────────────
  h+=buildRelacionesHTML(nodo);

  // ── Nueva relación ────────────────────────────────────────────────────
  h+=buildNuevaRelacionHTML(nodo);

  // ── Anotaciones ───────────────────────────────────────────────────────
  h+=buildAnnotationPanelHTML(nodo);

  return h;
}

function buildRelacionesHTML(nodo) {
  const links  = state.grafo?.links || [];
  const byId   = Object.fromEntries((state.grafo?.nodes||[]).map(n=>[n.id,n]));
  const color  = state.relColor || (() => "#888");

  const sal = links.filter(l => l.source === nodo.id);
  const ent = links.filter(l => l.target === nodo.id);
  const total = sal.length + ent.length;
  if (!total) return "";

  const row = (l, dir) => {
    const otro  = byId[dir==="→" ? l.target : l.source];
    const c     = color(l.tipo || "_");
    return `<div class="panel-rel-fila">
      <span class="panel-rel-dir" style="color:${c}">${dir}</span>
      <div class="panel-rel-cuerpo">
        <span class="panel-rel-tipo" style="color:${c}">${esc(l.tipo||"")}</span>
        <span class="panel-rel-nodo">${esc(otro?.label||"?")}</span>
        ${l.etiqueta?`<span class="panel-rel-etiq">${esc(l.etiqueta)}</span>`:""}
      </div>
    </div>`;
  };

  return `<div class="panel-seccion">
    <div class="panel-seccion-titulo">Relaciones (${total})</div>
    ${sal.map(l=>row(l,"→")).join("")}
    ${ent.map(l=>row(l,"←")).join("")}
  </div>`;
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

  return `<div class="panel-seccion">
    <div class="panel-seccion-titulo">Vincular con otro concepto</div>
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
  </div>`;
}

function buildAnnotationPanelHTML(nodo) {
  const anotaciones=(state.validacion?.anotaciones||[]).filter(a=>a.objeto_anotado===nodo.id);
  let h=`<div class="panel-seccion">
    <div class="panel-seccion-titulo">Anotaciones</div>`;
  if (anotaciones.length) {
    h+=anotaciones.map(a=>`<div class="panel-anotacion">
      <p class="cita">${esc(a.nota)}</p>
      <span class="muted" style="font-size:10px">${new Date(a.creada_en).toLocaleDateString("es",{day:"numeric",month:"short",year:"numeric"})}</span>
    </div>`).join("");
  }
  h+=`<textarea id="pb-anotacion" class="panel-nota-input" rows="2" placeholder="Añadir nota…" style="margin-top:8px"></textarea>
    <button id="pb-anotar" class="btn btn-neutro small" style="margin-top:6px;width:100%">Guardar nota</button>
  </div>`;
  return h;
}

function bindPanelListeners(nodo) {
  const C = document.getElementById("panel-nodo-content");

  C.querySelector("#pb-anotar")?.addEventListener("click", () => {
    const t = C.querySelector("#pb-anotacion")?.value.trim(); if (t) anotarEnPanel(nodo.id, t);
  });

  // Nueva relación
  C.querySelector("#nr-crear")?.addEventListener("click", () => {
    const destino  = C.querySelector("#nr-destino")?.value;
    const tipo     = C.querySelector("#nr-tipo")?.value;
    const etiqueta = C.querySelector("#nr-etiqueta")?.value.trim();
    const bidir    = C.querySelector("#nr-bidir")?.checked || false;
    if (!destino)  { C.querySelector("#nr-destino").focus();  return; }
    if (!etiqueta) { C.querySelector("#nr-etiqueta").focus(); return; }
    crearRelacion(nodo.id, destino, tipo, etiqueta, bidir);
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
    if (state.tabActivo === "mapa") {
      tabsInit.add("mapa");
      await initMapa();
    }
    // Refresh panel with updated connectivity info
    const updated = state.grafo.nodes.find(n => n.id === state.panelNodo?.id);
    if (updated) onNodoSeleccionado(updated);
  } catch(e) { alert("Error al crear relación: " + e.message); }
}

async function anotarEnPanel(nodoId, nota) {
  try {
    await apiFetch(`/api/validacion/${encodeURIComponent(state.slug)}/anotar`,{method:"POST",body:JSON.stringify({objeto_anotado:nodoId,nota})});
    await refrescarValidacion();
    // Refresh panel
    const updated=state.grafo?.nodes.find(n=>n.id===nodoId)||state.panelNodo;
    if (updated) onNodoSeleccionado(updated);
  } catch(e) { alert("Error al anotar: "+e.message); }
}

// ════════════════════════════════════════════════════════════════════════
// getYourStuffTogether — reconexión de nodos sueltos
// ════════════════════════════════════════════════════════════════════════

async function actualizarBotonReconexion() {
  const btn = document.getElementById("btn-reconectar");
  if (!btn || !state.slug) return;
  try {
    const info = await apiFetch(`/api/grafo/${encodeURIComponent(state.slug)}/reconexion/estado`);
    btn.hidden = info.es_conexo;
    if (!info.es_conexo) {
      btn.title = `${info.nodos_sueltos_count} nodo(s) desconectado(s) del núcleo principal — clic para reconectar`;
    }
    // Si hay sesión activa: mostrar según estado
    if (info.sesion_activa) {
      if (info.sesion_activa.estado === "en_revision") {
        renderPanelReconexion(info.sesion_activa);
      } else if (info.sesion_activa.estado === "procesando") {
        // Reconectar al stream en curso
        abrirStreamExistente();
      }
    }
  } catch(e) { btn.hidden = true; }
}

function abrirStreamExistente() {
  const panel = document.getElementById("panel-reconexion");
  const content = document.getElementById("panel-reconexion-content");
  const footer = document.getElementById("panel-reconexion-footer");
  if (!panel || !content) return;
  panel.hidden = false;
  if (footer) footer.hidden = true;
  content.innerHTML = `
    <div class="rec-log-header">Procesando…</div>
    <pre class="rec-log-pre" id="rec-log"></pre>`;
  const logPre = document.getElementById("rec-log");

  const es = new EventSource(`/api/grafo/${encodeURIComponent(state.slug)}/reconexion/stream`);
  es.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (d.chunk && logPre) { logPre.textContent += d.chunk; logPre.scrollTop = logPre.scrollHeight; }
    if (d.done) {
      es.close();
      apiFetch(`/api/grafo/${encodeURIComponent(state.slug)}/reconexion/sesion`)
        .then(s => renderPanelReconexion(s)).catch(() => {});
    }
  };
  es.onerror = () => { es.close(); };
}

async function abrirPanelReconexion() {
  const panel = document.getElementById("panel-reconexion");
  const content = document.getElementById("panel-reconexion-content");
  if (!panel) return;

  // Verificar si hay sesión activa
  let sesion = null;
  try {
    sesion = await apiFetch(`/api/grafo/${encodeURIComponent(state.slug)}/reconexion/sesion`);
  } catch(e) {}

  if (sesion && sesion.estado === "en_revision") {
    renderPanelReconexion(sesion);
    return;
  }
  if (sesion && sesion.estado === "procesando") {
    abrirStreamExistente();
    return;
  }

  // Iniciar nueva reconexión
  panel.hidden = false;
  document.getElementById("panel-nodo").hidden = true;
  // Ocultar footer hasta que las propuestas estén listas
  const footer = document.getElementById("panel-reconexion-footer");
  if (footer) footer.hidden = true;
  content.innerHTML = `
    <div class="rec-log-header">Procesando…</div>
    <pre class="rec-log-pre" id="rec-log"></pre>`;

  try {
    await apiFetch(`/api/grafo/${encodeURIComponent(state.slug)}/reconexion/iniciar`, { method: "POST", body: "{}" });

    // SSE: recibir tokens del LLM en tiempo real
    const esUrl = `/api/grafo/${encodeURIComponent(state.slug)}/reconexion/stream`;
    const es = new EventSource(esUrl);
    const logPre = document.getElementById("rec-log");

    es.onmessage = (ev) => {
      const d = JSON.parse(ev.data);
      if (d.chunk && logPre) {
        logPre.textContent += d.chunk;
        logPre.scrollTop = logPre.scrollHeight;
      }
      if (d.done) {
        es.close();
        apiFetch(`/api/grafo/${encodeURIComponent(state.slug)}/reconexion/sesion`)
          .then(s => renderPanelReconexion(s))
          .catch(err => {
            content.innerHTML = `<p class="muted" style="padding:16px">Error al cargar propuestas: ${esc(err.message)}</p>`;
          });
      }
    };

    es.onerror = () => {
      es.close();
      // Fallback: intentar cargar la sesión de todos modos
      apiFetch(`/api/grafo/${encodeURIComponent(state.slug)}/reconexion/sesion`)
        .then(s => {
          if (s.estado === "en_revision") renderPanelReconexion(s);
          else content.innerHTML = `<p class="muted" style="padding:16px">Error: ${esc(s.razon_falla || "Error de conexión")}</p>`;
        })
        .catch(() => {
          content.innerHTML = `<p class="muted" style="padding:16px">Error de conexión con el servidor.</p>`;
        });
    };
  } catch(e) {
    content.innerHTML = `<p class="muted" style="padding:16px">Error al iniciar: ${esc(e.message)}</p>`;
  }
}

function renderPanelReconexion(sesion) {
  const panel = document.getElementById("panel-reconexion");
  const content = document.getElementById("panel-reconexion-content");
  const footer = document.getElementById("panel-reconexion-footer");
  if (!panel || !content) return;
  panel.hidden = false;
  if (footer) footer.hidden = false;

  if (!sesion.propuestas || sesion.propuestas.length === 0) {
    content.innerHTML = `<p class="muted" style="padding:16px">El LLM no encontró conexiones adicionales.</p>`;
    return;
  }

  content.innerHTML = sesion.propuestas.map(p => {
    const orig = p.conexion.origen_label || p.conexion.origen_id;
    const dest = p.conexion.destino_label || p.conexion.destino_id;
    return `<div class="rec-propuesta" data-pid="${esc(p.id)}">
      <label class="rec-check-label">
        <input type="checkbox" class="rec-check" data-pid="${esc(p.id)}" ${p.seleccionada ? "checked" : ""}>
        <span class="rec-nodos"><span class="tag">${esc(orig)}</span> → <span class="tag">${esc(dest)}</span></span>
      </label>
      <input class="edit-input rec-frase" data-pid="${esc(p.id)}"
             value="${esc(p.frase_editada)}" placeholder="descripción de la relación">
    </div>`;
  }).join("");

  // Bind confirmar
  const btnConf = document.getElementById("btn-confirmar-reconexion");
  const btnCan  = document.getElementById("btn-cancelar-reconexion");
  const btnCer  = document.getElementById("btn-cerrar-reconexion");

  if (btnConf) btnConf.onclick = async () => {
    const items = sesion.propuestas.map(p => {
      const check = content.querySelector(`.rec-check[data-pid="${p.id}"]`);
      const frase = content.querySelector(`.rec-frase[data-pid="${p.id}"]`);
      return {
        propuesta_id: p.id,
        seleccionada: check ? check.checked : false,
        frase_editada: frase ? frase.value.trim() || p.frase_editada : p.frase_editada,
      };
    });
    try {
      const res = await apiFetch(
        `/api/grafo/${encodeURIComponent(state.slug)}/reconexion/confirmar`,
        { method: "POST", body: JSON.stringify({ items }) }
      );
      panel.hidden = true;
      // Invalidar caché del mini-mapa para que se recalcule
      delete _miniGrafoCache[state.slug];
      // Recargar grafo y actualizar botón
      state.grafo = null; tabsInit.delete("mapa");
      await cargarGrafo(); await initMapa();
      actualizarBotonReconexion();
      alert(`${res.relaciones_agregadas} conexión(es) agregada(s). Nodos desconectados restantes: ${res.nodos_sueltos_restantes}`);
    } catch(e) { alert("Error: " + e.message); }
  };
  if (btnCan) btnCan.onclick = async () => {
    try { await apiFetch(`/api/grafo/${encodeURIComponent(state.slug)}/reconexion/sesion`, { method: "DELETE" }); } catch(e) {}
    panel.hidden = true;
  };
  if (btnCer) btnCer.onclick = () => { panel.hidden = true; };
}

// ════════════════════════════════════════════════════════════════════════
// Tab: Decisiones
// ════════════════════════════════════════════════════════════════════════

const TIPO_DECISION_LABELS = {
  sinonimia:         "Sinónimos",
  bidireccionalidad: "Bidireccional",
  confirmar_bucle:   "Bucle",
  confianza_baja:    "Confianza baja",
  metalenguaje:      "Metalenguaje",
  promocion_de_tipo: "Tipo ambiguo",
};

async function initDecisiones() {
  if (!state.validacion) state.validacion = await apiFetch(`/api/validacion/${encodeURIComponent(state.slug)}`);
  renderDecisiones();
  if (!decisionesListeners) {
    decisionesListeners = true;
    document.getElementById("btn-siguiente-pendiente").addEventListener("click", () => {
      const el = document.querySelector(".dec-card[data-estado='pendiente']");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
  // Filtros por tipo
  const tipos = [...new Set((state.validacion.decisiones || []).map(d => d.tipo))].sort();
  const fe = document.getElementById("filtros-dec-tipo");
  fe.innerHTML = `<button class="tipo-filtro-btn active" data-tipo="todos">Todas</button>` +
    tipos.map(t => `<button class="tipo-filtro-btn" data-tipo="${esc(t)}">${esc(TIPO_DECISION_LABELS[t] || t)}</button>`).join("");
  fe.querySelectorAll(".tipo-filtro-btn").forEach(b => b.addEventListener("click", () => {
    fe.querySelectorAll(".tipo-filtro-btn").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    decisionesState.filtroTipo = b.dataset.tipo;
    renderDecisiones();
  }));
}

function renderDecisiones() {
  const decisiones = state.validacion?.decisiones || [];
  const nById = Object.fromEntries((state.grafo?.nodes || []).map(n => [n.id, n]));

  // Badge en tab
  const pendientes = decisiones.filter(d => d.estado === "pendiente").length;
  const badge = document.getElementById("badge-decisiones");
  if (badge) { badge.textContent = pendientes; badge.hidden = pendientes === 0; }

  let rows = decisiones;
  if (decisionesState.filtroTipo !== "todos") rows = rows.filter(d => d.tipo === decisionesState.filtroTipo);

  const lista = document.getElementById("decisiones-lista");
  if (!lista) return;
  if (rows.length === 0) { lista.innerHTML = `<p class="muted" style="padding:24px">No hay decisiones en este filtro.</p>`; return; }

  lista.innerHTML = rows.map(d => {
    const labelTipo = TIPO_DECISION_LABELS[d.tipo] || d.tipo;
    const resuelta = d.estado === "resuelta";
    const diferida = d.estado === "diferida";
    const pendiente = d.estado === "pendiente";

    // Contexto: conceptos implicados
    const ctxConceptos = (d.conceptos_implicados_ids || [])
      .map(id => nById[id]?.label || id)
      .map(l => `<span class="tag">${esc(l)}</span>`)
      .join(" ");

    // Extra para sinonimia: input de label
    const extraSinonimia = d.tipo === "sinonimia" && !resuelta
      ? `<div style="margin-top:8px"><label class="campo-etiq">Label canónico</label>
         <input class="edit-input dec-label-input" data-did="${esc(d.id)}"
                value="${esc(d.label_canonico_propuesto || "")}"
                placeholder="Label canónico (opcional)" style="width:260px"></div>`
      : (d.label_resolucion ? `<div class="muted" style="font-size:11px;margin-top:4px">Label: ${esc(d.label_resolucion)}</div>` : "");

    // Extra para promocion_de_tipo: selector
    const extraTipo = d.tipo === "promocion_de_tipo" && !resuelta
      ? `<div style="margin-top:8px"><label class="campo-etiq">Tipo elegido</label>
         <select class="edit-select dec-tipo-select" data-did="${esc(d.id)}" style="width:180px">
           <option value="">— elegir —</option>
           <option value="primitivo">Primitivo</option>
           <option value="derivado">Derivado</option>
           <option value="metalenguaje">Metalenguaje</option>
         </select></div>`
      : (d.nota_resolucion && d.tipo === "promocion_de_tipo"
          ? `<div class="muted" style="font-size:11px;margin-top:4px">Tipo: ${esc(d.nota_resolucion)}</div>` : "");

    const botonesAccion = !resuelta
      ? `<div class="dec-acciones">
           <button class="btn btn-aceptar small dec-btn-aceptar" data-did="${esc(d.id)}">Aceptar</button>
           <button class="btn btn-modificar small dec-btn-modificar" data-did="${esc(d.id)}">Modificar</button>
           <button class="btn btn-rechazar small dec-btn-rechazar" data-did="${esc(d.id)}">Rechazar</button>
           ${pendiente ? `<button class="btn btn-diferir small dec-btn-diferir" data-did="${esc(d.id)}">Diferir</button>` : ""}
           ${diferida  ? `<button class="btn btn-neutro small dec-btn-reanudar" data-did="${esc(d.id)}">Reanudar</button>` : ""}
         </div>`
      : `<div class="dec-acciones">
           <span class="tag ${d.resolucion}">${esc(d.resolucion || "")}</span>
           <button class="btn btn-neutro small dec-btn-reanudar" data-did="${esc(d.id)}">Reabrir</button>
         </div>`;

    return `<div class="dec-card" data-did="${esc(d.id)}" data-estado="${esc(d.estado)}">
      <div class="dec-header">
        <span class="tag dec-tipo-tag">${esc(labelTipo)}</span>
        <span class="dec-estado ${d.estado}">${esc(d.estado)}</span>
      </div>
      <div class="dec-pregunta">${esc(d.pregunta)}</div>
      ${ctxConceptos ? `<div class="dec-ctx">${ctxConceptos}</div>` : ""}
      <div class="dec-rec muted">${esc(d.recomendacion_llm || "")}</div>
      ${extraSinonimia}
      ${extraTipo}
      ${botonesAccion}
    </div>`;
  }).join("");

  // Bind eventos
  lista.querySelectorAll(".dec-btn-aceptar").forEach(btn => btn.addEventListener("click", () =>
    resolverDecision(btn.dataset.did, "aceptada", null,
      lista.querySelector(`.dec-label-input[data-did="${btn.dataset.did}"]`)?.value?.trim() || null)
  ));
  lista.querySelectorAll(".dec-btn-rechazar").forEach(btn => btn.addEventListener("click", () =>
    resolverDecision(btn.dataset.did, "rechazada")
  ));
  lista.querySelectorAll(".dec-btn-modificar").forEach(btn => btn.addEventListener("click", () => {
    // Para modificar: aceptar con el label editado (sinonimia) o tipo elegido (promocion_de_tipo)
    const labelInput = lista.querySelector(`.dec-label-input[data-did="${btn.dataset.did}"]`);
    const tipoSelect = lista.querySelector(`.dec-tipo-select[data-did="${btn.dataset.did}"]`);
    const nota = tipoSelect?.value || null;
    const labelVal = labelInput?.value?.trim() || null;
    resolverDecision(btn.dataset.did, "modificada", nota, labelVal);
  }));
  lista.querySelectorAll(".dec-btn-diferir").forEach(btn => btn.addEventListener("click", () =>
    resolverDecision(btn.dataset.did, "diferida")
  ));
  lista.querySelectorAll(".dec-btn-reanudar").forEach(btn => btn.addEventListener("click", () =>
    reanudarDecision(btn.dataset.did)
  ));
}

async function resolverDecision(did, resolucion, nota=null, label_resolucion=null) {
  try {
    await apiFetch(`/api/validacion/${encodeURIComponent(state.slug)}/decisiones/${encodeURIComponent(did)}/resolver`, {
      method: "POST",
      body: JSON.stringify({ resolucion, nota, label_resolucion }),
    });
    state.validacion = await apiFetch(`/api/validacion/${encodeURIComponent(state.slug)}`);
    // Invalidar mapa, conceptos y miniatura
    tabsInit.delete("mapa"); tabsInit.delete("conceptos");
    state.grafo = null;
    if (state.slug) delete _miniGrafoCache[state.slug];
    renderDecisiones();
  } catch(e) { alert("Error: " + e.message); }
}

async function reanudarDecision(did) {
  try {
    await apiFetch(`/api/validacion/${encodeURIComponent(state.slug)}/decisiones/${encodeURIComponent(did)}/reanudar`, {
      method: "POST", body: "{}",
    });
    state.validacion = await apiFetch(`/api/validacion/${encodeURIComponent(state.slug)}`);
    renderDecisiones();
  } catch(e) { alert("Error: " + e.message); }
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

  document.getElementById("btn-cerrar-panel").addEventListener("click", () => {
    document.getElementById("panel-nodo").hidden = true; state.panelNodo = null;
  });

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
  const btn         = document.getElementById("btn-settings");
  const panel       = document.getElementById("settings-panel");
  const cerrar      = document.getElementById("settings-panel-cerrar");
  const sel         = document.getElementById("settings-model-select");
  const status      = document.getElementById("settings-model-status");
  const guardar     = document.getElementById("settings-guardar");
  const ollamaSection = document.getElementById("settings-ollama-section");
  const apiSection    = document.getElementById("settings-api-section");
  const apiModelInput = document.getElementById("settings-api-model");
  const apiKeyStatus  = document.getElementById("settings-api-key-status");

  let _cfg = null;

  function _mostrarSeccion(provider) {
    const esOllama = provider === "ollama";
    ollamaSection.hidden = !esOllama;
    apiSection.hidden = esOllama;
    if (!esOllama && _cfg) {
      const ps = (_cfg.providers_status || {})[provider] || {};
      apiModelInput.value = ps.model || "";
      apiKeyStatus.innerHTML = ps.has_key
        ? ico("check", 10) + " API key configurada"
        : "⚠ API key no configurada en .env";
      apiKeyStatus.style.color = ps.has_key ? "var(--sn-ok)" : "var(--sn-warn)";
    }
  }

  async function _cargar() {
    status.textContent = "Cargando…";
    sel.innerHTML = "";
    try {
      _cfg = await apiFetch("/api/settings");
      // Marcar radio del proveedor activo
      document.querySelectorAll('input[name="settings-provider"]').forEach(r => {
        r.checked = r.value === _cfg.provider;
      });
      // Indicadores de API key en los labels
      const ps = _cfg.providers_status || {};
      ["anthropic", "openai", "gemini"].forEach(p => {
        const ind = document.getElementById(`settings-key-${p}`);
        if (!ind) return;
        const ok = (ps[p] || {}).has_key;
        ind.textContent = ok ? "✓" : "✗";
        ind.style.color = ok ? "var(--sn-ok)" : "var(--sn-danger)";
        ind.title = ok ? "API key configurada" : "API key no encontrada en .env";
      });
      // Sección activa
      _mostrarSeccion(_cfg.provider);
      // Poblar select de Ollama
      if ((ps.ollama || {}).connected === false || !_cfg.available_models.length) {
        sel.innerHTML = `<option value="${esc(_cfg.model || "")}">${esc(_cfg.model || "sin modelos")}</option>`;
        if (_cfg.provider === "ollama") status.textContent = "Ollama no responde";
        else status.textContent = "";
      } else {
        _cfg.available_models.forEach(m => {
          const opt = document.createElement("option");
          opt.value = m; opt.textContent = m;
          if (m === _cfg.model) opt.selected = true;
          sel.appendChild(opt);
        });
        status.textContent = "";
      }
    } catch(e) { status.textContent = "Error: " + e.message; }
  }

  btn.addEventListener("click", async () => {
    const visible = !panel.hidden;
    if (visible) { panel.hidden = true; btn.classList.remove("active"); return; }
    panel.hidden = false; btn.classList.add("active");
    await _cargar();
  });

  cerrar.addEventListener("click", () => { panel.hidden = true; btn.classList.remove("active"); });

  // Cambio de proveedor: actualizar sección visible
  document.querySelectorAll('input[name="settings-provider"]').forEach(r => {
    r.addEventListener("change", () => { if (r.checked) _mostrarSeccion(r.value); });
  });

  // Guardar
  guardar.addEventListener("click", async () => {
    const selectedProvider = document.querySelector('input[name="settings-provider"]:checked')?.value;
    if (!selectedProvider) return;
    const model = selectedProvider === "ollama"
      ? sel.value
      : apiModelInput.value.trim();
    status.textContent = "Guardando…";
    try {
      const body = { provider: selectedProvider };
      if (model) body.model = model;
      const r = await apiFetch("/api/settings", { method: "PATCH", body: JSON.stringify(body) });
      if (_cfg) _cfg.provider = r.provider;
      status.innerHTML = ico("check", 12) + " Guardado";
      setTimeout(() => { status.textContent = ""; }, 2000);
    } catch(e) { status.textContent = "Error: " + e.message; }
  });

  // Cerrar al hacer clic fuera
  document.addEventListener("click", e => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== btn) {
      panel.hidden = true; btn.classList.remove("active");
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

async function reprocesarDesdeLibreria(slug) {
  const titulo = slug.replace(/-/g," ").replace(/\b\w/g,c=>c.toUpperCase());
  const ok = confirm(
    `¿Re-procesar «${titulo}»?\n\n` +
    `El LLM volverá a analizar el texto. Los conceptos y relaciones ya existentes se conservarán; los nuevos que encuentre se añadirán al grafo.`
  );
  if (!ok) return;
  try {
    await apiFetch(`/api/extracciones/${encodeURIComponent(slug)}/procesar`,
      { method: "POST", body: JSON.stringify({ force: true }) });
    const exts = await apiFetch("/api/extracciones");
    renderBiblioteca(exts);
    _arrancarPolling();
  } catch(e) { alert("Error al iniciar re-extracción: " + e.message); }
}

// ════════════════════════════════════════════════════════════════════════
// Tab: Texto original
// ════════════════════════════════════════════════════════════════════════

async function initTexto() {
  const wrap = document.getElementById("texto-wrap");
  const metaEl = document.getElementById("texto-meta");
  const contenidoEl = document.getElementById("texto-contenido");

  contenidoEl.textContent = "Cargando…";
  try {
    const data = await apiFetch(`/api/transcripts/${encodeURIComponent(state.slug)}`);
    const m = state.validacion?.metadatos;
    const cita = m ? buildCita(m) : "";
    metaEl.innerHTML = cita
      ? `<div class="texto-ficha"><span class="campo-etiq">Fuente</span> <em>${esc(cita)}</em></div>`
      : `<div class="texto-ficha muted" style="font-size:var(--sn-fs-xs)">Sin ficha bibliográfica —
           <button class="btn-inline" id="btn-abrir-ficha-texto">${ico("edit-2")} Añadir</button></div>`;
    contenidoEl.textContent = data.texto;

    document.getElementById("btn-abrir-ficha-texto")?.addEventListener("click", () => {
      abrirFichaModal(state.slug);
    });
  } catch(e) {
    contenidoEl.textContent = "No se pudo cargar el transcript: " + e.message;
  }
}

// ════════════════════════════════════════════════════════════════════════
// Grafos personales
// ════════════════════════════════════════════════════════════════════════

const gpState = {
  slug: null,
  grafo: null,           // datos completos del GrafoPersonal
  grafoVis: null,        // { nodes, links } para D3
  nodoSeleccionado: null,
  gpUpdate: null,        // fn updateVisuals de initGrafo
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

function gpBindSidebarListeners() {
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

  // Ajustar vista
  document.getElementById("btn-gp-fit").onclick = () => {
    if (gpState.gpFit) gpState.gpFit();
  };

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

// ── Canvas D3 ────────────────────────────────────────────────────────

async function renderGPCanvas() {
  const svgEl = document.getElementById("gp-svg");
  const vacio = document.getElementById("gp-canvas-vacio");
  const { nodes, links } = gpState.grafoVis;

  vacio.hidden = nodes.length > 0;

  if (!nodes.length) { d3ClearGPSvg(svgEl); return; }

  // Importar y reusar initGrafo con los datos del grafo personal
  const { initGrafo } = await import("./grafo.js");
  const { updateVisuals, fitView } = initGrafo(svgEl, { nodes, links }, gpOnNodoSeleccionado);
  gpState.gpUpdate = updateVisuals;
  gpState.gpFit = fitView;
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
  const TIPOS_REL = ["fundamenta","amplifica","especifica","contraposicion","constituye","genera","presupone","evoca","pertenece"];

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
          <div>
            <span class="tag" style="font-size:10px">${esc(r.tipo)}</span>
            <span style="font-size:12px;margin-left:4px">${esOrigen ? "→" : "←"} ${esc(otro?.label || otroId)}</span>
            ${r.etiqueta ? `<div style="font-size:11px;color:var(--sn-ink-soft);font-style:italic">"${esc(r.etiqueta)}"</div>` : ""}
          </div>
          <button class="btn-inline danger" data-del-rel="${esc(r.id)}" title="Eliminar relación">${ico("x")}</button>
        </div>`;
      }).join("")}
    </div>` : ""}

    <!-- Nueva relación -->
    ${otros.length ? `
    <div class="panel-seccion">
      <div class="panel-seccion-titulo">Vincular con…</div>
      <div class="campo">
        <span class="campo-etiq">Concepto destino</span>
        <select id="gp-nr-destino" class="edit-select" style="width:100%">
          <option value="">— Seleccionar —</option>
          ${otros.map(n => `<option value="${esc(n.id)}">${esc(n.label)}</option>`).join("")}
        </select>
      </div>
      <div class="campo">
        <span class="campo-etiq">Tipo</span>
        <select id="gp-nr-tipo" class="edit-select" style="width:100%">
          ${TIPOS_REL.map(t => `<option value="${t}">${t}</option>`).join("")}
        </select>
      </div>
      <div class="campo">
        <span class="campo-etiq">Etiqueta <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">(opcional)</span></span>
        <input id="gp-nr-etiqueta" class="edit-input" placeholder="ej. implica, reduce, requiere…" style="width:100%">
      </div>
      <div class="campo" style="display:flex;align-items:center;gap:8px">
        <input type="checkbox" id="gp-nr-bidir" style="cursor:pointer">
        <label for="gp-nr-bidir" class="campo-etiq" style="margin-bottom:0;cursor:pointer">Bidireccional ↔</label>
      </div>
      <button id="gp-btn-crear-relacion" class="btn btn-aceptar small" style="width:100%;margin-top:4px">+ Crear relación</button>
      <div id="gp-nr-error" style="color:var(--sn-danger);font-size:var(--sn-fs-xs);margin-top:4px;display:none">Selecciona un concepto destino.</div>
    </div>` : ""}
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
    document.getElementById("gp-btn-crear-relacion").addEventListener("click", () => {
      const destino  = document.getElementById("gp-nr-destino").value;
      const tipo     = document.getElementById("gp-nr-tipo").value;
      const etiqueta = document.getElementById("gp-nr-etiqueta").value.trim() || tipo;
      const bidir    = document.getElementById("gp-nr-bidir").checked;
      const errEl    = document.getElementById("gp-nr-error");
      if (!destino) {
        errEl.style.display = "block";
        document.getElementById("gp-nr-destino").focus();
        return;
      }
      errEl.style.display = "none";
      gpCrearRelacion(c.id, destino, tipo, etiqueta, bidir);
    });
  }
}

// ── Acciones CRUD ────────────────────────────────────────────────────

async function crearConceptoGP() {
  const label = document.getElementById("gp-concepto-label").value.trim();
  const def   = document.getElementById("gp-concepto-def").value.trim() || null;
  if (!label) { document.getElementById("gp-concepto-label").focus(); return; }
  try {
    await apiFetch(`/api/grafos-personales/${encodeURIComponent(gpState.slug)}/conceptos`,
      { method: "POST", body: JSON.stringify({ label, definicion: def }) });
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

async function gpCrearRelacion(origenId, destinoId, tipo, etiqueta, bidireccional) {
  try {
    await apiFetch(`/api/grafos-personales/${encodeURIComponent(gpState.slug)}/relaciones`,
      { method: "POST", body: JSON.stringify({ origen_id: origenId, destino_id: destinoId, tipo, etiqueta, bidireccional }) });
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
  document.getElementById("gp-nuevo-concepto-form").hidden = true;
  document.getElementById("gp-panel").hidden = true;
  document.getElementById("vista-gp").hidden = true;
  mostrarBiblioteca();
}
