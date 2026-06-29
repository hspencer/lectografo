"""
División de texto en párrafos y lotes para extracción incremental.
Implementa DividirEnParrafosYFrases de specs/extraccion-incremental.allium.
"""
import re
from dataclasses import dataclass


@dataclass
class Parrafo:
    indice: int
    texto: str


def dividir_en_parrafos(texto: str, min_chars: int = 80) -> list[Parrafo]:
    """Divide texto en párrafos (separados por línea/s en blanco).
    Ignora bloques muy cortos (títulos sueltos, líneas de puntuación, etc.)."""
    bloques = re.split(r"\n{2,}", texto.strip())
    parrafos: list[Parrafo] = []
    for bloque in bloques:
        bloque = bloque.strip()
        if len(bloque) >= min_chars:
            parrafos.append(Parrafo(indice=len(parrafos), texto=bloque))
    return parrafos


def agrupar_en_lotes(parrafos: list[Parrafo], max_chars: int = 4000) -> list[list[Parrafo]]:
    """Agrupa párrafos consecutivos en lotes de tamaño ≤ max_chars.
    Si un párrafo individual supera max_chars se envía solo."""
    lotes: list[list[Parrafo]] = []
    lote: list[Parrafo] = []
    chars = 0
    for p in parrafos:
        n = len(p.texto)
        if lote and chars + n > max_chars:
            lotes.append(lote)
            lote = [p]
            chars = n
        else:
            lote.append(p)
            chars += n
    if lote:
        lotes.append(lote)
    return lotes
