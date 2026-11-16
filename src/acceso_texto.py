"""Acceso por texto y exclusión entre operaciones, también entre instancias."""
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import uuid

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from firebase_admin import firestore

operacion_actual = ContextVar("operacion_texto", default=None)


def referencia(biblioteca, slug):
    clave = sha256(f"{biblioteca}\0{slug}".encode()).hexdigest()
    return firestore.client().collection("accesos_texto").document(clave)


def datos_acceso(biblioteca, slug):
    return referencia(biblioteca, slug).get().to_dict()


def personas_legacy(biblioteca, slug):
    db = firestore.client()
    bib = db.collection("bibliotecas").document(biblioteca).get().to_dict() or {}
    personas = {}
    uid = bib.get("creadoPor")
    if uid:
        p = db.collection("personas").document(uid).get().to_dict() or {}
        personas[uid] = p.get("email") or p.get("nombre") or uid
    for d in documentos("permisos", biblioteca, slug):
        p = d.to_dict()
        personas[p["beneficiariaUid"]] = p.get("beneficiariaEmail") or p["beneficiariaUid"]
    return personas


def documentos(coleccion, biblioteca, slug):
    return (firestore.client().collection(coleccion)
            .where("bibliotecaOrigen", "==", biblioteca).where("slug", "==", slug).get())


def tiene_acceso(biblioteca, slug, uid):
    datos = datos_acceso(biblioteca, slug)
    if datos is None:
        return True  # La resolución legacy ya limita a biblioteca propia o permiso.
    return datos["estado"] == "activo" and uid in datos["personas"]


def accesos(biblioteca, slugs, uid):
    """tiene_acceso para muchos textos en una sola ida a Firestore."""
    slugs = list(slugs)
    db = firestore.client()
    refs = [referencia(biblioteca, slug) for slug in slugs]
    if hasattr(db, "get_all"):
        por_id = {snap.id: snap.to_dict() for snap in db.get_all(refs)}
        datos = [por_id.get(ref.id) for ref in refs]
    else:
        datos = [ref.get().to_dict() for ref in refs]
    return {slug: d is None or (d["estado"] == "activo" and uid in d["personas"])
            for slug, d in zip(slugs, datos)}


def exigir_acceso(biblioteca, slug, uid):
    if not tiene_acceso(biblioteca, slug, uid):
        raise HTTPException(404, "Este texto ya no está en tu biblioteca.")


@contextmanager
def operacion_texto(biblioteca, slug, uid=None, nuevo=False, reintentar_borrado=False):
    actual = operacion_actual.get()
    if actual and actual["biblioteca"] == biblioteca and actual["slug"] == slug:
        yield actual
        return
    ref = referencia(biblioteca, slug)
    iniciales = personas_legacy(biblioteca, slug) if nuevo or ref.get().to_dict() is None else {}
    identificador = uuid.uuid4().hex

    @firestore.transactional
    def adquirir(tx):
        datos = ref.get(transaction=tx).to_dict()
        ahora = datetime.now(timezone.utc)
        if datos and datos.get("bloqueoHasta") and datos["bloqueoHasta"] > ahora:
            raise HTTPException(409, "Hay una operación en curso sobre este texto. Espera a que termine e inténtalo de nuevo.")
        if nuevo:
            if datos and datos["estado"] != "eliminado":
                raise HTTPException(409, "Este texto ya existe, aunque no esté en tu biblioteca.")
            datos = {"estado": "activo", "personas": {uid: iniciales.get(uid, uid)}}
        elif datos is None:
            datos = {"estado": "activo", "personas": iniciales}
        if datos["estado"] != "activo" and not (reintentar_borrado and datos["estado"] == "eliminando"):
            raise HTTPException(404, "Este texto fue eliminado.")
        if uid and uid not in datos["personas"] and not nuevo:
            raise HTTPException(404, "Este texto ya no está en tu biblioteca.")
        datos.update(bloqueo=identificador, bloqueoHasta=ahora + timedelta(hours=1))
        tx.set(ref, datos)
        return datos

    datos = adquirir(firestore.client().transaction())
    operacion = {"biblioteca": biblioteca, "slug": slug, "ref": ref,
                 "id": identificador, "datos": datos, "transferida": False}
    token = operacion_actual.set(operacion)
    try:
        yield operacion
    except Exception:
        if nuevo:
            ref.update({"estado": "eliminado", "personas": {}})
        raise
    finally:
        operacion_actual.reset(token)
        if not operacion["transferida"]:
            liberar_operacion(operacion)


def liberar_operacion(operacion):
    @firestore.transactional
    def liberar(tx):
        ref = operacion["ref"]
        datos = ref.get(transaction=tx).to_dict()
        if datos and datos.get("bloqueo") == operacion["id"]:
            tx.update(ref, {"bloqueo": None, "bloqueoHasta": None})
    liberar(firestore.client().transaction())


def verificar_operacion():
    """Una tarea que agotó su reserva no puede guardar después de un borrado."""
    operacion = operacion_actual.get()
    if not operacion:
        return
    datos = operacion["ref"].get().to_dict()
    if (not datos or datos.get("bloqueo") != operacion["id"]
            or datos["estado"] != "activo"
            or datos["bloqueoHasta"] <= datetime.now(timezone.utc) + timedelta(minutes=1)):
        raise HTTPException(409, "La operación sobre este texto ya no está vigente.")


def retirar_acceso(op, uid, ultima):
    bib, slug, ref = op["biblioteca"], op["slug"], op["ref"]
    personas = {p: email for p, email in op["datos"]["personas"].items() if p != uid}
    # El estado intermedio permite reintentar una limpieza fallida sin dar acceso.
    if ultima:
        ref.update({"estado": "eliminando"})
    acciones = []
    for d in documentos("permisos", bib, slug):
        if ultima or d.to_dict()["beneficiariaUid"] == uid:
            acciones.append((d.reference, None))
    for d in documentos("invitaciones", bib, slug):
        if ultima or d.to_dict().get("aceptadaPor") == uid:
            acciones.append((d.reference, {"estado": "invalidada" if ultima else "retirada"}))
    if ultima:
        acciones.extend((d.reference, None) for d in documentos("publicaciones", bib, slug))
    for inicio in range(0, len(acciones), 400):
        batch = firestore.client().batch()
        for referencia_doc, cambio in acciones[inicio:inicio + 400]:
            if cambio is None:
                batch.delete(referencia_doc)
            else:
                batch.update(referencia_doc, cambio)
        batch.commit()
    if not ultima:
        ref.update({"personas": personas})


class OperacionesTextoMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        from src.contexto_biblioteca import _RE_SLUG_EN_PATH, biblioteca_actual, persona_actual
        uid, bib = persona_actual.get(), biblioteca_actual.get()
        m = _RE_SLUG_EN_PATH.match(scope.get("path", ""))
        if scope["type"] != "http" or not uid or not bib or not m:
            return await self.app(scope, receive, send)
        slug = m.group(1)
        try:
            borrado = scope["path"] == f"/api/transcripts/{slug}" and scope["method"] == "DELETE"
            salida = scope["path"] == f"/api/transcripts/{slug}/salida"
            datos = datos_acceso(bib, slug)
            reintento = datos and datos["estado"] == "eliminando" and uid in datos["personas"] and (borrado or salida)
            if datos and not reintento and (datos["estado"] != "activo" or uid not in datos["personas"]):
                raise HTTPException(404, "Este texto ya no está en tu biblioteca.")
            cancelar = scope["method"] == "DELETE" and scope["path"].endswith(("/procesar", "/reconexion/sesion", "/consolidacion/sesion"))
            if scope["method"] in {"GET", "HEAD", "OPTIONS"} or cancelar:
                return await self.app(scope, receive, send)
            with operacion_texto(bib, slug, uid, reintentar_borrado=borrado):
                return await self.app(scope, receive, send)
        except HTTPException as exc:
            await JSONResponse({"detail": exc.detail}, status_code=exc.status_code)(scope, receive, send)
