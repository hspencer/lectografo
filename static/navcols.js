/**
 * navcols.js — motor genérico de columnas draggables/cerrables.
 *
 * initNavCols(containerEl) → { abrirColumna, truncarDesde, limpiar, destruir }
 *
 * No conoce nada de conceptos/relaciones: cada columna recibe HTML ya
 * construido por el llamador (headerHtml + bodyHtml) y un callback opcional
 * onBind(colEl) para enganchar sus propios listeners de contenido.
 * Se ocupa sólo de la mecánica: orden, resize, cierre, scroll.
 */

export function initNavCols(containerEl, { onCerrar } = {}) {
  let columnas = []; // [{ id }]

  function render(col, { headerHtml, bodyHtml }, width) {
    const ws = width ? ` style="flex: none; width: ${width}px;"` : "";
    return `<div class="nav-col" data-col-id="${col.id}"${ws}>
      <div class="nav-col-header">${headerHtml}</div>
      <div class="nav-col-body">${bodyHtml}</div>
      <div class="nav-col-resize" aria-hidden="true"></div>
    </div>`;
  }

  function bind(col, onBind) {
    const colEl = containerEl.querySelector(`[data-col-id="${col.id}"]`);
    if (!colEl) return;

    const closeBtn = colEl.querySelector(".nav-col-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", e => {
        e.stopPropagation();
        truncarDesde(col.id);
        onCerrar?.(col.id);
      });
    }

    const resizeHandle = colEl.querySelector(".nav-col-resize");
    if (resizeHandle) {
      resizeHandle.addEventListener("mousedown", e => {
        e.preventDefault();
        const startX     = e.clientX;
        const startWidth = colEl.offsetWidth;

        const onMove = e => {
          const w = Math.max(280, startWidth + e.clientX - startX);
          colEl.style.flex  = "none";
          colEl.style.width = w + "px";
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup",   onUp);
          document.body.style.cursor = "";
          resizeHandle.classList.remove("nav-col-resize--dragging");
        };

        document.body.style.cursor = "col-resize";
        resizeHandle.classList.add("nav-col-resize--dragging");
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup",   onUp);
      });
    }

    if (onBind) onBind(colEl);
  }

  // ── API pública ──────────────────────────────────────────────────────

  function abrirColumna({ id, headerHtml, bodyHtml, onBind }) {
    const col = { id };
    columnas.push(col);

    const tmp = document.createElement("div");
    tmp.innerHTML = render(col, { headerHtml, bodyHtml }, null);
    containerEl.appendChild(tmp.firstElementChild);

    bind(col, onBind);
    containerEl.scrollLeft = containerEl.scrollWidth;
  }

  function refrescarColumna(id, { headerHtml, bodyHtml }, onBind) {
    const colEl = containerEl.querySelector(`[data-col-id="${id}"]`);
    if (!colEl) return;
    const width = colEl.style.width || null;

    const tmp = document.createElement("div");
    tmp.innerHTML = render({ id }, { headerHtml, bodyHtml }, width ? parseInt(width, 10) : null);
    colEl.replaceWith(tmp.firstElementChild);

    bind({ id }, onBind);
  }

  function truncarDesde(id) {
    const idx = columnas.findIndex(c => c.id === id);
    if (idx === -1) return;
    columnas.slice(idx).forEach(c => {
      containerEl.querySelector(`[data-col-id="${c.id}"]`)?.remove();
    });
    columnas = columnas.slice(0, idx);
  }

  function limpiar() {
    columnas = [];
    containerEl.innerHTML = "";
  }

  return {
    abrirColumna,
    refrescarColumna,
    truncarDesde,
    limpiar,
    destruir() { limpiar(); },
  };
}
