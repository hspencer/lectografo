"""
Pipeline de reconexión de nodos sueltos (getYourStuffTogether).
Implementa la lógica de IniciarReconexion y ReconexionLLMCompleta
definidos en specs/getYourStuffTogether.allium.
"""
import json
import re
import uuid
from pathlib import Path

from src.models.grafo import Grafo, Nodo
from src.models.reconexion import ConexionPropuesta, PropuestaEnRevision, SesionReconexion


# ── Serialización del grafo como contexto LLM ─────────────────────────────────

def construir_contexto_grafo(grafo: Grafo) -> str:
    """
    Serializa el grafo como texto comprimido apto para un prompt LLM.
    Incluye nodos (id, label, descripcion_corta) y relaciones (origen→destino, etiqueta).
    Implementa la función deferred construir_contexto_grafo de specs/getYourStuffTogether.allium.
    """
    lineas = ["### Nodos del grafo\n"]
    for n in grafo.nodos:
        desc = n.descripcion_corta[:120] if n.descripcion_corta else ""
        lineas.append(f"- [{n.id}] **{n.label}**: {desc}")

    lineas.append("\n### Relaciones existentes\n")
    # Índice de labels para humanizar el contexto
    label_por_id = {n.id: n.label for n in grafo.nodos}
    for r in grafo.relaciones:
        org = label_por_id.get(r.origen_id, r.origen_id)
        dst = label_por_id.get(r.destino_id, r.destino_id)
        lineas.append(f"- [{r.origen_id}] {org} —{r.etiqueta}→ [{r.destino_id}] {dst}")

    return "\n".join(lineas)


def construir_seccion_sueltos(sueltos: list[Nodo]) -> str:
    """
    Formatea los nodos desconectados con sus citas directas.
    Acepta tanto nodos aislados como nodos de componentes separadas.
    """
    lineas = []
    for n in sueltos:
        lineas.append(f"- [{n.id}] **{n.label}**: {n.descripcion_corta}")
        if n.cita_directa:
            lineas.append(f"  > \"{n.cita_directa[:200]}\"")
    return "\n".join(lineas)


def construir_prompt_reconexion(
    grafo: Grafo,
    sueltos: list[Nodo],
    transcripcion_texto: str | None,
    max_chars_transcripcion: int = 40000,
) -> tuple[str, str]:
    """
    Construye (prompt_sistema, texto_usuario) para la llamada al LLM.
    Carga la plantilla desde prompts/reconexion_v1.md.
    """
    plantilla_path = Path(__file__).parent.parent.parent / "prompts" / "reconexion_v1.md"
    plantilla = plantilla_path.read_text(encoding="utf-8")

    contexto_grafo = construir_contexto_grafo(grafo)
    seccion_sueltos = construir_seccion_sueltos(sueltos)

    if transcripcion_texto and len(transcripcion_texto) <= max_chars_transcripcion:
        transcripcion_section = f"## Texto original de referencia\n\n{transcripcion_texto}"
    else:
        transcripcion_section = ""

    prompt_relleno = (
        plantilla
        .replace("{contexto_grafo}", contexto_grafo)
        .replace("{nodos_sueltos}", seccion_sueltos)
        .replace("{transcripcion_section}", transcripcion_section)
    )

    return prompt_relleno, ""


# ── Parseo de la respuesta del LLM ────────────────────────────────────────────

def parsear_respuesta_reconexion(
    texto: str,
    ids_validos: set[str],
) -> list[ConexionPropuesta]:
    """
    Parsea la respuesta JSON del LLM para reconexión.
    Devuelve la lista de ConexionPropuesta, descartando las que apunten a IDs inválidos.
    Tolerante a fallos: ante JSON incompleto devuelve lo que pueda recuperar.
    """
    limpio = re.sub(r"<think>.*?</think>", "", texto, flags=re.DOTALL).strip()
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", limpio, re.DOTALL)
    if m:
        limpio = m.group(1)

    try:
        data = json.loads(limpio)
    except json.JSONDecodeError:
        # Intentar extraer el array de conexiones
        m2 = re.search(r'"conexiones"\s*:\s*\[', limpio)
        if not m2:
            return []
        data = {"conexiones": _extraer_items_array(limpio, m2.end() - 1)}

    conexiones: list[ConexionPropuesta] = []
    for i, raw in enumerate(data.get("conexiones") or []):
        if not isinstance(raw, dict):
            continue
        orig = raw.get("origen_id", "")
        dest = raw.get("destino_id", "")
        if orig not in ids_validos or dest not in ids_validos:
            continue
        if orig == dest:
            continue
        try:
            conexiones.append(ConexionPropuesta(
                id=f"cp_{i:03d}",
                origen_id=orig,
                destino_id=dest,
                frase=str(raw.get("frase") or raw.get("tipo") or "relacionado con")[:200],
                tipo=str(raw.get("tipo") or "relacionado_con")[:80],
                confianza=max(0.0, min(1.0, float(raw.get("confianza", 0.7)))),
            ))
        except Exception:
            continue
    return conexiones


def _extraer_items_array(texto: str, inicio: int) -> list[dict]:
    """Extrae items completos de un array JSON desde la posición dada."""
    items = []
    pos = inicio + 1
    while pos < len(texto):
        while pos < len(texto) and texto[pos] in " \t\n\r,":
            pos += 1
        if pos >= len(texto) or texto[pos] in ("]", "}"):
            break
        if texto[pos] != "{":
            break
        depth = 0
        in_str = False
        escape = False
        for i in range(pos, len(texto)):
            ch = texto[i]
            if escape:
                escape = False; continue
            if ch == "\\" and in_str:
                escape = True; continue
            if ch == '"' and not escape:
                in_str = not in_str; continue
            if in_str:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        items.append(json.loads(texto[pos:i+1]))
                    except json.JSONDecodeError:
                        pass
                    pos = i + 1
                    break
        else:
            break
    return items


# ── Ejecución asíncrona ───────────────────────────────────────────────────────

def ejecutar_reconexion(
    slug: str,
    grafo: Grafo,
    sueltos: list[Nodo],
    transcripcion_texto: str | None,
    grafos_dir: Path,
    sesion_id: str | None = None,
    max_chars_transcripcion: int = 40000,
    on_token=None,
    on_texto=None,
    should_cancel=None,
    on_log=None,
) -> SesionReconexion:
    """
    Llama al LLM y construye la SesionReconexion con las propuestas.
    Se ejecuta en un hilo separado (ThreadPoolExecutor).
    Persiste la sesión en disco en cada estado relevante.
    Si se provee sesion_id, reutiliza la sesión placeholder ya guardada.
    """
    from src.llm import get_llm
    from src.persistencia.reconexion import guardar as guardar_sesion, cargar as cargar_sesion, existe as existe_sesion

    # Reutilizar sesión placeholder si fue creada por el endpoint, o crear nueva
    sesion: SesionReconexion | None = None
    if sesion_id and existe_sesion(slug, grafos_dir):
        try:
            sesion = cargar_sesion(slug, grafos_dir)
        except Exception:
            sesion = None

    if sesion is None:
        sesion_id = sesion_id or f"rec_{uuid.uuid4().hex[:8]}"
        sesion = SesionReconexion(
            id=sesion_id,
            slug=slug,
            estado="procesando",
            nodos_sueltos_ids=[n.id for n in sueltos],
        )
        guardar_sesion(sesion, slug, grafos_dir)

    def _log(msg: str) -> None:
        if on_log:
            on_log(msg + "\n")

    try:
        llm = get_llm()

        _log(f"Grafo: {len(grafo.nodos)} nodos, {len(grafo.relaciones)} relaciones")
        _log(f"Conceptos a reconectar ({len(sueltos)}):")
        for n in sueltos:
            _log(f"  [{n.id}] {n.label}")
        _log("")
        _log("Consultando al LLM...")
        _log("")

        prompt_sistema, _ = construir_prompt_reconexion(
            grafo, sueltos, transcripcion_texto, max_chars_transcripcion
        )
        respuesta = llm.invocar(
            prompt_sistema=prompt_sistema,
            texto="",
            on_token=on_token,
            on_texto=on_texto,
            should_cancel=should_cancel,
        )

        ids_validos = {n.id for n in grafo.nodos}
        conexiones = parsear_respuesta_reconexion(respuesta, ids_validos)

        propuestas = [
            PropuestaEnRevision(
                id=f"pr_{i:03d}",
                conexion=cp,
                frase_editada=cp.frase,
                seleccionada=True,
                estado="pendiente",
            )
            for i, cp in enumerate(conexiones)
        ]

        sesion.propuestas = propuestas
        sesion.estado = "en_revision"
        _log(f"\nCompletado: {len(propuestas)} propuestas generadas.")

    except InterruptedError:
        sesion.estado = "cancelada"
        sesion.razon_falla = "cancelado por el usuario"
        _log("\nCancelado por el usuario.")
    except Exception as exc:
        sesion.estado = "cancelada"
        sesion.razon_falla = str(exc)
        _log(f"\nError: {exc}")
        print(f"[reconexion] Error: {exc}", flush=True)

    guardar_sesion(sesion, slug, grafos_dir)
    return sesion
