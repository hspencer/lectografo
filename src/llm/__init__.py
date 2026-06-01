from src.config import settings
from src.llm.base import EvaluadorLLM


def get_llm() -> EvaluadorLLM:
    if settings.provider == "ollama":
        from src.llm.ollama import OllamaLLM
        return OllamaLLM()
    raise NotImplementedError(f"Proveedor '{settings.provider}' aún no implementado")
