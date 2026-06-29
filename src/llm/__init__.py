from src.config import settings
from src.llm.base import EvaluadorLLM


def get_llm() -> EvaluadorLLM:
    match settings.provider:
        case "ollama":
            from src.llm.ollama import OllamaLLM
            return OllamaLLM()
        case "anthropic":
            from src.llm.anthropic import AnthropicLLM
            return AnthropicLLM()
        case "openai":
            from src.llm.openai import OpenAILLM
            return OpenAILLM()
        case "gemini":
            from src.llm.gemini import GeminiLLM
            return GeminiLLM()
        case _:
            raise NotImplementedError(f"Proveedor '{settings.provider}' no implementado")
