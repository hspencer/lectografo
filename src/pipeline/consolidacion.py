"""
Pipeline de consolidación de sinónimos: detecta conceptos duplicados en un
grafo ya extraído (misma noción escrita de distintas formas) y los fusiona
en un único nodo canónico.

A diferencia de getYourStuffTogether (reconexion.py), que opera sobre nodos
sueltos, esta función opera sobre TODO el grafo materializado buscando
conceptos que deberían ser el mismo nodo.
"""
import json
import re
import unicodedata
import uuid
from difflib import SequenceMatcher
from pathlib import Path

from src.models.grafo import Grafo, Nodo
from src.models.consolidacion import PropuestaFusion, PropuestaFusionEnRevision, SesionConsolidacion
from src.models.validacion import EstadoValidacion


# ── Detección de candidatos (heurística, sin LLM) ─────────────────────────────

_STOPWORDS = {"de", "del", "la", "el", "los", "las", "un", "una", "al", "y", "en", "que", "lo"}


def _normalizar_label(label: str) -> str:
    """Quita paréntesis (transliteraciones/aclaraciones), tildes, mayúsculas
    y orden de palabras, para comparar dos labels por su contenido léxico."""
    base = re.sub(r"\(.*?\)", "", label)
    base = "".join(c for c in unicodedata.normalize("NFD", base) if unicodedata.category(c) != "Mn")
    base = base.lower()
    base = re.sub(r"[^a-z0-9\s]", " ", base)
    palabras = [w for w in base.split() if w not in _STOPWORDS]
    return " ".join(sorted(palabras))


def detectar_candidatos(grafo: Grafo, umbral: float = 0.72) -> list[list[Nodo]]:
    """
    Agrupa nodos cuyo label normalizado es idéntico o muy similar: el mismo
    concepto escrito con variantes (paréntesis, script griego, mayúsculas,
    orden de palabras). Heurística barata usada como generador de candidatos;
    el LLM confirma/rechaza y justifica cada grupo antes de fusionar — ver
    construir_prompt_consolidacion.

    Devuelve grupos de 2+ nodos. Usa Union-Find: si A~B y B~C (aunque A y C
    no superen el umbral directamente), los tres quedan en el mismo grupo
    candidato para que el LLM decida si el grupo completo aplica o sólo parte.
    """
    normalizados = {n.id: _normalizar_label(n.label) for n in grafo.nodos}
    nodo_por_id = {n.id: n for n in grafo.nodos}
    ids = [nid for nid, key in normalizados.items() if key]

    padre: dict[str, str] = {nid: nid for nid in ids}

    def find(x: str) -> str:
        while padre[x] != x:
            padre[x] = padre[padre[x]]
            x = padre[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            padre[ra] = rb

    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = ids[i], ids[j]
            key_a, key_b = normalizados[a], normalizados[b]
            score = 1.0 if key_a == key_b else SequenceMatcher(None, key_a, key_b).ratio()
            if score >= umbral:
                union(a, b)

    grupos: dict[str, list[str]] = {}
    for nid in ids:
        grupos.setdefault(find(nid), []).append(nid)

    return [
        [nodo_por_id[nid] for nid in miembros]
        for miembros in grupos.values()
        if len(miembros) > 1
    ]


# ── Construcción del prompt LLM ───────────────────────────────────────────────

def construir_seccion_candidatos(candidatos: list[list[Nodo]]) -> str:
    """Formatea los grupos candidatos con sus descripciones y citas para el prompt."""
    lineas = []
    for i, grupo in enumerate(candidatos):
        lineas.append(f"### Grupo candidato {i + 1}\n")
        for n in grupo:
            desc = n.descripcion_corta[:200] if n.descripcion_corta else ""
            lineas.append(f"- [{n.id}] **{n.label}**: {desc}")
            if n.cita_directa:
                lineas.append(f"  > \"{n.cita_directa[:200]}\"")
        lineas.append("")
    return "\n".join(lineas)


def construir_prompt_consolidacion(
    candidatos: list[list[Nodo]],
    transcripcion_texto: str | None,
    max_chars_transcripcion: int = 40000,
) -> str:
    """Construye el prompt de sistema para la consolidación de sinónimos."""
    plantilla_path = Path(__file__).parent.parent.parent / "prompts" / "consolidacion_v1.md"
    plantilla = plantilla_path.read_text(encoding="utf-8")

    seccion_candidatos = construir_seccion_candidatos(candidatos)

    if transcripcion_texto and len(transcripcion_texto) <= max_chars_transcripcion:
        transcripcion_section = f"## Texto original de referencia\n\n{transcripcion_texto}"
    else:
        transcripcion_section = ""

    return (
        plantilla
        .replace("{candidatos}", seccion_candidatos)
        .replace("{transcripcion_section}", transcripcion_section)
    )


# ── Parseo de la respuesta del LLM ────────────────────────────────────────────

def parsear_respuesta_consolidacion(
    texto: str,
    ids_validos: set[str],
) -> list[PropuestaFusion]:
    """
    Parsea la respuesta JSON del LLM para consolidación.
    Descarta fusiones con ids inválidos, canónico duplicado en absorbidos,
    o sin absorbidos. Tolerante a fallos, mismo estilo que
    parsear_respuesta_reconexion.
    """
    limpio = re.sub(r"<think>.*?</think>", "", texto, flags=re.DOTALL).strip()
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", limpio, re.DOTALL)
    if m:
        limpio = m.group(1)

    try:
        data = json.loads(limpio)
    except json.JSONDecodeError:
        m2 = re.search(r'"fusiones"\s*:\s*\[', limpio)
        if not m2:
            return []
        data = {"fusiones": _extraer_items_array(limpio, m2.end() - 1)}

    propuestas: list[PropuestaFusion] = []
    for i, raw in enumerate(data.get("fusiones") or []):
        if not isinstance(raw, dict):
            continue
        canonico = raw.get("nodo_canonico_id", "")
        absorbidos = [
            aid for aid in (raw.get("nodos_absorbidos_ids") or [])
            if aid in ids_validos and aid != canonico
        ]
        if canonico not in ids_validos or not absorbidos:
            continue
        try:
            propuestas.append(PropuestaFusion(
                id=f"pf_{i:03d}",
                nodo_canonico_id=canonico,
                nodos_absorbidos_ids=absorbidos,
                label_canonico=str(raw.get("label_canonico") or "")[:200] or canonico,
                justificacion=str(raw.get("justificacion") or "")[:500],
                confianza=max(0.0, min(1.0, float(raw.get("confianza", 0.7)))),
            ))
        except Exception:
            continue
    return propuestas


def _extraer_items_array(texto: str, inicio: int) -> list[dict]:
    """Extrae items completos de un array JSON desde la posición dada.
    Copia de reconexion.py — se duplica intencionalmente para mantener
    ambos pipelines independientes entre sí."""
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

def ejecutar_consolidacion(
    slug: str,
    grafo: Grafo,
    transcripcion_texto: str | None,
    grafos_dir: Path,
    sesion_id: str | None = None,
    max_chars_transcripcion: int = 40000,
    on_token=None,
    on_texto=None,
    should_cancel=None,
    on_log=None,
) -> SesionConsolidacion:
    """
    Detecta candidatos, llama al LLM y construye la SesionConsolidacion con
    las propuestas. Se ejecuta en un hilo separado (ThreadPoolExecutor).
    Persiste la sesión en disco en cada estado relevante. Mismo esqueleto
    que ejecutar_reconexion.
    """
    from src.llm import get_llm
    from src.persistencia.consolidacion import guardar as guardar_sesion, cargar as cargar_sesion, existe as existe_sesion

    sesion: SesionConsolidacion | None = None
    if sesion_id and existe_sesion(slug, grafos_dir):
        try:
            sesion = cargar_sesion(slug, grafos_dir)
        except Exception:
            sesion = None

    def _log(msg: str) -> None:
        if on_log:
            on_log(msg + "\n")

    candidatos = detectar_candidatos(grafo)

    if sesion is None:
        sesion_id = sesion_id or f"cons_{uuid.uuid4().hex[:8]}"
        sesion = SesionConsolidacion(
            id=sesion_id,
            slug=slug,
            estado="procesando",
            candidatos_ids=[n.id for grupo in candidatos for n in grupo],
        )
        guardar_sesion(sesion, slug, grafos_dir)

    if not candidatos:
        sesion.estado = "en_revision"
        sesion.propuestas = []
        _log("No se detectaron grupos candidatos de sinónimos.")
        guardar_sesion(sesion, slug, grafos_dir)
        return sesion

    try:
        llm = get_llm()
        llm_name = type(llm).__name__
        label_por_id = {n.id: n.label for n in grafo.nodos}

        _log("╔══ CONSOLIDACIÓN DE SINÓNIMOS ══════════════╗")
        _log(f"  modelo     : {llm_name}")
        _log(f"  grafo      : {len(grafo.nodos)} nodos")
        _log(f"  candidatos : {len(candidatos)} grupo(s), {sum(len(g) for g in candidatos)} nodo(s)")
        _log("╚═══════════════════════════════════════════╝")
        _log("")

        _log("GRUPOS CANDIDATOS (por similitud de label):")
        for grupo in candidatos:
            labels = ", ".join(n.label for n in grupo)
            _log(f"  [{', '.join(n.id for n in grupo)}] {labels}")
        _log("")

        prompt_sistema = construir_prompt_consolidacion(
            candidatos, transcripcion_texto, max_chars_transcripcion
        )
        _log(f"  prompt    : {len(prompt_sistema):,} chars")
        if transcripcion_texto:
            _log(f"  transcripción incluida: {len(transcripcion_texto):,} chars")
        _log("")

        _log("─── RESPUESTA DEL LLM ──────────────────────")
        _log("")

        respuesta = llm.invocar(
            prompt_sistema=prompt_sistema,
            texto="",
            on_token=on_token,
            on_texto=on_texto,
            should_cancel=should_cancel,
        )

        _log("")
        _log("─── FIN DE RESPUESTA ───────────────────────")
        _log("")

        ids_validos = {n.id for n in grafo.nodos}
        _log("PARSEANDO RESPUESTA...")
        propuestas_llm = parsear_respuesta_consolidacion(respuesta, ids_validos)
        _log(f"  {len(propuestas_llm)} fusión(es) válida(s) encontrada(s)")
        _log("")

        if propuestas_llm:
            _log("FUSIONES PROPUESTAS:")
            for p in propuestas_llm:
                canon_l = label_por_id.get(p.nodo_canonico_id, p.nodo_canonico_id)
                abs_l = ", ".join(label_por_id.get(a, a) for a in p.nodos_absorbidos_ids)
                conf_pct = int(p.confianza * 100)
                conf_bar = "█" * (conf_pct // 10) + "░" * (10 - conf_pct // 10)
                _log(f"  {abs_l}  →  {canon_l} (\"{p.label_canonico}\")")
                _log(f"    confianza: {conf_bar} {conf_pct}%")
                _log("")
        else:
            _log("  (ningún grupo candidato fue confirmado por el LLM)")
            _log("")

        sesion.propuestas = [
            PropuestaFusionEnRevision(
                id=f"pfr_{i:03d}",
                propuesta=p,
                label_editado=p.label_canonico,
                seleccionada=True,
                estado="pendiente",
            )
            for i, p in enumerate(propuestas_llm)
        ]
        sesion.estado = "en_revision"
        _log(f"✓ Completado: {len(sesion.propuestas)} propuesta(s) listas para revisión.")

    except InterruptedError:
        sesion.estado = "cancelada"
        sesion.razon_falla = "cancelado por el usuario"
        _log("")
        _log("✗ Cancelado por el usuario.")
    except Exception as exc:
        sesion.estado = "cancelada"
        sesion.razon_falla = str(exc)
        _log("")
        _log(f"✗ Error: {exc}")
        print(f"[lectografo] Error en consolidación: {exc}", flush=True)

    guardar_sesion(sesion, slug, grafos_dir)
    return sesion


# ── Fusión ──────────────────────────────────────────────────────────────────

def fusionar_conceptos(
    estado: EstadoValidacion,
    canonico_id: str,
    absorbido_ids: list[str],
    label_canonico: str | None = None,
) -> None:
    """
    Registra la fusión de uno o más conceptos duplicados en un nodo canónico.

    Escribe en estado.conceptos_fusionados (absorbido → canónico); la
    redirección real de relaciones y la absorción de sinónimos ocurre en
    materializar_desde_validacion (src/persistencia/grafo.py), que resuelve
    la cadena de fusiones al momento de construir el Grafo.

    Si label_canonico se especifica, se aplica como override de label del
    nodo canónico (mismo mecanismo que conceptos_editados).
    """
    for aid in absorbido_ids:
        if aid == canonico_id:
            continue
        estado.conceptos_fusionados[aid] = canonico_id

    if label_canonico:
        ov = estado.conceptos_editados.get(canonico_id, {})
        ov["label"] = label_canonico
        estado.conceptos_editados[canonico_id] = ov
