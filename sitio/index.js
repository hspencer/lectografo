const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

const REL_PALETTE_MINI = [
  "#2a6da1","#7b4899","#c07030","#166e5a","#ae2d13","#2a6e40","#8a6012","#5c5049","#3d6b6b"
];

async function _construirMallaSVG(rawNodes, rawLinks, S) {
  if (!rawNodes?.length) return null;
  const d3 = await import("https://cdn.jsdelivr.net/npm/d3@7/+esm");

  const rNById = Object.fromEntries(rawNodes.map(n => [n.id, n]));
  const validLinks = rawLinks.filter(l => rNById[l.source] && rNById[l.target]);
  const connectedIds = new Set(validLinks.flatMap(l => [l.source, l.target]));
  const nodes = rawNodes.filter(n => connectedIds.has(n.id)).slice(0, 150).map(n => ({ ...n }));
  if (!nodes.length) return null;
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const links = validLinks.filter(l => byId[l.source] && byId[l.target]).map(l => ({ ...l }));

  const relTypes = [...new Set(links.map(l => l.tipo || "_"))];
  const relColor = t => REL_PALETTE_MINI[relTypes.indexOf(t) % REL_PALETTE_MINI.length] || "#888";

  const sim = d3.forceSimulation(nodes)
    .force("link",   d3.forceLink(links).id(d => d.id).distance(S * 0.15).strength(0.5))
    .force("charge", d3.forceManyBody().strength(-S * 0.8))
    .force("center", d3.forceCenter(S / 2, S / 2))
    .stop();
  for (let i = 0; i < 450; i++) sim.tick();

  const pad = S * 0.08;
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sc = Math.min((S - pad*2) / (x1 - x0 || 1), (S - pad*2) / (y1 - y0 || 1));
  const ox = S/2 - sc * (x0 + x1) / 2;
  const oy = S/2 - sc * (y0 + y1) / 2;
  const px = n => Math.round(ox + sc * n.x);
  const py = n => Math.round(oy + sc * n.y);

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

async function _renderMiniGrafos(grafos) {
  for (const g of grafos) {
    const container = document.querySelector(`.bib-mini-mapa[data-slug="${CSS.escape(g.slug)}"]`);
    if (!container || container.childElementCount > 0) continue;
    try {
      const r = await fetch(`./data/${encodeURIComponent(g.slug)}.json`);
      if (!r.ok) continue;
      const { nodes: rawNodes, links: rawLinks } = await r.json();
      const S   = container.clientWidth || 260;
      const svg = await _construirMallaSVG(rawNodes, rawLinks, S);
      if (svg) container.appendChild(svg);
    } catch (_) { /* ignorar errores por tarjeta */ }
  }
}

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
      <div class="bib-mini-mapa" data-slug="${esc(g.slug)}"></div>
      <div class="bib-card-inner">
        <div class="bib-card-titulo">${esc(g.titulo)}</div>
        <div class="bib-card-meta">
          <span>${g.total_nodos} conceptos</span>
          <span>${g.total_relaciones} relaciones</span>
        </div>
      </div>
    </a>
  `).join("");

  requestAnimationFrame(() => _renderMiniGrafos(grafos));
}

init();
