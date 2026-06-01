"""
Implementación del contrato EvaluadorLLM para Ollama (modelos locales).
Soporta modelos de la familia qwen3/qwen3.5 que emiten thinking tokens:
los desactiva con think=False en las opciones de la API.

Usa streaming para evitar ReadTimeout en modelos lentos o transcripciones largas:
los tokens llegan progresivamente y se acumulan hasta completar la respuesta.
"""
import json
import sys
import httpx

from src.config import settings
from src.llm.base import EvaluadorLLM


class OllamaLLM(EvaluadorLLM):

    def __init__(self):
        self.endpoint = settings.ollama_endpoint.rstrip("/")
        self.model = settings.ollama_model

    def invocar(self, prompt_sistema: str, texto: str) -> str:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": prompt_sistema},
                {"role": "user", "content": texto},
            ],
            "stream": True,
            "format": "json",       # fuerza JSON en la salida
            "options": {
                "temperature": 0.1,
                "num_predict": 8192,
                "num_ctx": 16384,   # contexto suficiente para transcripciones largas
                "think": False,     # desactiva thinking tokens en qwen3/qwen3.5
            },
        }
        fragmentos: list[str] = []
        tokens_recibidos = 0

        with httpx.Client(timeout=httpx.Timeout(30.0, read=600.0)) as client:
            with client.stream("POST", f"{self.endpoint}/api/chat", json=payload) as r:
                r.raise_for_status()
                for linea in r.iter_lines():
                    if not linea:
                        continue
                    evento = json.loads(linea)
                    token = evento.get("message", {}).get("content", "")
                    if token:
                        fragmentos.append(token)
                        tokens_recibidos += 1
                        # Indicador de progreso cada 100 tokens
                        if tokens_recibidos % 100 == 0:
                            print(f"      ... {tokens_recibidos} tokens", end="\r", flush=True)
                    if evento.get("done"):
                        break

        print(f"      {tokens_recibidos} tokens generados.              ")
        return "".join(fragmentos)
