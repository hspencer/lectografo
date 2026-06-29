/**
 * grafo.js — D3 v7 force graph: text-only nodes, labelled directed edges.
 * export initGrafo(svgEl, { nodes, links }, onSelect)
 *   → { relColorScale, relTypes, updateVisuals }
 */
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// Tinta cálida del sistema Stella Nova
const NODE_COLOR = "#221f1a";
const REL_PALETTE = [
  "#2a6da1","#7b4899","#c07030","#166e5a","#ae2d13","#2a6e40","#8a6012","#5c5049","#3d6b6b"
];

// Tamaños de fuente en pantalla (px screen-constant)
const BASE_NODE_PX = 15;   // nodo: tamaño objetivo en pantalla
const BASE_LINK_PX = 10;   // arista: tamaño objetivo en pantalla

const LABEL_LINE_H = 11.5; // separación entre líneas del label de arista

let _sim = null;

export function initGrafo(svgEl, { nodes: rN, links: rL }, onSelect) {
  if (_sim) { _sim.stop(); _sim = null; }

  const svg   = d3.select(svgEl);
  svg.selectAll("*").remove();

  const { width: W, height: H } = svgEl.getBoundingClientRect();

  // Filtrar nodos sin ninguna relación (huérfanos)
  const rNById     = Object.fromEntries(rN.map(n => [n.id, n]));
  const validLinks = rL.filter(l => rNById[l.source] && rNById[l.target]);
  const connectedIds = new Set(validLinks.flatMap(l => [l.source, l.target]));
  const nodes  = rN.filter(n => connectedIds.has(n.id)).map(n => ({ ...n }));
  const links  = validLinks.map(l => ({ ...l }));

  const relTypes = [...new Set(links.map(l => l.tipo || "_"))];
  const relColor  = d3.scaleOrdinal(REL_PALETTE).domain(relTypes);

  // ── Defs: marcadores de flecha ────────────────────────────────────────
  const defs = svg.append("defs");
  const sid  = t => t.replace(/[^a-z0-9]/gi, "_");

  relTypes.forEach(t => {
    const c   = relColor(t);
    const key = sid(t);
    defs.append("marker")
      .attr("id", `ae-${key}`).attr("viewBox","0 -5 10 10")
      .attr("refX",10).attr("refY",0).attr("markerWidth",5).attr("markerHeight",5)
      .attr("orient","auto")
      .append("path").attr("d","M0,-5L10,0L0,5").attr("fill",c);
    defs.append("marker")
      .attr("id", `as-${key}`).attr("viewBox","0 -5 10 10")
      .attr("refX",0).attr("refY",0).attr("markerWidth",5).attr("markerHeight",5)
      .attr("orient","auto-start-reverse")
      .append("path").attr("d","M0,-5L10,0L0,5").attr("fill",c);
  });

  // ── Contenedor con zoom ───────────────────────────────────────────────
  const g = svg.append("g");
  let nodeGroups;
  let linkLabelTexts;  // para sincronizar tamaño de fuente al hacer zoom

  function syncFontSize(k) {
    if (!nodeGroups) return;
    // Nodos: screen-constant entre 11–24px
    const nodePx = Math.min(24, Math.max(11, BASE_NODE_PX / k));
    nodeGroups.select("text").attr("font-size", nodePx.toFixed(1) + "px");
    // Labels de arista: screen-constant entre 7–16px
    if (linkLabelTexts) {
      const lnkPx = Math.min(16, Math.max(7, BASE_LINK_PX / k));
      linkLabelTexts.attr("font-size", lnkPx.toFixed(1) + "px");
    }
  }

  const zoom = d3.zoom().scaleExtent([0.05, 6])
    .on("zoom", ev => {
      g.attr("transform", ev.transform);
      syncFontSize(ev.transform.k);
    });
  svg.call(zoom).on("dblclick.zoom", null);
  svg.on("click", () => onSelect(null));

  // ── Aristas ───────────────────────────────────────────────────────────
  const gLinks = g.append("g").attr("class","links");
  const gLbls  = g.append("g").attr("class","link-labels");

  const linkLines = gLinks.selectAll("line")
    .data(links).join("line")
      .attr("stroke",           l => relColor(l.tipo || "_"))
      .attr("stroke-width",     l => l.investigador ? 1.2 : 1.4)
      .attr("stroke-dasharray", l => l.investigador ? "5,3" : null)
      .attr("stroke-opacity",  l => linkOpac(l))
      .attr("marker-end",      l => `url(#ae-${sid(l.tipo || "_")})`)
      .attr("marker-start",    l => l.bidireccional ? `url(#as-${sid(l.tipo || "_")})` : null);

  // Labels de arista: el ancho de línea se calcula dinámicamente en tick()
  const linkLabels = gLbls.selectAll("g.link-label")
    .data(links.filter(l => l.etiqueta)).join("g")
      .attr("class","link-label")
      .attr("pointer-events","none")
      .each(function(l) {
        // Wrap inicial generoso; se ajusta en tick() según distancia real
        l._lastWrapChars = 24;
        l._cachedLines   = _wrapLabel(l.etiqueta, 24);
        const t = d3.select(this).append("text")
          .attr("text-anchor","middle")
          .attr("dominant-baseline","middle")
          .attr("font-size","10px")
          .attr("font-style","italic")
          .attr("font-family","'IBM Plex Sans Condensed','IBM Plex Sans',sans-serif")
          .style("font-stretch","75%")
          .attr("fill", relColor(l.tipo || "_"))
          .attr("paint-order","stroke")
          .attr("stroke","#fcfbf7").attr("stroke-width","3.5px");
        _renderTspans(t, l._cachedLines);
      });

  linkLabelTexts = gLbls.selectAll("text");  // referencia para syncFontSize

  // ── Nodos (solo texto, sin rect visible) ─────────────────────────────
  const gNodes = g.append("g").attr("class","nodes");
  const PAD_X = 12, PAD_Y = 7;

  const drag = d3.drag()
    .on("start",(ev,d)=>{ if(!ev.active) _sim.alphaTarget(.3).restart(); d.fx=d.x; d.fy=d.y; })
    .on("drag", (ev,d)=>{ d.fx=ev.x; d.fy=ev.y; })
    .on("end",  (ev,d)=>{ if(!ev.active) _sim.alphaTarget(0); d.fx=null; d.fy=null; });

  nodeGroups = gNodes.selectAll("g.node")
    .data(nodes).join("g").attr("class","node")
      .attr("cursor","pointer")
      .call(drag)
      .on("click",(ev,d)=>{ ev.stopPropagation(); onSelect(d); hlNode(d); });

  nodeGroups.append("rect").attr("rx",2).attr("ry",2);
  nodeGroups.append("text")
    .attr("text-anchor","middle").attr("dominant-baseline","middle")
    .attr("font-size","15px").attr("font-weight","440")
    .attr("font-family","'IBM Plex Sans Condensed','IBM Plex Sans',sans-serif")
    .style("font-stretch","75%")
    .attr("letter-spacing","0.07em")
    .attr("pointer-events","none")
    .text(n => { const l = n.label || n.id; return (l.length > 30 ? l.slice(0,28)+"…" : l).toUpperCase(); });

  // Medir texto y dimensionar rect de colisión
  nodeGroups.each(function(n) {
    const txt = this.querySelector("text");
    if (!txt) return;
    let hw, hh;
    try { const b = txt.getBBox(); hw = b.width/2 + PAD_X; hh = b.height/2 + PAD_Y; }
    catch { hw = (Math.min((n.label||n.id).length, 26) * 6.8) + PAD_X; hh = 9 + PAD_Y; }
    n._hw = hw; n._hh = hh;
  });

  applyNodeStyles(nodeGroups);

  function applyNodeStyles(sel) {
    sel.select("rect")
      .attr("fill","transparent").attr("stroke","none")
      .attr("x", n=>-(n._hw||34)).attr("y", n=>-(n._hh||12))
      .attr("width", n=>(n._hw||34)*2).attr("height", n=>(n._hh||12)*2);
    sel.select("text")
      .attr("fill", NODE_COLOR)
      .attr("fill-opacity", n => nodeTOp(n));
  }

  function hlNode(selected) {
    nodeGroups.select("text")
      .attr("fill-opacity", n => n.id === selected?.id ? 1.0 : nodeTOp(n))
      .attr("font-weight",  n => n.id === selected?.id ? "600" : "440");
  }

  // ── Botón Ajustar ─────────────────────────────────────────────────────
  const btnFit = document.getElementById("btn-fit");
  if (btnFit) {
    const f = btnFit.cloneNode(true); btnFit.replaceWith(f);
    f.addEventListener("click", () => fitView(svg, g, zoom, W, H));
  }

  // ── Simulación ────────────────────────────────────────────────────────
  const D = Math.min(W, H);
  _sim = d3.forceSimulation(nodes)
    .force("link",    d3.forceLink(links).id(d=>d.id).distance(D * 0.28).strength(0.25))
    .force("charge",  d3.forceManyBody().strength(-D * 2.0))
    .force("center",  d3.forceCenter(W/2, H/2).strength(0.05))
    .force("collide", forceRectCollide(20, 16))
    .alphaDecay(0.016)
    .on("tick", tick)
    .on("end",  () => fitView(svg, g, zoom, W, H));

  // Re-medir tras cargar fuentes (IBM Plex real vs. fallback)
  document.fonts.ready.then(() => {
    let changed = false;
    nodeGroups.each(function(n) {
      const txt = this.querySelector("text");
      if (!txt) return;
      try {
        const b = txt.getBBox();
        const hw = b.width/2 + PAD_X, hh = b.height/2 + PAD_Y;
        if (Math.abs(hw - (n._hw||0)) > 1 || Math.abs(hh - (n._hh||0)) > 0.5) {
          n._hw = hw; n._hh = hh; changed = true;
        }
      } catch(_) {}
    });
    if (changed) { applyNodeStyles(nodeGroups); _sim.alpha(0.5).restart(); }
  });

  // ── Tick ──────────────────────────────────────────────────────────────
  function tick() {
    linkLines.each(function(l) {
      const ep = endpts(l.source, l.target);
      d3.select(this).attr("x1",ep.x1).attr("y1",ep.y1).attr("x2",ep.x2).attr("y2",ep.y2);
    });

    linkLabels.each(function(l) {
      const s = l.source, t = l.target;
      const dx = t.x - s.x, dy = t.y - s.y;
      const dist = Math.sqrt(dx*dx + dy*dy) || 1;

      // Ancho de línea dinámico: más espacio horizontal = más caracteres por línea
      const chars = _charsForDist(dist);
      if (Math.abs(chars - (l._lastWrapChars||0)) > 2) {
        l._lastWrapChars = chars;
        l._cachedLines   = _wrapLabel(l.etiqueta, chars);
        const textEl = d3.select(this).select("text");
        textEl.selectAll("tspan").remove();
        _renderTspans(textEl, l._cachedLines);
      }

      // Offset perpendicular escala con altura del bloque de texto
      const nLines = (l._cachedLines || [l.etiqueta]).length;
      const offset = 11 + (nLines - 1) * 5;
      const {x:lx, y:ly} = midperp(s, t, offset);
      d3.select(this).attr("transform", `translate(${lx},${ly})`);
    });

    nodeGroups.attr("transform", n=>`translate(${n.x},${n.y})`);
  }

  // ── updateVisuals: refresca estilos sin reinicar simulación ──────────
  function updateVisuals(newGrafo) {
    const newById = Object.fromEntries(newGrafo.nodes.map(n=>[n.id,n]));
    nodes.forEach(n => {
      const u = newById[n.id];
      if (u) { n.decision=u.decision; n.label=u.label; n.editado=u.editado; }
    });
    applyNodeStyles(nodeGroups);
    nodeGroups.select("text").text(n => {
      const l = n.label||n.id; return (l.length>30 ? l.slice(0,28)+"…" : l).toUpperCase();
    });
    linkLines.attr("stroke-opacity", l => linkOpac(l));
  }

  return {
    relColorScale: relColor,
    relTypes,
    updateVisuals,
    fitView: () => fitView(svg, g, zoom, W, H),
  };
}

// ── Helpers de geometría ──────────────────────────────────────────────

function endpts(s, t) {
  const dx=t.x-s.x, dy=t.y-s.y, d=Math.sqrt(dx*dx+dy*dy)||1;
  const ux=dx/d, uy=dy/d;
  const sr = ellRad(s, ux, uy);
  const tr = ellRad(t, ux, uy);
  return { x1:s.x+ux*sr, y1:s.y+uy*sr, x2:t.x-ux*tr, y2:t.y-uy*tr };
}

function ellRad(n, ux, uy) {
  const hw = n._hw || 34, hh = n._hh || 12;
  return Math.sqrt((hw*ux)**2 + (hh*uy)**2);
}

function midperp(s, t, offset) {
  const mx=(s.x+t.x)/2, my=(s.y+t.y)/2;
  const dx=t.x-s.x, dy=t.y-s.y, len=Math.sqrt(dx*dx+dy*dy)||1;
  return { x: mx - dy/len*offset, y: my + dx/len*offset };
}

function fitView(svg, g, zoom, W, H) {
  const gEl = g.node(); if (!gEl) return;
  const b = gEl.getBBox(); if (!b.width||!b.height) return;
  const pad=48, scale=Math.min((W-pad*2)/b.width,(H-pad*2)/b.height,2);
  const tx=W/2-scale*(b.x+b.width/2), ty=H/2-scale*(b.y+b.height/2);
  svg.transition().duration(600).call(zoom.transform,d3.zoomIdentity.translate(tx,ty).scale(scale));
}

// ── Atributos visuales ────────────────────────────────────────────────

function nodeTOp(_n) { return 0.92; }
function linkOpac(_l) { return 0.65; }

/** Caracteres por línea según distancia entre nodos en px. */
function _charsForDist(distPx) {
  // ~7px por carácter a 10px font-size con stretch 75%
  // Margen conservador: usar ~55% del espacio disponible
  return Math.max(10, Math.min(42, Math.round(distPx / 7)));
}

/** Divide texto en líneas de máximo maxChars caracteres. */
function _wrapLabel(text, maxChars) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [text];
}

/** Añade tspans centrados verticalmente al elemento text. */
function _renderTspans(textSel, lines) {
  lines.forEach((line, i) => {
    textSel.append("tspan")
      .attr("x", 0)
      .attr("y", (i - (lines.length - 1) / 2) * LABEL_LINE_H)
      .text(line);
  });
}

// ── Colisión rectangular (AABB) — posición directa, rígida ───────────
// Corrige solapamientos modificando posiciones (x, y) y velocidades.
// Múltiples iteraciones resuelven cadenas A→B→C sin amortiguamiento.
function forceRectCollide(padding = 20, iterations = 16) {
  let nodes;

  function force() {
    const n = nodes.length;
    for (let iter = 0; iter < iterations; ++iter) {
      for (let i = 0; i < n - 1; ++i) {
        const a   = nodes[i];
        const ahw = (a._hw || 45) + padding;
        const ahh = (a._hh || 14) + padding;

        for (let j = i + 1; j < n; ++j) {
          const b   = nodes[j];
          const bhw = (b._hw || 45) + padding;
          const bhh = (b._hh || 14) + padding;

          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const minX = ahw + bhw;
          const minY = ahh + bhh;

          if (Math.abs(dx) >= minX || Math.abs(dy) >= minY) continue;

          const overlapX = minX - Math.abs(dx);
          const overlapY = minY - Math.abs(dy);

          // Desambiguar nodos perfectamente superpuestos
          if (dx === 0) dx = Math.random() > 0.5 ? 0.5 : -0.5;
          if (dy === 0) dy = Math.random() > 0.5 ? 0.5 : -0.5;

          const signX = dx > 0 ? 1 : -1;
          const signY = dy > 0 ? 1 : -1;

          if (overlapX < overlapY) {
            const push = overlapX * 0.5;
            if (!a.fx) { a.x -= push * signX; a.vx -= push * signX; }
            if (!b.fx) { b.x += push * signX; b.vx += push * signX; }
          } else {
            const push = overlapY * 0.5;
            if (!a.fy) { a.y -= push * signY; a.vy -= push * signY; }
            if (!b.fy) { b.y += push * signY; b.vy += push * signY; }
          }
        }
      }
    }
  }

  force.initialize = ns => { nodes = ns; };
  return force;
}
