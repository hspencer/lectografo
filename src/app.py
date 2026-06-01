"""
FastAPI app: sirve la UI estática y expone la API de validación.
Arrancar con: uvicorn src.app:app --reload
"""
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from src.config import settings
from src.models.extraccion import ResultadoExtraccion
from src.models.validacion import (
    AnotacionInvestigador,
    EstadoDecision,
    EstadoValidacion,
    ResolucionDecision,
)
from src.persistencia.estado import cargar, guardar, ruta_validacion
from src.pipeline.validacion import generar_decisiones

app = FastAPI(title="Llull", docs_url="/api/docs")

STATIC = Path(__file__).parent.parent / "static"
GRAFOS = settings.grafos_dir


# ── helpers ───────────────────────────────────────────────────────────────────

def _cargar_o_crear(slug: str) -> tuple[EstadoValidacion, Path]:
    ruta_val = ruta_validacion(slug, GRAFOS)
    if ruta_val.exists():
        return cargar(ruta_val), ruta_val

    ruta_ext = GRAFOS / f"{slug}_extraccion.json"
    if not ruta_ext.exists():
        raise HTTPException(404, f"No existe extracción para slug '{slug}'")

    extraccion = ResultadoExtraccion.model_validate_json(ruta_ext.read_text("utf-8"))
    decisiones = generar_decisiones(
        extraccion,
        confianza_minima=settings.confianza_minima_extraccion,
        menciones_minimas=2,
    )
    estado = EstadoValidacion(
        titulo=slug.replace("_", " ").title(),
        slug=slug,
        extraccion=extraccion,
        decisiones=decisiones,
    )
    guardar(estado, ruta_val)
    return estado, ruta_val


# ── API ───────────────────────────────────────────────────────────────────────

@app.get("/api/extracciones")
def listar_extracciones():
    """Lista todos los slugs con extracción disponible."""
    archivos = sorted(GRAFOS.glob("*_extraccion.json"))
    resultado = []
    for f in archivos:
        slug = f.stem.replace("_extraccion", "")
        ruta_val = ruta_validacion(slug, GRAFOS)
        info: dict = {"slug": slug, "titulo": slug.replace("_", " ").title()}
        if ruta_val.exists():
            estado = cargar(ruta_val)
            total = len(estado.decisiones)
            resueltas = len(estado.resueltas())
            info.update({
                "total": total,
                "resueltas": resueltas,
                "pendientes": len(estado.pendientes()),
                "diferidas": len(estado.diferidas()),
                "completado": estado.completado,
            })
        else:
            info.update({"total": None, "resueltas": 0,
                         "pendientes": None, "diferidas": 0, "completado": False})
        resultado.append(info)
    return resultado


@app.get("/api/validacion/{slug}")
def obtener_validacion(slug: str):
    """Devuelve el estado completo de la sesión de validación."""
    estado, _ = _cargar_o_crear(slug)
    return estado.model_dump(mode="json")


class ResolverPayload(BaseModel):
    resolucion: ResolucionDecision
    nota: Optional[str] = None
    label_resolucion: Optional[str] = None   # solo para sinonimia modificada


@app.post("/api/validacion/{slug}/decisiones/{did}/resolver")
def resolver_decision(slug: str, did: str, payload: ResolverPayload):
    """Resuelve o difiere una decisión."""
    from datetime import datetime

    estado, ruta_val = _cargar_o_crear(slug)
    decision = next((d for d in estado.decisiones if d.id == did), None)
    if not decision:
        raise HTTPException(404, f"Decisión '{did}' no encontrada")
    if decision.estado == EstadoDecision.resuelta:
        raise HTTPException(409, "La decisión ya está resuelta")

    if payload.resolucion == ResolucionDecision.diferida:
        decision.estado = EstadoDecision.diferida
    else:
        decision.estado = EstadoDecision.resuelta
        decision.resolucion = payload.resolucion
        decision.nota_resolucion = payload.nota
        decision.resuelta_en = datetime.utcnow()
        if payload.label_resolucion:
            decision.label_resolucion = payload.label_resolucion

    if estado.todas_resueltas() and not estado.completado:
        estado.completado = True

    guardar(estado, ruta_val)
    return {"ok": True, "completado": estado.completado,
            "resueltas": len(estado.resueltas()), "total": len(estado.decisiones)}


class ReanudarPayload(BaseModel):
    pass


@app.post("/api/validacion/{slug}/decisiones/{did}/reanudar")
def reanudar_decision(slug: str, did: str):
    """
    Mueve una decisión diferida o resuelta de vuelta a pendiente.
    Nota: reabrir una decisión `resuelta` contradice `terminal: resuelta`
    de la máquina de estados del spec. Se permite aquí como override
    explícito del investigador; ver open question en validacion.allium.
    """
    estado, ruta_val = _cargar_o_crear(slug)
    decision = next((d for d in estado.decisiones if d.id == did), None)
    if not decision:
        raise HTTPException(404, f"Decisión '{did}' no encontrada")
    if decision.estado == EstadoDecision.pendiente:
        raise HTTPException(409, "La decisión ya está pendiente")
    decision.estado    = EstadoDecision.pendiente
    decision.resolucion      = None
    decision.nota_resolucion = None
    decision.resuelta_en     = None
    decision.label_resolucion = None
    if estado.completado:
        estado.completado = False
    guardar(estado, ruta_val)
    return {"ok": True}


class AnotarPayload(BaseModel):
    objeto_anotado: str
    nota: str


@app.post("/api/validacion/{slug}/anotar")
def agregar_anotacion(slug: str, payload: AnotarPayload):
    import uuid
    estado, ruta_val = _cargar_o_crear(slug)
    estado.anotaciones.append(AnotacionInvestigador(
        id=str(uuid.uuid4())[:8],
        objeto_anotado=payload.objeto_anotado,
        nota=payload.nota,
    ))
    guardar(estado, ruta_val)
    return {"ok": True}


# ── Static files (debe ir al final) ───────────────────────────────────────────
app.mount("/", StaticFiles(directory=str(STATIC), html=True), name="static")
