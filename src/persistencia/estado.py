"""
Persistencia del estado de validación en disco (JSON local).
El archivo vive en data/grafos/{slug}_validacion.json.
"""
from pathlib import Path
from src.models.validacion import EstadoValidacion


def ruta_validacion(slug: str, grafos_dir: Path) -> Path:
    return grafos_dir / f"{slug}_validacion.json"


def guardar(estado: EstadoValidacion, ruta: Path) -> None:
    from datetime import datetime
    estado.actualizado_en = datetime.utcnow()
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(estado.model_dump_json(indent=2), encoding="utf-8")


def cargar(ruta: Path) -> EstadoValidacion:
    return EstadoValidacion.model_validate_json(ruta.read_text(encoding="utf-8"))
