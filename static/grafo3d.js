/**
 * grafo3d.js — vista 3D del grafo conceptual, alternativa a grafo.js (D3/SVG).
 * Portado desde logseq-constel/src/render3d.ts (mismo patrón: 3d-force-graph +
 * three.js, sprites de texto en canvas) y adaptado a la identidad visual
 * "solo texto" de Lectógrafo y al resaltado de foco/hover de grafo.js.
 *
 * export initGrafo3D(containerEl, { nodes, links }, onSelect)
 *   → { updateVisuals, highlightPath, fitView, destroy }
 *
 * "three" se resuelve vía import map (ver index.html) a una única instancia;
 * 3d-force-graph la importa como externa para no duplicarla — dos copias de
 * three en el mismo scene graph rompen el reconocimiento de objetos WebGL.
 */
import * as THREE from "three";
import ForceGraph3D from "https://esm.sh/3d-force-graph@1.79.1?external=three";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const NODE_COLOR = "#221f1a";
const REL_PALETTE = [
  "#2a6da1","#7b4899","#c07030","#166e5a","#ae2d13","#2a6e40","#8a6012","#5c5049","#3d6b6b"
];

const _cs = getComputedStyle(document.documentElement);
const FIELD_COLOR = (_cs.getPropertyValue("--sn-field") || "#f4f2ed").trim() || "#f4f2ed";
const NOVA_COLOR  = (_cs.getPropertyValue("--sn-nova")  || "#ae2d13").trim() || "#ae2d13";

const DIM_OPACITY   = 0.12;
const FULL_OPACITY  = 1.0;
const REST_OPACITY  = 0.9;

// Tamaño de los labels: screen-constant (no atenuado por distancia/zoom),
// igual que el texto 2D. Sin esto, un sprite normal se encoge con la
// perspectiva hasta ser ilegible en cuanto el grafo se aleja de cámara.
const FOV_DEG          = 50; // default de three-render-objects/3d-force-graph
const LABEL_PX_NORMAL  = 26; // alto en px de pantalla, pastilla incluida
const LABEL_PX_FOCUS   = 30;

let _graph = null; // instancia activa, para poder limpiar al alternar 2D/3D

export function destroyGrafo3D() {
  if (_graph) { _graph._destructor?.(); _graph = null; }
}

export function initGrafo3D(container, { nodes: rN, links: rL }, onSelect, { autoFit = true } = {}) {
  destroyGrafo3D();
  container.innerHTML = "";

  // Filtrar nodos sin ninguna relación (huérfanos) — igual que grafo.js
  const rNById     = Object.fromEntries(rN.map(n => [n.id, n]));
  const validLinks = rL.filter(l => rNById[l.source] && rNById[l.target]);
  const connectedIds = new Set(validLinks.flatMap(l => [l.source, l.target]));
  const nodes = rN.filter(n => connectedIds.has(n.id)).map(n => ({ ...n }));
  const links = validLinks.map(l => ({ ...l }));

  const relTypes = [...new Set(links.map(l => l.tipo || "_"))];
  const relColor = d3.scaleOrdinal(REL_PALETTE).domain(relTypes);

  // Alto del contenedor: base para convertir "px de pantalla deseados" en
  // la escala de mundo que un sprite con sizeAttenuation:false necesita.
  let viewportH = container.clientHeight || 600;
  function worldScalePerPx() {
    const fovRad = FOV_DEG * Math.PI / 180;
    return (2 * Math.tan(fovRad / 2)) / viewportH;
  }

  // ── Sprites de texto: pastilla de "papel" + label, análogo al halo 2D ──
  function labelText(n) {
    const l = n.label || n.id;
    return (l.length > 30 ? l.slice(0, 28) + "…" : l).toUpperCase();
  }

  function makeLabelSprite(node, color, bold) {
    const dpr = 2;
    const fontPx = (bold ? 21 : 19) * dpr;
    const font = `${bold ? "700" : "500"} ${fontPx}px 'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif`;
    const text = labelText(node);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = font;
    const textW = ctx.measureText(text).width;

    const padX = 16 * dpr, padY = 9 * dpr;
    canvas.width  = textW + padX * 2;
    canvas.height = fontPx * 1.5 + padY * 2;

    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Pastilla casi opaca color-campo: separa el texto del enjambre de líneas.
    // A diferencia del halo 2D (texto directo sobre el fondo de página), aquí
    // el fondo detrás del sprite es la maraña de líneas 3D — necesita más
    // cobertura para dar contraste real, no solo un halo sutil.
    ctx.fillStyle = FIELD_COLOR;
    ctx.globalAlpha = 0.97;
    const rr = canvas.height / 2;
    ctx.beginPath();
    ctx.moveTo(rr, 0);
    ctx.lineTo(canvas.width - rr, 0);
    ctx.arc(canvas.width - rr, rr, rr, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(rr, canvas.height);
    ctx.arc(rr, rr, rr, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    // sizeAttenuation:false → tamaño en pantalla constante, sin importar la
    // distancia a cámara ni el zoom. Evita que el texto se vuelva ilegible
    // al alejarse (pedido explícito: nunca más chico que ~8px, y aquí lo
    // fijamos bastante por encima de ese piso para que se lea cómodo).
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, sizeAttenuation: false });
    const sprite = new THREE.Sprite(material);
    const pxH = bold ? LABEL_PX_FOCUS : LABEL_PX_NORMAL;
    const pxW = pxH * (canvas.width / canvas.height);
    const perPx = worldScalePerPx();
    sprite.scale.set(pxW * perPx, pxH * perPx, 1);
    return sprite;
  }

  function makeHaloSprite(worldSize) {
    const dpr = 2, size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    const r = (size * dpr) / 2;
    const grad = ctx.createRadialGradient(r, r, r * 0.55, r, r, r);
    grad.addColorStop(0, NOVA_COLOR + "40");
    grad.addColorStop(0.85, NOVA_COLOR + "22");
    grad.addColorStop(1, NOVA_COLOR + "00");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = NOVA_COLOR;
    ctx.lineWidth = 3 * dpr;
    ctx.beginPath();
    ctx.arc(r, r, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0, sizeAttenuation: false });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 0;
    sprite.scale.set(worldSize, worldSize, 1);
    return sprite;
  }

  function createNodeObject(node) {
    const group = new THREE.Group();
    const normal = makeLabelSprite(node, NODE_COLOR, false);
    const focus  = makeLabelSprite(node, NOVA_COLOR, true);
    // El halo se dimensiona a partir del sprite de foco: debe envolver la
    // pastilla de texto más ancha (bold), no un tamaño fijo arbitrario.
    const halo = makeHaloSprite(Math.max(focus.scale.x, focus.scale.y) * 0.85);
    normal.renderOrder = 1;
    focus.renderOrder  = 1;
    focus.visible = false;
    group.add(halo, normal, focus);
    group.userData = { halo, normal, focus };
    return group;
  }

  // ── Foco: selección persistente (clic/ruta) e interina (hover) ────────
  // Mismo diseño que grafo.js: un solo renderer reutilizado por ambos casos.
  let activePath = [];
  let hoverId    = null;

  function computeFocus(path) {
    const nodeIds = new Set(path.map(p => p.nodeId));
    const linkIds = new Set(path.map(p => p.linkId).filter(Boolean));
    const focoId  = path.length ? path[path.length - 1].nodeId : null;
    return { nodeIds, linkIds, focoId, activo: path.length > 0 };
  }

  function computeHoverFocus(id) {
    const nodeIds = new Set([id]);
    const linkIds = new Set();
    links.forEach(l => {
      const sId = l.source.id ?? l.source, tId = l.target.id ?? l.target;
      if (sId === id || tId === id) { linkIds.add(l.id); nodeIds.add(sId); nodeIds.add(tId); }
    });
    return { nodeIds, linkIds, focoId: id, activo: true };
  }

  let focusState = { nodeIds: new Set(), linkIds: new Set(), focoId: null, activo: false };
  let focusPersistent = true;

  function render(state, persistente) {
    focusState = state;
    focusPersistent = persistente;
    const { nodeIds, linkIds, focoId, activo } = state;

    nodes.forEach(n => {
      const obj = n.__threeObj?.userData;
      if (!obj) return;
      const isFocus = n.id === focoId;
      const inPath  = nodeIds.has(n.id);
      const opacity = !activo ? FULL_OPACITY : isFocus ? FULL_OPACITY : inPath ? REST_OPACITY : DIM_OPACITY;
      const showFocusText = persistente && activo && isFocus;
      obj.normal.material.opacity = showFocusText ? 0 : opacity;
      obj.focus.visible = showFocusText;
      obj.focus.material.opacity = showFocusText ? FULL_OPACITY : 0;
      obj.halo.material.opacity  = (persistente && activo && isFocus) ? 1 : 0;
    });

    if (_graph) {
      _graph.linkColor(_graph.linkColor());
      _graph.linkOpacity(_graph.linkOpacity());
      _graph.linkWidth(_graph.linkWidth());
    }
  }

  // En 3D muchas líneas se apilan a lo largo del rayo de vista (profundidad
  // que el 2D no tiene), así que una opacidad que en SVG se ve sutil aquí se
  // acumula y lee como maciza — de ahí la base mucho más baja que en grafo.js.
  function linkOpac(l) {
    if (focusState.activo) return focusState.linkIds.has(l.id) ? 0.85 : 0.03;
    return l.investigador ? 0.10 : 0.16;
  }
  // 0 = línea WebGL nativa de 1px screen-constant (fina, no un tubo 3D grueso)
  function linkW(l) {
    if (focusState.activo && focusState.linkIds.has(l.id)) return 0.6;
    return 0;
  }

  // path: [{ nodeId, linkId }] en orden; linkId null para el primer paso.
  function highlightPath(path = []) {
    activePath = path;
    if (hoverId == null) render(computeFocus(activePath), true);
  }

  // ── Cámara: re-centrar sobre el nodo enfocado, conservando ángulo/distancia ──
  function recenterCamera(node) {
    if (!_graph || node.x == null) return;
    const camPos = _graph.cameraPosition();
    const target = _graph.controls()?.target || { x: 0, y: 0, z: 0 };
    const dx = camPos.x - target.x, dy = camPos.y - target.y, dz = camPos.z - target.z;
    _graph.cameraPosition(
      { x: node.x + dx, y: node.y + dy, z: node.z + dz },
      { x: node.x, y: node.y, z: node.z },
      800
    );
  }

  // ── Construcción del grafo ──────────────────────────────────────────
  const graph = new ForceGraph3D(container, { controlType: "orbit" })
    .backgroundColor("rgba(0,0,0,0)")
    .graphData({ nodes, links })
    .nodeLabel(null)
    .nodeThreeObject(createNodeObject)
    .nodeThreeObjectExtend(false)
    .linkColor(l => relColor(l.tipo || "_"))
    .linkOpacity(linkOpac)
    .linkWidth(linkW)
    .linkDirectionalArrowLength(3.2)
    .linkDirectionalArrowRelPos(1)
    .onNodeClick(node => {
      if (!node) return;
      onSelect(node);
    })
    .onBackgroundClick(() => onSelect(null))
    .onNodeHover(node => {
      container.style.cursor = node ? "pointer" : "default";
      hoverId = node ? node.id : null;
      render(node ? computeHoverFocus(node.id) : computeFocus(activePath), !node);
    })
    .enableNavigationControls(true);

  _graph = graph;

  // Ajustar tamaño al contenedor y reaccionar a cambios (paneles, resize).
  // viewportH alimenta worldScalePerPx(): si cambia, los sprites screen-
  // constant deben recalcularse o quedan mal calibrados tras el resize.
  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (w <= 0 || h <= 0) return;
    graph.width(w).height(h);
    if (Math.abs(h - viewportH) > 2) {
      viewportH = h;
      nodes.forEach(rebuildSprites);
    }
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  // Ajustar cámara cuando la simulación converge — solo si autoFit está habilitado
  // (se deshabilita en refrescos de datos para no resetear la vista del usuario).
  if (autoFit) {
    let didInitialFit = false;
    graph.onEngineStop(() => {
      if (didInitialFit) return;
      didInitialFit = true;
      graph.zoomToFit(400, 60);
    });
  }

  // Reconstruye los tres sprites de un nodo (halo + texto normal + texto foco)
  // preservando su estado de opacidad/visibilidad actual.
  function rebuildSprites(n) {
    const parent = n.__threeObj;
    if (!parent) return;
    const prev = parent.userData;
    const normal = makeLabelSprite(n, NODE_COLOR, false);
    const focus = makeLabelSprite(n, NOVA_COLOR, true);
    const halo = makeHaloSprite(Math.max(focus.scale.x, focus.scale.y) * 0.85);
    normal.renderOrder = 1; focus.renderOrder = 1;
    if (prev) {
      halo.material.opacity   = prev.halo.material.opacity;
      normal.material.opacity = prev.normal.material.opacity;
      focus.material.opacity  = prev.focus.material.opacity;
      focus.visible = prev.focus.visible;
    } else {
      focus.visible = false;
    }
    parent.remove(...parent.children);
    parent.add(halo, normal, focus);
    parent.userData = { halo, normal, focus };
  }

  // Re-generar sprites tras cargar la fuente real (IBM Plex vs. fallback)
  document.fonts.ready.then(() => {
    nodes.forEach(rebuildSprites);
    render(focusState, focusPersistent);
  });

  function updateVisuals(newGrafo) {
    const newById = Object.fromEntries(newGrafo.nodes.map(n => [n.id, n]));
    nodes.forEach(n => {
      const u = newById[n.id];
      if (u) { n.decision = u.decision; n.label = u.label; n.editado = u.editado; }
      rebuildSprites(n);
    });
    graph.linkOpacity(linkOpac);
  }

  function centerOnNode(nodeId) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node || !_graph || node.x == null) return;
    const dist = 180;
    _graph.cameraPosition(
      { x: node.x, y: node.y, z: node.z + dist },
      { x: node.x, y: node.y, z: node.z },
      600
    );
  }

  return {
    updateVisuals,
    highlightPath,
    centerOnNode,
    fitView: () => graph.zoomToFit(400, 60),
    destroy: () => { ro.disconnect(); destroyGrafo3D(); },
  };
}
