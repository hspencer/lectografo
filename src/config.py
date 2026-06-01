from pathlib import Path
from typing import Optional
from pydantic import model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    provider: str

    # Claves remotas
    anthropic_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    gemini_api_key: Optional[str] = None

    # Modelos remotos (defaults razonables)
    anthropic_model: str = "claude-opus-4-6"
    openai_model: str = "gpt-4o"
    gemini_model: str = "gemini-1.5-pro"

    # Ollama local
    ollama_endpoint: str = "http://localhost:11434"
    ollama_model: Optional[str] = None

    # Paths
    transcripts_dir: Path = Path("transcripts")
    grafos_dir: Path = Path("data/grafos")

    # Comportamiento
    lang_default: str = "es"
    confianza_minima_extraccion: float = 0.6

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @model_validator(mode="after")
    def validar_proveedor(self):
        validos = {"anthropic", "openai", "gemini", "ollama"}
        if self.provider not in validos:
            raise ValueError(f"PROVIDER='{self.provider}' no reconocido. Opciones: {validos}")
        if self.provider == "ollama" and not self.ollama_model:
            raise ValueError("OLLAMA_MODEL debe estar definido cuando PROVIDER=ollama")
        if self.provider == "anthropic" and not self.anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY debe estar definido cuando PROVIDER=anthropic")
        if self.provider == "openai" and not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY debe estar definido cuando PROVIDER=openai")
        if self.provider == "gemini" and not self.gemini_api_key:
            raise ValueError("GEMINI_API_KEY debe estar definido cuando PROVIDER=gemini")
        return self


settings = Settings()
