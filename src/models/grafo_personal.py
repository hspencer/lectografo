"""
Modelos para grafos personales del investigador.
Corresponden a GrafoPersonal, ConceptoInvestigador, RelacionInvestigador
definidos en specs/grafos-personales.allium.

MVP: conceptos propios + relaciones entre ellos + visualización D3.
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class CitaPasaje(BaseModel):
    texto: str
    fuente: Optional[str] = None


class ConceptoInvestigador(BaseModel):
    id: str
    label: str
    definicion: Optional[str] = None
    citas: list[CitaPasaje] = Field(default_factory=list)
    creado_en: datetime = Field(default_factory=datetime.utcnow)
    actualizado_en: datetime = Field(default_factory=datetime.utcnow)


class RelacionInvestigador(BaseModel):
    id: str
    origen_id: str    # ConceptoInvestigador.id en este grafo
    destino_id: str   # ConceptoInvestigador.id en este grafo
    tipo: str
    etiqueta: str
    bidireccional: bool = False
    cita: Optional[CitaPasaje] = None
    creada_en: datetime = Field(default_factory=datetime.utcnow)


class GrafoPersonal(BaseModel):
    titulo: str
    slug: str
    descripcion: Optional[str] = None
    conceptos_propios: list[ConceptoInvestigador] = Field(default_factory=list)
    relaciones: list[RelacionInvestigador] = Field(default_factory=list)
    creado_en: datetime = Field(default_factory=datetime.utcnow)
    actualizado_en: datetime = Field(default_factory=datetime.utcnow)
