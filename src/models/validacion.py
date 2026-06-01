"""
Modelos para el flujo de validación humana.
Corresponden a PuntoDecision, AnotacionInvestigador y al estado
de la sesión de validación definidos en specs/validacion.allium.
"""
from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field

from src.models.extraccion import ResultadoExtraccion


class TipoDecision(str, Enum):
    sinonimia = "sinonimia"
    bidireccionalidad = "bidireccionalidad"
    promocion_de_tipo = "promocion_de_tipo"
    confirmar_bucle = "confirmar_bucle"
    confianza_baja = "confianza_baja"
    metalenguaje = "metalenguaje"


class ResolucionDecision(str, Enum):
    aceptada = "aceptada"
    rechazada = "rechazada"
    modificada = "modificada"
    diferida = "diferida"


class EstadoDecision(str, Enum):
    pendiente = "pendiente"
    resuelta = "resuelta"
    diferida = "diferida"


class PuntoDecision(BaseModel):
    id: str
    tipo: TipoDecision
    pregunta: str
    recomendacion_llm: str
    justificacion_llm: Optional[str] = None

    # Para sinonimia: label canónico que el LLM propone
    label_canonico_propuesto: Optional[str] = None
    # Para modificada: label que el investigador elige
    label_resolucion: Optional[str] = None

    # Referencias a entidades de extracción por ID
    conceptos_implicados_ids: list[str] = Field(default_factory=list)
    relacion_implicada_id: Optional[str] = None
    bucle_implicado_id: Optional[str] = None
    flag_implicado_id: Optional[str] = None

    estado: EstadoDecision = EstadoDecision.pendiente
    resolucion: Optional[ResolucionDecision] = None
    nota_resolucion: Optional[str] = None
    resuelta_en: Optional[datetime] = None
    creada_en: datetime = Field(default_factory=datetime.utcnow)


class AnotacionInvestigador(BaseModel):
    id: str
    objeto_anotado: str
    nota: str
    creada_en: datetime = Field(default_factory=datetime.utcnow)


class EstadoValidacion(BaseModel):
    """Estado completo de una sesión de validación. Persiste en JSON."""
    titulo: str
    slug: str
    extraccion: ResultadoExtraccion
    decisiones: list[PuntoDecision]
    anotaciones: list[AnotacionInvestigador] = Field(default_factory=list)
    completado: bool = False
    creado_en: datetime = Field(default_factory=datetime.utcnow)
    actualizado_en: datetime = Field(default_factory=datetime.utcnow)

    # ── Proyecciones ──────────────────────────────────────────────────

    def pendientes(self) -> list[PuntoDecision]:
        return [d for d in self.decisiones if d.estado == EstadoDecision.pendiente]

    def diferidas(self) -> list[PuntoDecision]:
        return [d for d in self.decisiones if d.estado == EstadoDecision.diferida]

    def resueltas(self) -> list[PuntoDecision]:
        return [d for d in self.decisiones if d.estado == EstadoDecision.resuelta]

    def todas_resueltas(self) -> bool:
        return all(d.estado == EstadoDecision.resuelta for d in self.decisiones)
