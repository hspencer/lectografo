"""
Modelos para la consolidación de sinónimos: detecta conceptos duplicados
en un grafo ya extraído y los somete al investigador para su fusión.
Mismo patrón que src/models/reconexion.py (SesionReconexion), aplicado a
fusión de nodos en vez de creación de relaciones.
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class PropuestaFusion(BaseModel):
    """Fusión propuesta por el LLM: uno o más nodos absorbidos en un canónico."""
    id: str
    nodo_canonico_id: str
    nodos_absorbidos_ids: list[str] = Field(min_length=1)
    label_canonico: str                    # label final propuesto para el nodo resultante
    justificacion: str                     # por qué el LLM considera que son el mismo concepto
    confianza: float = Field(ge=0.0, le=1.0, default=0.8)


class PropuestaFusionEnRevision(BaseModel):
    """Estado de una PropuestaFusion durante la revisión del investigador."""
    id: str
    propuesta: PropuestaFusion
    label_editado: str                     # el label del LLM o la versión editada
    seleccionada: bool = True              # pre-marcada por defecto
    estado: str = "pendiente"              # "pendiente" | "aceptada" | "rechazada"


class SesionConsolidacion(BaseModel):
    """
    Sesión de revisión de propuestas de fusión.
    Persiste en {slug}_consolidacion.json mientras está activa.
    """
    id: str
    slug: str
    propuestas: list[PropuestaFusionEnRevision] = Field(default_factory=list)
    estado: str = "en_revision"            # "en_revision" | "completada" | "cancelada" | "procesando"
    razon_falla: Optional[str] = None
    iniciada_en: datetime = Field(default_factory=datetime.utcnow)
    completada_en: Optional[datetime] = None

    # Snapshot de los nodos candidatos (agrupados) al momento de iniciar
    candidatos_ids: list[str] = Field(default_factory=list)

    def aceptadas(self) -> list[PropuestaFusionEnRevision]:
        return [p for p in self.propuestas if p.estado == "aceptada"]

    def rechazadas(self) -> list[PropuestaFusionEnRevision]:
        return [p for p in self.propuestas if p.estado == "rechazada"]
