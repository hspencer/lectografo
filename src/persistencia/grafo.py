"""
Persistencia del Grafo conceptual en disco (JSON local).
El archivo vive en data/grafos/{slug}_grafo.json.

Implementa PersistenciaGrafo.guardar / PersistenciaGrafo.cargar
definidos en specs/grafo.allium.
"""
from datetime import datetime
from pathlib import Path

from src.models.grafo import Bucle, Grafo, Nodo, Relacion
from src.models.validacion import EstadoValidacion


# ── Rutas ─────────────────────────────────────────────────────────────────────

def ruta_grafo(slug: str, grafos_dir: Path) -> Path:
    return grafos_dir / f"{slug}_grafo.json"


def existe(slug: str, grafos_dir: Path) -> bool:
    return ruta_grafo(slug, grafos_dir).exists()


# ── Guardar / Cargar ──────────────────────────────────────────────────────────

def guardar(grafo: Grafo, slug: str, grafos_dir: Path) -> None:
    grafo.actualizado_en = datetime.utcnow()
    ruta = ruta_grafo(slug, grafos_dir)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(grafo.model_dump_json(indent=2), encoding="utf-8")


def cargar(slug: str, grafos_dir: Path) -> Grafo:
    ruta = ruta_grafo(slug, grafos_dir)
    return Grafo.model_validate_json(ruta.read_text(encoding="utf-8"))


# ── Materialización ───────────────────────────────────────────────────────────

def materializar_desde_validacion(estado: EstadoValidacion) -> Grafo:
    """
    Construye un Grafo desde el estado de validación actual.

    Aplica los overrides del investigador (conceptos_editados, relaciones_editadas)
    e incluye las relaciones añadidas manualmente. Implementa las reglas
    MaterializarNodoDesdeConceptoAceptado y MaterializarRelacionDesdeDecisionAceptada
    de specs/grafo.allium en su forma actual (pre-decisiones explícitas).
    """
    slug = estado.slug
    ext = estado.extraccion

    # ── Nodos ─────────────────────────────────────────────────────────────────
    nodos: list[Nodo] = []
    for c in ext.conceptos:
        ov = estado.conceptos_editados.get(c.id, {})
        nodos.append(Nodo(
            id=c.id,
            label=ov.get("label", c.label),
            tipos=[ov.get("tipo", "primitivo")],
            descripcion_corta=c.descripcion,
            sinonimos_consolidados=list(c.sinonimos_candidatos),
            contexto_primera_aparicion=c.timestamp_primera_aparicion,
            conceptos_origen_ids=[c.id],
            confianza=c.confianza,
            menciones=c.menciones,
            cita_directa=c.cita_directa,
        ))

    # ── Relaciones del LLM ────────────────────────────────────────────────────
    relaciones: list[Relacion] = []
    for r in ext.relaciones:
        ov = estado.relaciones_editadas.get(r.id, {})
        relaciones.append(Relacion(
            id=r.id,
            origen_id=r.origen_id,
            destino_id=r.destino_id,
            tipo=ov.get("tipo", r.tipo),
            etiqueta=ov.get("etiqueta", r.etiqueta),
            frase_completa=r.frase_completa,
            bidireccional=ov.get("bidireccional", r.bidireccional),
            matiz=r.matiz,
            contexto=r.contexto,
            confianza_extraccion=r.confianza,
            estado_validacion="aceptada",
            es_investigador=False,
        ))

    # ── Relaciones del investigador ───────────────────────────────────────────
    for r in estado.relaciones_investigador:
        relaciones.append(Relacion(
            id=r["id"],
            origen_id=r["origen_id"],
            destino_id=r["destino_id"],
            tipo=r["tipo"],
            etiqueta=r["etiqueta"],
            frase_completa="",
            bidireccional=r.get("bidireccional", False),
            confianza_extraccion=1.0,
            estado_validacion="aceptada",
            es_investigador=True,
        ))

    # ── Bucles ────────────────────────────────────────────────────────────────
    bucles: list[Bucle] = []
    for b in ext.bucles:
        bucles.append(Bucle(
            id=b.id,
            nodo_ids=list(b.nodos_ids),
            descripcion=b.descripcion,
            tipo=b.tipo.value,
        ))

    # Deduplicar nodos por ID (puede haber duplicados tras merges incrementales)
    seen_ids: set[str] = set()
    nodos_unicos: list[Nodo] = []
    for n in nodos:
        if n.id not in seen_ids:
            seen_ids.add(n.id)
            nodos_unicos.append(n)

    # Deduplicar relaciones por (origen, destino, tipo)
    seen_rels: set[tuple] = set()
    relaciones_unicas: list[Relacion] = []
    for r in relaciones:
        key = (r.origen_id, r.destino_id, r.tipo)
        if key not in seen_rels:
            seen_rels.add(key)
            relaciones_unicas.append(r)

    return Grafo(
        id=f"{slug}-v1",
        slug=slug,
        titulo=estado.titulo,
        nodos=nodos_unicos,
        relaciones=relaciones_unicas,
        bucles=bucles,
    )
