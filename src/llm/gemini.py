"""
Implementación del contrato EvaluadorLLM para Google Gemini.
Usa el SDK `google-generativeai` con streaming.
"""
import threading

from src.config import settings
from src.llm.base import EvaluadorLLM


class GeminiLLM(EvaluadorLLM):

    def __init__(self):
        import google.generativeai as genai
        genai.configure(api_key=settings.gemini_api_key)
        self._genai = genai
        self.model_name = settings.gemini_model

    def invocar(self, prompt_sistema: str, texto: str, on_token=None, on_texto=None, should_cancel=None) -> str:
        import google.generativeai as genai
        from google.generativeai.types import GenerationConfig

        fragmentos: list[str] = []
        tokens_recibidos = 0
        _cancelado = threading.Event()

        user_content = texto.strip() if texto.strip() else "Procede según las instrucciones."
        # Gemini: sistema + usuario como prompt combinado
        prompt_completo = f"{prompt_sistema}\n\n---\n\n{user_content}"

        model = genai.GenerativeModel(
            model_name=self.model_name,
            generation_config=GenerationConfig(
                temperature=0.1,
                response_mime_type="application/json",
            ),
        )

        def _watchdog():
            while not _cancelado.wait(timeout=1.0):
                if should_cancel and should_cancel():
                    _cancelado.set()
                    break

        if should_cancel:
            threading.Thread(target=_watchdog, daemon=True).start()

        try:
            for chunk in model.generate_content(prompt_completo, stream=True):
                if _cancelado.is_set() or (should_cancel and should_cancel()):
                    raise InterruptedError("Extracción cancelada por el usuario")
                text = chunk.text if hasattr(chunk, "text") and chunk.text else ""
                if text:
                    fragmentos.append(text)
                    tokens_recibidos += len(text.split())  # aproximación
                    if on_token:
                        on_token(tokens_recibidos)
                    if on_texto:
                        on_texto(text)
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
