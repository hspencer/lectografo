"""
Pipeline de extracción: lee el prompt, invoca el LLM, parsea el resultado.
Implementa IniciarExtraccion / ExtraccionCompleta de specs/extraccion.allium.
"""
from pathlib import Path

from src.llm.base import EvaluadorLLM
from src.models.extraccion import ResultadoExtraccion
from src.pipeline.ingesta import TranscripcionCruda


PROMPTS_DIR = Path(__file__).parent.parent.parent / "prompts"

# Límite de caracteres por defecto; configurable via Settings.max_chars_prompt
_MAX_CHARS_DEFAULT = 40_000


def cargar_prompt(nombre: str = "extraccion_v1.md") -> str:
    ruta = PROMPTS_DIR / nombre
    if not ruta.exists():
        raise FileNotFoundError(f"Prompt no encontrado: {ruta}")
    return ruta.read_text(encoding="utf-8")


def extraer(
    transcripcion: TranscripcionCruda,
    llm: EvaluadorLLM,
    prompt_nombre: str = "extraccion_v1.md",
    on_token=None,
    on_texto=None,
    should_cancel=None,
    max_chars: int | None = None,
) -> ResultadoExtraccion:
    prompt_sistema = cargar_prompt(prompt_nombre)

    # Truncar el texto si supera el límite para no desbordar el contexto del LLM.
    # Para textos largos, la extracción incremental por fragmentos es la ruta
    # correcta (pendiente de implementar); esto es un fallback de seguridad.
    limite = max_chars if max_chars is not None else _MAX_CHARS_DEFAULT
    texto = transcripcion.texto
    if len(texto) > limite:
        print(
            f"[lectografo] Transcript de {len(texto):,} chars excede el límite de {limite:,}. "
            f"Truncando al primer fragmento. Para textos largos usa extracción incremental.",
            flush=True,
        )
        # Truncar en el último salto de párrafo antes del límite para evitar
        # cortar en medio de una oración
        fragmento = texto[:limite]
        ult_parrafo = fragmento.rfind("\n\n")
        if ult_parrafo > limite // 2:
            fragmento = fragmento[:ult_parrafo]
        texto = fragmento

    respuesta_cruda = llm.invocar(
        prompt_sistema, texto,
        on_token=on_token, on_texto=on_texto, should_cancel=should_cancel,
    )
    return llm.parsear_respuesta(respuesta_cruda)
