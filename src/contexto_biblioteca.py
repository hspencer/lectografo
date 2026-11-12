"""
Resuelve GRAFOS/TRANSCRIPTS por biblioteca sin tocar los ~70 call sites de
app.py que ya los usan como Path. Middleware verifica el ID token de Firebase,
busca la biblioteca de la persona en Firestore y la deja en un ContextVar; los
proxies de abajo resuelven la subcarpeta correspondiente en cada acceso.

Sin token válido (uso local con `run.sh`, o smoke tests) cae en la carpeta
raíz de siempre: así no se rompe el flujo local existente.
"""
from __future__ import annotations

import os
import re
from contextvars import ContextVar
from pathlib import Path

import firebase_admin
from fastapi import HTTPException
from fastapi.responses import JSONResponse
from firebase_admin import auth as fb_auth, firestore

# K_SERVICE lo setea Cloud Run automaticamente; no existe en local (run.sh).
# Con el servicio publico (allUsers invoker), esto es lo unico que impide
# que cualquiera sin sesion lea/escriba la carpeta raiz (datos legacy).
_EN_CLOUD_RUN = bool(os.environ.get("K_SERVICE"))

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
es_admin_actual: ContextVar[bool] = ContextVar("es_admin_actual", default=False)

_cache_persona: dict[str, tuple[str | None, bool]] = {}

# Rutas por-slug cuyo dueño puede no ser quien pide: si hay un permiso
# compartido para (uid, slug), el request completo pasa a resolver GRAFOS/
# TRANSCRIPTS contra la biblioteca de origen del permiso, no la propia.
_RE_SLUG_EN_PATH = re.compile(
    r"^/api/(?:extracciones|validacion|grafo|metadatos|transcripts)/([^/]+)"
)
_cache_permiso: dict[tuple[str, str], str | None] = {}


def _biblioteca_compartida(uid: str, slug: str) -> str | None:
    """bibliotecaOrigen si existe un permisos/{...} que comparte `slug` con
    `uid`; None si el slug no fue compartido con esta persona."""
    clave = (uid, slug)
    if clave in _cache_permiso:
        return _cache_permiso[clave]
    docs = (
        firestore.client().collection("permisos")
        .where("beneficiariaUid", "==", uid).where("slug", "==", slug)
        .limit(1).get()
    )
    resultado = docs[0].to_dict().get("bibliotecaOrigen") if docs else None
    _cache_permiso[clave] = resultado
    return resultado


def otorgar_permiso(biblioteca_origen: str, slug: str, beneficiaria_uid: str,
                     beneficiaria_email: str, otorgado_por: str) -> None:
    from datetime import datetime, timezone
    firestore.client().collection("permisos").add({
        "bibliotecaOrigen": biblioteca_origen,
        "slug": slug,
        "beneficiariaUid": beneficiaria_uid,
        "beneficiariaEmail": beneficiaria_email,
        "otorgadoPor": otorgado_por,
        "otorgadoEn": datetime.now(timezone.utc),
    })
    _cache_permiso.pop((beneficiaria_uid, slug), None)


def permisos_compartidos_conmigo(uid: str) -> list[dict]:
    docs = firestore.client().collection("permisos").where("beneficiariaUid", "==", uid).get()
    return [d.to_dict() for d in docs]


def emails_con_acceso(biblioteca_origen: str, slug: str) -> list[str]:
    """Emails de todas las personas con quien se compartió este texto --
    la jerarquía de colaboración es plana, así que esto es lo único que
    distingue a quien lo comparte de quien lo recibió."""
    docs = (
        firestore.client().collection("permisos")
        .where("bibliotecaOrigen", "==", biblioteca_origen).where("slug", "==", slug)
        .get()
    )
    return [d.to_dict().get("beneficiariaEmail", "") for d in docs]


def nombre_de_biblioteca(biblioteca_id: str) -> str:
    doc = firestore.client().collection("bibliotecas").document(biblioteca_id).get()
    return (doc.to_dict() or {}).get("nombre", "") if doc.exists else ""


def _doc_publicacion(biblioteca_origen: str, slug: str):
    docs = (
        firestore.client().collection("publicaciones")
        .where("bibliotecaOrigen", "==", biblioteca_origen).where("slug", "==", slug)
        .limit(1).get()
    )
    return docs[0] if docs else None


def publicar_texto(biblioteca_origen: str, slug: str, publicado_por: str) -> str:
    """Id público del texto (crea uno si no existía ya)."""
    existente = _doc_publicacion(biblioteca_origen, slug)
    if existente:
        return existente.id
    from datetime import datetime, timezone
    ref = firestore.client().collection("publicaciones").document()
    ref.set({
        "bibliotecaOrigen": biblioteca_origen, "slug": slug,
        "publicadoPor": publicado_por, "publicadoEn": datetime.now(timezone.utc),
    })
    return ref.id


def despublicar_texto(biblioteca_origen: str, slug: str) -> bool:
    doc = _doc_publicacion(biblioteca_origen, slug)
    if not doc:
        return False
    doc.reference.delete()
    return True


def estado_publicacion(biblioteca_origen: str, slug: str) -> str | None:
    doc = _doc_publicacion(biblioteca_origen, slug)
    return doc.id if doc else None


def resolver_publicacion(pub_id: str) -> tuple[str, str]:
    doc = firestore.client().collection("publicaciones").document(pub_id).get()
    if not doc.exists:
        raise HTTPException(404, "Esta publicación no existe o fue retirada")
    d = doc.to_dict()
    return d["bibliotecaOrigen"], d["slug"]


def _datos_persona(uid: str) -> tuple[str | None, bool]:
    """(bibliotecaId principal, esAdmin) -- una sola lectura de Firestore por uid."""
    if uid in _cache_persona:
        return _cache_persona[uid]
    doc = firestore.client().collection("personas").document(uid).get()
    datos = doc.to_dict() or {} if doc.exists else {}
    ids = datos.get("bibliotecaIds") or []
    resultado = (ids[0] if ids else None, datos.get("esAdmin") is True)
    _cache_persona[uid] = resultado
    return resultado


_PREFIJO_PUBLICO = "/api/publico/"


async def middleware_biblioteca(request, call_next):
    if not _FIREBASE_OK:
        return await call_next(request)
    if request.url.path.startswith(_PREFIJO_PUBLICO):
        # Lectura pública: el propio endpoint resuelve su biblioteca a partir
        # del id de publicación (ver resolver_publicacion), sin exigir sesión.
        return await call_next(request)
    header = request.headers.get("authorization", "")
    # EventSource no permite headers custom; las 3 rutas /stream mandan el
    # ID token como query param en vez de Authorization.
    crudo = header[7:] if header.startswith("Bearer ") else request.query_params.get("token")
    bib = None
    admin = False
    autenticado = False
    token_persona = persona_actual.set(None)
    if crudo:
        try:
            decoded = fb_auth.verify_id_token(crudo)
            persona_actual.reset(token_persona)
            token_persona = persona_actual.set(decoded["uid"])
            bib, admin = _datos_persona(decoded["uid"])
            autenticado = True
            m = _RE_SLUG_EN_PATH.match(request.url.path)
            if m:
                # Compartir es plano: quien recibe el acceso queda en las
                # mismas condiciones que la dueña, sin distinción de rol.
                compartida = _biblioteca_compartida(decoded["uid"], m.group(1))
                if compartida:
                    bib = compartida
        except Exception:
            bib = None
    if _EN_CLOUD_RUN and not autenticado:
        persona_actual.reset(token_persona)
        return JSONResponse({"detail": "No autenticado"}, status_code=401)
    token_bib = biblioteca_actual.set(bib)
    token_admin = es_admin_actual.set(admin)
    try:
        return await call_next(request)
    finally:
        biblioteca_actual.reset(token_bib)
        persona_actual.reset(token_persona)
        es_admin_actual.reset(token_admin)


def exigir_admin() -> None:
    """Solo se exige en Cloud Run -- mismo criterio que el 401 de arriba.
    En local (run.sh, sin K_SERVICE) no hay nadie a quien exigirle nada."""
    if _EN_CLOUD_RUN and not es_admin_actual.get():
        raise HTTPException(403, "Solo la administradora puede ver o cambiar la configuración del modelo.")


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
