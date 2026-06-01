// ── Estado global ────────────────────────────────────────────────────────────
const state = {
  slug: null,
  validacion: null,          // objeto completo del servidor
  decisionActual: null,      // PuntoDecision seleccionada
  filtro: "pendiente",       // pendiente | diferida | resuelta | todas
  indiceActual: 0,           // posición dentro de la lista filtrada
};

// ── Índices de acceso rápido ──────────────────────────────────────────────────
const idx = {
  concepto: {},
  relacion: {},
  bucle:    {},
  flag:     {},
};

function construirIndices() {
  const ext = state.validacion.extraccion;
  idx.concepto = Object.fromEntries(ext.conceptos.map(c => [c.id, c]));
  idx.relacion = Object.fromEntries(ext.relaciones.map(r => [r.id, r]));
  idx.bucle    = Object.fromEntries(ext.bucles.map(b => [b.id, b]));
  idx.flag     = Object.fromEntries(ext.metalenguaje.map(m => [m.id, m]));
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const r = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!r.ok) {
    const msg = await r.text();
    throw new Error(`${r.status}: ${msg}`);
  }
  return r.json();
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  const extracciones = await apiFetch("/api/extracciones");
  if (extracciones.length === 0) {
    document.getElementById("empty-state").innerHTML =
      "<p>No hay extracciones disponibles. Ejecuta <code>extraer.py</code> primero.</p>";
    return;
  }
  // Auto-cargar la primera (o la que esté en el hash)
  const slugHash = location.hash.slice(1);
  const primera  = slugHash
    ? extracciones.find(e => e.slug === slugHash) || extracciones[0]
    : extracciones[0];
  await cargarValidacion(primera.slug);
}

async function cargarValidacion(slug) {
  state.slug       = slug;
  state.validacion = await apiFetch(`/api/validacion/${encodeURIComponent(slug)}`);
  construirIndices();
  renderTopbar();
  renderDecisionList();
  // Seleccionar primera pendiente automáticamente
  const pendientes = decisionesFiltradas();
  if (pendientes.length > 0) {
    seleccionarDecision(pendientes[0]);
  } else {
    document.getElementById("empty-state").hidden  = false;
    document.getElementById("detalle").hidden       = true;
  }
}

// ── Filtro ────────────────────────────────────────────────────────────────────
function decisionesFiltradas() {
  const all = state.validacion.decisiones;
  if (state.filtro === "todas") return all;
  if (state.filtro === "pendiente") return all.filter(d => d.estado === "pendiente");
  if (state.filtro === "diferida")  return all.filter(d => d.estado === "diferida");
  if (state.filtro === "resuelta")  return all.filter(d => d.estado === "resuelta");
  return all;
}

// ── Topbar ────────────────────────────────────────────────────────────────────
function renderTopbar() {
  const v = state.validacion;
  document.getElementById("transcripcion-titulo").textContent = v.titulo;
  const total     = v.decisiones.length;
  const resueltas = v.decisiones.filter(d => d.estado === "resuelta").length;
  const pct       = total ? Math.round((resueltas / total) * 100) : 0;
  document.getElementById("progreso-barra").style.width = pct + "%";
  document.getElementById("progreso-texto").textContent  =
    `${resueltas} / ${total} resueltas`;
}

// ── Decision list (sidebar) ───────────────────────────────────────────────────
const TIPO_LABELS = {
  sinonimia:         "Sinonimia",
  bidireccionalidad: "Bidir.",
  confianza_baja:    "Conf. baja",
  promocion_de_tipo: "Tipo",
  confirmar_bucle:   "Bucle",
  metalenguaje:      "Meta",
};

function labelDecision(d) {
  if (d.conceptos_implicados_ids?.length) {
    const c = idx.concepto[d.conceptos_implicados_ids[0]];
    return c ? c.label : d.conceptos_implicados_ids[0];
  }
  if (d.relacion_implicada_id) {
    const r = idx.relacion[d.relacion_implicada_id];
    if (r) {
      const lo = idx.concepto[r.origen_id]?.label || r.origen_id;
      const ld = idx.concepto[r.destino_id]?.label || r.destino_id;
      return `${lo} → ${ld}`;
    }
  }
  if (d.bucle_implicado_id) return "Bucle " + d.bucle_implicado_id;
  if (d.flag_implicado_id)  return "Flag "  + d.flag_implicado_id;
  return d.id;
}

function itemClase(d) {
  const clases = ["decision-item", d.tipo];
  if (d.estado === "diferida") clases.push("diferida");
  if (d.estado === "resuelta" && d.resolucion) {
    clases.push(`resuelta-${d.resolucion}`);
  }
  if (state.decisionActual?.id === d.id) clases.push("active");
  return clases.join(" ");
}

function renderDecisionList() {
  const lista   = document.getElementById("decision-list");
  const filtradas = decisionesFiltradas();
  lista.innerHTML = "";

  filtradas.forEach(d => {
    const li = document.createElement("li");
    li.className  = itemClase(d);
    li.dataset.id = d.id;

    const dot    = document.createElement("span");
    dot.className = "estado-dot";

    const info   = document.createElement("div");
    info.className = "info";

    const lbl    = document.createElement("div");
    lbl.className = "item-label";
    lbl.textContent = labelDecision(d);

    const meta   = document.createElement("div");
    meta.className = "item-meta";
    const badge   = document.createElement("span");
    badge.className = `tipo-badge ${d.tipo}`;
    badge.textContent = TIPO_LABELS[d.tipo] || d.tipo;
    meta.appendChild(badge);

    info.appendChild(lbl);
    info.appendChild(meta);
    li.appendChild(dot);
    li.appendChild(info);
    li.addEventListener("click", () => seleccionarDecision(d));
    lista.appendChild(li);
  });
}

// ── Selección y detalle ───────────────────────────────────────────────────────
function seleccionarDecision(d) {
  state.decisionActual = d;
  // Actualizar clase activa en lista
  document.querySelectorAll(".decision-item").forEach(el => {
    el.classList.toggle("active", el.dataset.id === d.id);
  });
  renderDetalle(d);
}

function renderDetalle(d) {
  document.getElementById("empty-state").hidden = true;
  document.getElementById("detalle").hidden      = false;

  // Header
  const badgeEl = document.getElementById("detalle-tipo-badge");
  badgeEl.className   = `tipo-badge ${d.tipo}`;
  badgeEl.textContent = (TIPO_LABELS[d.tipo] || d.tipo).toUpperCase();
  document.getElementById("detalle-id").textContent = d.id;

  const estadoBadge = document.getElementById("detalle-estado-badge");
  estadoBadge.className   = `estado-badge ${d.estado === "resuelta" ? d.resolucion : d.estado}`;
  estadoBadge.textContent = d.estado === "resuelta" ? d.resolucion : d.estado;

  // Cuerpo: contexto por tipo
  const cuerpo = document.getElementById("detalle-cuerpo");
  cuerpo.innerHTML = "";
  renderContexto(d, cuerpo);

  // Recomendación LLM
  const recPanel = document.getElementById("detalle-recomendacion");
  if (d.recomendacion_llm) {
    document.getElementById("detalle-rec-texto").textContent = d.recomendacion_llm;
    recPanel.hidden = false;
  } else {
    recPanel.hidden = true;
  }

  // Acciones vs. panel resuelta
  const yaResuelta = d.estado === "resuelta";
  document.getElementById("acciones").hidden      =  yaResuelta;
  document.getElementById("resuelta-panel").hidden = !yaResuelta;

  if (yaResuelta) {
    renderResuelta(d);
  } else {
    prepararAcciones(d);
  }
}

// ── Contexto por tipo ─────────────────────────────────────────────────────────
function campo(etiq, valor, extra = "") {
  return `<div class="campo">
    <span class="campo-etiq">${etiq}</span>
    <div class="campo-valor ${extra}">${valor}</div>
  </div>`;
}

function renderContexto(d, container) {
  let html = "";

  if (d.tipo === "sinonimia") {
    const c = idx.concepto[d.conceptos_implicados_ids?.[0]];
    if (c) {
      html += campo("Concepto",
        `<span class="campo-valor large">${esc(c.label)}</span>
         &ensp;<span class="tag ${c.tipo}">${c.tipo}</span>`);
      html += campo("Descripción", esc(c.descripcion));
      html += campo("Cita directa",
        `<p class="cita">"${esc(c.cita_directa)}"</p>`, "");
      html += `<div class="campo">
        <span class="campo-etiq">Confianza</span>
        <div>${c.confianza.toFixed(2)} &ensp; <span class="muted">× ${c.menciones} menciones</span></div>
      </div>`;
      html += `<div class="campo">
        <span class="campo-etiq">Sinónimos candidatos</span>
        <div class="sinonimos-lista">
          ${c.sinonimos_candidatos.map(s => `<span class="tag">${esc(s)}</span>`).join("")}
        </div>
      </div>`;
      html += campo("Label canónico propuesto",
        `<span class="label-propuesto">${esc(d.label_canonico_propuesto || c.label)}</span>`);
    }

  } else if (d.tipo === "bidireccionalidad") {
    const r = idx.relacion[d.relacion_implicada_id];
    if (r) {
      const lo = idx.concepto[r.origen_id]?.label || r.origen_id;
      const ld = idx.concepto[r.destino_id]?.label || r.destino_id;
      html += `<div class="relacion-flecha">
        <span class="tag ${idx.concepto[r.origen_id]?.tipo}">${esc(lo)}</span>
        <span class="flecha">↔</span>
        <span class="tag ${idx.concepto[r.destino_id]?.tipo}">${esc(ld)}</span>
      </div>`;
      html += campo("Tipo de relación", r.tipo);
      html += campo("Etiqueta", `<em>"${esc(r.etiqueta)}"</em>`);
      html += campo("Frase completa", `<p class="cita">"${esc(r.frase_completa)}"</p>`);
      if (r.matiz) html += campo("Matiz", esc(r.matiz));
      html += campo("Confianza", r.confianza.toFixed(2));
    }

  } else if (d.tipo === "confianza_baja") {
    if (d.conceptos_implicados_ids?.length) {
      const c = idx.concepto[d.conceptos_implicados_ids[0]];
      if (c) {
        html += campo("Concepto",
          `${esc(c.label)} &ensp;<span class="tag ${c.tipo}">${c.tipo}</span>`);
        html += campo("Confianza",
          `<span class="conf-baja">${c.confianza.toFixed(2)}</span>`);
        html += campo("Cita directa", `<p class="cita">"${esc(c.cita_directa)}"</p>`);
      }
    } else if (d.relacion_implicada_id) {
      const r = idx.relacion[d.relacion_implicada_id];
      if (r) {
        const lo = idx.concepto[r.origen_id]?.label || r.origen_id;
        const ld = idx.concepto[r.destino_id]?.label || r.destino_id;
        html += campo("Relación", `${esc(lo)} → ${esc(ld)}`);
        html += campo("Confianza",
          `<span class="conf-baja">${r.confianza.toFixed(2)}</span>`);
        html += campo("Frase", `<p class="cita">"${esc(r.frase_completa)}"</p>`);
      }
    }

  } else if (d.tipo === "promocion_de_tipo") {
    const c = idx.concepto[d.conceptos_implicados_ids?.[0]];
    if (c) {
      html += campo("Concepto",
        `${esc(c.label)} &ensp;<span class="tag ambiguo">ambiguo</span>`);
      html += campo("Descripción", esc(c.descripcion));
      html += campo("Cita", `<p class="cita">"${esc(c.cita_directa)}"</p>`);
    }

  } else if (d.tipo === "confirmar_bucle") {
    const b = idx.bucle[d.bucle_implicado_id];
    if (b) {
      const labels = b.nodos_ids.map(nid => idx.concepto[nid]?.label || nid);
      html += campo("Ciclo",
        labels.map(l => `<span class="tag">${esc(l)}</span>`).join(" → ") + " → …");
      html += campo("Tipo", b.tipo);
      html += campo("Descripción", esc(b.descripcion));
    }

  } else if (d.tipo === "metalenguaje") {
    const m = idx.flag[d.flag_implicado_id];
    if (m) {
      html += campo("Tipo de pasaje", m.tipo);
      html += campo("Contexto", esc(m.contexto));
      html += campo("Fragmento", `<p class="cita">"${esc(m.texto)}"</p>`);
      if (m.conceptos_afectados_ids?.length) {
        const cls = m.conceptos_afectados_ids
          .map(cid => idx.concepto[cid])
          .filter(Boolean)
          .map(c => `<span class="tag">${esc(c.label)}</span>`)
          .join(" ");
        html += campo("Conceptos afectados", cls);
      }
    }
  }

  container.innerHTML = html;
}

// ── Acciones ──────────────────────────────────────────────────────────────────
function prepararAcciones(d) {
  // Reset panels
  document.getElementById("modificar-label-panel").hidden = true;
  document.getElementById("tipo-selector-panel").hidden   = true;
  document.getElementById("input-nota").value             = "";

  // Para promocion_de_tipo: ocultar aceptar/rechazar y mostrar selector
  const esTipo = d.tipo === "promocion_de_tipo";
  document.getElementById("btn-aceptar").hidden   = esTipo;
  document.getElementById("btn-modificar").hidden = !["sinonimia"].includes(d.tipo);

  // Para diferida: mostrar "Reanudar" en lugar de diferir
  document.getElementById("btn-diferir").textContent =
    d.estado === "diferida" ? "Reanudar" : "⏭ Diferir";

  // Rellenar input-label con el label propuesto actual
  const inputLabel = document.getElementById("input-label");
  inputLabel.value = d.label_canonico_propuesto || "";
}

// ── Panel resuelta (read-only) ────────────────────────────────────────────────
function renderResuelta(d) {
  const el = document.getElementById("resuelta-resolucion");
  const iconos = { aceptada: "✓", rechazada: "✗", modificada: "✎", diferida: "⏭" };
  el.innerHTML =
    `<span class="res-${d.resolucion}">${iconos[d.resolucion] || ""} ${d.resolucion}</span>`;
  if (d.label_resolucion) {
    el.innerHTML += ` &ensp;→ <span class="label-propuesto">${esc(d.label_resolucion)}</span>`;
  }
  const notaEl = document.getElementById("resuelta-nota");
  notaEl.textContent = d.nota_resolucion || "";
  notaEl.hidden      = !d.nota_resolucion;
}

// ── Resolver vía API ─────────────────────────────────────────────────────────
async function resolver(resolucion, nota, labelResolucion) {
  const d = state.decisionActual;
  if (!d) return;

  const payload = { resolucion };
  if (nota)           payload.nota              = nota;
  if (labelResolucion) payload.label_resolucion = labelResolucion;

  try {
    const resultado = await apiFetch(
      `/api/validacion/${encodeURIComponent(state.slug)}/decisiones/${encodeURIComponent(d.id)}/resolver`,
      { method: "POST", body: JSON.stringify(payload) }
    );
    // Actualizar estado local
    await refrescarValidacion();
    renderTopbar();
    renderDecisionList();

    if (resultado.completado) {
      mostrarCompletado();
    } else {
      avanzarSiguiente();
    }
  } catch (e) {
    alert("Error al resolver: " + e.message);
  }
}

async function refrescarValidacion() {
  state.validacion = await apiFetch(
    `/api/validacion/${encodeURIComponent(state.slug)}`
  );
  construirIndices();
  // Actualizar decisión actual con datos frescos
  if (state.decisionActual) {
    state.decisionActual = state.validacion.decisiones
      .find(d => d.id === state.decisionActual.id) || null;
  }
}

function avanzarSiguiente() {
  const filtradas = decisionesFiltradas();
  if (filtradas.length === 0) return;
  // Buscar la siguiente pendiente después de la actual
  const idActual = state.decisionActual?.id;
  const idxActual = filtradas.findIndex(d => d.id === idActual);
  const siguiente = filtradas[idxActual + 1] || filtradas[0];
  seleccionarDecision(siguiente);
  // Scroll en sidebar
  const el = document.querySelector(`[data-id="${siguiente.id}"]`);
  if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function mostrarCompletado() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <div style="padding-top:80px; text-align:center; color:var(--text-muted)">
      <div style="font-size:32px; margin-bottom:12px">✓</div>
      <div style="font-size:18px; font-weight:600; color:var(--aceptada)">
        Validación completada
      </div>
      <p style="margin-top:8px">Todas las decisiones están resueltas.</p>
    </div>`;
}

// ── Event listeners ───────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {

  // Filtros
  document.querySelectorAll(".filtro-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filtro-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.filtro = btn.dataset.filtro;
      renderDecisionList();
    });
  });

  // Botón aceptar
  document.getElementById("btn-aceptar").addEventListener("click", () => {
    const nota = document.getElementById("input-nota").value.trim() || null;
    resolver("aceptada", nota, null);
  });

  // Botón rechazar
  document.getElementById("btn-rechazar").addEventListener("click", () => {
    const nota = document.getElementById("input-nota").value.trim() || null;
    resolver("rechazada", nota, null);
  });

  // Botón diferir / reanudar
  document.getElementById("btn-diferir").addEventListener("click", async () => {
    const d = state.decisionActual;
    if (!d) return;
    if (d.estado === "diferida") {
      // Reanudar
      await apiFetch(
        `/api/validacion/${encodeURIComponent(state.slug)}/decisiones/${encodeURIComponent(d.id)}/reanudar`,
        { method: "POST", body: "{}" }
      );
      await refrescarValidacion();
      renderTopbar();
      renderDecisionList();
      seleccionarDecision(state.decisionActual);
    } else {
      resolver("diferida", null, null);
    }
  });

  // Botón modificar (sinonimia) — toggle del panel de label
  document.getElementById("btn-modificar").addEventListener("click", () => {
    const panel = document.getElementById("modificar-label-panel");
    panel.hidden = !panel.hidden;
    if (!panel.hidden) document.getElementById("input-label").focus();
  });

  // Confirmar label modificado
  document.getElementById("btn-confirmar-label").addEventListener("click", () => {
    const nuevoLabel = document.getElementById("input-label").value.trim();
    if (!nuevoLabel) return;
    const nota = document.getElementById("input-nota").value.trim() || null;
    resolver("modificada", nota, nuevoLabel);
  });

  // Selector de tipo (promocion_de_tipo)
  document.querySelectorAll(".btn-tipo").forEach(btn => {
    btn.addEventListener("click", () => {
      const tipo  = btn.dataset.tipo;
      const nota  = document.getElementById("input-nota").value.trim() || null;
      resolver("modificada", nota, tipo);
    });
  });
  // Mostrar selector de tipo para promocion_de_tipo
  document.getElementById("btn-aceptar").addEventListener("mouseenter", () => {
    if (state.decisionActual?.tipo === "promocion_de_tipo") {
      document.getElementById("tipo-selector-panel").hidden = false;
    }
  });

  // Botón deshacer (resuelta → pendiente) — reusar reanudar endpoint
  document.getElementById("btn-deshacer").addEventListener("click", async () => {
    const d = state.decisionActual;
    if (!d) return;
    await apiFetch(
      `/api/validacion/${encodeURIComponent(state.slug)}/decisiones/${encodeURIComponent(d.id)}/reanudar`,
      { method: "POST", body: "{}" }
    );
    await refrescarValidacion();
    renderTopbar();
    renderDecisionList();
    seleccionarDecision(state.decisionActual);
  });

  // Teclado
  document.addEventListener("keydown", e => {
    if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
    const d = state.decisionActual;
    if (!d || d.estado === "resuelta") return;

    const nota = document.getElementById("input-nota").value.trim() || null;
    if (e.key === "a" || e.key === "A") {
      e.preventDefault();
      if (d.tipo === "promocion_de_tipo") {
        document.getElementById("tipo-selector-panel").hidden = false;
      } else {
        resolver("aceptada", nota, null);
      }
    }
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      resolver("rechazada", nota, null);
    }
    if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      if (d.tipo === "sinonimia") {
        const panel = document.getElementById("modificar-label-panel");
        panel.hidden = false;
        document.getElementById("input-label").focus();
      }
    }
    if (e.key === "d" || e.key === "D") {
      e.preventDefault();
      resolver("diferida", nota, null);
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      avanzarSiguiente();
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const filtradas = decisionesFiltradas();
      const idxActual = filtradas.findIndex(dd => dd.id === d.id);
      const ant = filtradas[idxActual - 1];
      if (ant) seleccionarDecision(ant);
    }
  });

  // Arrancar
  init();
});

// ── Utilidad ──────────────────────────────────────────────────────────────────
function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
