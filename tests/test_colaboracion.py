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
        documentos = {
            "bibliotecas": {"bib_a": {"creadoPor": "a", "nombre": "Persona a"}},
            "personas": {"a": {"email": "a@example.org"}},
        }

        def collection(nombre):
            if nombre == "permisos":
                return self.consulta
            return SimpleNamespace(document=lambda uid: SimpleNamespace(get=lambda:
                SimpleNamespace(to_dict=lambda: documentos.get(nombre, {}).get(uid))))

        self.db = SimpleNamespace(collection=collection)
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
            self.assertEqual(set(r.json()["emails"]), {f"{persona}@example.org" for persona in "abcd"})
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

    def test_personas_con_acceso_sin_duplicados(self):
        self.compartir("a", "b")
        self.compartir("a", "b")
        self.assertEqual(self.request("b", "GET", "/api/compartir/lectura").json()["emails"],
                         ["a@example.org", "b@example.org"])

    def test_simplificacion_emite_registro_completo_y_conserva_glosas(self):
        import json
        self.compartir("a", "b")
        estado = cargar(self.ruta)
        estado.extraccion = ResultadoExtraccion(conceptos=[{
            "id": f"c_{n}", "label": f"Concepto {n}", "descripcion": "", "confianza": 1,
            "cita_directa": "",
        } for n in range(3)])
        guardar(estado, self.ruta)

        class LLM:
            def invocar(self, *args, **kwargs):
                kwargs["on_texto"]("detalle" * 4000)
                kwargs["on_token"](42)
                return '{"conservar": ["c_0", "c_1"]}'

        with patch("src.llm.get_llm", return_value=LLM()):
            r = self.request("b", "POST", "/api/grafo/lectura/simplificar/stream")
        self.assertEqual(r.status_code, 200)
        eventos = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
        self.assertTrue(eventos[-1]["done"])
        self.assertEqual(len(eventos[-1]["resultado"]["nodes"]), 2)
        self.assertIn("detalle" * 4000, "".join(e.get("chunk", "") for e in eventos))
        self.assertIn({"tokens": 42}, eventos)
        self.assertEqual(cargar(self.ruta).anotaciones, estado.anotaciones)

    def test_simplificacion_fallida_no_modifica_el_grafo(self):
        import json
        antes = self.ruta.read_bytes()
        with patch.object(api, "_simplificar_grafo", side_effect=RuntimeError("Proveedor no disponible")):
            r = self.request("a", "POST", "/api/grafo/lectura/simplificar/stream")
        eventos = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
        self.assertEqual(eventos[-1], {"done": True, "error": "Proveedor no disponible"})
        self.assertEqual(self.ruta.read_bytes(), antes)

    def test_extraccion_no_recorta_ni_pierde_el_log_al_terminar(self):
        import json
        salida = "respuesta completa " * 2000
        resultado = ResultadoExtraccion(conceptos=[{
            "id": "c_0", "label": "Concepto", "descripcion": "", "confianza": 1, "cita_directa": "",
        }])

        def extraer(*args, **kwargs):
            kwargs["on_texto"](salida)
            kwargs["on_token"](60)
            return resultado

        self.enterContext(patch.dict(api._TAREAS))
        api._TAREAS["lectura"] = {"estado": "procesando", "inicio": time.time()}
        token = contexto.biblioteca_actual.set("bib_a")
        try:
            with patch("src.llm.get_llm", return_value=object()), patch("src.pipeline.extraccion.extraer", side_effect=extraer):
                api._tarea_extraer("lectura", Path(self.tmp.name) / "textos/bib_a/lectura.txt")
        finally:
            contexto.biblioteca_actual.reset(token)
        self.assertEqual(api._TAREAS["lectura"]["texto_llm"], salida)
        r = self.request("a", "GET", "/api/extracciones/lectura/stream")
        eventos = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
        self.assertEqual("".join(e.get("chunk", "") for e in eventos), salida)
        self.assertEqual(eventos[-1]["estado"], "listo")

    def test_fusion_transmite_respuesta_y_registro_sin_recortar(self):
        import json
        from src.models.grafo import Nodo
        salida = "respuesta de fusión " * 1500
        self.enterContext(patch.dict(api._CONSOLIDACION_LOG))
        self.enterContext(patch.dict(api._CONSOLIDACION_DONE))
        self.enterContext(patch.dict(api._CONSOLIDACION_TOKENS))

        def ejecutar(**kwargs):
            kwargs["on_log"]("Candidatos detectados\n")
            kwargs["on_texto"](salida)
            kwargs["on_token"](90)
            sesion = api.persistencia_consolidacion.cargar("lectura", kwargs["grafos_dir"])
            sesion.estado = "en_revision"
            api.persistencia_consolidacion.guardar(sesion, "lectura", kwargs["grafos_dir"])

        with patch.object(api, "detectar_candidatos", return_value=[[Nodo(id="c_0", label="Uno")]]), \
                patch("src.pipeline.consolidacion.ejecutar_consolidacion", side_effect=ejecutar):
            r = self.request("a", "POST", "/api/grafo/lectura/consolidacion/iniciar")
        self.assertEqual(r.status_code, 200, r.text)
        r = self.request("a", "GET", "/api/grafo/lectura/consolidacion/stream")
        eventos = [json.loads(line[6:]) for line in r.text.splitlines() if line.startswith("data: ")]
        self.assertEqual("".join(e.get("chunk", "") for e in eventos), "Candidatos detectados\n" + salida)
        self.assertTrue(eventos[-1]["done"])


if __name__ == "__main__":
    unittest.main()
