// Motor genérico de tarjetas flotantes: arrastrables, colapsables y
// encadenadas por flechas SVG que respetan la dirección real de la relación
// (saliente → flecha hacia la tarjeta hija, entrante → flecha hacia la
// tarjeta padre, bidireccional → ambas puntas). Usado por la vista Mapa,
// tanto en el editor (static/app.js) como en el sitio publicado (visor.js).

export function createFloatingCards(overlayEl, arrowsEl, { onFocus } = {}) {
  const cards = new Map(); // cardId → { el, parentCardId, nodeId, linkId, relLabel, dir }
  let z = 100;

  function close(cardId) {
    const data = cards.get(cardId);
    if (!data) return;
    [...cards.entries()].forEach(([id, d]) => { if (d.parentCardId === cardId) close(id); });
    data.el.remove();
    cards.delete(cardId);
    redrawArrows();
  }

  function closeAll() {
    [...cards.keys()].forEach(close);
  }

  // Trae la tarjeta al frente y la marca como "seleccionada": reenfoca el
  // mapa en su concepto (ver onFocus, pasado por el llamador).
  function bringToFront(cardId) {
    const data = cards.get(cardId);
    if (!data) return;
    data.el.style.zIndex = ++z;
    onFocus?.(data.nodeId);
  }

  function findByNodeId(nodeId) {
    for (const [id, d] of cards) if (d.nodeId === nodeId && !d.parentCardId) return id;
    return null;
  }

  function findChildByLink(parentCardId, linkId) {
    for (const [id, d] of cards) if (d.parentCardId === parentCardId && d.linkId === linkId) return id;
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
    cards.forEach(data => {
      if (!data.parentCardId) return;
      const pd = cards.get(data.parentCardId);
      if (!pd) return;
      const x1 = pd.el.offsetLeft + pd.el.offsetWidth, y1 = pd.el.offsetTop + 18;
      const x2 = data.el.offsetLeft, y2 = data.el.offsetTop + 18;
      const cx = (x1 + x2) / 2;
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", "var(--sn-ink-faint)");
      p.setAttribute("stroke-width", "1.5");
      // La flecha respeta la dirección real de la relación, no el orden de
      // apertura: saliente apunta hacia la tarjeta hija, entrante hacia la
      // padre, bidireccional lleva punta en ambos extremos.
      if (data.dir !== "entrante") p.setAttribute("marker-end", "url(#mapa-arrowhead)");
      if (data.dir === "entrante" || data.dir === "bidireccional") p.setAttribute("marker-start", "url(#mapa-arrowhead)");
      arrowsEl.appendChild(p);
      if (data.relLabel) {
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("x", cx); t.setAttribute("y", Math.min(y1, y2) - 4);
        t.setAttribute("text-anchor", "middle"); t.setAttribute("font-size", "10");
        t.setAttribute("fill", "var(--sn-ink-soft)");
        t.textContent = data.relLabel;
        arrowsEl.appendChild(t);
      }
    });
  }

  // nodeId/title/bodyHtml: contenido de la tarjeta. parentCardId/linkId/dir:
  // de dónde viene al encadenarse (null para una tarjeta raíz). onBind recibe
  // el elemento y el cardId para enganchar sus propios listeners.
  function open({ nodeId, title, bodyHtml, onBind, parentCardId = null, linkId = null, relLabel = null, dir = null }) {
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
    return [...cards.values()].map(d => ({ nodeId: d.nodeId, linkId: d.linkId }));
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
