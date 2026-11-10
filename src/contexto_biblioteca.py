"""
Resuelve GRAFOS/TRANSCRIPTS por biblioteca sin tocar los ~70 call sites de
app.py que ya los usan como Path. Middleware verifica el ID token de Firebase,
busca la biblioteca de la persona en Firestore y la deja en un ContextVar; los
proxies de abajo resuelven la subcarpeta correspondiente en cada acceso.

Sin token válido (uso local con `run.sh`, o smoke tests) cae en la carpeta
raíz de siempre: así no se rompe el flujo local existente.
"""
from __future__ import annotations

from contextvars import ContextVar
from pathlib import Path

import firebase_admin
from firebase_admin import auth as fb_auth, firestore

try:
    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    _FIREBASE_OK = True
except Exception:
    # Sin credenciales (desarrollo local con run.sh): cae a modo sin-biblioteca,
    # igual que el comportamiento de siempre.
    _FIREBASE_OK = False

biblioteca_actual: ContextVar[str | None] = ContextVar("biblioteca_actual", default=None)
persona_actual: ContextVar[str | None] = ContextVar("persona_actual", default=None)

_cache_biblioteca: dict[str, str | None] = {}


def _biblioteca_de(uid: str) -> str | None:
    if uid in _cache_biblioteca:
        return _cache_biblioteca[uid]
    doc = firestore.client().collection("personas").document(uid).get()
    ids = doc.to_dict().get("bibliotecaIds") or [] if doc.exists else []
    bib = ids[0] if ids else None
    _cache_biblioteca[uid] = bib
    return bib


async def middleware_biblioteca(request, call_next):
    if not _FIREBASE_OK:
        return await call_next(request)
    header = request.headers.get("authorization", "")
    bib = None
    token_persona = persona_actual.set(None)
    if header.startswith("Bearer "):
        try:
            decoded = fb_auth.verify_id_token(header[7:])
            persona_actual.reset(token_persona)
            token_persona = persona_actual.set(decoded["uid"])
            bib = _biblioteca_de(decoded["uid"])
        except Exception:
            bib = None
    token_bib = biblioteca_actual.set(bib)
    try:
        return await call_next(request)
    finally:
        biblioteca_actual.reset(token_bib)
        persona_actual.reset(token_persona)


class _DirectorioPorBiblioteca:
    """Se comporta como un Path, pero resuelve a <raiz>/<bibliotecaId> por request."""

    def __init__(self, raiz: Path):
        self._raiz = raiz

    def _resuelta(self) -> Path:
        bib = biblioteca_actual.get()
        destino = self._raiz / bib if bib else self._raiz
        destino.mkdir(parents=True, exist_ok=True)
        return destino

    def __truediv__(self, other):
        return self._resuelta() / other

    def __fspath__(self):
        return str(self._resuelta())

    def __str__(self):
        return str(self._resuelta())

    def __getattr__(self, name):
        return getattr(self._resuelta(), name)
