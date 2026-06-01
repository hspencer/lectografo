"""
Pipeline de extracción: lee el prompt, invoca el LLM, parsea el resultado.
Implementa IniciarExtraccion / ExtraccionCompleta de specs/extraccion.allium.
"""
from pathlib import Path

from src.llm.base import EvaluadorLLM
from src.models.extraccion import ResultadoExtraccion
from src.pipeline.ingesta import TranscripcionCruda


PROMPTS_DIR = Path(__file__).parent.parent.parent / "prompts"


def cargar_prompt(nombre: str = "extraccion_v1.md") -> str:
    ruta = PROMPTS_DIR / nombre
    if not ruta.exists():
        raise FileNotFoundError(f"Prompt no encontrado: {ruta}")
    return ruta.read_text(encoding="utf-8")


def extraer(
    transcripcion: TranscripcionCruda,
    llm: EvaluadorLLM,
    prompt_nombre: str = "extraccion_v1.md",
) -> ResultadoExtraccion:
    prompt_sistema = cargar_prompt(prompt_nombre)
    respuesta_cruda = llm.invocar(prompt_sistema, transcripcion.texto)
    return llm.parsear_respuesta(respuesta_cruda)
