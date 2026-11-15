"""Salida individual y borrado final, sin red ni datos de producción."""
import contextvars
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
import unittest

from src import app as api, acceso_texto as acceso, invitaciones
import test_colaboracion


class SalidaTest(unittest.TestCase):
    setUp = test_colaboracion.ColaboracionTest.setUp
    request = test_colaboracion.ColaboracionTest.request
    compartir = test_colaboracion.ColaboracionTest.compartir

    def salir(self, uid, confirmar=False):
        return self.request(uid, "DELETE", f"/api/transcripts/lectura?confirmar_borrado={str(confirmar).lower()}")

    def test_sale_quien_subio_conserva_grafo_glosas_y_terceros(self):
        self.compartir("a", "b")
        self.compartir("b", "c")
        publicacion = self.request("a", "POST", "/api/publicar", json={"slug": "lectura"}).json()["id"]
        original = self.ruta.read_bytes()
        self.assertEqual(self.salir("a").json(), {"ok": True, "eliminado_definitivamente": False})
        self.assertEqual(self.ruta.read_bytes(), original)
        self.assertEqual(self.request("b", "GET", f"/api/publico/{publicacion}").status_code, 200)
        self.assertEqual(self.request("a", "GET", "/api/extracciones").json(), [])
        for method, url in [("GET", "/api/transcripts/lectura"),
                            ("GET", "/api/validacion/lectura"),
                            ("PATCH", "/api/metadatos/lectura")]:
            self.assertEqual(self.request("a", method, url, json={}).status_code, 404)
        self.assertEqual(self.request("a", "POST", "/api/compartir", json={"slug": "lectura", "email": "d@example.org"}).status_code, 404)
        for uid in "bc":
            self.assertEqual(self.request(uid, "GET", "/api/transcripts/lectura").status_code, 200)
        self.assertEqual(set(self.request("b", "GET", "/api/compartir/lectura").json()["emails"]),
                         {"b@example.org", "c@example.org"})
        self.salir("b")
        self.assertEqual(self.request("c", "GET", "/api/validacion/lectura").status_code, 200)
        self.assertEqual(self.salir("c").status_code, 409, "Exige nueva confirmación si ahora soy la última persona")
        self.assertTrue(self.request("c", "GET", "/api/transcripts/lectura/salida").json()["ultima_persona"])
        self.assertEqual(self.salir("c", True).status_code, 200)
        self.assertFalse(self.ruta.exists())

    def test_permisos_duplicados_y_enlace_aceptado_no_restauran_acceso(self):
        self.compartir("a", "b")
        self.compartir("a", "b")
        token = "x" * 43
        self.db.collection("invitaciones").document(token).set({
            "bibliotecaOrigen": "bib_a", "slug": "lectura", "titulo": "Lectura",
            "destinatariaEmail": "b@example.org", "estado": "aceptada", "aceptadaPor": "b",
            "invitadoPor": "a", "venceEn": datetime.now(timezone.utc) + timedelta(days=1),
        })
        self.assertFalse(self.request("b", "GET", "/api/transcripts/lectura/salida").json()["ultima_persona"])
        self.assertEqual(self.salir("b").status_code, 200)
        self.assertFalse(self.documentos["permisos"])
        with self.assertRaises(Exception) as error:
            invitaciones.aceptar_invitacion(token, "b", "b@example.org")
        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(self.request("b", "GET", "/api/transcripts/lectura").status_code, 404)
        self.compartir("a", "b")
        self.assertEqual(self.request("b", "GET", "/api/transcripts/lectura").status_code, 200)

    def test_borrado_final_limpia_publicaciones_invitaciones_y_todos_los_archivos(self):
        publicacion = self.request("a", "POST", "/api/publicar", json={"slug": "lectura"}).json()["id"]
        for suf in ("grafo", "reconexion", "consolidacion", "metadatos"):
            self.ruta.with_name(f"lectura_{suf}.json").write_text("{}")
        token = "y" * 43
        self.db.collection("invitaciones").document(token).set({
            "bibliotecaOrigen": "bib_a", "slug": "lectura", "estado": "enviada",
            "destinatariaEmail": "nueva@example.org", "venceEn": datetime.now(timezone.utc) + timedelta(days=1),
        })
        self.assertEqual(self.salir("a").status_code, 409)
        self.assertTrue(self.ruta.exists())
        self.assertEqual(self.salir("a", True).status_code, 200)
        self.assertFalse(list(self.ruta.parent.glob("lectura_*.json")))
        self.assertFalse(self.documentos["publicaciones"])
        self.assertEqual(self.documentos["invitaciones"][token]["estado"], "invalidada")
        self.assertEqual(self.request("a", "GET", f"/api/publico/{publicacion}").status_code, 404)
        nuevo = self.request("a", "POST", "/api/transcripts", json={"nombre": "lectura.txt", "contenido": "Otro texto"})
        self.assertEqual(nuevo.status_code, 200, nuevo.text)
        self.assertEqual(self.request("a", "GET", f"/api/publico/{publicacion}").status_code, 404)
        self.assertEqual(self.request("a", "GET", f"/api/publico/invitaciones/{token}").status_code, 404)

    def test_operacion_concurrente_impide_borrado_y_tarea_vencida_no_guarda(self):
        with acceso.operacion_texto("bib_a", "lectura", "a") as op:
            respuesta = contextvars.Context().run(self.salir, "a", True)
            self.assertEqual(respuesta.status_code, 409)
            self.assertTrue(self.ruta.exists())
            op["ref"].update({"bloqueoHasta": datetime.now(timezone.utc) - timedelta(seconds=1)})
            with self.assertRaises(Exception) as error:
                acceso.verificar_operacion()
            self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.salir("a", True).status_code, 200)

    def test_aceptar_y_borrar_no_pueden_entrelazarse(self):
        token = "z" * 43
        self.db.collection("invitaciones").document(token).set({
            "bibliotecaOrigen": "bib_a", "slug": "lectura", "titulo": "Lectura",
            "destinatariaEmail": "b@example.org", "estado": "enviada", "invitadoPor": "a",
            "venceEn": datetime.now(timezone.utc) + timedelta(days=1),
        })
        with acceso.operacion_texto("bib_a", "lectura", "a"):
            with self.assertRaises(Exception) as error:
                contextvars.Context().run(invitaciones.aceptar_invitacion, token, "b", "b@example.org")
            self.assertEqual(error.exception.status_code, 409)
        invitaciones.aceptar_invitacion(token, "b", "b@example.org")
        self.assertFalse(self.request("a", "GET", "/api/transcripts/lectura/salida").json()["ultima_persona"])
        self.assertFalse(self.salir("a", True).json()["eliminado_definitivamente"])
        self.assertTrue(self.ruta.exists())

    def test_limpieza_fallida_se_puede_reintentar_sin_publicar_exito(self):
        original = Path.unlink
        def fallar(ruta, *args, **kwargs):
            if ruta == self.ruta:
                raise OSError("Fallo de disco simulado")
            return original(ruta, *args, **kwargs)
        with patch.object(Path, "unlink", fallar), self.assertRaises(OSError):
            self.salir("a", True)
        self.assertEqual(self.request("a", "GET", "/api/validacion/lectura").status_code, 404)
        self.assertEqual(self.salir("a", True).status_code, 200)
        self.assertFalse(self.ruta.exists())

    def test_texto_recibido_sin_procesar_tambien_se_puede_retirar(self):
        self.ruta.unlink()
        self.ruta.with_name("lectura_extraccion.json").unlink()
        self.compartir("a", "b")
        self.assertTrue(any(t["slug"] == "lectura" and not t["procesado"]
                            for t in self.request("b", "GET", "/api/extracciones").json()))
        self.assertEqual(self.salir("b").status_code, 200)
        self.assertTrue(self.request("a", "GET", "/api/extracciones").json())


if __name__ == "__main__":
    unittest.main()
