"""Invitaciones por correo: no requieren una cuenta previa."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from email.headerregistry import Address
from email.message import EmailMessage
from email.errors import HeaderParseError, MessageDefect
import secrets
import smtplib
import ssl

from fastapi import HTTPException
from firebase_admin import firestore

from src.config import settings
from src.contexto_biblioteca import otorgar_permiso

VIGENCIA = timedelta(days=14)


def normalizar_email(email: str) -> str:
    email = email.strip().lower()
    try:
        direccion = Address(addr_spec=email)
        if (not direccion.username or "." not in direccion.domain
                or len(email) > 254 or any(c.isspace() for c in email)):
            raise ValueError()
    except (ValueError, IndexError, HeaderParseError, MessageDefect) as exc:
        raise HTTPException(422, f"Correo no válido: {email}") from exc
    return email


@contextmanager
def correo_smtp():
    if not all((settings.smtp_host, settings.smtp_user, settings.smtp_password, settings.smtp_from)):
        raise HTTPException(503, "El envío de invitaciones por correo todavía no está configurado.")
    if settings.smtp_port not in (465, 587):
        raise HTTPException(503, "El correo requiere SMTP con TLS en el puerto 465 o 587.")
    contexto = ssl.create_default_context()
    if settings.smtp_port == 465:
        cliente = smtplib.SMTP_SSL(settings.smtp_host, 465, timeout=20, context=contexto)
    else:
        cliente = smtplib.SMTP(settings.smtp_host, 587, timeout=20)
    with cliente:
        if settings.smtp_port == 587:
            cliente.starttls(context=contexto)
        cliente.login(settings.smtp_user, settings.smtp_password.get_secret_value())
        yield cliente


def enviar_invitaciones(biblioteca: str, slug: str, titulo: str, emails: list[str],
                        uid: str, nombre: str) -> list[dict]:
    """Una conexión SMTP, un mensaje privado por destinatario; informa fallos parciales."""
    resultados = []
    try:
        with correo_smtp() as cliente:
            for email in emails:
                ref = firestore.client().collection("invitaciones").document(secrets.token_urlsafe(32))
                ahora = datetime.now(timezone.utc)
                invitacion = {
                    "bibliotecaOrigen": biblioteca, "slug": slug, "titulo": titulo,
                    "destinatariaEmail": email, "invitadoPor": uid, "invitadoNombre": nombre,
                    "creadaEn": ahora, "venceEn": ahora + VIGENCIA, "estado": "preparada",
                }
                ref.set(invitacion)
                link = f"{settings.app_url.rstrip('/')}/#invitacion:{ref.id}"
                mensaje = EmailMessage()
                mensaje["From"] = Address(display_name="Lectógrafo", addr_spec=settings.smtp_from)
                mensaje["To"] = email
                mensaje["Subject"] = "Invitación a «" + " ".join(titulo.splitlines()) + "» en Lectógrafo"
                mensaje.set_content(
                    f"{nombre} te invita a colaborar en «{titulo}» en Lectógrafo.\n\n"
                    f"Abre este enlace e inicia sesión con Google usando exactamente el correo {email}:\n{link}\n\n"
                    "No necesitas haber ingresado antes. Al autenticarte, se abrirá directamente el texto y su mapa conceptual.\n\n"
                    "Podrás enriquecer el mismo grafo con conceptos y relaciones, añadir glosas con tu autoría "
                    "y compartirlo con otras personas.\n\n"
                    "Si tienes varias cuentas, elige la que recibió esta invitación. "
                    "Puedes aceptar esta invitación durante los próximos 14 días. "
                    "Si no esperabas esta invitación, puedes ignorarla.\n"
                )
                try:
                    cliente.send_message(mensaje)
                except (smtplib.SMTPException, OSError):
                    ref.update({"estado": "error_envio"})
                    resultados.append({"email": email, "estado": "error", "mensaje": "El servicio no aceptó el correo."})
                    continue
                ref.update({"estado": "enviada", "enviadaEn": datetime.now(timezone.utc)})
                resultados.append({"email": email, "estado": "enviada"})
    except (smtplib.SMTPException, OSError) as exc:
        if not resultados:
            raise HTTPException(502, "No se pudo conectar con el servicio de correo. No se enviaron invitaciones.") from exc
        return resultados
    return resultados


def cargar_invitacion(token: str) -> tuple:
    if len(token) != 43 or not all(c.isalnum() or c in "-_" for c in token):
        raise HTTPException(404, "La invitación no existe.")
    ref = firestore.client().collection("invitaciones").document(token)
    datos = ref.get().to_dict()
    if not datos or datos.get("estado") not in ("preparada", "enviada", "aceptada"):
        raise HTTPException(404, "La invitación no existe o no pudo enviarse.")
    if datos["estado"] != "aceptada" and datos["venceEn"] <= datetime.now(timezone.utc):
        raise HTTPException(410, "Esta invitación venció. Pide que te envíen una nueva.")
    return ref, datos


def aceptar_invitacion(token: str, uid: str, correo_verificado: str | None) -> dict:
    ref, datos = cargar_invitacion(token)
    if not correo_verificado or normalizar_email(correo_verificado) != datos["destinatariaEmail"]:
        raise HTTPException(403, "Inicia sesión con el correo que recibió la invitación.")
    if datos.get("aceptadaPor") not in (None, uid):
        raise HTTPException(403, "Esta invitación ya fue aceptada por otra cuenta.")
    if datos["estado"] != "aceptada":
        # La misma invitación siempre escribe el mismo permiso, también ante reintentos.
        otorgar_permiso(datos["bibliotecaOrigen"], datos["slug"], uid,
                        datos["destinatariaEmail"], datos["invitadoPor"], permiso_id=f"inv_{token}")
        ref.update({"estado": "aceptada", "aceptadaPor": uid, "aceptadaEn": datetime.now(timezone.utc)})
    return {"slug": datos["slug"], "titulo": datos["titulo"]}
