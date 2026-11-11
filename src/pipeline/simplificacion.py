"""
Simplificación de grafo: le pide al LLM que elija los conceptos más
importantes de un grafo ya materializado, para ocultar el resto (ver
EstadoValidacion.conceptos_ocultos). No inventa nada nuevo, solo poda.
"""
import json

from src.llm.base import EvaluadorLLM
from src.models.grafo import Grafo

PROMPT = """Eres asistente de un investigador que cartografía un grafo conceptual.
Te paso la lista de conceptos (con sus relaciones) de un grafo ya construido.
Tu tarea: elegir cuáles son los {objetivo} conceptos MÁS IMPORTANTES -- los que
sostienen la argumentación central -- y cuáles se pueden omitir sin perder el
núcleo del grafo (detalles menores, menciones de paso, nodos poco conectados).

Conceptos (id: label -- menciones, nº de relaciones):
{listado}

Responde SOLO con JSON: {{"conservar": ["id1", "id2", ...]}} con exactamente
los ids de los conceptos a conservar, ordenados por importancia."""


def simplificar(grafo: Grafo, llm: EvaluadorLLM, objetivo: int) -> list[str]:
    """Devuelve la lista de ids de nodos a CONSERVAR (el resto se oculta)."""
    grado: dict[str, int] = {}
    for r in grafo.relaciones:
        grado[r.origen_id] = grado.get(r.origen_id, 0) + 1
        grado[r.destino_id] = grado.get(r.destino_id, 0) + 1

    listado = "\n".join(
        f"{n.id}: {n.label} -- {n.menciones} menciones, {grado.get(n.id, 0)} relaciones"
        for n in grafo.nodos
    )
    prompt = PROMPT.format(objetivo=objetivo, listado=listado)
    cruda = llm.invocar(prompt, "Procede según las instrucciones.")

    from src.llm.base import _reparar_json
    data = _reparar_json(cruda) or {}
    conservar = data.get("conservar") or []
    ids_validos = {n.id for n in grafo.nodos}
    conservar = [cid for cid in conservar if cid in ids_validos]
    return conservar or [n.id for n in grafo.nodos[:objetivo]]
