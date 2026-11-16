"""Proveedor y modelo LLM elegidos en Configuración, y modelos disponibles.

El .env solo guarda credenciales. La elección de proveedor/modelo vive en
Firestore (config/llm): en Cloud Run el disco es efímero y cada instancia tiene
el suyo, así que cada una relee el documento como máximo cada _TTL segundos.
Sin Firebase (desarrollo local) se guarda en data/config_llm.json.

Los modelos disponibles se piden en vivo a cada proveedor, no a un catálogo
escrito a mano: así aparecen los nuevos y desaparecen los retirados.
"""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import threading
import time

from src.config import settings
from src.contexto_biblioteca import _FIREBASE_OK

PROVEEDORES = ("vertexai", "gemini", "anthropic", "openai", "lmstudio")
_ARCHIVO_LOCAL = Path("data/config_llm.json")
_TTL = 30.0
_lock = threading.Lock()
_leido_en = 0.0


def _doc():
    from firebase_admin import firestore
    return firestore.client().collection("config").document("llm")


def _aplicar(datos: dict) -> None:
    if datos.get("provider") in PROVEEDORES:
        object.__setattr__(settings, "provider", datos["provider"])
    for prov in PROVEEDORES:
        if datos.get(f"{prov}_model"):
            object.__setattr__(settings, f"{prov}_model", datos[f"{prov}_model"])


def _leer() -> dict:
    if _FIREBASE_OK:
        return _doc().get().to_dict() or {}
    return json.loads(_ARCHIVO_LOCAL.read_text("utf-8")) if _ARCHIVO_LOCAL.exists() else {}


def sincronizar(forzar: bool = False) -> None:
    """Trae la elección guardada a `settings` si pasó el TTL. Best-effort: si
    falla la lectura se sigue con lo que hay en memoria."""
    global _leido_en
    with _lock:
        if not forzar and time.monotonic() - _leido_en < _TTL:
            return
        _leido_en = time.monotonic()
    try:
        _aplicar(_leer())
    except Exception:
        pass


def guardar(provider: str, model: str | None) -> None:
    """Persiste la elección. Lanza si no se pudo: el admin debe saberlo."""
    datos = {"provider": provider}
    if model:
        datos[f"{provider}_model"] = model
    if _FIREBASE_OK:
        _doc().set(datos, merge=True)
    else:
        previo = _leer()
        _ARCHIVO_LOCAL.parent.mkdir(parents=True, exist_ok=True)
        _ARCHIVO_LOCAL.write_text(json.dumps({**previo, **datos}, indent=2), "utf-8")
    _aplicar(datos)


# ── Modelos disponibles, en vivo ──────────────────────────────────────────────

def _gemini(key: str) -> list[str]:
    from google import genai
    cliente = genai.Client(api_key=key)  # referencia viva: el paginador lo usa
    nombres = [m.name.removeprefix("models/") for m in cliente.models.list()
               if "generateContent" in (m.supported_actions or [])]
    # generateContent también lo exponen los de imagen, audio y TTS.
    return [n for n in nombres if n.startswith(("gemini", "gemma"))
            and not any(x in n for x in ("image", "tts", "audio", "live", "embedding"))]


def _vertexai() -> list[str]:
    from google import genai
    cliente = genai.Client(vertexai=True, project=settings.vertexai_project,
                           location=settings.vertexai_location)
    nombres = (m.name.rsplit("/", 1)[-1] for m in cliente.models.list(config={"query_base": True}))
    return [n for n in nombres if n.startswith("gemini")]


def _anthropic(key: str) -> list[str]:
    import anthropic
    return [m.id for m in anthropic.Anthropic(api_key=key).models.list(limit=100)]


# Lo que /v1/models devuelve y no sirve para chat.
_OPENAI_NO_CHAT = ("embedding", "tts", "whisper", "dall-e", "image", "audio",
                   "realtime", "live", "transcribe", "moderation", "search", "codex")


def _openai(key: str) -> list[str]:
    import openai
    ids = [m.id for m in openai.OpenAI(api_key=key).models.list()]
    return [i for i in ids if i.startswith(("gpt-", "o1", "o3", "o4", "chatgpt"))
            and not any(x in i for x in _OPENAI_NO_CHAT)]


def _lmstudio() -> list[str]:
    import httpx
    r = httpx.get(f"{settings.lmstudio_endpoint.rstrip('/')}/models", timeout=2.0)
    r.raise_for_status()
    return [m["id"] for m in r.json().get("data", [])]


_CACHE_MODELOS: dict[str, tuple[float, list[str]]] = {}
_TTL_MODELOS = 300.0


def modelos_disponibles(claves: dict[str, str | None]) -> dict[str, list[str]]:
    """Modelos por proveedor, consultados en paralelo. Un proveedor sin clave o
    que no responde queda con lista vacía; la UI ofrece entonces "Otro…"."""
    tareas = {
        "vertexai":  _vertexai,
        "gemini":    lambda: _gemini(claves["gemini"]) if claves.get("gemini") else [],
        "anthropic": lambda: _anthropic(claves["anthropic"]) if claves.get("anthropic") else [],
        "openai":    lambda: _openai(claves["openai"]) if claves.get("openai") else [],
        "lmstudio":  _lmstudio,
    }

    def consultar(prov):
        previo = _CACHE_MODELOS.get(prov)
        if previo and time.monotonic() - previo[0] < _TTL_MODELOS:
            return previo[1]
        try:
            modelos = sorted(set(tareas[prov]()), reverse=True)
        except Exception:
            modelos = []
        if modelos:  # no cachear un fallo: puede ser transitorio
            _CACHE_MODELOS[prov] = (time.monotonic(), modelos)
        return modelos

    with ThreadPoolExecutor(len(tareas)) as pool:
        return dict(zip(tareas, pool.map(consultar, tareas)))
