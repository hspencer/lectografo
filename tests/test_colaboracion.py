"""Contrato de colaboración; Firestore y Firebase Auth se simulan, sin red."""
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from src import app as api
from src import contexto_biblioteca as contexto
from src.models.extraccion import ResultadoExtraccion
from src.models.validacion import AnotacionInvestigador, EstadoValidacion
from src.persistencia.estado import cargar, guardar


class Consulta:
    def __init__(self, rows, filtros=(), limite=None):
        self.rows, self.filtros, self.limite = rows, filtros, limite

    def where(self, campo, operador, valor):
        assert operador == "=="
        return Consulta(self.rows, (*self.filtros, (campo, valor)), self.limite)

    def limit(self, cantidad):
        return Consulta(self.rows, self.filtros, cantidad)

    def get(self):
        return [SimpleNamespace(to_dict=lambda r=r: r) for r in self.rows
                if all(r.get(k) == v for k, v in self.filtros)][:self.limite]

    def add(self, datos):
        self.rows.append(datos)


class ColaboracionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        raiz = Path(self.tmp.name)
        grafos, textos = raiz / "grafos", raiz / "textos"
        self.ruta = grafos / "bib_a" / "lectura_validacion.json"
        (textos / "bib_a").mkdir(parents=True)
        (textos / "bib_a" / "lectura.txt").write_text("Texto compartido", encoding="utf-8")
        self.ext = ResultadoExtraccion()
        guardar(EstadoValidacion(titulo="Lectura", slug="lectura", extraccion=self.ext,
                                decisiones=[], anotaciones=[AnotacionInvestigador(
                                    id="antigua", objeto_anotado="c_1", nota="Nota antigua")]), self.ruta)
        self.ruta.with_name("lectura_extraccion.json").write_text(self.ext.model_dump_json())
        self.permisos = []
        self.consulta = Consulta(self.permisos)
        self.db = SimpleNamespace(collection=lambda nombre: self.consulta)
        for objeto, nombre, valor in [
            (api, "GRAFOS", contexto._DirectorioPorBiblioteca(grafos)),
            (api, "TRANSCRIPTS", contexto._DirectorioPorBiblioteca(textos)),
            (api.settings, "grafos_dir", grafos),
            (api, "nombre_de_biblioteca", lambda bib: bib),
            (contexto, "_FIREBASE_OK", True),
            (contexto, "_EN_CLOUD_RUN", True),
            (contexto, "_datos_persona", lambda uid: (f"bib_{uid}", False)),
        ]:
            self.enterContext(patch.object(objeto, nombre, valor))
        self.enterContext(patch.object(contexto.firestore, "client", return_value=self.db))
        self.enterContext(patch.object(contexto.fb_auth, "verify_id_token", side_effect=lambda uid:
                                     {"uid": uid, "name": f"Persona {uid}"}))
        self.enterContext(patch.object(contexto.fb_auth, "get_user_by_email", side_effect=lambda email:
                                     SimpleNamespace(uid=email.split("@")[0])))
        self.client = self.enterContext(TestClient(api.app))

    def request(self, uid, method, path, **kwargs):
        return self.client.request(method, path, headers={"Authorization": f"Bearer {uid}"}, **kwargs)

    def compartir(self, origen, destino):
        r = self.request(origen, "POST", "/api/compartir",
                         json={"slug": "lectura", "email": f"{destino}@example.org"})
        self.assertEqual(r.status_code, 200, r.text)

    def test_recompartir_en_cadena_y_grafo_comun(self):
        self.compartir("a", "b")
        # Un resultado negativo previo no debe ocultar un permiso nuevo.
        self.assertIsNone(contexto._biblioteca_compartida("c", "lectura"))
        self.compartir("b", "c")
        self.compartir("c", "d")
        self.assertEqual([p["bibliotecaOrigen"] for p in self.permisos], ["bib_a"] * 3)
        self.assertEqual([p["otorgadoPor"] for p in self.permisos], ["a", "b", "c"])
        for uid in "bcd":
            listado = self.request(uid, "GET", "/api/extracciones").json()
            self.assertTrue(any(t["slug"] == "lectura" and t["compartido"] for t in listado))
            r = self.request(uid, "GET", "/api/compartir/lectura")
            self.assertEqual(len(r.json()["emails"]), 3)
        c1 = self.request("b", "POST", "/api/validacion/lectura/conceptos", json={"label": "Uno"}).json()["id"]
        c2 = self.request("c", "POST", "/api/validacion/lectura/conceptos", json={"label": "Dos"}).json()["id"]
        r = self.request("d", "POST", "/api/validacion/lectura/relaciones", json={
            "origen_id": c1, "destino_id": c2, "tipo": "conecta", "etiqueta": "conecta"})
        self.assertEqual(r.status_code, 200, r.text)
        for uid in "abcd":
            grafo = self.request(uid, "GET", "/api/grafo/lectura").json()
            self.assertEqual({n["label"] for n in grafo["nodes"]}, {"Uno", "Dos"})
            self.assertEqual(len(grafo["links"]), 1)
        self.assertFalse((self.ruta.parent.parent / "bib_b" / self.ruta.name).exists())
        self.assertEqual(self.request("sin_permiso", "GET", "/api/validacion/lectura").status_code, 404)
        self.assertEqual(self.request("sin_permiso", "POST", "/api/compartir",
                                     json={"slug": "lectura", "email": "x@example.org"}).status_code, 404)
        with patch.object(api, "publicar_texto", return_value="publico") as publicar:
            r = self.request("d", "POST", "/api/publicar", json={"slug": "lectura"})
            self.assertEqual(r.status_code, 200, r.text)
            publicar.assert_called_once_with("bib_a", "lectura", "d")
        with patch.object(api, "estado_publicacion", return_value="publico") as estado:
            self.assertTrue(self.request("d", "GET", "/api/publicar/lectura").json()["publicado"])
            estado.assert_called_once_with("bib_a", "lectura")
        with patch.object(api, "despublicar_texto", return_value=True) as retirar:
            self.assertEqual(self.request("d", "DELETE", "/api/publicar/lectura").status_code, 200)
            retirar.assert_called_once_with("bib_a", "lectura")

    def test_glosas_con_autoria_verificada_y_compatibilidad(self):
        self.compartir("a", "b")
        for uid in "ab":
            r = self.request(uid, "POST", "/api/validacion/lectura/anotar", json={
                "objeto_anotado": "c_1", "nota": f"Glosa {uid}",
                "autor_uid": "suplantada", "autor_nombre": "Suplantada"})
            self.assertEqual(r.status_code, 200, r.text)
        notas = self.request("b", "GET", "/api/validacion/lectura").json()["anotaciones"]
        self.assertIsNone(notas[0]["autor_uid"])
        self.assertEqual([(n["autor_uid"], n["autor_nombre"]) for n in notas[1:]],
                         [("a", "Persona a"), ("b", "Persona b")])
        self.assertEqual(len({n["id"] for n in notas}), 3)
        self.assertEqual(self.request("b", "POST", "/api/validacion/lectura/anotar",
                                     json={"objeto_anotado": "c_1", "nota": ""}).status_code, 422)
        token = contexto.biblioteca_actual.set("bib_a")
        try:
            estado = cargar(self.ruta)
            estado.relaciones_ocultas = ["r_1"]
            guardar(estado, self.ruta)
            api._merge_y_guardar("lectura", self.ext, time.time(), None)
            self.assertEqual(cargar(self.ruta).anotaciones, estado.anotaciones)
            self.assertEqual(cargar(self.ruta).relaciones_ocultas, ["r_1"])
            self.assertEqual(cargar(self.ruta).creado_en, estado.creado_en)
        finally:
            contexto.biblioteca_actual.reset(token)

    def test_fallo_de_fusion_no_sobrescribe_datos(self):
        self.ruta.write_text("estado ilegible", encoding="utf-8")
        ruta_ext = self.ruta.with_name("lectura_extraccion.json")
        antes = ruta_ext.read_bytes()
        token = contexto.biblioteca_actual.set("bib_a")
        try:
            with self.assertRaises(RuntimeError):
                api._merge_y_guardar("lectura", self.ext, time.time(), None)
        finally:
            contexto.biblioteca_actual.reset(token)
        self.assertEqual(self.ruta.read_text(), "estado ilegible")
        self.assertEqual(ruta_ext.read_bytes(), antes)

    def test_cloud_no_cae_en_datos_raiz_si_falla_la_identidad(self):
        with patch.object(contexto, "_datos_persona", return_value=(None, False)):
            self.assertEqual(self.request("nueva", "GET", "/api/extracciones").status_code, 403)
        with patch.object(contexto, "_biblioteca_compartida", side_effect=RuntimeError("Firestore")):
            self.assertEqual(self.request("b", "GET", "/api/validacion/lectura").status_code, 401)
        with patch.object(contexto, "_FIREBASE_OK", False):
            self.assertEqual(self.request("b", "GET", "/api/extracciones").status_code, 503)
        self.assertEqual(self.client.get("/api/extracciones").status_code, 401)


if __name__ == "__main__":
    unittest.main()
