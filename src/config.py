from pathlib import Path
from typing import Optional
from pydantic import SecretStr, model_validator
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
    gemini_model: str = "gemini-flash-latest"

    # Vertex AI: factura al proyecto GCP (sin API key personal), vía la
    # cuenta de servicio de Cloud Run. Ver block:lectografo:firebase:* en Vera.
    vertexai_project: str = "lectografo"
    vertexai_location: str = "us-central1"
    vertexai_model: str = "gemini-2.5-flash"

    # Ollama local
    ollama_endpoint: str = "http://localhost:11434"
    ollama_model: Optional[str] = None

    # LM Studio local (API compatible con OpenAI)
    lmstudio_endpoint: str = "http://localhost:1234/v1"
    lmstudio_model: Optional[str] = None

    # Paths
    transcripts_dir: Path = Path("transcripts")
    grafos_dir: Path = Path("data/grafos")

    # Comportamiento
    lang_default: str = "es"
    confianza_minima_extraccion: float = 0.6
    # Máximo de caracteres del transcript enviados en un solo prompt.
    # Transcripciones más largas se truncan con aviso. Para textos largos
    # usar extracción incremental (pendiente de implementar).
    max_chars_prompt: int = 40000

    # Invitaciones: secretos del remitente fuera del repositorio.
    smtp_host: Optional[str] = None
    smtp_port: int = 587
    smtp_user: Optional[str] = None
    smtp_password: Optional[SecretStr] = None
    smtp_from: Optional[str] = None
    app_url: str = "https://lectografo.web.app"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @model_validator(mode="after")
    def validar_proveedor(self):
        # Por ahora solo Google (Vertex AI o API key directa) -- los demás
        # quedan implementados pero fuera de uso hasta que se retomen.
        validos = {"gemini", "vertexai"}
        if self.provider not in validos:
            raise ValueError(f"PROVIDER='{self.provider}' no reconocido. Opciones: {validos}")
        # Las API keys se validan al momento de usar el LLM, no al arrancar,
        # para que el servidor pueda iniciarse aunque la key aún no esté en memoria.
        return self


settings = Settings()
