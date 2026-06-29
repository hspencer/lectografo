"""
Implementación del contrato EvaluadorLLM para Anthropic (Claude).
Usa el SDK oficial `anthropic` con streaming.
Soporta prompt caching con cache_control en el bloque de sistema.
"""
import threading

from src.config import settings
from src.llm.base import EvaluadorLLM


class AnthropicLLM(EvaluadorLLM):

    def __init__(self):
        import anthropic as _sdk
        self._client = _sdk.Anthropic(api_key=settings.anthropic_api_key)
        self.model = settings.anthropic_model

    def invocar(self, prompt_sistema: str, texto: str, on_token=None, on_texto=None, should_cancel=None) -> str:
        fragmentos: list[str] = []
        tokens_recibidos = 0
        _cancelado = threading.Event()

        # Construir mensajes: el texto del usuario puede ir vacío si
        # todo está en el prompt del sistema (patrón de reconexión).
        messages = []
        user_content = texto.strip() if texto.strip() else "Procede según las instrucciones."
        messages.append({"role": "user", "content": user_content})

        system_blocks = [
            {
                "type": "text",
                "text": prompt_sistema,
                "cache_control": {"type": "ephemeral"},   # prompt caching
            }
        ]

        def _watchdog():
            while not _cancelado.wait(timeout=1.0):
                if should_cancel and should_cancel():
                    _cancelado.set()
                    break

        if should_cancel:
            threading.Thread(target=_watchdog, daemon=True).start()

        try:
            with self._client.messages.stream(
                model=self.model,
                max_tokens=8192,
                system=system_blocks,
                messages=messages,
            ) as stream:
                for text_chunk in stream.text_stream:
                    if _cancelado.is_set() or (should_cancel and should_cancel()):
                        raise InterruptedError("Extracción cancelada por el usuario")
                    fragmentos.append(text_chunk)
                    tokens_recibidos += 1
                    if on_token:
                        on_token(tokens_recibidos)
                    if on_texto:
                        on_texto(text_chunk)
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
