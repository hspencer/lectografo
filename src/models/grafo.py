"""
Modelos Pydantic para el Grafo conceptual materializado.
Corresponden a Nodo, Relacion, Bucle y Grafo definidos en specs/grafo.allium.

El Grafo es la cristalización del trabajo interpretativo del investigador
sobre la propuesta del LLM. Se materializa desde EstadoValidacion y se
persiste en {slug}_grafo.json.
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class Nodo(BaseModel):
    """Nodo en el grafo conceptual. Derive de ConceptoPropuesto + overrides."""
    id: str                                         # "c_001", "c_002", ...
    label: str
    tipos: list[str] = Field(default_factory=lambda: ["primitivo"])
    descripcion_corta: str = ""
    sinonimos_consolidados: list[str] = Field(default_factory=list)
    contexto_primera_aparicion: Optional[str] = None
    notas_usuario: list[str] = Field(default_factory=list)
    conceptos_origen_ids: list[str] = Field(default_factory=list)
    confianza: float = Field(ge=0.0, le=1.0, default=1.0)
    menciones: int = Field(default=1, ge=1)
    cita_directa: str = ""
    creado_en: datetime = Field(default_factory=datetime.utcnow)


class Relacion(BaseModel):
    """Relación dirigida entre dos Nodos del mismo Grafo."""
    id: str
    origen_id: str
    destino_id: str
    tipo: str                       # ontología abierta; cualquier frase en español
    etiqueta: str
    frase_completa: str = ""
    bidireccional: bool = False
    matiz: Optional[str] = None
    contexto: Optional[str] = None
    notas_usuario: list[str] = Field(default_factory=list)
    confianza_extraccion: float = Field(ge=0.0, le=1.0, default=1.0)
    estado_validacion: str = "aceptada"             # "aceptada" | "indefinida" | "pendiente"
    es_investigador: bool = False                   # True si fue creada manualmente, no por LLM
    creada_en: datetime = Field(default_factory=datetime.utcnow)


class Bucle(BaseModel):
    """Bucle de retroalimentación entre conceptos."""
    id: str
    nodo_ids: list[str] = Field(min_length=2)
    descripcion: str
    tipo: str                       # "fundamental" | "contingente"


class Grafo(BaseModel):
    """
    Grafo conceptual completo derivado de una transcripción validada.
    Persiste en {slug}_grafo.json.
    """
    id: str                         # "{slug}-v1"
    slug: str
    titulo: str
    version: str = "1.0"
    creado_en: datetime = Field(default_factory=datetime.utcnow)
    actualizado_en: datetime = Field(default_factory=datetime.utcnow)
    nodos: list[Nodo] = Field(default_factory=list)
    relaciones: list[Relacion] = Field(default_factory=list)
    bucles: list[Bucle] = Field(default_factory=list)

    # ── Proyecciones ──────────────────────────────────────────────────────

    def nodos_sueltos(self) -> list[Nodo]:
        """Nodos con grado 0 — no participan en ninguna relación."""
        conectados: set[str] = set()
        for r in self.relaciones:
            conectados.add(r.origen_id)
            conectados.add(r.destino_id)
        return [n for n in self.nodos if n.id not in conectados]

    def componentes_conexas(self) -> list[list["Nodo"]]:
        """
        Componentes conexas del grafo tratado como no dirigido (BFS).
        Devuelve lista de listas de Nodo, ordenada por tamaño descendente.
        La primera componente es siempre la mayor (componente principal).
        """
        adj: dict[str, set[str]] = {n.id: set() for n in self.nodos}
        for r in self.relaciones:
            if r.origen_id in adj and r.destino_id in adj:
                adj[r.origen_id].add(r.destino_id)
                adj[r.destino_id].add(r.origen_id)

        visitados: set[str] = set()
        nodo_por_id = {n.id: n for n in self.nodos}
        componentes: list[list[Nodo]] = []

        for nodo in self.nodos:
            if nodo.id in visitados:
                continue
            cola = [nodo.id]
            componente: list[str] = []
            while cola:
                actual = cola.pop(0)
                if actual in visitados:
                    continue
                visitados.add(actual)
                componente.append(actual)
                for vecino in adj.get(actual, set()):
                    if vecino not in visitados:
                        cola.append(vecino)
            componentes.append([nodo_por_id[nid] for nid in componente if nid in nodo_por_id])

        return sorted(componentes, key=len, reverse=True)

    def es_conexo(self) -> bool:
        """
        True si el grafo tiene a lo sumo una componente conexa.
        Detecta tanto nodos aislados como componentes enteras desconectadas.
        """
        return len(self.componentes_conexas()) <= 1

    def total_nodos(self) -> int:
        return len(self.nodos)

    def total_relaciones(self) -> int:
        return len(self.relaciones)

    def densidad(self) -> float:
        """Densidad del grafo dirigido (sin auto-loops). 0 si menos de 2 nodos."""
        n = len(self.nodos)
        if n < 2:
            return 0.0
        return len(self.relaciones) / (n * (n - 1))
