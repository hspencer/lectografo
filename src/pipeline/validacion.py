"""
Generación de puntos de decisión desde el resultado de extracción.
Implementa GenerarDecisionesDesdeExtraccion de specs/validacion.allium.
"""
from src.models.extraccion import ResultadoExtraccion, TipoConcepto
from src.models.validacion import PuntoDecision, TipoDecision


def generar_decisiones(
    extraccion: ResultadoExtraccion,
    confianza_minima: float = 0.6,
    menciones_minimas: int = 2,
) -> list[PuntoDecision]:
    decisiones: list[PuntoDecision] = []

    # ── Sinonimia ──────────────────────────────────────────────────────
    for c in extraccion.conceptos:
        if c.sinonimos_candidatos and c.menciones >= menciones_minimas:
            decisiones.append(PuntoDecision(
                id=f"d_sin_{c.id}",
                tipo=TipoDecision.sinonimia,
                pregunta=f"¿Colapsar '{c.label}' con sus sinónimos candidatos?",
                recomendacion_llm=f"El LLM propone '{c.label}' como label canónico",
                label_canonico_propuesto=c.label,
                conceptos_implicados_ids=[c.id],
            ))

    # ── Bidireccionalidad ──────────────────────────────────────────────
    for r in extraccion.relaciones:
        if r.bidireccional:
            decisiones.append(PuntoDecision(
                id=f"d_bidir_{r.id}",
                tipo=TipoDecision.bidireccionalidad,
                pregunta=f"¿Confirmar que '{r.etiqueta}' es bidireccional?",
                recomendacion_llm=r.matiz or "Sin matiz adicional del LLM",
                relacion_implicada_id=r.id,
            ))

    # ── Confirmar bucles ───────────────────────────────────────────────
    for b in extraccion.bucles:
        decisiones.append(PuntoDecision(
            id=f"d_bucle_{b.id}",
            tipo=TipoDecision.confirmar_bucle,
            pregunta="¿Aceptar el bucle de retroalimentación descrito?",
            recomendacion_llm=b.descripcion,
            bucle_implicado_id=b.id,
        ))

    # ── Confianza baja — conceptos ─────────────────────────────────────
    for c in extraccion.conceptos:
        if c.confianza < confianza_minima:
            decisiones.append(PuntoDecision(
                id=f"d_conf_{c.id}",
                tipo=TipoDecision.confianza_baja,
                pregunta=f"¿Confirmar la presencia del concepto '{c.label}' (confianza baja)?",
                recomendacion_llm=f"Revisar cita directa: {c.cita_directa}",
                conceptos_implicados_ids=[c.id],
            ))

    # ── Confianza baja — relaciones ────────────────────────────────────
    for r in extraccion.relaciones:
        if r.confianza < confianza_minima:
            decisiones.append(PuntoDecision(
                id=f"d_conf_rel_{r.id}",
                tipo=TipoDecision.confianza_baja,
                pregunta=f"¿Confirmar la relación '{r.etiqueta}'?",
                recomendacion_llm=f"Revisar frase: {r.frase_completa}",
                relacion_implicada_id=r.id,
            ))

    # ── Tipo ambiguo — promoción de tipo ──────────────────────────────
    for c in extraccion.conceptos:
        if c.tipo == TipoConcepto.ambiguo:
            decisiones.append(PuntoDecision(
                id=f"d_tipo_{c.id}",
                tipo=TipoDecision.promocion_de_tipo,
                pregunta=f"¿Clasificar '{c.label}': primitivo, derivado o metalenguaje?",
                recomendacion_llm=f"Concepto ambiguo. Revisar: {c.descripcion}",
                conceptos_implicados_ids=[c.id],
            ))

    # ── Metalenguaje ───────────────────────────────────────────────────
    for m in extraccion.metalenguaje:
        decisiones.append(PuntoDecision(
            id=f"d_meta_{m.id}",
            tipo=TipoDecision.metalenguaje,
            pregunta=f"¿Confirmar el pasaje de metalenguaje ({m.tipo.value})?",
            recomendacion_llm=m.nota,
            flag_implicado_id=m.id,
        ))

    return decisiones
