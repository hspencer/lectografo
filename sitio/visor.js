import { createFloatingCards } from "./floatcards.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

// Lucide icon helper — igual que ico() en static/app.js, subset usado acá
function ico(name, size = 13) {
  const P = {
    "book-a":     `<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/><path d="m8 13 4-7 4 7"/><path d="M9.1 11h5.7"/>`,
    "graph-star": `<path d="m12.342 9.316 1.764-3.527"/><path d="m12.59 14.545 2.35 3.759"/><path d="m13.982 12.332 4.03.447"/><path d="M5.414 17.586 8.88 14.12"/><path d="M9.025 9.742 5.317 5.505"/><circle cx="11" cy="12" r="3"/><circle cx="15" cy="4" r="2"/><circle cx="16" cy="20" r="2"/><circle cx="20" cy="13" r="2"/><circle cx="4" cy="19" r="2"/><circle cx="4" cy="4" r="2"/>`,
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`;
}

const DIR_SYM = { saliente: "→", entrante: "←", bidireccional: "↔" };

const slug = new URLSearchParams(location.search).get("slug");

const state = {
  grafo: null,
  modo3d: true,  // 3D por defecto
  grafoDestroy: null,
  grafoFit: null,
  grafoHighlight: null,
  grafoCenter: null,
  relColor: null,
  mapaCards: null,
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

  state.mapaCards = createFloatingCards(
    document.getElementById("mapa-overlay"),
    document.getElementById("mapa-arrows"),
    { onFocus: nodeId => state.grafoCenter?.(nodeId) },
  );

  document.getElementById("btn-fit").onclick = () => state.grafoFit?.();
  document.getElementById("btn-modo3d").onclick = () => {
    state.modo3d = !state.modo3d;
    renderMapa();
  };

  initMapaBuscar();
  renderMapa();
}

async function renderMapa() {
  const gen = ++renderGen;
  const svgEl = document.getElementById("grafo-svg");
  const el3d  = document.getElementById("grafo-3d");

  if (state.modo3d) {
    svgEl.setAttribute("hidden", ""); el3d.removeAttribute("hidden");
  } else {
    svgEl.removeAttribute("hidden"); el3d.setAttribute("hidden", "");
  }
  const btnModo3d = document.getElementById("btn-modo3d");
  btnModo3d.title = state.modo3d ? "Cambiar a vista 2D" : "Cambiar a vista 3D";
  btnModo3d.classList.toggle("active", state.modo3d);

  const modulo = state.modo3d
    ? await import("./grafo3d.js")
    : await import("./grafo.js");

  if (gen !== renderGen) return; // se alternó el modo mientras cargaba

  state.grafoDestroy?.();
  state.grafoDestroy = null;

  if (state.modo3d) {
    const { fitView, highlightPath, centerOnNode, destroy } = modulo.initGrafo3D(el3d, state.grafo, onNodoSeleccionado);
    state.grafoFit      = fitView;
    state.grafoHighlight = highlightPath;
    state.grafoCenter   = centerOnNode;
    state.grafoDestroy  = destroy;
    state.relColor      = null;
    document.getElementById("leyenda-tipos").innerHTML = "";
  } else {
    const { relColorScale, relTypes, highlightPath, centerOnNode, fitView } = modulo.initGrafo(svgEl, state.grafo, onNodoSeleccionado);
    state.grafoFit       = fitView;
    state.grafoHighlight = highlightPath;
    state.grafoCenter    = centerOnNode;
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

// ── Buscador de conceptos en el mapa (mismo patrón que static/app.js) ──────

function initMapaBuscar() {
  const inp  = document.getElementById("mapa-buscar");
  const drop = document.getElementById("mapa-buscar-dropdown");
  if (!inp || !drop) return;

  wireAutocomplete(inp, drop,
    () => (state.grafo?.nodes || []).map(n => ({
      label: n.label,
      meta:  n.menciones ? `${n.menciones} mens.` : undefined,
      onSelect: () => {
        inp.value = "";
        drop.hidden = true;
        if (state.grafoCenter) state.grafoCenter(n.id);
        onNodoSeleccionado(n);
      },
    })),
    { minChars: 1 }
  );
}

function wireAutocomplete(inputEl, dropdownEl, getPool, { minChars = 1 } = {}) {
  let activeIdx = -1;
  let items = [];

  function render(query) {
    const q = query.toLowerCase().trim();
    items = (q.length < minChars)
      ? []
      : getPool().filter(p => p.label.toLowerCase().includes(q)).slice(0, 12);
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
    if (inputEl.value.length >= minChars) render(inputEl.value);
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

// ── Tarjetas flotantes: nodo del grafo → tarjeta flotante de concepto,
// encadenadas por flechas que respetan la dirección de la relación ──────

function onNodoSeleccionado(nodo) {
  if (!nodo || !state.mapaCards) return;
  const existente = state.mapaCards.findByNodeId(nodo.id);
  if (existente) { state.mapaCards.bringToFront(existente); return; }
  abrirCardMapa(nodo);
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

function campo(etiq, valorHtml) {
  return `<div class="campo"><span class="campo-etiq">${esc(etiq)}</span><div>${valorHtml}</div></div>`;
}

function buildPanelHTML(nodo) {
  let h = "";

  h += `<details class="panel-seccion panel-seccion-concepto"><summary class="panel-seccion-titulo panel-seccion-summary">${ico("book-a")} Concepto</summary>`;
  if (nodo.descripcion) h += `<p class="concepto-definicion">${esc(nodo.descripcion)}</p>`;
  if (nodo.cita_directa) h += campo("Cita directa", `<p class="cita">"${esc(nodo.cita_directa)}"</p>`);
  h += `<div class="campo"><span class="campo-etiq">Menciones · Confianza</span>
    <div>${nodo.menciones} menciones &ensp;<span>${nodo.confianza.toFixed(2)}</span></div></div>`;
  if (nodo.sinonimos_candidatos?.length) {
    h += `<div class="campo"><span class="campo-etiq">Sinónimos candidatos</span><div class="sinonimos-lista">${nodo.sinonimos_candidatos.map(s => `<span class="tag">${esc(s)}</span>`).join("")}</div></div>`;
  }
  h += `</details>`;

  h += buildRelacionesHTML(nodo);
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

function buildRelacionesHTML(nodo) {
  const color = state.relColor || (() => "#888");
  const nodeById = Object.fromEntries((state.grafo?.nodes || []).map(n => [n.id, n]));
  const conex = conexionesDe(nodo.id);

  if (!conex.length) {
    return `<div class="panel-seccion">
      <div class="panel-seccion-titulo">${ico("graph-star")} Relaciones</div>
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

  let h = `<details class="panel-seccion"><summary class="panel-seccion-titulo panel-seccion-summary">${ico("graph-star")} Relaciones (${conex.length})</summary>`;
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

function bindPanelListeners(el, nodo, cardId) {
  el.querySelectorAll(".panel-rel-fila--clicable").forEach(btn => {
    btn.addEventListener("click", () => {
      const link     = state.grafo.links.find(l => l.id === btn.dataset.linkId);
      const neighbor = state.grafo.nodes.find(n => n.id === btn.dataset.neighborId);
      if (!link || !neighbor) return;
      const existente = state.mapaCards?.findChildByLink(cardId, link.id);
      if (existente) { state.mapaCards.bringToFront(existente); return; }
      abrirCardMapa(neighbor, cardId, link, btn.dataset.dir);
      refrescarHighlight();
    });
  });
}

init();
