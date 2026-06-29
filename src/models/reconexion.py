"""
Modelos para la función getYourStuffTogether.
Corresponden a ConexionPropuesta, PropuestaEnRevision y SesionReconexion
definidos en specs/getYourStuffTogether.allium.
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class ConexionPropuesta(BaseModel):
    """Conexión propuesta por el LLM entre dos nodos, al menos uno suelto."""
    id: str
    origen_id: str
    destino_id: str
    frase: str                          # descripción de la relación (editable)
    tipo: str = "relacionado_con"
    confianza: float = Field(ge=0.0, le=1.0, default=0.8)


class PropuestaEnRevision(BaseModel):
    """Estado de una ConexionPropuesta durante la revisión del investigador."""
    id: str
    conexion: ConexionPropuesta
    frase_editada: str                  # la frase del LLM o la versión editada
    seleccionada: bool = True           # pre-marcada por defecto
    estado: str = "pendiente"           # "pendiente" | "aceptada" | "rechazada"


class SesionReconexion(BaseModel):
    """
    Sesión de revisión de conexiones propuestas.
    Persiste en {slug}_reconexion.json mientras está activa.
    """
    id: str
    slug: str
    propuestas: list[PropuestaEnRevision] = Field(default_factory=list)
    estado: str = "en_revision"         # "en_revision" | "completada" | "cancelada" | "procesando"
    razon_falla: Optional[str] = None
    iniciada_en: datetime = Field(default_factory=datetime.utcnow)
    completada_en: Optional[datetime] = None

    # Snapshot de nodos sueltos al momento de iniciar
    nodos_sueltos_ids: list[str] = Field(default_factory=list)

    def aceptadas(self) -> list[PropuestaEnRevision]:
        return [p for p in self.propuestas if p.estado == "aceptada"]

    def rechazadas(self) -> list[PropuestaEnRevision]:
        return [p for p in self.propuestas if p.estado == "rechazada"]
