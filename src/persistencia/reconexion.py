"""
Persistencia de la SesionReconexion en disco.
El archivo vive en data/grafos/{slug}_reconexion.json mientras la sesión está activa.
"""
from pathlib import Path
from src.models.reconexion import SesionReconexion


def ruta_sesion(slug: str, grafos_dir: Path) -> Path:
    return grafos_dir / f"{slug}_reconexion.json"


def existe(slug: str, grafos_dir: Path) -> bool:
    return ruta_sesion(slug, grafos_dir).exists()


def guardar(sesion: SesionReconexion, slug: str, grafos_dir: Path) -> None:
    ruta = ruta_sesion(slug, grafos_dir)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(sesion.model_dump_json(indent=2), encoding="utf-8")


def cargar(slug: str, grafos_dir: Path) -> SesionReconexion:
    return SesionReconexion.model_validate_json(
        ruta_sesion(slug, grafos_dir).read_text(encoding="utf-8")
    )


def eliminar(slug: str, grafos_dir: Path) -> None:
    ruta_sesion(slug, grafos_dir).unlink(missing_ok=True)
