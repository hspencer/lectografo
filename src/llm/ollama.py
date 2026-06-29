"""
Implementación del contrato EvaluadorLLM para Ollama (modelos locales).
Soporta modelos de la familia qwen3/qwen3.5 que emiten thinking tokens:
los desactiva con think=False en las opciones de la API.

Usa streaming para evitar ReadTimeout en modelos lentos o transcripciones largas:
los tokens llegan progresivamente y se acumulan hasta completar la respuesta.

Cancelación: un thread watchdog comprueba should_cancel() cada segundo y cierra
el cliente httpx cuando se activa, incluso si el modelo aún no ha emitido tokens
(fase de carga o thinking interno). Esto hace la cancelación responsiva sin depender
de que lleguen tokens.
"""
import json
import threading
import httpx

from src.config import settings
from src.llm.base import EvaluadorLLM


class OllamaLLM(EvaluadorLLM):

    def __init__(self):
        self.endpoint = settings.ollama_endpoint.rstrip("/")
        self.model = settings.ollama_model

    def invocar(self, prompt_sistema: str, texto: str, on_token=None, on_texto=None, should_cancel=None) -> str:
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
                "num_predict": -1,      # sin límite de tokens de salida
                "num_ctx": 32768,       # contexto amplio para transcripciones largas
                "think": False,         # desactiva thinking tokens en qwen3/qwen3.5
            },
        }
        fragmentos: list[str] = []
        tokens_recibidos = 0
        _cancelado = threading.Event()

        with httpx.Client(timeout=httpx.Timeout(30.0, read=600.0)) as client:

            # ── Watchdog: cierra el cliente si se solicita cancelación ──────────
            # Opera en un thread daemon y verifica each segundo, permitiendo
            # cancelar incluso cuando el modelo no ha emitido ningún token aún
            # (fase de carga, thinking interno, etc.).
            def _watchdog():
                while not _cancelado.wait(timeout=1.0):
                    if should_cancel and should_cancel():
                        client.close()
                        _cancelado.set()
                        break

            if should_cancel:
                threading.Thread(target=_watchdog, daemon=True).start()

            try:
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
                            if on_token:
                                on_token(tokens_recibidos)
                            if on_texto:
                                on_texto(token)
                            if tokens_recibidos % 50 == 0:
                                print(f"      ... {tokens_recibidos} tokens", end="\r", flush=True)
                        if evento.get("done"):
                            break
            except Exception as exc:
                if _cancelado.is_set() or (should_cancel and should_cancel()):
                    raise InterruptedError("Extracción cancelada por el usuario") from exc
                raise
            finally:
                _cancelado.set()   # detener watchdog si el streaming terminó normalmente

        print(f"      {tokens_recibidos} tokens generados.              ")
        return "".join(fragmentos)
