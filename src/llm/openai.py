"""
Implementación del contrato EvaluadorLLM para OpenAI (GPT).
Usa el SDK oficial `openai` con streaming.
"""
import threading

from src.config import settings
from src.llm.base import EvaluadorLLM


class OpenAILLM(EvaluadorLLM):

    def __init__(self):
        import openai as _sdk
        self._client = _sdk.OpenAI(api_key=settings.openai_api_key)
        self.model = settings.openai_model

    def invocar(self, prompt_sistema: str, texto: str, on_token=None, on_texto=None, should_cancel=None) -> str:
        fragmentos: list[str] = []
        tokens_recibidos = 0
        _cancelado = threading.Event()

        user_content = texto.strip() if texto.strip() else "Procede según las instrucciones."
        messages = [
            {"role": "system", "content": prompt_sistema},
            {"role": "user", "content": user_content},
        ]

        def _watchdog():
            while not _cancelado.wait(timeout=1.0):
                if should_cancel and should_cancel():
                    _cancelado.set()
                    break

        if should_cancel:
            threading.Thread(target=_watchdog, daemon=True).start()

        try:
            with self._client.chat.completions.create(
                model=self.model,
                messages=messages,
                stream=True,
                temperature=0.1,
                response_format={"type": "json_object"},
            ) as stream:
                for chunk in stream:
                    if _cancelado.is_set() or (should_cancel and should_cancel()):
                        raise InterruptedError("Extracción cancelada por el usuario")
                    delta = chunk.choices[0].delta.content if chunk.choices else None
                    if delta:
                        fragmentos.append(delta)
                        tokens_recibidos += 1
                        if on_token:
                            on_token(tokens_recibidos)
                        if on_texto:
                            on_texto(delta)
                        if tokens_recibidos % 50 == 0:
                            print(f"      ... {tokens_recibidos} tokens", end="\r", flush=True)
        except InterruptedError:
            raise
        except Exception as exc:
            if _cancelado.is_set():
                raise InterruptedError("Extracción cancelada por el usuario") from exc
            raise
        finally:
            _cancelado.set()

        print(f"      {tokens_recibidos} tokens generados.              ")
        return "".join(fragmentos)
