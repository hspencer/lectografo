"""Carga y guarda GrafoPersonal desde/hacia JSON."""
from pathlib import Path
from src.models.grafo_personal import GrafoPersonal


def _dir(base: Path) -> Path:
    d = base / "grafos-personales"
    d.mkdir(parents=True, exist_ok=True)
    return d


def ruta_grafo_personal(slug: str, base: Path) -> Path:
    return _dir(base) / f"{slug}.json"


def cargar_gp(slug: str, base: Path) -> GrafoPersonal:
    return GrafoPersonal.model_validate_json(
        ruta_grafo_personal(slug, base).read_text("utf-8")
    )


def guardar_gp(grafo: GrafoPersonal, base: Path) -> None:
    ruta_grafo_personal(grafo.slug, base).write_text(
        grafo.model_dump_json(indent=2), encoding="utf-8"
    )


def listar_gp(base: Path) -> list[GrafoPersonal]:
    d = _dir(base)
    return [
        GrafoPersonal.model_validate_json(f.read_text("utf-8"))
        for f in sorted(d.glob("*.json"))
    ]
