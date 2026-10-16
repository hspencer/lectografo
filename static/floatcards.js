// Motor genérico de tarjetas flotantes: arrastrables, colapsables y
// encadenadas por flechas SVG que respetan la dirección real de la relación
// (saliente → flecha hacia la tarjeta hija, entrante → flecha hacia la
// tarjeta padre, bidireccional → ambas puntas). Usado por la vista Mapa,
// tanto en el editor (static/app.js) como en el sitio publicado (visor.js).

export function createFloatingCards(overlayEl, arrowsEl, { onFocus } = {}) {
  const cards = new Map(); // cardId → { el, parentCardId, nodeId, linkId, relLabel, dir }
  // Relaciones hacia una tarjeta que ya estaba abierta: se dibujan como
  // flecha entre ambas sin duplicar la tarjeta ni volverla hija.
  let extras = []; // { fromCardId, toCardId, linkId, relLabel, dir }
  let z = 100;

  function close(cardId) {
    const data = cards.get(cardId);
    if (!data) return;
    [...cards.entries()].forEach(([id, d]) => { if (d.parentCardId === cardId) close(id); });
    data.el.remove();
    cards.delete(cardId);
    extras = extras.filter(x => x.fromCardId !== cardId && x.toCardId !== cardId);
    redrawArrows();
  }

  function closeAll() {
    [...cards.keys()].forEach(close);
  }

  // Trae la tarjeta al frente y la marca como "seleccionada"; onFocus
  // (opcional) avisa al llamador.
  function bringToFront(cardId) {
    const data = cards.get(cardId);
    if (!data) return;
    data.el.style.zIndex = ++z;
    onFocus?.(data.nodeId);
  }

  function findByNodeId(nodeId) {
    for (const [id, d] of cards) if (d.nodeId === nodeId) return id;
    return null;
  }

  function findChildByLink(parentCardId, linkId) {
    for (const [id, d] of cards) if (d.parentCardId === parentCardId && d.linkId === linkId) return id;
    for (const x of extras) if (x.fromCardId === parentCardId && x.linkId === linkId) return x.toCardId;
    return null;
  }

  function _drag(el, cardId) {
    const handle = el.querySelector(".float-card-header");
    handle.addEventListener("mousedown", e => {
      if (e.button !== 0) return;
      e.preventDefault();
      bringToFront(cardId);
      const ox = e.clientX - el.offsetLeft, oy = e.clientY - el.offsetTop;
      const onMove = e => {
        el.style.left = (e.clientX - ox) + "px";
        el.style.top  = (e.clientY - oy) + "px";
        redrawArrows();
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  function redrawArrows() {
    [...arrowsEl.children].forEach(c => { if (c.tagName !== "defs") c.remove(); });
    const conectores = [
      ...[...cards.values()].filter(d => d.parentCardId)
        .map(d => ({ pd: cards.get(d.parentCardId), data: d, dir: d.dir, relLabel: d.relLabel })),
      ...extras.map(x => ({ pd: cards.get(x.fromCardId), data: cards.get(x.toCardId), dir: x.dir, relLabel: x.relLabel })),
    ];
    conectores.forEach(({ pd, data, dir, relLabel }) => {
      if (!pd || !data) return;
      // El punto de anclaje se recalcula según la posición relativa actual
      // (no la de apertura): si al arrastrar la tarjeta hija queda a la
      // izquierda de la padre, la flecha sale por el borde izquierdo de
      // ambas en vez de cruzarlas — el sentido (marker-start/end) no cambia,
      // solo el lado por el que conecta.
      const pLeft = pd.el.offsetLeft, pRight = pLeft + pd.el.offsetWidth;
      const cLeft = data.el.offsetLeft, cRight = cLeft + data.el.offsetWidth;
      const hijoALaDerecha = (cLeft + cRight) / 2 >= (pLeft + pRight) / 2;
      const x1 = hijoALaDerecha ? pRight : pLeft, y1 = pd.el.offsetTop + 18;
      const x2 = hijoALaDerecha ? cLeft : cRight,  y2 = data.el.offsetTop + 18;
      const cx = (x1 + x2) / 2;
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", "var(--sn-ink-faint)");
      p.setAttribute("stroke-width", "1.5");
      // La flecha respeta la dirección real de la relación, no el orden de
      // apertura: saliente apunta hacia la tarjeta hija, entrante hacia la
      // padre, bidireccional lleva punta en ambos extremos.
      if (dir !== "entrante") p.setAttribute("marker-end", "url(#mapa-arrowhead)");
      if (dir === "entrante" || dir === "bidireccional") p.setAttribute("marker-start", "url(#mapa-arrowhead)");
      arrowsEl.appendChild(p);
      if (relLabel) {
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        // Punto medio de la curva (no el borde superior): dos relaciones que
        // salen de la misma tarjeta ya no apilan sus etiquetas.
        t.setAttribute("x", cx); t.setAttribute("y", (y1 + y2) / 2);
        t.setAttribute("text-anchor", "middle"); t.setAttribute("dominant-baseline", "middle");
        t.setAttribute("font-size", "10");
        t.setAttribute("fill", "var(--sn-ink-soft)");
        t.textContent = relLabel;
        arrowsEl.appendChild(t);
        // Fondillo traslúcido detrás de la etiqueta, sobre la curva.
        const b = t.getBBox();
        const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        r.setAttribute("x", b.x - 4); r.setAttribute("y", b.y - 1);
        r.setAttribute("width", b.width + 8); r.setAttribute("height", b.height + 2);
        r.setAttribute("rx", 3);
        r.setAttribute("fill", "var(--sn-field)"); r.setAttribute("fill-opacity", "0.8");
        arrowsEl.insertBefore(r, t);
      }
    });
  }

  // nodeId/title/bodyHtml: contenido de la tarjeta. parentCardId/linkId/dir:
  // de dónde viene al encadenarse (null para una tarjeta raíz). onBind recibe
  // el elemento y el cardId para enganchar sus propios listeners.
  function open({ nodeId, title, bodyHtml, onBind, parentCardId = null, linkId = null, relLabel = null, dir = null }) {
    // Una sola tarjeta por concepto en pantalla: si ya está abierta (como raíz
    // o encadenada desde otra relación), se trae al frente en vez de duplicarla.
    // Si se llega por una relación, igual se dibuja la conexión entre ambas.
    const abierta = findByNodeId(nodeId);
    if (abierta) {
      const yaConectada = abierta === parentCardId
        || cards.get(abierta).parentCardId === parentCardId && cards.get(abierta).linkId === linkId
        || cards.get(parentCardId)?.parentCardId === abierta && cards.get(parentCardId)?.linkId === linkId
        || extras.some(x => x.linkId === linkId && (x.fromCardId === parentCardId && x.toCardId === abierta
                                                 || x.fromCardId === abierta && x.toCardId === parentCardId));
      if (parentCardId && !yaConectada) {
        extras.push({ fromCardId: parentCardId, toCardId: abierta, linkId, relLabel, dir });
        redrawArrows();
      }
      bringToFront(abierta);
      return abierta;
    }
    const cardId = `fc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    let left = 24 + (cards.size % 6) * 24, top = 16 + (cards.size % 6) * 24;
    if (parentCardId) {
      const pd = cards.get(parentCardId);
      if (pd) { left = pd.el.offsetLeft + pd.el.offsetWidth + 56; top = pd.el.offsetTop; }
    }

    const el = document.createElement("div");
    el.className = "float-card";
    el.dataset.cardId = cardId;
    el.style.cssText = `left:${left}px;top:${top}px;z-index:${++z}`;
    el.innerHTML = `
      <div class="float-card-header">
        <span class="float-card-title">${title}</span>
        <div class="float-card-btns">
          <button class="float-card-btn float-card-collapse" title="Colapsar">−</button>
          <button class="float-card-btn float-card-close" title="Cerrar">×</button>
        </div>
      </div>
      <div class="float-card-body">${bodyHtml}</div>`;

    overlayEl.appendChild(el);
    cards.set(cardId, { el, parentCardId, nodeId, linkId, relLabel, dir });
    _drag(el, cardId);
    // Cualquier interacción con la tarjeta la selecciona (reenfoca el mapa).
    el.addEventListener("mousedown", () => bringToFront(cardId));
    // La tarjeta es redimensionable (CSS resize); redibuja las flechas
    // cuando cambia su tamaño, no solo cuando se arrastra.
    new ResizeObserver(() => redrawArrows()).observe(el);

    el.querySelector(".float-card-collapse").addEventListener("click", () => {
      const collapsed = el.classList.toggle("collapsed");
      el.querySelector(".float-card-collapse").textContent = collapsed ? "+" : "−";
      redrawArrows();
    });
    el.querySelector(".float-card-close").addEventListener("click", () => close(cardId));

    onBind?.(el, cardId);
    redrawArrows();
    return cardId;
  }

  function highlightList() {
    return [
      ...[...cards.values()].map(d => ({ nodeId: d.nodeId, linkId: d.linkId })),
      ...extras.map(x => ({ nodeId: cards.get(x.toCardId)?.nodeId, linkId: x.linkId })),
    ];
  }

  function listOpen() {
    return [...cards.entries()].map(([cardId, d]) => ({ cardId, nodeId: d.nodeId }));
  }

  // Reemplaza el título/cuerpo de una tarjeta ya abierta sin tocar su
  // posición, tamaño ni tarjetas hijas (usado tras guardar/anotar).
  function refresh(cardId, { title, bodyHtml, onBind }) {
    const data = cards.get(cardId);
    if (!data) return;
    if (title !== undefined) data.el.querySelector(".float-card-title").innerHTML = title;
    data.el.querySelector(".float-card-body").innerHTML = bodyHtml;
    onBind?.(data.el, cardId);
  }

  return { open, close, closeAll, bringToFront, findByNodeId, findChildByLink, redrawArrows, highlightList, listOpen, refresh };
}
