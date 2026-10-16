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
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import ForceGraph3D from "https://esm.sh/3d-force-graph@1.79.1?external=three";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const NODE_COLOR = "#221f1a";
const REL_PALETTE = [
  "#2a6da1","#7b4899","#c07030","#166e5a","#ae2d13","#2a6e40","#8a6012","#5c5049","#3d6b6b"
];

const _cs = getComputedStyle(document.documentElement);
const FIELD_COLOR = (_cs.getPropertyValue("--sn-field") || "#f4f2ed").trim() || "#f4f2ed";
const NOVA_COLOR  = (_cs.getPropertyValue("--sn-nova")  || "#ae2d13").trim() || "#ae2d13";

const DIM_OPACITY   = 0.2;
const FULL_OPACITY  = 1.0;
const REST_OPACITY  = 0.9;

// Tamaño de los labels: screen-constant (no atenuado por distancia/zoom),
// igual que el texto 2D. Sin esto, un sprite normal se encoge con la
// perspectiva hasta ser ilegible en cuanto el grafo se aleja de cámara.
const FOV_DEG          = 50; // default de three-render-objects/3d-force-graph
const LABEL_PX_NORMAL  = 22; // alto en px de pantalla de la pastilla
const LABEL_PX_FOCUS   = 28;

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

    const padX = 8 * dpr, padY = 2 * dpr;
    const blur = 8 * dpr; // margen para que el difuminado no se recorte
    const pillW = textW + padX * 2;
    const pillH = fontPx * 1.4 + padY * 2;
    canvas.width  = pillW + blur * 2;
    canvas.height = pillH + blur * 2;

    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Pastilla opaca color-campo con borde difuminado (shadowBlur, que a
    // diferencia de ctx.filter funciona en todos los navegadores).
    ctx.fillStyle = FIELD_COLOR;
    ctx.shadowColor = FIELD_COLOR;
    ctx.shadowBlur = blur;
    ctx.globalAlpha = 0.85;
    const rr = pillH / 2;
    ctx.beginPath();
    ctx.moveTo(blur + rr, blur);
    ctx.lineTo(blur + pillW - rr, blur);
    ctx.arc(blur + pillW - rr, blur + rr, rr, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(blur + rr, blur + pillH);
    ctx.arc(blur + rr, blur + rr, rr, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
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
    // LABEL_PX_* es el alto de la pastilla; el sprite incluye el margen del blur
    const pxH = (bold ? LABEL_PX_FOCUS : LABEL_PX_NORMAL) * (canvas.height / pillH);
    const pxW = pxH * (canvas.width / canvas.height);
    const perPx = worldScalePerPx();
    sprite.scale.set(pxW * perPx, pxH * perPx, 1);
    return sprite;
  }


  function createNodeObject(node) {
    const group = new THREE.Group();
    const normal = makeLabelSprite(node, NODE_COLOR, false);
    const focus  = makeLabelSprite(node, NOVA_COLOR, true);
    normal.renderOrder = 1;
    focus.renderOrder  = 1;
    focus.visible = false;
    group.add(normal, focus);
    group.userData = { normal, focus };
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
    });

    links.forEach(applyLinkStyle);
  }

  function applyLinkStyle(l) {
    const m = l.__line?.material;
    if (!m) return;
    m.opacity   = linkOpac(l);
    m.linewidth = linkW(l);
    // La librería crea la flecha con Lambert (sombreado oscuro) y opacidad fija
    // 0.6: quedaba flotando cuando el enlace se apagaba. Se ata al enlace.
    const a = l.__arrowObj;
    if (a) {
      if (!a.material.isMeshBasicMaterial) {
        const old = a.material;
        a.material = new THREE.MeshBasicMaterial({ color: old.color, transparent: true, depthWrite: false });
        old.dispose();
      }
      a.material.opacity = linkOpac(l);
    }
  }

  // En 3D muchas líneas se apilan a lo largo del rayo de vista (profundidad
  // que el 2D no tiene), así que una opacidad que en SVG se ve sutil aquí se
  // acumula y lee como maciza — de ahí la base mucho más baja que en grafo.js.
  function linkOpac(l) {
    if (focusState.activo) return focusState.linkIds.has(l.id) ? 0.95 : 0.18;
    return l.investigador ? 0.4 : 0.5;
  }
  // Grosor en px de pantalla (LineMaterial sin worldUnits): constante con el zoom.
  function linkW(l) {
    if (focusState.activo && focusState.linkIds.has(l.id)) return 3;
    return 2;
  }

  function makeLinkObject(l) {
    const material = new LineMaterial({
      color: relColor(l.tipo || "_"),
      linewidth: linkW(l),
      transparent: true,
      opacity: linkOpac(l),
      depthWrite: false,
    });
    material.resolution.set(container.clientWidth || 800, container.clientHeight || 600);
    const line = new Line2(new LineGeometry(), material);
    line.geometry.setPositions([0, 0, 0, 0, 0, 0]);
    l.__line = line;
    return line;
  }

  // ponytail: setPositions realoca el buffer en cada tick de la simulación;
  // si pesa con grafos grandes, escribir in-place en instanceStart/End.
  function updateLinkPosition(line, { start, end }) {
    line.geometry.setPositions([start.x, start.y, start.z, end.x, end.y, end.z]);
    return true;
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
    .linkThreeObject(makeLinkObject)
    .linkPositionUpdate(updateLinkPosition)
    .linkDirectionalArrowLength(3)
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

  // Las flechas nacen en el digest de la librería, después de construir el
  // grafo: aplicar su estilo una vez que existen.
  let arrowsStyled = false;
  graph.onEngineTick(() => {
    if (arrowsStyled || !links.some(l => l.__arrowObj)) return;
    arrowsStyled = true;
    links.forEach(applyLinkStyle);
  });

  // Etiquetas ocultas mientras se arrastra la cámara (girar/desplazar).
  // Solo arrastre: la rueda (zoom) y un clic simple no las ocultan.
  let dragging = false, labelsHidden = false;
  const setLabels = visible => {
    if (labelsHidden === !visible) return;
    labelsHidden = !visible;
    nodes.forEach(n => { if (n.__threeObj) n.__threeObj.visible = visible; });
  };
  const abort = new AbortController();
  container.addEventListener("pointerdown", () => { dragging = true; }, { capture: true, signal: abort.signal });
  window.addEventListener("pointerup", () => { dragging = false; setLabels(true); }, { signal: abort.signal });
  graph.controls().addEventListener("change", () => { if (dragging) setLabels(false); });
  const baseDestructor = graph._destructor?.bind(graph);
  graph._destructor = () => { abort.abort(); baseDestructor?.(); };

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

  // Reconstruye los sprites de un nodo (texto normal + texto foco)
  // preservando su estado de opacidad/visibilidad actual.
  function rebuildSprites(n) {
    const parent = n.__threeObj;
    if (!parent) return;
    const prev = parent.userData;
    const normal = makeLabelSprite(n, NODE_COLOR, false);
    const focus = makeLabelSprite(n, NOVA_COLOR, true);
    normal.renderOrder = 1; focus.renderOrder = 1;
    if (prev) {
      normal.material.opacity = prev.normal.material.opacity;
      focus.material.opacity  = prev.focus.material.opacity;
      focus.visible = prev.focus.visible;
    } else {
      focus.visible = false;
    }
    parent.remove(...parent.children);
    parent.add(normal, focus);
    parent.userData = { normal, focus };
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
    links.forEach(applyLinkStyle);
  }

  function centerOnNode(nodeId) {
    const node = nodes.find(n => n.id === nodeId);
    if (!node || !_graph || node.x == null) return;
    // Preservar ángulo y distancia actuales; solo mover el target al nodo
    const cam = _graph.cameraPosition();
    const ctrl = _graph.controls();
    const tgt = ctrl?.target || { x: 0, y: 0, z: 0 };
    const dx = cam.x - tgt.x, dy = cam.y - tgt.y, dz = cam.z - tgt.z;
    _graph.cameraPosition(
      { x: node.x + dx, y: node.y + dy, z: node.z + dz },
      { x: node.x, y: node.y, z: node.z },
      600
    );
  }

  // Pan programático en espacio de mundo: mueve cámara y target juntos
  function panBy(dx, dy) {
    if (!_graph) return;
    const cam = _graph.cameraPosition();
    const ctrl = _graph.controls();
    const tgt = ctrl?.target || { x: 0, y: 0, z: 0 };
    _graph.cameraPosition(
      { x: cam.x + dx, y: cam.y + dy, z: cam.z },
      { x: tgt.x + dx, y: tgt.y + dy, z: tgt.z }
    );
    ctrl?.update?.();
  }

  return {
    updateVisuals,
    highlightPath,
    centerOnNode,
    panBy,
    fitView: () => graph.zoomToFit(400, 60),
    destroy: () => { ro.disconnect(); destroyGrafo3D(); },
    relColorScale: relColor,
    relTypes,
  };
}
