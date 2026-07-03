const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

async function init() {
  const grid  = document.getElementById("biblioteca-grid");
  const vacio = document.getElementById("biblioteca-vacio");

  let grafos = [];
  try {
    const r = await fetch("./data/index.json");
    if (r.ok) grafos = await r.json();
  } catch { /* sin datos publicados aún */ }

  if (!grafos.length) {
    grid.hidden = true;
    vacio.hidden = false;
    return;
  }

  grid.innerHTML = grafos.map(g => `
    <a class="bib-card bib-card-click" href="./visor.html?slug=${encodeURIComponent(g.slug)}">
      <div class="bib-card-inner">
        <div class="bib-card-titulo">${esc(g.titulo)}</div>
        <div class="bib-card-meta">
          <span>${g.total_nodos} conceptos</span>
          <span>${g.total_relaciones} relaciones</span>
        </div>
      </div>
    </a>
  `).join("");
}

init();
