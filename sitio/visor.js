const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

const slug = new URLSearchParams(location.search).get("slug");

const state = {
  grafo: null,
  modo3d: false,
  grafoDestroy: null,
  grafoFit: null,
};

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

  document.getElementById("btn-fit").onclick = () => state.grafoFit?.();
  document.getElementById("btn-modo3d").onclick = () => {
    state.modo3d = !state.modo3d;
    renderMapa();
  };
  document.getElementById("panel-nodo-cerrar").onclick = () => ocultarPanel();

  renderMapa();
}

async function renderMapa() {
  const svgEl = document.getElementById("grafo-svg");
  const el3d  = document.getElementById("grafo-3d");

  state.grafoDestroy?.();
  state.grafoDestroy = null;

  svgEl.hidden = state.modo3d;
  el3d.hidden  = !state.modo3d;
  document.getElementById("btn-modo3d-label").textContent = state.modo3d ? "2D" : "3D";

  if (state.modo3d) {
    const { initGrafo3D } = await import("./grafo3d.js");
    const { fitView, destroy } = initGrafo3D(el3d, state.grafo, onNodoSeleccionado);
    state.grafoFit     = fitView;
    state.grafoDestroy = destroy;
    document.getElementById("leyenda-tipos").innerHTML = "";
  } else {
    const { initGrafo } = await import("./grafo.js");
    const { relColorScale, relTypes, fitView } = initGrafo(svgEl, state.grafo, onNodoSeleccionado);
    state.grafoFit = fitView;
    renderLeyenda(relColorScale, relTypes);
  }
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

function onNodoSeleccionado(nodo) {
  if (!nodo) { ocultarPanel(); return; }
  document.getElementById("panel-nodo-label").textContent = nodo.label || nodo.id;
  document.getElementById("panel-nodo-desc").textContent = nodo.descripcion || "";
  const cita = document.getElementById("panel-nodo-cita");
  if (nodo.cita_directa) {
    cita.hidden = false;
    cita.textContent = `“${nodo.cita_directa}”`;
  } else {
    cita.hidden = true;
  }
  document.getElementById("panel-nodo").hidden = false;
}

function ocultarPanel() {
  document.getElementById("panel-nodo").hidden = true;
}

init();
