"""
FastAPI app: sirve la UI estática y expone la API de validación.
Arrancar con: uvicorn src.app:app --port 8000
"""
from pathlib import Path
from typing import Optional

import asyncio
import json
import time
from concurrent.futures import ThreadPoolExecutor

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from src.config import settings
from src.models.extraccion import ResultadoExtraccion
from src.models.validacion import (
    AnotacionInvestigador,
    EstadoDecision,
    EstadoValidacion,
    MetadatosTexto,
    ResolucionDecision,
)
from src.persistencia.estado import cargar, guardar, ruta_validacion
from src.persistencia.grafo import (
    materializar_desde_validacion,
    guardar as guardar_grafo,
    cargar as cargar_grafo,
    existe as existe_grafo,
    ruta_grafo,
)
from src.pipeline.grafo import nodos_sueltos, nodos_desconectados, serializar_para_d3
from src.persistencia.reconexion import (
    guardar as guardar_sesion,
    cargar as cargar_sesion,
    existe as existe_sesion,
    eliminar as eliminar_sesion,
)
from src.models.reconexion import SesionReconexion
from src.persistencia import consolidacion as persistencia_consolidacion
from src.pipeline.consolidacion import detectar_candidatos, fusionar_conceptos
from src.models.consolidacion import SesionConsolidacion
from src.persistencia.grafo_personal import (
    cargar_gp, guardar_gp, listar_gp, ruta_grafo_personal,
)
from src.models.grafo_personal import (
    GrafoPersonal, ConceptoInvestigador as ConceptoGP,
    RelacionInvestigador as RelacionGP,
)

app = FastAPI(title="Lectógrafo", docs_url="/api/docs")

STATIC      = Path(__file__).parent.parent / "static"
GRAFOS      = settings.grafos_dir
TRANSCRIPTS = settings.transcripts_dir

class _ExtraccionCancelada(Exception):
    """Señal interna para abortar limpiamente una extracción cancelada."""


# ── Helper: merge aditivo y persistencia ──────────────────────────────────────

def _merge_y_guardar(slug: str, resultado: ResultadoExtraccion, inicio: float, mp_previos: dict | None) -> None:
    """Fusiona resultado con la validación previa (si existe) y persiste.
    Idempotente: si no hay validación previa, guarda como extracción nueva.
    """
    import copy as _copy
    from src.persistencia.estado import guardar as _guardar, ruta_validacion as _rv

    salida = GRAFOS / f"{slug}_extraccion.json"
    GRAFOS.mkdir(parents=True, exist_ok=True)
    rv_existente = _rv(slug, GRAFOS)

    if rv_existente.exists():
        try:
            estado_previo = cargar(rv_existente)
            ext_previa = estado_previo.extraccion

            labels_prev = {c.label.lower().strip(): c.id for c in ext_previa.conceptos}
            ids_prev = {c.id for c in ext_previa.conceptos}
            # Calcular próximo ID numérico libre para evitar colisiones
            import re as _re
            nums_prev = [int(m.group(1)) for c in ext_previa.conceptos for m in [_re.match(r"c_(\d+)$", c.id)] if m]
            next_num = max(nums_prev, default=0) + 1

            id_remap: dict[str, str] = {}
            conceptos_nuevos = []
            for c in resultado.conceptos:
                key = c.label.lower().strip()
                if key in labels_prev:
                    id_remap[c.id] = labels_prev[key]
                else:
                    # Reasignar ID si colisiona con alguno existente
                    nuevo_id = c.id
                    if nuevo_id in ids_prev:
                        nuevo_id = f"c_{next_num:03d}"
                        next_num += 1
                    c2 = _copy.copy(c)
                    c2.id = nuevo_id
                    conceptos_nuevos.append(c2)
                    ids_prev.add(nuevo_id)
                    id_remap[c.id] = nuevo_id
                    labels_prev[key] = nuevo_id

            rels_prev_keys = {(r.origen_id, r.destino_id, r.tipo) for r in ext_previa.relaciones}
            relaciones_nuevas = []
            for r in resultado.relaciones:
                r2 = _copy.copy(r)
                r2.origen_id = id_remap.get(r.origen_id, r.origen_id)
                r2.destino_id = id_remap.get(r.destino_id, r.destino_id)
                if (r2.origen_id, r2.destino_id, r2.tipo) not in rels_prev_keys:
                    relaciones_nuevas.append(r2)

            ext_fusionada = ResultadoExtraccion(
                conceptos=ext_previa.conceptos + conceptos_nuevos,
                relaciones=ext_previa.relaciones + relaciones_nuevas,
                bucles=ext_previa.bucles,
                metalenguaje=ext_previa.metalenguaje,
            )
            meta = MetadatosTexto(**mp_previos) if mp_previos else estado_previo.metadatos
            estado_fusionado = EstadoValidacion(
                titulo=estado_previo.titulo,
                slug=slug,
                extraccion=ext_fusionada,
                decisiones=[],
                anotaciones=estado_previo.anotaciones,
                completado=True,
                metadatos=meta,
                conceptos_editados=estado_previo.conceptos_editados,
                relaciones_editadas=estado_previo.relaciones_editadas,
                relaciones_investigador=estado_previo.relaciones_investigador,
            )
            salida.write_text(
                json.dumps(ext_fusionada.model_dump(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            _guardar(estado_fusionado, rv_existente)
            print(
                f"[lectografo] Merge aditivo: +{len(conceptos_nuevos)} conceptos, +{len(relaciones_nuevas)} relaciones",
                flush=True,
            )
            return
        except Exception as exc:
            print(f"[lectografo] Merge aditivo falló ({exc}), guardando como extracción nueva.", flush=True)

    # Sin validación previa: guardar extracción nueva
    salida.write_text(
        json.dumps(resultado.model_dump(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    meta = MetadatosTexto(**mp_previos) if mp_previos else MetadatosTexto()
    nuevo_estado = EstadoValidacion(
        titulo=meta.titulo or slug.replace("_", " ").title(),
        slug=slug,
        extraccion=resultado,
        decisiones=[],
        completado=True,
        metadatos=meta,
    )
    try:
        from src.persistencia.estado import guardar as _guardar, ruta_validacion as _rv
        _guardar(nuevo_estado, _rv(slug, GRAFOS))
    except Exception as exc:
        print(f"[lectografo] No se pudo guardar estado: {exc}", flush=True)


# Estado en memoria de extracciones en curso
# slug → {"estado": "procesando"|"listo"|"error:…"|"cancelado", "inicio": float, "fase": str}
_TAREAS: dict[str, dict] = {}
_executor = ThreadPoolExecutor(max_workers=1)   # una extracción a la vez

# Buffers de log en tiempo real para reconexión (in-memory, no persiste)
_RECONEXION_LOG: dict[str, str] = {}     # mensajes de progreso (sin tokens LLM crudos)
_RECONEXION_TOKENS: dict[str, int] = {}  # contador de tokens LLM generados
_RECONEXION_DONE: dict[str, bool] = {}
_RECONEXION_CANCEL: dict[str, bool] = {} # flag de cancelación por slug

# Mismos buffers, para consolidación de sinónimos
_CONSOLIDACION_LOG: dict[str, str] = {}
_CONSOLIDACION_TOKENS: dict[str, int] = {}
_CONSOLIDACION_DONE: dict[str, bool] = {}
_CONSOLIDACION_CANCEL: dict[str, bool] = {}

_EXTS_TRANSCRIPT = ("txt", "md", "vtt", "srt")


def _slug_de_archivo(ruta: Path) -> str:
    return ruta.stem.lower().replace(" ", "_")[:50]


def _titulo_de_archivo(ruta: Path) -> str:
    return ruta.stem.replace("-", " ").replace("_", " ").title()


def _ruta_transcript(slug: str) -> Path | None:
    for ext in _EXTS_TRANSCRIPT:
        for f in TRANSCRIPTS.glob(f"*.{ext}"):
            if _slug_de_archivo(f) == slug:
                return f
    return None


# ── helpers ───────────────────────────────────────────────────────────────────

def _cargar_o_crear(slug: str) -> tuple[EstadoValidacion, Path]:
    ruta_val = ruta_validacion(slug, GRAFOS)
    if ruta_val.exists():
        return cargar(ruta_val), ruta_val

    ruta_ext = GRAFOS / f"{slug}_extraccion.json"
    if not ruta_ext.exists():
        raise HTTPException(404, f"No existe extracción para slug '{slug}'")

    extraccion = ResultadoExtraccion.model_validate_json(ruta_ext.read_text("utf-8"))
    # Recuperar metadatos standalone si existen (ej. editados antes de procesar)
    meta_standalone = MetadatosTexto()
    ruta_meta = GRAFOS / f"{slug}_metadatos.json"
    if ruta_meta.exists():
        try:
            meta_standalone = MetadatosTexto.model_validate_json(ruta_meta.read_text("utf-8"))
        except Exception:
            pass
    estado = EstadoValidacion(
        titulo=meta_standalone.titulo or slug.replace("_", " ").title(),
        slug=slug,
        extraccion=extraccion,
        decisiones=[],
        completado=True,
        metadatos=meta_standalone,
    )
    guardar(estado, ruta_val)
    # Eliminar el archivo standalone ya que quedó integrado en la validación
    ruta_meta.unlink(missing_ok=True)
    return estado, ruta_val


# ── API ───────────────────────────────────────────────────────────────────────

@app.get("/api/extracciones")
def listar_extracciones():
    """Lista todos los textos: extraídos (con o sin validación) y aún sin procesar."""
    resultado = []
    slugs_procesados: set[str] = set()

    # ── Textos ya extraídos ────────────────────────────────────────────────────
    for f in sorted(GRAFOS.glob("*_extraccion.json")):
        slug = f.stem.replace("_extraccion", "")
        slugs_procesados.add(slug)
        ruta_val = ruta_validacion(slug, GRAFOS)

        # Verificar si hay un reproceso en curso para este slug
        tarea = _TAREAS.get(slug, {})
        estado_tarea = tarea.get("estado", "") if isinstance(tarea, dict) else ""
        procesando   = estado_tarea == "procesando"
        tokens       = tarea.get("tokens", 0)       if isinstance(tarea, dict) else 0
        tok_total    = tarea.get("tokens_total", 0) if isinstance(tarea, dict) else 0
        elapsed      = int(time.time() - tarea["inicio"]) if procesando and isinstance(tarea, dict) else 0
        if tok_total > 0 and tokens > 0:
            porcentaje = int(min(tokens / tok_total * 90, 90))
        else:
            porcentaje = 0

        info: dict = {
            "slug":            slug,
            "titulo":          slug.replace("_", " ").title(),
            "procesado":       True,
            "procesando":      procesando,
            "fase_extraccion": tarea.get("fase", "") if isinstance(tarea, dict) else "",
            "elapsed":         elapsed,
            "tokens":          tokens,
            "tokens_total":    tok_total,
            "porcentaje":      porcentaje,
            "estado":          estado_tarea or "listo",
            "error":           (estado_tarea if estado_tarea.startswith("error")
                                else ("cancelado" if estado_tarea == "cancelado" else None)),
        }
        if ruta_val.exists():
            val = cargar(ruta_val)
            info.update({
                "titulo":    val.titulo,
                "metadatos": val.metadatos.model_dump(),
            })
        resultado.append(info)

    # ── Transcripts sin extracción ─────────────────────────────────────────────
    for ext in _EXTS_TRANSCRIPT:
        for f in sorted(TRANSCRIPTS.glob(f"*.{ext}")):
            slug = _slug_de_archivo(f)
            if slug in slugs_procesados:
                continue
            tarea = _TAREAS.get(slug, {})
            estado_tarea = tarea.get("estado", "pendiente") if isinstance(tarea, dict) else "pendiente"
            procesando   = estado_tarea == "procesando"
            tokens       = tarea.get("tokens", 0)            if isinstance(tarea, dict) else 0
            tok_total    = tarea.get("tokens_total", 0)      if isinstance(tarea, dict) else 0
            total_lotes  = tarea.get("total_lotes", 0)       if isinstance(tarea, dict) else 0
            lotes_proc   = tarea.get("lotes_procesados", 0)  if isinstance(tarea, dict) else 0
            elapsed      = int(time.time() - tarea["inicio"]) if procesando and isinstance(tarea, dict) else 0
            if total_lotes > 0 and lotes_proc > 0:
                porcentaje = int(min(lotes_proc / total_lotes * 90, 90))
            elif tok_total > 0 and tokens > 0:
                porcentaje = int(min(tokens / tok_total * 90, 90))
            else:
                porcentaje = 0
            # Incluir metadatos standalone si existen
            meta_standalone: dict | None = None
            ruta_meta_s = GRAFOS / f"{slug}_metadatos.json"
            if ruta_meta_s.exists():
                try:
                    meta_standalone = MetadatosTexto.model_validate_json(
                        ruta_meta_s.read_text("utf-8")
                    ).model_dump()
                except Exception:
                    pass
            titulo_mostrar = (
                (meta_standalone or {}).get("titulo") or _titulo_de_archivo(f)
            )
            resultado.append({
                "slug":            slug,
                "titulo":          titulo_mostrar,
                "procesado":       False,
                "procesando":      procesando,
                "fase_extraccion": tarea.get("fase", "") if isinstance(tarea, dict) else "",
                "elapsed":         elapsed,
                "tokens":          tokens,
                "tokens_total":    tok_total,
                "porcentaje":      porcentaje,
                "texto_llm":            tarea.get("texto_llm", "")             if procesando and isinstance(tarea, dict) else "",
                "modelo_en_ram":        tarea.get("modelo_en_ram")             if procesando and isinstance(tarea, dict) else None,
                "modo_extraccion":      tarea.get("modo", "rapido")            if isinstance(tarea, dict) else "rapido",
                "total_lotes":          total_lotes,
                "lotes_procesados":     lotes_proc,
                "conceptos_parciales":  tarea.get("conceptos_parciales", [])   if procesando and isinstance(tarea, dict) else [],
                "relaciones_parciales": tarea.get("relaciones_parciales", [])  if procesando and isinstance(tarea, dict) else [],
                "metadatos":       meta_standalone,
                "error":           (estado_tarea if estado_tarea.startswith("error")
                                    else ("cancelado" if estado_tarea == "cancelado" else None)),
                "total":           None, "resueltas": 0,
                "pendientes":      None, "diferidas": 0, "completado": False,
            })

    return resultado


def _tarea_extraer(slug: str, ruta: Path) -> None:
    """Ejecuta la extracción en un hilo separado (llamado desde executor)."""
    tarea_inicial = _TAREAS.get(slug, {}) if isinstance(_TAREAS.get(slug), dict) else {}
    inicio       = tarea_inicial.get("inicio", time.time())
    mp_previos   = tarea_inicial.get("_metadatos_previos")   # metadatos a restaurar

    def _fase(f: str) -> None:
        if isinstance(_TAREAS.get(slug), dict):
            _TAREAS[slug]["fase"] = f

    def _on_token(count: int) -> None:
        t = _TAREAS.get(slug)
        if not isinstance(t, dict):
            return
        t["tokens"] = count
        # Parsear conceptos y relaciones parciales cada 80 tokens
        if count % 80 == 0:
            buf = t.get("texto_llm", "")
            if len(buf) > 80:
                from src.llm.base import _reparar_json
                data = _reparar_json(buf)
                if data:
                    if data.get("conceptos"):
                        t["conceptos_parciales"] = [
                            {"id": c.get("id", ""), "label": c.get("label", ""), "tipo": c.get("tipo", "primitivo")}
                            for c in data["conceptos"] if c.get("label")
                        ]
                    if data.get("relaciones"):
                        t["relaciones_parciales"] = [
                            {
                                "origen_id": r.get("origen_id", ""),
                                "destino_id": r.get("destino_id", ""),
                                "etiqueta": r.get("etiqueta", r.get("tipo", "")),
                            }
                            for r in data["relaciones"]
                            if r.get("origen_id") and r.get("destino_id")
                        ]

    def _on_texto(fragmento: str) -> None:
        t = _TAREAS.get(slug)
        if isinstance(t, dict):
            buf = t.get("texto_llm", "")
            # Ventana deslizante: últimos 4000 chars del output crudo
            t["texto_llm"] = (buf + fragmento)[-4000:]

    def _should_cancel() -> bool:
        t = _TAREAS.get(slug)
        return isinstance(t, dict) and bool(t.get("cancelar"))

    try:
        from src.llm import get_llm
        from src.pipeline.ingesta import leer_archivo
        from src.pipeline.extraccion import extraer

        _fase("leyendo")
        transcripcion = leer_archivo(str(ruta))

        # Estimar total de tokens de salida a partir del tamaño del texto
        tokens_total_est = max(len(transcripcion.texto) // 4 * 2, 500)
        if isinstance(_TAREAS.get(slug), dict):
            _TAREAS[slug]["tokens_total"] = tokens_total_est
            _TAREAS[slug]["tokens"] = 0

        # Antes de invocar el LLM, consultar /api/ps de Ollama para saber
        # si el modelo ya está en RAM o si habrá que cargarlo primero.
        # Esto permite mostrar al usuario un mensaje preciso en la UI.
        if settings.provider == "ollama":
            try:
                import httpx as _httpx
                ps = _httpx.get(
                    f"{settings.ollama_endpoint.rstrip('/')}/api/ps", timeout=3.0
                )
                if ps.status_code == 200:
                    modelos_en_ram = [m.get("name", "") for m in ps.json().get("models", [])]
                    modelo_activo = settings.ollama_model
                    en_ram = any(
                        modelo_activo in m or m.startswith(modelo_activo.split(":")[0])
                        for m in modelos_en_ram
                    )
                    if isinstance(_TAREAS.get(slug), dict):
                        _TAREAS[slug]["modelo_en_ram"] = en_ram
                    _fase("cargando_modelo" if not en_ram else "extrayendo")
                else:
                    _fase("extrayendo")
            except Exception:
                _fase("extrayendo")
        else:
            _fase("extrayendo")

        llm = get_llm()
        resultado = extraer(
            transcripcion, llm,
            on_token=_on_token, on_texto=_on_texto, should_cancel=_should_cancel,
            max_chars=settings.max_chars_prompt,
        )

        if not resultado.conceptos:
            _TAREAS[slug] = {"estado": "error:extraccion_vacia", "inicio": inicio, "fase": ""}
            return

        _fase("guardando")
        _merge_y_guardar(slug, resultado, inicio, mp_previos)
        _TAREAS[slug] = {"estado": "listo", "inicio": inicio, "fase": "listo"}
    except (_ExtraccionCancelada, InterruptedError):
        _TAREAS[slug] = {"estado": "cancelado", "inicio": inicio, "fase": ""}
    except Exception as exc:
        _TAREAS[slug] = {"estado": f"error:{exc}", "inicio": inicio, "fase": "error"}


def _tarea_extraer_incremental(slug: str, ruta: Path) -> None:
    """Extracción párrafo a párrafo: procesa el texto en lotes con tesauro acumulado."""
    tarea_inicial = _TAREAS.get(slug, {}) if isinstance(_TAREAS.get(slug), dict) else {}
    inicio       = tarea_inicial.get("inicio", time.time())
    mp_previos   = tarea_inicial.get("_metadatos_previos")

    def _fase(f: str) -> None:
        if isinstance(_TAREAS.get(slug), dict):
            _TAREAS[slug]["fase"] = f

    def _should_cancel() -> bool:
        t = _TAREAS.get(slug)
        return isinstance(t, dict) and bool(t.get("cancelar"))

    try:
        import copy as _copy
        from src.llm import get_llm
        from src.pipeline.ingesta import leer_archivo
        from src.pipeline.fragmentacion import dividir_en_parrafos, agrupar_en_lotes

        _fase("leyendo")
        transcripcion = leer_archivo(str(ruta))
        texto = transcripcion.texto

        parrafos = dividir_en_parrafos(texto)
        lotes    = agrupar_en_lotes(parrafos, max_chars=settings.max_chars_prompt)
        total_lotes = len(lotes)

        if isinstance(_TAREAS.get(slug), dict):
            _TAREAS[slug].update({
                "total_lotes":    total_lotes,
                "lotes_procesados": 0,
                "tokens_total":   max(len(texto) // 4, 500),
                "tokens":         0,
            })

        prompt_path = Path(__file__).parent.parent / "prompts" / "extraccion_fragmento_v1.md"
        prompt_fragmento = prompt_path.read_text("utf-8")

        llm = get_llm()

        # Acumuladores globales entre lotes
        conceptos_globales:    list = []
        relaciones_globales:   list = []
        labels_globales:       dict[str, str] = {}   # label.lower() → id global
        rel_keys_globales:     set  = set()           # (origen_id, destino_id, tipo)
        _c_counter = 0
        _r_counter = 0

        for i, lote in enumerate(lotes):
            if _should_cancel():
                raise _ExtraccionCancelada()

            _fase(f"lote_{i+1}_de_{total_lotes}")
            if isinstance(_TAREAS.get(slug), dict):
                _TAREAS[slug]["lotes_procesados"] = i
                _TAREAS[slug]["conceptos_parciales"] = [
                    {"id": c.id, "label": c.label}
                    for c in conceptos_globales
                ]
                _TAREAS[slug]["relaciones_parciales"] = [
                    {"origen_id": r.origen_id, "destino_id": r.destino_id, "etiqueta": r.etiqueta}
                    for r in relaciones_globales[:20]
                ]

            tesauro_context = (
                "\n".join(f"- {c.label}" for c in conceptos_globales)
                if conceptos_globales else "(ninguno aún)"
            )
            texto_lote     = "\n\n".join(p.texto for p in lote)
            system_prompt  = prompt_fragmento.replace("{tesauro_context}", tesauro_context)

            def _on_tok(count: int, slug=slug) -> None:
                t = _TAREAS.get(slug)
                if isinstance(t, dict):
                    t["tokens"] = t.get("tokens", 0) + count

            raw = llm.invocar(system_prompt, texto_lote, on_token=_on_tok)
            resultado_lote = llm.parsear_respuesta(raw)

            # Deduplicar conceptos del lote contra globales y construir id_remap
            id_remap: dict[str, str] = {}
            for c in resultado_lote.conceptos:
                key = c.label.lower().strip()
                if not key:
                    continue
                if key in labels_globales:
                    id_remap[c.id] = labels_globales[key]
                else:
                    _c_counter += 1
                    new_id = f"c_{_c_counter:03d}"
                    c_new  = c.model_copy(update={"id": new_id})
                    conceptos_globales.append(c_new)
                    labels_globales[key] = new_id
                    id_remap[c.id] = new_id

            # Agregar relaciones con IDs remapeados, deduplicando por (origen, destino, tipo)
            for r in resultado_lote.relaciones:
                new_origen  = id_remap.get(r.origen_id,  r.origen_id)
                new_destino = id_remap.get(r.destino_id, r.destino_id)
                key = (new_origen, new_destino, r.tipo)
                if key not in rel_keys_globales:
                    _r_counter += 1
                    r_new = r.model_copy(update={
                        "id":         f"r_{_r_counter:03d}",
                        "origen_id":  new_origen,
                        "destino_id": new_destino,
                    })
                    relaciones_globales.append(r_new)
                    rel_keys_globales.add(key)

            print(
                f"[lectografo] Lote {i+1}/{total_lotes}: "
                f"+{len(resultado_lote.conceptos)}c +{len(resultado_lote.relaciones)}r | "
                f"acum: {len(conceptos_globales)}c {len(relaciones_globales)}r",
                flush=True,
            )

        if isinstance(_TAREAS.get(slug), dict):
            _TAREAS[slug]["lotes_procesados"] = total_lotes

        if not conceptos_globales:
            _TAREAS[slug] = {"estado": "error:extraccion_vacia", "inicio": inicio, "fase": ""}
            return

        resultado = ResultadoExtraccion(
            conceptos=conceptos_globales,
            relaciones=relaciones_globales,
        )

        _fase("guardando")
        _merge_y_guardar(slug, resultado, inicio, mp_previos)
        _TAREAS[slug] = {"estado": "listo", "inicio": inicio, "fase": "listo"}

    except (_ExtraccionCancelada, InterruptedError):
        _TAREAS[slug] = {"estado": "cancelado", "inicio": inicio, "fase": ""}
    except Exception as exc:
        _TAREAS[slug] = {"estado": f"error:{exc}", "inicio": inicio, "fase": "error"}


class ProcesarPayload(BaseModel):
    force: bool = False  # True = re-extraer aunque ya exista extracción
    modo: str  = "auto"  # "auto" | "rapido" | "incremental"


@app.post("/api/extracciones/{slug}/procesar")
async def procesar_extraccion(slug: str, payload: ProcesarPayload = ProcesarPayload()):
    """Dispara la extracción LLM de un transcript en segundo plano.
    Si force=True, elimina la extracción y validación previas antes de re-extraer.
    """
    tarea = _TAREAS.get(slug, {})
    if isinstance(tarea, dict) and tarea.get("estado") == "procesando":
        return {"ok": False, "error": "Ya hay una extracción en curso para este texto"}

    ruta = _ruta_transcript(slug)
    if not ruta:
        raise HTTPException(404, f"No se encontró transcript para slug '{slug}'")

    mp_previos: dict = {}
    if payload.force:
        # Preservar metadatos por si la validación previa no se puede mergear
        rv_actual = ruta_validacion(slug, GRAFOS)
        if rv_actual.exists():
            try:
                mp_previos = cargar(rv_actual).metadatos.model_dump()
            except Exception:
                pass
        # NO borramos extracción ni validación — la nueva extracción se fusionará
        # aditivamente con los datos existentes (ver lógica en _tarea_extraer).

    # Determinar modo: "auto" usa incremental si el texto supera el límite
    modo = payload.modo
    if modo == "auto":
        try:
            from src.pipeline.ingesta import leer_archivo as _la
            _txt = _la(str(ruta)).texto
            modo = "incremental" if len(_txt) > settings.max_chars_prompt else "rapido"
        except Exception:
            modo = "rapido"

    _TAREAS[slug] = {
        "estado":    "procesando",
        "inicio":    time.time(),
        "fase":      "iniciando",
        "modo":      modo,
        "tokens":    0,
        "tokens_total": 0,
        "total_lotes":    0,
        "lotes_procesados": 0,
        "texto_llm":  "",
        "conceptos_parciales":  [],
        "relaciones_parciales": [],
        "_metadatos_previos": mp_previos,
    }
    tarea_fn = _tarea_extraer_incremental if modo == "incremental" else _tarea_extraer
    loop = asyncio.get_event_loop()
    loop.run_in_executor(_executor, tarea_fn, slug, ruta)
    return {"ok": True, "estado": "procesando", "modo": modo}


@app.get("/api/validacion/{slug}")
def obtener_validacion(slug: str):
    """Devuelve el estado completo de la sesión de validación."""
    estado, _ = _cargar_o_crear(slug)
    return estado.model_dump(mode="json")


class ResolverPayload(BaseModel):
    resolucion: ResolucionDecision
    nota: Optional[str] = None
    label_resolucion: Optional[str] = None   # solo para sinonimia modificada


@app.post("/api/validacion/{slug}/decisiones/{did}/resolver")
def resolver_decision(slug: str, did: str, payload: ResolverPayload):
    """Resuelve o difiere una decisión."""
    from datetime import datetime

    estado, ruta_val = _cargar_o_crear(slug)
    decision = next((d for d in estado.decisiones if d.id == did), None)
    if not decision:
        raise HTTPException(404, f"Decisión '{did}' no encontrada")
    if decision.estado == EstadoDecision.resuelta:
        raise HTTPException(409, "La decisión ya está resuelta")

    if payload.resolucion == ResolucionDecision.diferida:
        decision.estado = EstadoDecision.diferida
    else:
        decision.estado    = EstadoDecision.resuelta
        decision.resolucion      = payload.resolucion
        decision.nota_resolucion = payload.nota
        decision.resuelta_en     = datetime.utcnow()
        if payload.label_resolucion:
            decision.label_resolucion = payload.label_resolucion

        # ── Efectos secundarios según tipo de decisión ─────────────────────
        from src.models.validacion import TipoDecision as TD
        aceptada_o_modificada = payload.resolucion in (
            ResolucionDecision.aceptada, ResolucionDecision.modificada
        )

        if decision.tipo == TD.sinonimia and aceptada_o_modificada:
            # label_resolucion > label_canonico_propuesto > label actual del canónico.
            # Hoy conceptos_implicados_ids siempre trae un solo id (ver
            # generar_decisiones en pipeline/validacion.py: cada concepto propone
            # sus propios sinonimos_candidatos como variantes de sí mismo, no
            # como referencias a otros conceptos ya extraídos). Si en el futuro
            # llegara a traer más de uno, se fusionan de verdad vía
            # fusionar_conceptos (redirección de relaciones incluida), en vez
            # de solo renombrar cada uno por separado.
            ids = decision.conceptos_implicados_ids
            if ids:
                canonico_id = ids[0]
                label_final = (
                    payload.label_resolucion
                    or decision.label_canonico_propuesto
                    or next(
                        (c.label for c in estado.extraccion.conceptos if c.id == canonico_id),
                        None,
                    )
                )
                if len(ids) > 1:
                    from src.pipeline.consolidacion import fusionar_conceptos
                    fusionar_conceptos(estado, canonico_id, ids[1:], label_canonico=label_final)
                elif label_final:
                    ov = estado.conceptos_editados.get(canonico_id, {})
                    ov["label"] = label_final
                    estado.conceptos_editados[canonico_id] = ov

        elif decision.tipo == TD.promocion_de_tipo and payload.resolucion == ResolucionDecision.modificada:
            # nota_resolucion contiene el tipo elegido: "primitivo" | "derivado" | "metalenguaje"
            tipo_elegido = (payload.nota or "").strip().lower()
            if tipo_elegido in {"primitivo", "derivado", "metalenguaje"}:
                for cid in decision.conceptos_implicados_ids:
                    ov = estado.conceptos_editados.get(cid, {})
                    ov["tipo"] = tipo_elegido
                    estado.conceptos_editados[cid] = ov

    if estado.todas_resueltas() and not estado.completado:
        estado.completado = True

    guardar(estado, ruta_val)
    return {"ok": True, "completado": estado.completado,
            "resueltas": len(estado.resueltas()), "total": len(estado.decisiones)}


class ReanudarPayload(BaseModel):
    pass


@app.post("/api/validacion/{slug}/decisiones/{did}/reanudar")
def reanudar_decision(slug: str, did: str):
    """
    Mueve una decisión diferida o resuelta de vuelta a pendiente.
    Nota: reabrir una decisión `resuelta` contradice `terminal: resuelta`
    de la máquina de estados del spec. Se permite aquí como override
    explícito del investigador; ver open question en validacion.allium.
    """
    estado, ruta_val = _cargar_o_crear(slug)
    decision = next((d for d in estado.decisiones if d.id == did), None)
    if not decision:
        raise HTTPException(404, f"Decisión '{did}' no encontrada")
    if decision.estado == EstadoDecision.pendiente:
        raise HTTPException(409, "La decisión ya está pendiente")
    decision.estado    = EstadoDecision.pendiente
    decision.resolucion      = None
    decision.nota_resolucion = None
    decision.resuelta_en     = None
    decision.label_resolucion = None
    if estado.completado:
        estado.completado = False
    guardar(estado, ruta_val)
    return {"ok": True}


# ── Grafo derivado ────────────────────────────────────────────────────────────

@app.get("/api/grafo/{slug}")
def obtener_grafo(slug: str):
    """
    Devuelve nodos y aristas con estado de validación superpuesto.
    Aplica los overrides del investigador (conceptos_editados, relaciones_editadas).
    El campo 'suelto' indica si el nodo no tiene ninguna relación.
    """
    estado, _ = _cargar_o_crear(slug)
    grafo = materializar_desde_validacion(estado)
    return serializar_para_d3(grafo)


@app.get("/api/grafo/{slug}/info")
def info_grafo(slug: str):
    """
    Devuelve metadatos del grafo: totales, nodos sueltos, densidad.
    Útil para saber si mostrar el botón getYourStuffTogether.
    """
    estado, _ = _cargar_o_crear(slug)
    grafo = materializar_desde_validacion(estado)
    sueltos = nodos_sueltos(grafo)
    return {
        "slug":                 slug,
        "titulo":               grafo.titulo,
        "total_nodos":          grafo.total_nodos(),
        "total_relaciones":     grafo.total_relaciones(),
        "nodos_sueltos_count":  len(sueltos),
        "nodos_sueltos_ids":    [n.id for n in sueltos],
        "es_conexo":            grafo.es_conexo(),
        "densidad":             round(grafo.densidad(), 4),
    }


# ── getYourStuffTogether — reconexión de nodos sueltos ───────────────────────

@app.get("/api/grafo/{slug}/reconexion/estado")
def estado_reconexion(slug: str):
    """
    Devuelve el estado de nodos sueltos y si hay una sesión activa.
    El frontend usa esto para mostrar/ocultar el botón de reconexión.
    """
    estado_val, _ = _cargar_o_crear(slug)
    grafo = materializar_desde_validacion(estado_val)
    desconectados = nodos_desconectados(grafo)
    sesion_activa = None
    if existe_sesion(slug, GRAFOS):
        try:
            s = cargar_sesion(slug, GRAFOS)
            if s.estado in ("en_revision", "procesando"):
                sesion_activa = s.model_dump(mode="json")
        except Exception:
            pass
    return {
        "nodos_sueltos_count": len(desconectados),
        "nodos_sueltos_ids":   [n.id for n in desconectados],
        "es_conexo":           grafo.es_conexo(),
        "sesion_activa":       sesion_activa,
    }


@app.post("/api/grafo/{slug}/reconexion/iniciar")
async def iniciar_reconexion(slug: str, background_tasks: BackgroundTasks):
    """
    Lanza la extracción de conexiones para nodos sueltos.
    El proceso corre en background (BackgroundTasks de FastAPI).
    """
    estado_val, _ = _cargar_o_crear(slug)
    grafo = materializar_desde_validacion(estado_val)
    desconectados = nodos_desconectados(grafo)
    if not desconectados:
        raise HTTPException(400, "El grafo ya es completamente conexo")

    # Si ya hay sesión en revisión, devolver error
    if existe_sesion(slug, GRAFOS):
        try:
            s = cargar_sesion(slug, GRAFOS)
            if s.estado == "en_revision":
                raise HTTPException(409, "Ya hay una sesión de reconexión activa")
        except HTTPException:
            raise
        except Exception:
            pass

    # Leer texto de la transcripción si existe
    transcripcion_texto: str | None = None
    ruta_t = _ruta_transcript(slug)
    if ruta_t:
        try:
            transcripcion_texto = ruta_t.read_text(encoding="utf-8")
        except Exception:
            pass

    # Crear sesión placeholder "procesando" y persisitir antes de lanzar hilo
    import uuid as _uuid
    sesion_id = f"rec_{_uuid.uuid4().hex[:8]}"
    sesion_placeholder = SesionReconexion(
        id=sesion_id,
        slug=slug,
        estado="procesando",
        nodos_sueltos_ids=[n.id for n in desconectados],
    )
    guardar_sesion(sesion_placeholder, slug, GRAFOS)

    # Inicializar buffers de log y cancelación
    _RECONEXION_LOG[slug] = ""
    _RECONEXION_TOKENS[slug] = 0
    _RECONEXION_DONE[slug] = False
    _RECONEXION_CANCEL[slug] = False

    def _on_token_rec(total: int) -> None:
        _RECONEXION_TOKENS[slug] = total

    def _on_log_rec(msg: str) -> None:
        _RECONEXION_LOG[slug] = (_RECONEXION_LOG.get(slug, "") + msg)[-16000:]

    def _tarea():
        from src.pipeline.reconexion import ejecutar_reconexion
        try:
            ejecutar_reconexion(
                slug=slug,
                sesion_id=sesion_id,
                grafo=grafo,
                sueltos=desconectados,
                transcripcion_texto=transcripcion_texto,
                grafos_dir=GRAFOS,
                max_chars_transcripcion=settings.max_chars_prompt,
                on_token=_on_token_rec,
                on_texto=None,          # no mezclamos tokens crudos en el log visible
                on_log=_on_log_rec,
                should_cancel=lambda: _RECONEXION_CANCEL.get(slug, False),
            )
        finally:
            _RECONEXION_DONE[slug] = True
            _RECONEXION_CANCEL.pop(slug, None)  # limpiar flag

    background_tasks.add_task(_tarea)
    return {"ok": True, "estado": "procesando", "nodos_sueltos": len(desconectados)}


@app.get("/api/grafo/{slug}/reconexion/stream")
async def stream_reconexion(slug: str):
    """
    SSE: emite el log de reconexión en tiempo real mientras el LLM procesa.
    El cliente cierra la conexión cuando recibe el evento 'done'.
    """
    async def _generate():
        enviados = 0
        # Sentinel: None = sin seguimiento en memoria; False = en curso; True = terminado
        while True:
            done_flag = _RECONEXION_DONE.get(slug)   # None si no hay sesión activa

            # Sin sesión activa en esta instancia: verificar estado en disco
            if done_flag is None:
                if existe_sesion(slug, GRAFOS):
                    try:
                        s = cargar_sesion(slug, GRAFOS)
                        if s.estado in ("en_revision", "cancelada"):
                            yield f"data: {json.dumps({'done': True})}\n\n"
                            break
                    except Exception:
                        pass
                else:
                    yield f"data: {json.dumps({'done': True})}\n\n"
                    break
                await asyncio.sleep(0.2)
                continue

            texto = _RECONEXION_LOG.get(slug, "")
            tokens = _RECONEXION_TOKENS.get(slug, 0)
            nuevo = texto[enviados:]
            if nuevo:
                enviados += len(nuevo)
                payload = json.dumps({"chunk": nuevo, "tokens": tokens}, ensure_ascii=False)
                yield f"data: {payload}\n\n"
            elif tokens > 0:
                # Sin texto nuevo pero hay tokens → emitir solo el contador
                yield f"data: {json.dumps({'tokens': tokens})}\n\n"

            if done_flag and enviados >= len(_RECONEXION_LOG.get(slug, "")):
                yield f"data: {json.dumps({'done': True, 'tokens': tokens})}\n\n"
                break

            await asyncio.sleep(0.1)

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/grafo/{slug}/reconexion/sesion")
def obtener_sesion_reconexion(slug: str):
    """Devuelve la sesión de reconexión activa."""
    if not existe_sesion(slug, GRAFOS):
        raise HTTPException(404, "No hay sesión de reconexión activa")
    sesion = cargar_sesion(slug, GRAFOS)
    # Enriquecer con labels de nodos para el frontend
    estado_val, _ = _cargar_o_crear(slug)
    label_por_id = {c.id: c.label for c in estado_val.extraccion.conceptos}
    ov = estado_val.conceptos_editados
    datos = sesion.model_dump(mode="json")
    for p in datos.get("propuestas", []):
        orig = p["conexion"]["origen_id"]
        dest = p["conexion"]["destino_id"]
        p["conexion"]["origen_label"] = ov.get(orig, {}).get("label") or label_por_id.get(orig, orig)
        p["conexion"]["destino_label"] = ov.get(dest, {}).get("label") or label_por_id.get(dest, dest)
    return datos


class ConfirmarReconexionPayload(BaseModel):
    items: list[dict]  # [{propuesta_id, frase_editada, seleccionada}]


@app.post("/api/grafo/{slug}/reconexion/confirmar")
def confirmar_reconexion(slug: str, payload: ConfirmarReconexionPayload):
    """
    Acepta la selección del investigador: materializa las conexiones aceptadas
    como relaciones_investigador en el estado de validación.
    """
    import uuid as _uuid
    if not existe_sesion(slug, GRAFOS):
        raise HTTPException(404, "No hay sesión de reconexión activa")
    sesion = cargar_sesion(slug, GRAFOS)
    if sesion.estado != "en_revision":
        raise HTTPException(409, f"La sesión está en estado '{sesion.estado}', no se puede confirmar")

    estado_val, ruta_val = _cargar_o_crear(slug)
    ids_validos = {c.id for c in estado_val.extraccion.conceptos}

    # Mapa de overrides del investigador
    items_por_id = {it["propuesta_id"]: it for it in payload.items if "propuesta_id" in it}

    relaciones_agregadas = 0
    for p in sesion.propuestas:
        override = items_por_id.get(p.id, {})
        seleccionada = override.get("seleccionada", p.seleccionada)
        if not seleccionada:
            p.estado = "rechazada"
            continue
        frase = override.get("frase_editada", p.frase_editada) or p.frase_editada
        # Verificar que los nodos siguen existiendo
        if p.conexion.origen_id not in ids_validos or p.conexion.destino_id not in ids_validos:
            p.estado = "rechazada"
            continue
        # Agregar como relación del investigador
        estado_val.relaciones_investigador.append({
            "id":            f"r_rec_{_uuid.uuid4().hex[:8]}",
            "origen_id":     p.conexion.origen_id,
            "destino_id":    p.conexion.destino_id,
            "tipo":          p.conexion.tipo,
            "etiqueta":      frase,
            "bidireccional": False,
        })
        p.estado = "aceptada"
        relaciones_agregadas += 1

    sesion.estado = "completada"
    from datetime import datetime as _dt
    sesion.completada_en = _dt.utcnow()
    guardar(estado_val, ruta_val)
    guardar_sesion(sesion, slug, GRAFOS)

    # Calcular nodos sueltos restantes
    grafo_actualizado = materializar_desde_validacion(estado_val)
    sueltos_restantes = len(nodos_sueltos(grafo_actualizado))

    return {
        "ok": True,
        "relaciones_agregadas":   relaciones_agregadas,
        "nodos_sueltos_restantes": sueltos_restantes,
        "es_conexo":              grafo_actualizado.es_conexo(),
    }


@app.delete("/api/grafo/{slug}/reconexion/sesion")
def cancelar_sesion_reconexion(slug: str):
    """Cancela la sesión de reconexión activa (detiene el LLM si está en curso)."""
    _RECONEXION_CANCEL[slug] = True   # señal al watchdog del LLM
    eliminar_sesion(slug, GRAFOS)
    return {"ok": True}


# ── Consolidación de sinónimos — fusión de nodos duplicados ───────────────────

@app.get("/api/grafo/{slug}/consolidacion/estado")
def estado_consolidacion(slug: str):
    """
    Devuelve cuántos grupos candidatos a fusión detecta la heurística de label
    y si hay una sesión activa. El frontend usa esto para mostrar/ocultar el
    botón de consolidación.
    """
    estado_val, _ = _cargar_o_crear(slug)
    grafo = materializar_desde_validacion(estado_val)
    candidatos = detectar_candidatos(grafo)
    sesion_activa = None
    if persistencia_consolidacion.existe(slug, GRAFOS):
        try:
            s = persistencia_consolidacion.cargar(slug, GRAFOS)
            if s.estado in ("en_revision", "procesando"):
                sesion_activa = s.model_dump(mode="json")
        except Exception:
            pass
    return {
        "candidatos_grupos_count": len(candidatos),
        "candidatos_nodos_count": sum(len(g) for g in candidatos),
        "sesion_activa": sesion_activa,
    }


@app.post("/api/grafo/{slug}/consolidacion/iniciar")
async def iniciar_consolidacion(slug: str, background_tasks: BackgroundTasks):
    """Lanza la detección y confirmación LLM de fusiones candidatas. Background task."""
    estado_val, _ = _cargar_o_crear(slug)
    grafo = materializar_desde_validacion(estado_val)
    candidatos = detectar_candidatos(grafo)
    if not candidatos:
        raise HTTPException(400, "No se detectaron conceptos candidatos a fusionar")

    if persistencia_consolidacion.existe(slug, GRAFOS):
        try:
            s = persistencia_consolidacion.cargar(slug, GRAFOS)
            if s.estado == "en_revision":
                raise HTTPException(409, "Ya hay una sesión de consolidación activa")
        except HTTPException:
            raise
        except Exception:
            pass

    transcripcion_texto: str | None = None
    ruta_t = _ruta_transcript(slug)
    if ruta_t:
        try:
            transcripcion_texto = ruta_t.read_text(encoding="utf-8")
        except Exception:
            pass

    import uuid as _uuid
    sesion_id = f"cons_{_uuid.uuid4().hex[:8]}"
    sesion_placeholder = SesionConsolidacion(
        id=sesion_id,
        slug=slug,
        estado="procesando",
        candidatos_ids=[n.id for grupo in candidatos for n in grupo],
    )
    persistencia_consolidacion.guardar(sesion_placeholder, slug, GRAFOS)

    _CONSOLIDACION_LOG[slug] = ""
    _CONSOLIDACION_TOKENS[slug] = 0
    _CONSOLIDACION_DONE[slug] = False
    _CONSOLIDACION_CANCEL[slug] = False

    def _on_token_cons(total: int) -> None:
        _CONSOLIDACION_TOKENS[slug] = total

    def _on_log_cons(msg: str) -> None:
        _CONSOLIDACION_LOG[slug] = (_CONSOLIDACION_LOG.get(slug, "") + msg)[-16000:]

    def _tarea():
        from src.pipeline.consolidacion import ejecutar_consolidacion
        try:
            ejecutar_consolidacion(
                slug=slug,
                sesion_id=sesion_id,
                grafo=grafo,
                transcripcion_texto=transcripcion_texto,
                grafos_dir=GRAFOS,
                max_chars_transcripcion=settings.max_chars_prompt,
                on_token=_on_token_cons,
                on_texto=None,
                on_log=_on_log_cons,
                should_cancel=lambda: _CONSOLIDACION_CANCEL.get(slug, False),
            )
        finally:
            _CONSOLIDACION_DONE[slug] = True
            _CONSOLIDACION_CANCEL.pop(slug, None)

    background_tasks.add_task(_tarea)
    return {"ok": True, "estado": "procesando", "candidatos_grupos": len(candidatos)}


@app.get("/api/grafo/{slug}/consolidacion/stream")
async def stream_consolidacion(slug: str):
    """SSE: emite el log de consolidación en tiempo real. Mismo patrón que /reconexion/stream."""
    async def _generate():
        enviados = 0
        while True:
            done_flag = _CONSOLIDACION_DONE.get(slug)

            if done_flag is None:
                if persistencia_consolidacion.existe(slug, GRAFOS):
                    try:
                        s = persistencia_consolidacion.cargar(slug, GRAFOS)
                        if s.estado in ("en_revision", "cancelada"):
                            yield f"data: {json.dumps({'done': True})}\n\n"
                            break
                    except Exception:
                        pass
                else:
                    yield f"data: {json.dumps({'done': True})}\n\n"
                    break
                await asyncio.sleep(0.2)
                continue

            texto = _CONSOLIDACION_LOG.get(slug, "")
            tokens = _CONSOLIDACION_TOKENS.get(slug, 0)
            nuevo = texto[enviados:]
            if nuevo:
                enviados += len(nuevo)
                payload = json.dumps({"chunk": nuevo, "tokens": tokens}, ensure_ascii=False)
                yield f"data: {payload}\n\n"
            elif tokens > 0:
                yield f"data: {json.dumps({'tokens': tokens})}\n\n"

            if done_flag and enviados >= len(_CONSOLIDACION_LOG.get(slug, "")):
                yield f"data: {json.dumps({'done': True, 'tokens': tokens})}\n\n"
                break

            await asyncio.sleep(0.1)

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/grafo/{slug}/consolidacion/sesion")
def obtener_sesion_consolidacion(slug: str):
    """Devuelve la sesión de consolidación activa, con labels resueltos."""
    if not persistencia_consolidacion.existe(slug, GRAFOS):
        raise HTTPException(404, "No hay sesión de consolidación activa")
    sesion = persistencia_consolidacion.cargar(slug, GRAFOS)
    estado_val, _ = _cargar_o_crear(slug)
    label_por_id = {c.id: c.label for c in estado_val.extraccion.conceptos}
    ov = estado_val.conceptos_editados

    def _label(cid: str) -> str:
        return ov.get(cid, {}).get("label") or label_por_id.get(cid, cid)

    datos = sesion.model_dump(mode="json")
    for p in datos.get("propuestas", []):
        prop = p["propuesta"]
        prop["nodo_canonico_label"] = _label(prop["nodo_canonico_id"])
        prop["nodos_absorbidos_labels"] = [_label(a) for a in prop["nodos_absorbidos_ids"]]
    return datos


class ConfirmarConsolidacionPayload(BaseModel):
    items: list[dict]  # [{propuesta_id, label_editado, seleccionada}]


@app.post("/api/grafo/{slug}/consolidacion/confirmar")
def confirmar_consolidacion(slug: str, payload: ConfirmarConsolidacionPayload):
    """
    Acepta la selección del investigador: fusiona de verdad los nodos
    aceptados (redirección de relaciones incluida vía materializar_desde_validacion).
    """
    if not persistencia_consolidacion.existe(slug, GRAFOS):
        raise HTTPException(404, "No hay sesión de consolidación activa")
    sesion = persistencia_consolidacion.cargar(slug, GRAFOS)
    if sesion.estado != "en_revision":
        raise HTTPException(409, f"La sesión está en estado '{sesion.estado}', no se puede confirmar")

    estado_val, ruta_val = _cargar_o_crear(slug)
    ids_validos = {c.id for c in estado_val.extraccion.conceptos}

    items_por_id = {it["propuesta_id"]: it for it in payload.items if "propuesta_id" in it}

    fusiones_aplicadas = 0
    for p in sesion.propuestas:
        override = items_por_id.get(p.id, {})
        seleccionada = override.get("seleccionada", p.seleccionada)
        if not seleccionada:
            p.estado = "rechazada"
            continue
        label_final = override.get("label_editado", p.label_editado) or p.label_editado
        canonico_id = p.propuesta.nodo_canonico_id
        absorbidos_ids = [a for a in p.propuesta.nodos_absorbidos_ids if a in ids_validos]
        if canonico_id not in ids_validos or not absorbidos_ids:
            p.estado = "rechazada"
            continue
        fusionar_conceptos(estado_val, canonico_id, absorbidos_ids, label_canonico=label_final)
        p.estado = "aceptada"
        fusiones_aplicadas += 1

    sesion.estado = "completada"
    from datetime import datetime as _dt
    sesion.completada_en = _dt.utcnow()
    guardar(estado_val, ruta_val)
    persistencia_consolidacion.guardar(sesion, slug, GRAFOS)

    grafo_actualizado = materializar_desde_validacion(estado_val)

    return {
        "ok": True,
        "fusiones_aplicadas": fusiones_aplicadas,
        "nodos_totales": len(grafo_actualizado.nodos),
    }


@app.delete("/api/grafo/{slug}/consolidacion/sesion")
def cancelar_sesion_consolidacion(slug: str):
    """Cancela la sesión de consolidación activa."""
    _CONSOLIDACION_CANCEL[slug] = True
    persistencia_consolidacion.eliminar(slug, GRAFOS)
    return {"ok": True}


# ── Creación de relaciones por el investigador ────────────────────────────────

class NuevaRelacionPayload(BaseModel):
    origen_id: str
    destino_id: str
    tipo: str
    etiqueta: str
    bidireccional: bool = False


@app.post("/api/validacion/{slug}/relaciones")
def crear_relacion_investigador(slug: str, payload: NuevaRelacionPayload):
    """Añade una relación creada manualmente por el investigador."""
    import uuid
    estado, ruta_val = _cargar_o_crear(slug)
    ids_validos = {c.id for c in estado.extraccion.conceptos}
    if payload.origen_id not in ids_validos:
        raise HTTPException(404, f"Concepto origen '{payload.origen_id}' no encontrado")
    if payload.destino_id not in ids_validos:
        raise HTTPException(404, f"Concepto destino '{payload.destino_id}' no encontrado")
    rid = f"r_inv_{str(uuid.uuid4())[:8]}"
    estado.relaciones_investigador.append({
        "id":            rid,
        "origen_id":     payload.origen_id,
        "destino_id":    payload.destino_id,
        "tipo":          payload.tipo,
        "etiqueta":      payload.etiqueta,
        "bidireccional": payload.bidireccional,
    })
    guardar(estado, ruta_val)
    return {"ok": True, "id": rid}


# ── Edición de conceptos y relaciones ─────────────────────────────────────────

class EditConceptoPayload(BaseModel):
    label: Optional[str] = None


@app.patch("/api/validacion/{slug}/conceptos/{cid}")
def editar_concepto(slug: str, cid: str, payload: EditConceptoPayload):
    estado, ruta_val = _cargar_o_crear(slug)
    if not any(c.id == cid for c in estado.extraccion.conceptos):
        raise HTTPException(404, f"Concepto '{cid}' no encontrado")
    ov = estado.conceptos_editados.get(cid, {})
    if payload.label is not None:
        ov["label"] = payload.label
    estado.conceptos_editados[cid] = ov
    guardar(estado, ruta_val)
    return {"ok": True}


class EditRelacionPayload(BaseModel):
    tipo: Optional[str] = None
    etiqueta: Optional[str] = None
    bidireccional: Optional[bool] = None


@app.patch("/api/validacion/{slug}/relaciones/{rid}")
def editar_relacion(slug: str, rid: str, payload: EditRelacionPayload):
    estado, ruta_val = _cargar_o_crear(slug)
    if not any(r.id == rid for r in estado.extraccion.relaciones):
        raise HTTPException(404, f"Relación '{rid}' no encontrada")
    ov = estado.relaciones_editadas.get(rid, {})
    if payload.tipo is not None:
        ov["tipo"] = payload.tipo
    if payload.etiqueta is not None:
        ov["etiqueta"] = payload.etiqueta
    if payload.bidireccional is not None:
        ov["bidireccional"] = payload.bidireccional
    estado.relaciones_editadas[rid] = ov
    guardar(estado, ruta_val)
    return {"ok": True}


class MetadatosPayload(BaseModel):
    titulo: Optional[str] = None
    autores: Optional[list[str]] = None
    anio: Optional[int] = None
    editorial: Optional[str] = None
    url: Optional[str] = None
    notas: Optional[str] = None


def _ruta_metadatos_standalone(slug: str) -> Path:
    """Archivo de metadatos independiente para textos aún sin extracción."""
    return GRAFOS / f"{slug}_metadatos.json"


def _leer_metadatos(slug: str) -> MetadatosTexto:
    """Lee metadatos desde la validación (si existe) o el archivo standalone."""
    ruta_val = ruta_validacion(slug, GRAFOS)
    if ruta_val.exists():
        try:
            return cargar(ruta_val).metadatos
        except Exception:
            pass
    ruta_meta = _ruta_metadatos_standalone(slug)
    if ruta_meta.exists():
        try:
            return MetadatosTexto.model_validate_json(ruta_meta.read_text("utf-8"))
        except Exception:
            pass
    return MetadatosTexto()


def _guardar_metadatos(slug: str, m: MetadatosTexto) -> str:
    """Guarda metadatos donde corresponda y retorna la cita generada."""
    ruta_val = ruta_validacion(slug, GRAFOS)
    if ruta_val.exists():
        try:
            estado = cargar(ruta_val)
            estado.metadatos = m
            if m.titulo:
                estado.titulo = m.titulo
            guardar(estado, ruta_val)
            return m.cita()
        except Exception:
            pass
    # Sin validación: guardar en archivo standalone
    GRAFOS.mkdir(parents=True, exist_ok=True)
    _ruta_metadatos_standalone(slug).write_text(
        m.model_dump_json(indent=2), encoding="utf-8"
    )
    return m.cita()


@app.get("/api/metadatos/{slug}")
def obtener_metadatos(slug: str):
    """Devuelve los metadatos editoriales de cualquier texto (procesado o no)."""
    # Verificar que el transcript existe
    if not _ruta_transcript(slug) and not (GRAFOS / f"{slug}_extraccion.json").exists():
        raise HTTPException(404, f"No se encontró texto para slug '{slug}'")
    return _leer_metadatos(slug).model_dump()


@app.patch("/api/metadatos/{slug}")
def actualizar_metadatos_general(slug: str, payload: MetadatosPayload):
    """Actualiza los metadatos de cualquier texto (procesado o no)."""
    m = _leer_metadatos(slug)
    if payload.titulo    is not None: m.titulo    = payload.titulo
    if payload.autores   is not None: m.autores   = payload.autores
    if payload.anio      is not None: m.anio      = payload.anio
    if payload.editorial is not None: m.editorial = payload.editorial
    if payload.url       is not None: m.url       = payload.url
    if payload.notas     is not None: m.notas     = payload.notas
    cita = _guardar_metadatos(slug, m)
    return {"ok": True, "cita": cita}


@app.patch("/api/validacion/{slug}/metadatos")
def actualizar_metadatos(slug: str, payload: MetadatosPayload):
    """Actualiza los metadatos editoriales del texto (requiere extracción)."""
    estado, ruta_val = _cargar_o_crear(slug)
    m = estado.metadatos
    if payload.titulo    is not None: m.titulo    = payload.titulo
    if payload.autores   is not None: m.autores   = payload.autores
    if payload.anio      is not None: m.anio      = payload.anio
    if payload.editorial is not None: m.editorial = payload.editorial
    if payload.url       is not None: m.url       = payload.url
    if payload.notas     is not None: m.notas     = payload.notas
    # Sincronizar título principal si se editó
    if payload.titulo:
        estado.titulo = payload.titulo
    guardar(estado, ruta_val)
    return {"ok": True, "cita": m.cita()}


class AnotarPayload(BaseModel):
    objeto_anotado: str
    nota: str


@app.post("/api/validacion/{slug}/anotar")
def agregar_anotacion(slug: str, payload: AnotarPayload):
    import uuid
    estado, ruta_val = _cargar_o_crear(slug)
    estado.anotaciones.append(AnotacionInvestigador(
        id=str(uuid.uuid4())[:8],
        objeto_anotado=payload.objeto_anotado,
        nota=payload.nota,
    ))
    guardar(estado, ruta_val)
    return {"ok": True}


# ══ Grafos personales ════════════════════════════════════════════════════════


def _slugify(titulo: str) -> str:
    import unicodedata, re
    s = unicodedata.normalize("NFKD", titulo).encode("ascii", "ignore").decode()
    s = re.sub(r"[^\w\s-]", "", s).strip().lower()
    return re.sub(r"[\s_-]+", "-", s)[:60]


class NuevoGrafoPersonalPayload(BaseModel):
    titulo: str
    descripcion: Optional[str] = None


@app.get("/api/grafos-personales")
def listar_grafos_personales():
    """Lista todos los grafos personales."""
    grafos = listar_gp(GRAFOS)
    return [
        {
            "slug": g.slug,
            "titulo": g.titulo,
            "descripcion": g.descripcion,
            "total_conceptos": len(g.conceptos_propios),
            "total_relaciones": len(g.relaciones),
            "actualizado_en": g.actualizado_en.isoformat(),
        }
        for g in grafos
    ]


@app.post("/api/grafos-personales")
def crear_grafo_personal(payload: NuevoGrafoPersonalPayload):
    """Crea un nuevo grafo personal."""
    slug = _slugify(payload.titulo)
    if not slug:
        from fastapi import HTTPException
        raise HTTPException(400, "Título no válido para generar slug")
    ruta = ruta_grafo_personal(slug, GRAFOS)
    if ruta.exists():
        # Añadir sufijo numérico para evitar colisión
        base = slug
        for i in range(2, 100):
            slug = f"{base}-{i}"
            ruta = ruta_grafo_personal(slug, GRAFOS)
            if not ruta.exists():
                break
    grafo = GrafoPersonal(
        titulo=payload.titulo,
        slug=slug,
        descripcion=payload.descripcion,
    )
    guardar_gp(grafo, GRAFOS)
    return {"ok": True, "slug": slug}


@app.get("/api/grafos-personales/{slug}")
def obtener_grafo_personal(slug: str):
    """Devuelve el estado completo de un grafo personal."""
    ruta = ruta_grafo_personal(slug, GRAFOS)
    if not ruta.exists():
        raise HTTPException(404, f"Grafo personal '{slug}' no encontrado")
    grafo = cargar_gp(slug, GRAFOS)
    return grafo.model_dump(mode="json")


@app.get("/api/grafos-personales/{slug}/grafo")
def obtener_grafo_personal_vis(slug: str):
    """Devuelve nodos y aristas para visualización D3."""
    ruta = ruta_grafo_personal(slug, GRAFOS)
    if not ruta.exists():
        raise HTTPException(404, f"Grafo personal '{slug}' no encontrado")
    grafo = cargar_gp(slug, GRAFOS)
    nodes = [
        {
            "id":        c.id,
            "label":     c.label,
            "tipo":      "investigador",
            "definicion": c.definicion,
            "menciones": 1,
            "confianza": 1.0,
            "citas":     [{"texto": ct.texto, "fuente": ct.fuente} for ct in c.citas],
        }
        for c in grafo.conceptos_propios
    ]
    links = [
        {
            "id":            r.id,
            "source":        r.origen_id,
            "target":        r.destino_id,
            "tipo":          r.tipo,
            "etiqueta":      r.etiqueta,
            "bidireccional": r.bidireccional,
            "confianza":     1.0,
        }
        for r in grafo.relaciones
    ]
    return {"nodes": nodes, "links": links}


class NuevoConceptoGPPayload(BaseModel):
    label: str
    definicion: Optional[str] = None


@app.post("/api/grafos-personales/{slug}/conceptos")
def agregar_concepto_gp(slug: str, payload: NuevoConceptoGPPayload):
    """Añade un concepto propio al grafo personal."""
    import uuid
    ruta = ruta_grafo_personal(slug, GRAFOS)
    if not ruta.exists():
        raise HTTPException(404, f"Grafo personal '{slug}' no encontrado")
    grafo = cargar_gp(slug, GRAFOS)
    cid = f"ci_{str(uuid.uuid4())[:8]}"
    concepto = ConceptoGP(id=cid, label=payload.label, definicion=payload.definicion)
    grafo.conceptos_propios.append(concepto)
    from datetime import datetime
    grafo.actualizado_en = datetime.utcnow()
    guardar_gp(grafo, GRAFOS)
    return {"ok": True, "id": cid}


class EditarConceptoGPPayload(BaseModel):
    label: Optional[str] = None
    definicion: Optional[str] = None


@app.patch("/api/grafos-personales/{slug}/conceptos/{cid}")
def editar_concepto_gp(slug: str, cid: str, payload: EditarConceptoGPPayload):
    """Edita un concepto del grafo personal."""
    ruta = ruta_grafo_personal(slug, GRAFOS)
    if not ruta.exists():
        raise HTTPException(404, f"Grafo personal '{slug}' no encontrado")
    grafo = cargar_gp(slug, GRAFOS)
    c = next((c for c in grafo.conceptos_propios if c.id == cid), None)
    if not c:
        raise HTTPException(404, f"Concepto '{cid}' no encontrado")
    from datetime import datetime
    if payload.label is not None:
        c.label = payload.label
    if payload.definicion is not None:
        c.definicion = payload.definicion
    c.actualizado_en = datetime.utcnow()
    grafo.actualizado_en = datetime.utcnow()
    guardar_gp(grafo, GRAFOS)
    return {"ok": True}


@app.delete("/api/grafos-personales/{slug}/conceptos/{cid}")
def eliminar_concepto_gp(slug: str, cid: str):
    """Elimina un concepto del grafo personal (si no tiene relaciones)."""
    ruta = ruta_grafo_personal(slug, GRAFOS)
    if not ruta.exists():
        raise HTTPException(404, f"Grafo personal '{slug}' no encontrado")
    grafo = cargar_gp(slug, GRAFOS)
    en_uso = any(r.origen_id == cid or r.destino_id == cid for r in grafo.relaciones)
    if en_uso:
        raise HTTPException(409, "El concepto tiene relaciones. Elimínalas primero.")
    grafo.conceptos_propios = [c for c in grafo.conceptos_propios if c.id != cid]
    from datetime import datetime
    grafo.actualizado_en = datetime.utcnow()
    guardar_gp(grafo, GRAFOS)
    return {"ok": True}


class NuevaRelacionGPPayload(BaseModel):
    origen_id: str
    destino_id: str
    tipo: str
    etiqueta: str
    bidireccional: bool = False


@app.post("/api/grafos-personales/{slug}/relaciones")
def agregar_relacion_gp(slug: str, payload: NuevaRelacionGPPayload):
    """Añade una relación entre dos conceptos del grafo personal."""
    import uuid
    ruta = ruta_grafo_personal(slug, GRAFOS)
    if not ruta.exists():
        raise HTTPException(404, f"Grafo personal '{slug}' no encontrado")
    grafo = cargar_gp(slug, GRAFOS)
    ids_validos = {c.id for c in grafo.conceptos_propios}
    if payload.origen_id not in ids_validos:
        raise HTTPException(404, f"Concepto origen '{payload.origen_id}' no encontrado")
    if payload.destino_id not in ids_validos:
        raise HTTPException(404, f"Concepto destino '{payload.destino_id}' no encontrado")
    if payload.origen_id == payload.destino_id:
        raise HTTPException(400, "Un concepto no puede relacionarse consigo mismo")
    rid = f"ri_{str(uuid.uuid4())[:8]}"
    grafo.relaciones.append(RelacionGP(
        id=rid,
        origen_id=payload.origen_id,
        destino_id=payload.destino_id,
        tipo=payload.tipo,
        etiqueta=payload.etiqueta,
        bidireccional=payload.bidireccional,
    ))
    from datetime import datetime
    grafo.actualizado_en = datetime.utcnow()
    guardar_gp(grafo, GRAFOS)
    return {"ok": True, "id": rid}


class ActualizarGrafoPersonalPayload(BaseModel):
    titulo: Optional[str] = None
    descripcion: Optional[str] = None


@app.patch("/api/grafos-personales/{slug}")
def actualizar_grafo_personal(slug: str, payload: ActualizarGrafoPersonalPayload):
    """Renombra o actualiza la descripción de un grafo personal."""
    ruta = ruta_grafo_personal(slug, GRAFOS)
    if not ruta.exists():
        raise HTTPException(404, f"Grafo personal '{slug}' no encontrado")
    grafo = cargar_gp(slug, GRAFOS)
    from datetime import datetime
    if payload.titulo is not None:
        grafo.titulo = payload.titulo
    if payload.descripcion is not None:
        grafo.descripcion = payload.descripcion
    grafo.actualizado_en = datetime.utcnow()
    guardar_gp(grafo, GRAFOS)
    return {"ok": True}


@app.delete("/api/grafos-personales/{slug}")
def eliminar_grafo_personal(slug: str):
    """Elimina completamente un grafo personal."""
    ruta = ruta_grafo_personal(slug, GRAFOS)
    if not ruta.exists():
        raise HTTPException(404, f"Grafo personal '{slug}' no encontrado")
    ruta.unlink()
    return {"ok": True}


@app.delete("/api/grafos-personales/{slug}/relaciones/{rid}")
def eliminar_relacion_gp(slug: str, rid: str):
    """Elimina una relación del grafo personal."""
    ruta = ruta_grafo_personal(slug, GRAFOS)
    if not ruta.exists():
        raise HTTPException(404, f"Grafo personal '{slug}' no encontrado")
    grafo = cargar_gp(slug, GRAFOS)
    orig = len(grafo.relaciones)
    grafo.relaciones = [r for r in grafo.relaciones if r.id != rid]
    if len(grafo.relaciones) == orig:
        raise HTTPException(404, f"Relación '{rid}' no encontrada")
    from datetime import datetime
    grafo.actualizado_en = datetime.utcnow()
    guardar_gp(grafo, GRAFOS)
    return {"ok": True}


# ── Settings (modelo Ollama) ──────────────────────────────────────────────────

def _actualizar_env(key: str, value: str) -> None:
    env_path = Path(".env")
    lines = env_path.read_text("utf-8").splitlines() if env_path.exists() else []
    nuevas, encontrada = [], False
    for linea in lines:
        if linea.startswith(f"{key}="):
            nuevas.append(f"{key}={value}")
            encontrada = True
        else:
            nuevas.append(linea)
    if not encontrada:
        nuevas.append(f"{key}={value}")
    env_path.write_text("\n".join(nuevas) + "\n", encoding="utf-8")


def _leer_key_env(nombre: str) -> str | None:
    """Lee un valor del .env en disco (fresco, no del proceso en memoria)."""
    env_path = Path(".env")
    if not env_path.exists():
        return None
    for linea in env_path.read_text("utf-8").splitlines():
        linea = linea.strip()
        if linea.startswith(f"{nombre}="):
            val = linea[len(f"{nombre}="):].strip()
            if val and val[0] in ('"', "'") and val[-1] == val[0]:
                val = val[1:-1]
            return val or None
    return None


@app.get("/api/settings")
async def obtener_settings():
    """Configuración actual + modelos disponibles y estado por proveedor."""
    modelos: list[str] = []
    ollama_ok = False
    if settings.provider == "ollama":
        try:
            import httpx as _httpx
            r = _httpx.get(f"{settings.ollama_endpoint}/api/tags", timeout=4.0)
            if r.status_code == 200:
                modelos = [m["name"] for m in r.json().get("models", [])]
                ollama_ok = True
        except Exception:
            pass
    modelo_actual = (
        settings.ollama_model if settings.provider == "ollama"
        else getattr(settings, f"{settings.provider}_model", None)
    )
    return {
        "provider":         settings.provider,
        "model":            modelo_actual,
        "available_models": modelos,
        "providers_status": {
            "ollama": {
                "model":     settings.ollama_model or "",
                "connected": ollama_ok,
            },
            "anthropic": {
                "model":   settings.anthropic_model,
                "has_key": bool(_leer_key_env("ANTHROPIC_API_KEY") or settings.anthropic_api_key),
            },
            "openai": {
                "model":   settings.openai_model,
                "has_key": bool(_leer_key_env("OPENAI_API_KEY") or settings.openai_api_key),
            },
            "gemini": {
                "model":   settings.gemini_model,
                "has_key": bool(_leer_key_env("GEMINI_API_KEY") or settings.gemini_api_key),
            },
        },
    }


class SettingsPayload(BaseModel):
    model:    Optional[str] = None
    provider: Optional[str] = None


@app.patch("/api/settings")
async def actualizar_settings(payload: SettingsPayload):
    """Cambia el proveedor y/o modelo en uso. Escribe .env y actualiza en memoria."""
    valid_providers = {"ollama", "anthropic", "openai", "gemini"}
    new_provider = (payload.provider or "").strip() or None
    if new_provider and new_provider not in valid_providers:
        raise HTTPException(400, f"Proveedor no reconocido: '{new_provider}'")

    target = new_provider or settings.provider

    if target == "ollama":
        new_model = (payload.model or "").strip() or settings.ollama_model or ""
        if not new_model:
            raise HTTPException(400, "OLLAMA_MODEL debe estar configurado")
    elif target == "anthropic":
        key = _leer_key_env("ANTHROPIC_API_KEY") or settings.anthropic_api_key
        if not key:
            raise HTTPException(400, "ANTHROPIC_API_KEY no está configurada en .env")
        object.__setattr__(settings, "anthropic_api_key", key)
        new_model = (payload.model or "").strip() or settings.anthropic_model
    elif target == "openai":
        key = _leer_key_env("OPENAI_API_KEY") or settings.openai_api_key
        if not key:
            raise HTTPException(400, "OPENAI_API_KEY no está configurada en .env")
        object.__setattr__(settings, "openai_api_key", key)
        new_model = (payload.model or "").strip() or settings.openai_model
    elif target == "gemini":
        key = _leer_key_env("GEMINI_API_KEY") or settings.gemini_api_key
        if not key:
            raise HTTPException(400, "GEMINI_API_KEY no está configurada en .env")
        object.__setattr__(settings, "gemini_api_key", key)
        _GEMINI_DEFAULT = "gemini-2.0-flash"
        _GEMINI_DEPRECATED = {"gemini-1.5-pro", "gemini-1.5-flash", "gemini-1.0-pro"}
        env_model = _leer_key_env("GEMINI_MODEL") or ""
        requested = (payload.model or "").strip()
        if requested:
            new_model = requested
        elif env_model and env_model not in _GEMINI_DEPRECATED:
            new_model = env_model
        else:
            new_model = _GEMINI_DEFAULT

    if new_provider and new_provider != settings.provider:
        _actualizar_env("PROVIDER", new_provider)
        object.__setattr__(settings, "provider", new_provider)

    if new_model:
        if target == "ollama":
            _actualizar_env("OLLAMA_MODEL", new_model)
            object.__setattr__(settings, "ollama_model", new_model)
        else:
            _actualizar_env(f"{target.upper()}_MODEL", new_model)
            object.__setattr__(settings, f"{target}_model", new_model)

    return {"ok": True, "provider": settings.provider, "model": new_model}


@app.get("/api/extracciones/{slug}/stream")
async def stream_extraccion(slug: str):
    """
    SSE: emite el log LLM de una extracción en tiempo real.
    Útil para ver token a token sin esperar el polling de /api/extracciones.
    """
    async def _generate():
        enviados = 0
        while True:
            tarea = _TAREAS.get(slug)
            if not isinstance(tarea, dict):
                yield f"data: {json.dumps({'done': True})}\n\n"
                break

            texto = tarea.get("texto_llm", "")
            estado = tarea.get("estado", "")
            fase   = tarea.get("fase", "")
            tokens = tarea.get("tokens", 0)

            nuevo = texto[enviados:]
            if nuevo:
                enviados += len(nuevo)
                payload = json.dumps({"chunk": nuevo, "tokens": tokens, "fase": fase}, ensure_ascii=False)
                yield f"data: {payload}\n\n"

            if estado != "procesando":
                yield f"data: {json.dumps({'done': True, 'estado': estado})}\n\n"
                break

            await asyncio.sleep(0.08)

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.delete("/api/extracciones/{slug}/procesar")
async def cancelar_extraccion(slug: str):
    """Cancela una extracción en curso poniendo la bandera 'cancelar'."""
    tarea = _TAREAS.get(slug)
    if not isinstance(tarea, dict) or tarea.get("estado") != "procesando":
        raise HTTPException(400, "No hay extracción en curso para este texto")
    _TAREAS[slug]["cancelar"] = True
    return {"ok": True}


# ── Transcripts (lectura y edición del texto fuente) ─────────────────────────

@app.get("/api/transcripts/{slug}")
def obtener_transcript(slug: str):
    """Devuelve el texto del transcript (editado si existe, original en caso contrario)."""
    ruta = _ruta_transcript(slug)
    texto_original: str | None = None
    if ruta:
        texto_original = ruta.read_text("utf-8", errors="replace")

    # Leer texto editado y metadatos de revisión desde el estado de validación
    texto_editado: str | None = None
    revisiones: list[dict] = []
    desincronizado_desde: str | None = None
    rv = ruta_validacion(slug, GRAFOS)
    if rv.exists():
        try:
            ev = cargar(rv)
            texto_editado = ev.texto_editado
            revisiones = [
                {"fecha": r.fecha.isoformat(), "nota_autor": r.nota_autor}
                for r in ev.revisiones_texto
            ]
            if ev.texto_desincronizado_desde:
                desincronizado_desde = ev.texto_desincronizado_desde.isoformat()
        except Exception:
            pass

    texto = texto_editado if texto_editado is not None else texto_original
    if texto is None:
        raise HTTPException(404, f"No se encontró transcript para slug '{slug}'")

    return {
        "slug": slug,
        "nombre": ruta.name if ruta else slug,
        "texto": texto,
        "es_editado": texto_editado is not None,
        "texto_desincronizado_desde": desincronizado_desde,
        "revisiones": revisiones,
    }


class EditarTextoPayload(BaseModel):
    texto: str
    nota: Optional[str] = None


@app.patch("/api/transcripts/{slug}")
def editar_transcript(slug: str, payload: EditarTextoPayload):
    """Guarda una edición del texto fuente y registra la revisión."""
    from src.models.validacion import RevisionTexto

    rv = ruta_validacion(slug, GRAFOS)
    if not rv.exists():
        raise HTTPException(404, f"No hay datos de validación para '{slug}'")

    estado = cargar(rv)

    # Texto actual (editado o del archivo original)
    texto_actual = estado.texto_editado
    if texto_actual is None:
        ruta = _ruta_transcript(slug)
        texto_actual = ruta.read_text("utf-8", errors="replace") if ruta else ""

    # Registrar revisión con snapshot del texto anterior
    estado.revisiones_texto.append(RevisionTexto(
        texto_anterior=texto_actual,
        nota_autor=payload.nota,
    ))
    estado.texto_editado = payload.texto

    # Marcar desincronización si ya hay extracción
    if estado.extraccion and estado.extraccion.conceptos:
        from datetime import datetime
        estado.texto_desincronizado_desde = datetime.utcnow()

    guardar(estado, rv)
    return {
        "ok": True,
        "revisiones": len(estado.revisiones_texto),
        "texto_desincronizado_desde": (
            estado.texto_desincronizado_desde.isoformat()
            if estado.texto_desincronizado_desde else None
        ),
    }


# ── Static files (debe ir al final) ───────────────────────────────────────────
app.mount("/", StaticFiles(directory=str(STATIC), html=True), name="static")
