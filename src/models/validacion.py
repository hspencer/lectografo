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
    confirmar_bucle = "confirmar_bucle"
    confianza_baja = "confianza_baja"
    metalenguaje = "metalenguaje"
    promocion_de_tipo = "promocion_de_tipo"   # concepto ambiguo → primitivo|derivado|metalenguaje


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


class MetadatosTexto(BaseModel):
    """Metadatos editoriales del texto fuente (autor, año, editorial, etc.)"""
    titulo: str = ""
    autores: list[str] = Field(default_factory=list)
    anio: Optional[int] = None
    editorial: Optional[str] = None
    url: Optional[str] = None
    notas: Optional[str] = None

    def cita(self) -> str:
        """Devuelve una cadena de cita estilo APA simplificado."""
        partes = []
        if self.autores:
            partes.append("; ".join(self.autores))
        if self.anio:
            partes.append(f"({self.anio})")
        if self.titulo:
            partes.append(self.titulo)
        if self.editorial:
            partes.append(self.editorial)
        return ". ".join(partes) if partes else ""


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

    # Overrides del investigador sobre la extracción cruda (label, tipo, etc.)
    conceptos_editados: dict[str, dict] = Field(default_factory=dict)
    relaciones_editadas: dict[str, dict] = Field(default_factory=dict)

    # Relaciones añadidas manualmente por el investigador (no provienen del LLM)
    relaciones_investigador: list[dict] = Field(default_factory=list)

    # Metadatos editoriales del texto fuente
    metadatos: MetadatosTexto = Field(default_factory=MetadatosTexto)

    # ── Proyecciones ──────────────────────────────────────────────────

    def pendientes(self) -> list[PuntoDecision]:
        return [d for d in self.decisiones if d.estado == EstadoDecision.pendiente]

    def diferidas(self) -> list[PuntoDecision]:
        return [d for d in self.decisiones if d.estado == EstadoDecision.diferida]

    def resueltas(self) -> list[PuntoDecision]:
        return [d for d in self.decisiones if d.estado == EstadoDecision.resuelta]

    def todas_resueltas(self) -> bool:
        return all(d.estado == EstadoDecision.resuelta for d in self.decisiones)
