"""
Simplificación de grafo: le pide al LLM que identifique los conceptos
SEGUROS de conservar -- centrales y bien respaldados por el texto -- y
oculta el resto (ver EstadoValidacion.conceptos_ocultos). No inventa nada
nuevo, solo poda; no se le pide una cantidad fija, el LLM decide cuántos
hacen falta para que el núcleo del grafo se sostenga.
"""
import json
import re

from src.llm.base import EvaluadorLLM
from src.models.grafo import Grafo


def _extraer_conservar(texto: str) -> list[str]:
    """Parsea {"conservar": [...]}. _reparar_json (en llm/base.py) no sirve
    acá: está codificado para el esquema de extracción (conceptos/relaciones/
    bucles/metalenguaje, listas de objetos), no para una lista de ids."""
    limpio = re.sub(r"^```(?:json)?\s*|\s*```$", "", texto.strip())
    try:
        data = json.loads(limpio)
        return [str(x) for x in (data.get("conservar") or [])]
    except (json.JSONDecodeError, AttributeError):
        pass
    # Respuesta truncada a mitad del array: rescatar los ids ya completos.
    m = re.search(r'"conservar"\s*:\s*\[(.*)', limpio, re.DOTALL)
    if not m:
        return []
    return re.findall(r'"([^"]+)"', m.group(1))

PROMPT = """Eres asistente de un investigador que cartografía un grafo conceptual.
Te paso la lista de conceptos (con confianza de extracción, menciones y
conectividad) de un grafo ya construido.

Tu tarea: identificar cuáles son los conceptos SEGUROS de conservar -- los
que sostienen la argumentación central y tienen respaldo claro en el texto
(confianza alta, buena conectividad, varias menciones) -- y cuáles son
prescindibles (confianza baja, poco conectados, menciones de paso). No
apuntes a una cantidad fija: conservá tantos como hagan falta para que el
núcleo del grafo se sostenga, ni uno más.

Conceptos (id: label -- confianza, menciones, nº de relaciones):
{listado}

Responde SOLO con JSON: {{"conservar": ["id1", "id2", ...]}} con los ids de
los conceptos seguros de conservar."""


def simplificar(grafo: Grafo, llm: EvaluadorLLM) -> list[str]:
    """Devuelve los ids de nodos SEGUROS de conservar; el resto se oculta."""
    grado: dict[str, int] = {}
    for r in grafo.relaciones:
        grado[r.origen_id] = grado.get(r.origen_id, 0) + 1
        grado[r.destino_id] = grado.get(r.destino_id, 0) + 1

    listado = "\n".join(
        f"{n.id}: {n.label} -- confianza {n.confianza:.2f}, {n.menciones} menciones, {grado.get(n.id, 0)} relaciones"
        for n in grafo.nodos
    )
    cruda = llm.invocar(PROMPT.format(listado=listado), "Procede según las instrucciones.")

    ids_validos = {n.id for n in grafo.nodos}
    conservar = [cid for cid in _extraer_conservar(cruda) if cid in ids_validos]
    # Si el LLM no devolvió nada usable, no tocar el grafo en vez de vaciarlo.
    return conservar or [n.id for n in grafo.nodos]
