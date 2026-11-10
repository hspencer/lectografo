"""
Vertex AI: mismo contrato que Gemini, pero factura al proyecto GCP en vez
de a una API key personal. Usa ADC (la cuenta de servicio del propio
Cloud Run, o `gcloud auth application-default login` en local) -- ver
block:lectografo:firebase:cloudrun:* en Vera.
"""
from src.config import settings
from src.llm.gemini import GeminiLLM


class VertexAILLM(GeminiLLM):

    def __init__(self):
        from google import genai
        self._client = genai.Client(
            vertexai=True,
            project=settings.vertexai_project,
            location=settings.vertexai_location,
        )
        self.model_name = settings.vertexai_model
