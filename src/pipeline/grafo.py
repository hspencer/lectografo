"""
Operaciones sobre el Grafo conceptual.
Incluye nodos_sueltos y serialización para el frontend D3.
"""
from src.models.grafo import Grafo, Nodo


def nodos_sueltos(grafo: Grafo) -> list[Nodo]:
    """
    Devuelve los nodos que no participan en ninguna relación como origen o destino.
    Implementa la función deferred nodos_sueltos() de specs/getYourStuffTogether.allium.
    """
    return grafo.nodos_sueltos()


def nodos_desconectados(grafo: Grafo) -> list[Nodo]:
    """
    Devuelve todos los nodos que no pertenecen a la componente principal del grafo.
    Incluye nodos aislados (grado 0) y componentes completas desconectadas.
    Usado por el pipeline de reconexión para obtener el conjunto a reconectar.
    """
    componentes = grafo.componentes_conexas()
    if len(componentes) <= 1:
        return []
    # La primera componente es la mayor (principal); el resto son las desconectadas
    return [n for comp in componentes[1:] for n in comp]


def serializar_para_d3(grafo: Grafo, decisiones_por_nodo: dict | None = None) -> dict:
    """
    Convierte un Grafo al formato {nodes, links} esperado por el frontend D3.
    Compatible con el formato devuelto por GET /api/grafo/{slug}.

    decisiones_por_nodo: dict[nodo_id, decision_info] para overlay de validación.
    """
    decisiones_por_nodo = decisiones_por_nodo or {}

    nodes = []
    for n in grafo.nodos:
        nodes.append({
            "id":                   n.id,
            "label":                n.label,
            "confianza":            n.confianza,
            "menciones":            n.menciones,
            "descripcion":          n.descripcion_corta,
            "sinonimos_candidatos": n.sinonimos_consolidados,
            "cita_directa":         n.cita_directa,
            "editado":              bool(n.notas_usuario),
            "decision":             decisiones_por_nodo.get(n.id),
            "suelto":               False,  # se rellena después
        })

    # Marcar nodos sueltos
    sueltos = {n.id for n in grafo.nodos_sueltos()}
    for node in nodes:
        node["suelto"] = node["id"] in sueltos

    links = []
    for r in grafo.relaciones:
        link: dict = {
            "id":             r.id,
            "source":         r.origen_id,
            "target":         r.destino_id,
            "tipo":           r.tipo,
            "etiqueta":       r.etiqueta,
            "bidireccional":  r.bidireccional,
            "confianza":      r.confianza_extraccion,
            "frase_completa": r.frase_completa,
            "matiz":          r.matiz,
            "editado":        False,
            "decision":       None,
        }
        if r.es_investigador:
            link["investigador"] = True
        links.append(link)

    return {"nodes": nodes, "links": links}
