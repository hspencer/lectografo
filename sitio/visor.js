import { initNavCols } from "./navcols.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

const DIR_SYM = { saliente: "→", entrante: "←", bidireccional: "↔" };

const slug = new URLSearchParams(location.search).get("slug");

const state = {
  grafo: null,
  modo3d: false,
  grafoDestroy: null,
  grafoFit: null,
  grafoHighlight: null,
  relColor: null,
  navCols: null,
  path: [],   // [{ node, link, dir }] — link/dir describen cómo se llegó a ese paso
};

// Token de generación: descarta renders 3D/2D que quedaron en vuelo si el
// usuario alterna el modo antes de que la carga (import + init) termine —
// sin esto, dos renderMapa() concurrentes pueden dejar el DOM (hidden/label)
// en un estado inconsistente con la última instancia realmente inicializada.
let renderGen = 0;

async function init() {
  if (!slug) {
    document.getElementById("grafo-titulo").textContent = "Falta el parámetro ?slug=";
    return;
  }
  const r = await fetch(`./data/${encodeURIComponent(slug)}.json`);
  if (!r.ok) {
    document.getElementById("grafo-titulo").textContent = "Grafo no encontrado";
    return;
  }
  state.grafo = await r.json();
  document.title = `Lectógrafo — ${state.grafo.titulo || slug}`;
  document.getElementById("grafo-titulo").textContent = state.grafo.titulo || slug;

  state.navCols = initNavCols(document.getElementById("nav-cols"), {
    onCerrar: id => {
      const idx = parseInt(id.replace("col-", ""), 10);
      state.path = state.path.slice(0, idx);
      refrescarHighlight();
    },
  });

  document.getElementById("btn-fit").onclick = () => state.grafoFit?.();
  document.getElementById("btn-modo3d").onclick = () => {
    state.modo3d = !state.modo3d;
    renderMapa();
  };

  renderMapa();
}

async function renderMapa() {
  const gen = ++renderGen;
  const svgEl = document.getElementById("grafo-svg");
  const el3d  = document.getElementById("grafo-3d");

  svgEl.hidden = state.modo3d;
  el3d.hidden  = !state.modo3d;
  document.getElementById("btn-modo3d-label").textContent = state.modo3d ? "2D" : "3D";

  const modulo = state.modo3d
    ? await import("./grafo3d.js")
    : await import("./grafo.js");

  if (gen !== renderGen) return; // se alternó el modo mientras cargaba

  state.grafoDestroy?.();
  state.grafoDestroy = null;

  if (state.modo3d) {
    const { fitView, highlightPath, destroy } = modulo.initGrafo3D(el3d, state.grafo, onNodoSeleccionado);
    state.grafoFit      = fitView;
    state.grafoHighlight = highlightPath;
    state.grafoDestroy  = destroy;
    state.relColor      = null;
    document.getElementById("leyenda-tipos").innerHTML = "";
  } else {
    const { relColorScale, relTypes, highlightPath, fitView } = modulo.initGrafo(svgEl, state.grafo, onNodoSeleccionado);
    state.grafoFit       = fitView;
    state.grafoHighlight = highlightPath;
    state.relColor       = relColorScale;
    renderLeyenda(relColorScale, relTypes);
  }
  refrescarHighlight();
}

function renderLeyenda(relColorScale, relTypes) {
  const fmt = t => t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  document.getElementById("leyenda-tipos").innerHTML = relTypes.slice(0, 10).map(t => `
    <div class="leyenda-item">
      <span class="leyenda-line" style="background:${relColorScale(t)}"></span>
      <span>${esc(fmt(t))}</span>
    </div>
  `).join("");
}

// ── Navegador de columnas: nodo del grafo → columnas concepto+relaciones ──

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

function renderColumnasDesde(idx) {
  if (!state.navCols) return;
  state.navCols.truncarDesde(`col-${idx}`);
  for (let i = idx; i < state.path.length; i++) {
    const paso = state.path[i];
    state.navCols.abrirColumna({
      id: `col-${i}`,
      headerHtml: buildColHeaderHTML(paso),
      bodyHtml:   buildPanelHTML(paso.node, i),
      onBind:     colEl => bindPanelListeners(colEl, i),
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

function campo(etiq, valorHtml) {
  return `<div class="campo"><span class="campo-etiq">${esc(etiq)}</span><div>${valorHtml}</div></div>`;
}

function buildPanelHTML(nodo, colIdx) {
  let h = "";

  h += `<div class="panel-seccion">`;
  h += `<div class="campo"><span class="campo-etiq">Menciones · Confianza</span>
    <div>${nodo.menciones} menciones &ensp;<span>${nodo.confianza.toFixed(2)}</span></div></div>`;
  if (nodo.descripcion) h += campo("Descripción", esc(nodo.descripcion));
  if (nodo.cita_directa) h += campo("Cita directa", `<p class="cita">"${esc(nodo.cita_directa)}"</p>`);
  if (nodo.sinonimos_candidatos?.length) {
    h += `<div class="campo"><span class="campo-etiq">Sinónimos candidatos</span><div class="sinonimos-lista">${nodo.sinonimos_candidatos.map(s => `<span class="tag">${esc(s)}</span>`).join("")}</div></div>`;
  }
  h += `</div>`;

  h += buildRelacionesHTML(nodo, colIdx);
  return h;
}

// Conexiones de un nodo, salientes+bidireccionales primero, entrantes puras
// después; una relación bidireccional aparece una sola vez.
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
  const nodeById = Object.fromEntries((state.grafo?.nodes || []).map(n => [n.id, n]));
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

function bindPanelListeners(colEl, colIdx) {
  colEl.querySelectorAll(".panel-rel-fila--clicable").forEach(btn => {
    btn.addEventListener("click", () => {
      const linkId     = btn.dataset.linkId;
      const neighborId = btn.dataset.neighborId;
      const dir        = btn.dataset.dir;
      const link       = state.grafo.links.find(l => l.id === linkId);
      avanzarCamino(neighborId, link, dir, colIdx);
    });
  });
}

init();
