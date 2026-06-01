"""
Contrato EvaluadorLLM definido en specs/surfaces.allium.

Toda implementación concreta (Ollama, Anthropic, OpenAI, Gemini) debe
extender esta clase. parsear_respuesta nunca lanza excepción: ante input
inválido retorna un ResultadoExtraccion vacío (@invariant ParseoEsTotal).
"""
import json
import re
from abc import ABC, abstractmethod

from src.models.extraccion import ResultadoExtraccion


class EvaluadorLLM(ABC):

    @abstractmethod
    def invocar(self, prompt_sistema: str, texto: str) -> str:
        """Envía prompt + texto al proveedor y retorna la respuesta cruda."""
        ...

    def parsear_respuesta(self, texto: str) -> ResultadoExtraccion:
        """
        Parsea la respuesta JSON del LLM.
        Limpia bloques <think>...</think> que algunos modelos emiten
        antes del JSON (ej. qwen3, deepseek-r1).
        Nunca lanza excepción.
        """
        # Eliminar bloques de pensamiento si existen
        limpio = re.sub(r"<think>.*?</think>", "", texto, flags=re.DOTALL).strip()

        # Si la respuesta envuelve el JSON en markdown, extraerlo
        match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", limpio, re.DOTALL)
        if match:
            limpio = match.group(1)

        try:
            data = json.loads(limpio)
            return ResultadoExtraccion.model_validate(data)
        except Exception:
            return ResultadoExtraccion()
