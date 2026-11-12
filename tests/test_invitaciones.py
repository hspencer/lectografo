import copy
from datetime import datetime, timedelta, timezone
import smtplib
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import SecretStr

from src import app as api, contexto_biblioteca as contexto, invitaciones

CORREO_SMTP_REAL = invitaciones.correo_smtp


class Documento:
    def __init__(self, datos, clave):
        self.datos, self.id = datos, clave

    def get(self):
        valor = copy.deepcopy(self.datos.get(self.id))
        return SimpleNamespace(to_dict=lambda: valor)

    def set(self, datos):
        self.datos[self.id] = copy.deepcopy(datos)

    def update(self, datos):
        self.datos[self.id].update(copy.deepcopy(datos))


class InvitacionesTest(unittest.TestCase):
    def setUp(self):
        self.datos = {"invitaciones": {}, "permisos": {}}
        self.db = SimpleNamespace(collection=lambda nombre: SimpleNamespace(
            document=lambda clave: Documento(self.datos[nombre], clave)))
        self.smtp = MagicMock()
        self.enterContext(patch.object(invitaciones.firestore, "client", return_value=self.db))
        self.correo = self.enterContext(patch.object(invitaciones, "correo_smtp"))
        self.correo.return_value.__enter__.return_value = self.smtp
        self.enterContext(patch.object(invitaciones.settings, "smtp_from", "invitaciones@example.org"))
        self.enterContext(patch.object(contexto, "_FIREBASE_OK", True))
        self.enterContext(patch.object(contexto, "_EN_CLOUD_RUN", True))
        self.enterContext(patch.object(contexto, "_datos_persona", return_value=("biblioteca", False)))
        self.enterContext(patch.object(contexto.fb_auth, "get_user_by_email", side_effect=AssertionError("No requiere cuenta previa")))

        def verificar(token):
            return {"uid": token, "name": "Herbert", "email": {
                "invitada": "nueva@example.org", "otra": "otra@example.org",
                "sin_verificar": "nueva@example.org", "nueva_uid": "nueva@example.org",
            }.get(token, "herbert@example.org"), "email_verified": token != "sin_verificar"}

        self.enterContext(patch.object(contexto.fb_auth, "verify_id_token", side_effect=verificar))
        self.resolver = self.enterContext(patch.object(api, "_resolver_biblioteca_de_slug", return_value="origen"))
        self.enterContext(patch.object(api, "_cargar_o_crear", return_value=(SimpleNamespace(titulo="Timeo"), None)))
        self.client = self.enterContext(TestClient(api.app))

    def request(self, uid, method, path, **kwargs):
        return self.client.request(method, path, headers={"Authorization": f"Bearer {uid}"}, **kwargs)

    def invitar(self, emails=None):
        r = self.request("herbert", "POST", "/api/invitaciones", json={
            "slug": "timeo", "emails": emails or ["nueva@example.org"],
        })
        self.assertEqual(r.status_code, 200, r.text)
        return r

    def test_varias_personas_sin_cuenta_mensajes_privados_y_aceptacion(self):
        r = self.invitar([" NUEVA@example.org ", "otra@example.org", "nueva@example.org"])
        self.assertEqual(len(r.json()["resultados"]), 2)
        self.assertEqual(self.smtp.send_message.call_count, 2)
        for llamada in self.smtp.send_message.call_args_list:
            mensaje = llamada.args[0]
            self.assertNotIn("Cc", mensaje)
            self.assertNotIn("Bcc", mensaje)
            self.assertIn(str(mensaje["To"]), mensaje.get_content())
            self.assertIn("Timeo", mensaje.get_content())
            self.assertIn("/#invitacion:", mensaje.get_content())
        self.assertFalse(self.datos["permisos"], "El correo por sí solo no da acceso")
        token = next(k for k, v in self.datos["invitaciones"].items() if v["destinatariaEmail"] == "nueva@example.org")
        info = self.client.get(f"/api/publico/invitaciones/{token}")
        self.assertEqual(info.json()["email"], "nueva@example.org")
        self.assertEqual(self.client.post(f"/api/invitaciones/{token}/aceptar").status_code, 401)
        for uid in ("otra", "sin_verificar"):
            self.assertEqual(self.request(uid, "POST", f"/api/invitaciones/{token}/aceptar",
                                         json={"email": "nueva@example.org"}).status_code, 403)
        self.assertFalse(self.datos["permisos"])
        for _ in range(2):
            aceptada = self.request("invitada", "POST", f"/api/invitaciones/{token}/aceptar")
            self.assertEqual(aceptada.json(), {"slug": "timeo", "titulo": "Timeo"})
        self.assertEqual(len(self.datos["permisos"]), 1)
        permiso = next(iter(self.datos["permisos"].values()))
        self.assertEqual((permiso["bibliotecaOrigen"], permiso["beneficiariaUid"]), ("origen", "invitada"))
        self.assertEqual(self.request("nueva_uid", "POST", f"/api/invitaciones/{token}/aceptar").status_code, 403)

    def test_envio_parcial_informa_a_quien_fallo(self):
        self.smtp.send_message.side_effect = [None, smtplib.SMTPRecipientsRefused({"otra@example.org": (550, "rechazado")})]
        estados = self.invitar(["nueva@example.org", "otra@example.org"]).json()["resultados"]
        self.assertEqual([e["estado"] for e in estados], ["enviada", "error"])
        token = next(k for k, v in self.datos["invitaciones"].items() if v["estado"] == "error_envio")
        self.assertEqual(self.client.get(f"/api/publico/invitaciones/{token}").status_code, 404)

    def test_vencimiento_y_correo_invalido(self):
        self.invitar()
        token, invitacion = next(iter(self.datos["invitaciones"].items()))
        invitacion["venceEn"] = datetime.now(timezone.utc) - timedelta(seconds=1)
        self.assertEqual(self.client.get(f"/api/publico/invitaciones/{token}").status_code, 410)
        self.assertEqual(self.request("invitada", "POST", f"/api/invitaciones/{token}/aceptar").status_code, 410)
        for email in ("sin-arroba", "a@example.org\r\nBcc: b@example.org", "a@x..com"):
            r = self.request("herbert", "POST", "/api/invitaciones", json={"slug": "timeo", "emails": [email]})
            self.assertEqual(r.status_code, 422, r.text)

    def test_sin_acceso_no_puede_invitar(self):
        self.resolver.side_effect = HTTPException(404, "Sin acceso")
        r = self.request("otra", "POST", "/api/invitaciones", json={"slug": "timeo", "emails": ["nueva@example.org"]})
        self.assertEqual(r.status_code, 404)
        self.smtp.send_message.assert_not_called()
        self.assertFalse(self.datos["invitaciones"])

    def test_smtp_real_exige_configuracion_y_tls(self):
        with patch.object(invitaciones.settings, "smtp_host", None):
            with self.assertRaises(HTTPException) as error:
                with CORREO_SMTP_REAL():
                    self.fail("No debe conectar sin configuración")
            self.assertEqual(error.exception.status_code, 503)
        for puerto in (465, 587):
            with patch.object(invitaciones.settings, "smtp_host", "smtp.example.org"), \
                    patch.object(invitaciones.settings, "smtp_port", puerto), \
                    patch.object(invitaciones.settings, "smtp_user", "test"), \
                    patch.object(invitaciones.settings, "smtp_password", SecretStr("solo-prueba")), \
                    patch.object(invitaciones.smtplib, "SMTP_SSL") as ssl_cliente, \
                    patch.object(invitaciones.smtplib, "SMTP") as tls_cliente:
                fabrica = ssl_cliente if puerto == 465 else tls_cliente
                with CORREO_SMTP_REAL() as cliente:
                    self.assertIs(cliente, fabrica.return_value)
                cliente.login.assert_called_once_with("test", "solo-prueba")
                self.assertEqual(cliente.starttls.call_count, 1 if puerto == 587 else 0)


if __name__ == "__main__":
    unittest.main()
