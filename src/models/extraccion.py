"""
Modelos Pydantic que representan la salida del LLM.
Corresponden a las entidades ConceptoPropuesto, RelacionPropuesta,
BucleDetectado y FlagMetalenguaje definidas en specs/extraccion.allium.
"""
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


class TipoRelacion(str, Enum):
    """Tipos canónicos. En la práctica el campo tipo es str libre; este enum
    sirve como referencia de valores esperados."""
    fundamenta = "fundamenta"
    amplifica = "amplifica"
    especifica = "especifica"
    contraposicion = "contraposicion"
    constituye = "constituye"
    genera = "genera"
    presupone = "presupone"
    relacionado_con = "relacionado_con"   # fallback genérico


class TipoBucle(str, Enum):
    fundamental = "fundamental"
    contingente = "contingente"


class TipoMetalenguaje(str, Enum):
    definicion_sobre_el_vuelo = "definicion_sobre_el_vuelo"
    refinamiento_de_uso = "refinamiento_de_uso"
    cita_de_otro_autor = "cita_de_otro_autor"


class TipoConcepto(str, Enum):
    primitivo    = "primitivo"
    derivado     = "derivado"
    metalenguaje = "metalenguaje"
    ambiguo      = "ambiguo"


class ConceptoPropuesto(BaseModel):
    id: str                                        # "c_001", "c_002", ...
    label: str
    tipo: TipoConcepto = TipoConcepto.primitivo    # clasificación epistemológica
    descripcion: str
    sinonimos_candidatos: list[str] = Field(default_factory=list)
    menciones: int = Field(default=1, ge=1)
    confianza: float = Field(ge=0.0, le=1.0)
    timestamp_primera_aparicion: Optional[str] = None
    cita_directa: str


class RelacionPropuesta(BaseModel):
    id: str                                        # "r_001", "r_002", ...
    origen_id: str
    destino_id: str
    tipo: str                                      # string libre; TipoRelacion como guía
    etiqueta: str                                  # la palabra que el autor usa
    bidireccional: bool = False
    confianza: float = Field(ge=0.0, le=1.0)
    frase_completa: str
    matiz: Optional[str] = None
    contexto: Optional[str] = None


class BucleDetectado(BaseModel):
    id: str                                        # "b_001", ...
    nodos_ids: list[str] = Field(min_length=2)
    descripcion: str
    tipo: TipoBucle


class FlagMetalenguaje(BaseModel):
    id: str                                        # "m_001", ...
    tipo: TipoMetalenguaje
    contexto: str
    texto: str
    conceptos_afectados_ids: list[str] = Field(default_factory=list)
    nota: str


class ResultadoExtraccion(BaseModel):
    conceptos: list[ConceptoPropuesto] = Field(default_factory=list)
    relaciones: list[RelacionPropuesta] = Field(default_factory=list)
    bucles: list[BucleDetectado] = Field(default_factory=list)
    metalenguaje: list[FlagMetalenguaje] = Field(default_factory=list)
