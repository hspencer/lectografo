"""
Ingesta de transcripciones desde archivo local.
Implementa IngestarArchivoLocal de specs/transcripcion.allium.
"""
from pathlib import Path
from dataclasses import dataclass


EXTENSIONES_SOPORTADAS = {"txt", "md", "vtt", "srt"}
EXTENSIONES_CON_TIMESTAMPS = {"vtt", "srt"}


@dataclass
class TranscripcionCruda:
    titulo: str
    ruta: Path
    texto: str
    tiene_timestamps: bool
    extension: str


def leer_archivo(ruta: str | Path) -> TranscripcionCruda:
    ruta = Path(ruta)
    if not ruta.exists():
        raise FileNotFoundError(f"No se encontró el archivo: {ruta}")

    extension = ruta.suffix.lower().lstrip(".")
    if extension not in EXTENSIONES_SOPORTADAS:
        raise ValueError(
            f"Extensión '.{extension}' no soportada. "
            f"Extensiones válidas: {EXTENSIONES_SOPORTADAS}"
        )

    texto = ruta.read_text(encoding="utf-8")
    if not texto.strip():
        raise ValueError(f"El archivo está vacío: {ruta}")

    return TranscripcionCruda(
        titulo=ruta.stem,
        ruta=ruta,
        texto=texto,
        tiene_timestamps=extension in EXTENSIONES_CON_TIMESTAMPS,
        extension=extension,
    )
