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

def _resolver_fusion(cid: str, fusiones: dict[str, str]) -> str:
    """Sigue la cadena de conceptos_fusionados hasta el id canónico final."""
    visto: set[str] = set()
    while cid in fusiones and cid not in visto:
        visto.add(cid)
        cid = fusiones[cid]
    return cid


def materializar_desde_validacion(estado: EstadoValidacion) -> Grafo:
    """
    Construye un Grafo desde el estado de validación actual.

    Aplica los overrides del investigador (conceptos_editados, relaciones_editadas)
    e incluye las relaciones añadidas manualmente. Implementa las reglas
    MaterializarNodoDesdeConceptoAceptado y MaterializarRelacionDesdeDecisionAceptada
    de specs/grafo.allium en su forma actual (pre-decisiones explícitas).

    Los conceptos fusionados (estado.conceptos_fusionados: absorbido → canónico)
    no generan Nodo propio: sus relaciones se redirigen al canónico y su label
    pasa a integrar los sinónimos consolidados del nodo canónico.
    """
    slug = estado.slug
    ext = estado.extraccion
    fusiones = estado.conceptos_fusionados

    def resolver(cid: str) -> str:
        return _resolver_fusion(cid, fusiones)

    # ── Nodos ─────────────────────────────────────────────────────────────────
    # Los conceptos absorbidos por una fusión no generan Nodo: su label pasa a
    # engrosar sinonimos_consolidados del nodo canónico que los absorbe.
    labels_absorbidos: dict[str, list[str]] = {}
    nodos: list[Nodo] = []
    for c in ext.conceptos:
        ov = estado.conceptos_editados.get(c.id, {})
        label_efectivo = ov.get("label", c.label)
        if resolver(c.id) != c.id:
            labels_absorbidos.setdefault(resolver(c.id), []).append(label_efectivo)
            continue
        nodos.append(Nodo(
            id=c.id,
            label=label_efectivo,
            tipos=[ov.get("tipo", "primitivo")],
            descripcion_corta=c.descripcion,
            sinonimos_consolidados=list(c.sinonimos_candidatos),
            contexto_primera_aparicion=c.timestamp_primera_aparicion,
            conceptos_origen_ids=[c.id],
            confianza=c.confianza,
            menciones=c.menciones,
            cita_directa=c.cita_directa,
        ))

    for n in nodos:
        for label in labels_absorbidos.get(n.id, []):
            if label and label != n.label and label not in n.sinonimos_consolidados:
                n.sinonimos_consolidados.append(label)

    # ── Relaciones del LLM ────────────────────────────────────────────────────
    # origen_id/destino_id se redirigen a través de la fusión; una relación que
    # quede como auto-loop (ambos extremos fusionados al mismo canónico) se descarta.
    relaciones: list[Relacion] = []
    for r in ext.relaciones:
        ov = estado.relaciones_editadas.get(r.id, {})
        origen_id, destino_id = resolver(r.origen_id), resolver(r.destino_id)
        if origen_id == destino_id:
            continue
        relaciones.append(Relacion(
            id=r.id,
            origen_id=origen_id,
            destino_id=destino_id,
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
        origen_id, destino_id = resolver(r["origen_id"]), resolver(r["destino_id"])
        if origen_id == destino_id:
            continue
        relaciones.append(Relacion(
            id=r["id"],
            origen_id=origen_id,
            destino_id=destino_id,
            tipo=r["tipo"],
            etiqueta=r["etiqueta"],
            frase_completa="",
            bidireccional=r.get("bidireccional", False),
            confianza_extraccion=1.0,
            estado_validacion="aceptada",
            es_investigador=True,
        ))

    # ── Bucles ────────────────────────────────────────────────────────────────
    # nodo_ids también se redirige a través de la fusión, sin perder los ids
    # duplicados que resulten (un bucle puede terminar con menos nodos distintos).
    bucles: list[Bucle] = []
    for b in ext.bucles:
        nodo_ids_resueltos = list(dict.fromkeys(resolver(nid) for nid in b.nodos_ids))
        if len(nodo_ids_resueltos) < 2:
            continue
        bucles.append(Bucle(
            id=b.id,
            nodo_ids=nodo_ids_resueltos,
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
