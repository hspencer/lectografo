"""
Contrato EvaluadorLLM definido en specs/surfaces.allium.

Toda implementación concreta (Ollama, Anthropic, OpenAI, Gemini) debe
extender esta clase. parsear_respuesta nunca lanza excepción: ante input
inválido retorna el máximo de entidades rescatables, no un objeto vacío.
"""
import json
import re
from abc import ABC, abstractmethod

from src.models.extraccion import (
    BucleDetectado,
    ConceptoPropuesto,
    FlagMetalenguaje,
    RelacionPropuesta,
    ResultadoExtraccion,
)

_TIPOS_RELACION_VALIDOS = {
    "fundamenta", "amplifica", "especifica",
    "contraposicion", "constituye", "genera", "presupone",
    "relacionado_con",
}


# ── Sanitización de campos problemáticos ─────────────────────────────────────

def _sanitizar_concepto(c: dict) -> dict:
    """Corrige in-place los campos que el LLM suele devolver fuera de rango."""
    # menciones: int >= 1
    try:
        c["menciones"] = max(1, int(c.get("menciones") or 1))
    except (TypeError, ValueError):
        c["menciones"] = 1
    # confianza: float en [0, 1]
    try:
        c["confianza"] = max(0.0, min(1.0, float(c.get("confianza", 0.5))))
    except (TypeError, ValueError):
        c["confianza"] = 0.5
    # cita_directa: str no nulo
    if not c.get("cita_directa") or not isinstance(c["cita_directa"], str):
        c["cita_directa"] = ""
    # descripcion: str no nulo
    if not c.get("descripcion") or not isinstance(c["descripcion"], str):
        c["descripcion"] = ""
    # sinonimos_candidatos: lista de str
    sins = c.get("sinonimos_candidatos")
    if not isinstance(sins, list):
        c["sinonimos_candidatos"] = []
    return c


def _sanitizar_relacion(r: dict) -> dict:
    """Corrige in-place campos de relación problemáticos."""
    # tipo: aceptar cualquier string no vacío; fallback si está ausente o en blanco
    tipo = r.get("tipo")
    if not tipo or not isinstance(tipo, str) or not tipo.strip():
        r["tipo"] = "relacionado_con"
    else:
        r["tipo"] = tipo.strip().lower().replace(" ", "_")
    # confianza: float en [0, 1]
    try:
        r["confianza"] = max(0.0, min(1.0, float(r.get("confianza", 0.5))))
    except (TypeError, ValueError):
        r["confianza"] = 0.5
    # etiqueta y frase_completa: str no nulos
    if not r.get("etiqueta") or not isinstance(r["etiqueta"], str):
        r["etiqueta"] = r.get("tipo", "relacionado con")
    if not r.get("frase_completa") or not isinstance(r["frase_completa"], str):
        r["frase_completa"] = ""
    return r


# ── Recuperación de JSON truncado ─────────────────────────────────────────────

def _reparar_json(texto: str) -> dict | None:
    """
    Intenta recuperar un objeto JSON truncado (ej. cuando el modelo llega
    al límite de tokens a mitad de la respuesta).
    Estrategia: encontrar los arrays completos dentro del texto crudo.
    """
    resultado: dict = {}
    for clave in ("conceptos", "relaciones", "bucles", "metalenguaje"):
        # Buscar el inicio del array para esta clave
        patron = rf'"{clave}"\s*:\s*\['
        m = re.search(patron, texto)
        if not m:
            resultado[clave] = []
            continue
        inicio = m.end() - 1   # posición del '['
        # Extraer objetos completos del array, uno a uno
        pos = inicio + 1
        items = []
        while pos < len(texto):
            # Saltar espacios y comas
            while pos < len(texto) and texto[pos] in " \t\n\r,":
                pos += 1
            if pos >= len(texto) or texto[pos] == "]":
                break
            if texto[pos] != "{":
                break
            # Leer un objeto completo
            depth = 0
            obj_start = pos
            in_str = False
            escape = False
            for i in range(pos, len(texto)):
                ch = texto[i]
                if escape:
                    escape = False
                    continue
                if ch == "\\" and in_str:
                    escape = True
                    continue
                if ch == '"' and not escape:
                    in_str = not in_str
                    continue
                if in_str:
                    continue
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        try:
                            items.append(json.loads(texto[obj_start:i+1]))
                        except json.JSONDecodeError:
                            pass
                        pos = i + 1
                        break
            else:
                break   # objeto sin cerrar — truncado aquí, paramos
        resultado[clave] = items
    return resultado if any(resultado.values()) else None


# ── Contrato principal ────────────────────────────────────────────────────────

class EvaluadorLLM(ABC):

    @abstractmethod
    def invocar(
        self,
        prompt_sistema: str,
        texto: str,
        on_token: "Callable[[int], None] | None" = None,
        on_texto: "Callable[[str], None] | None" = None,
        should_cancel: "Callable[[], bool] | None" = None,
    ) -> str:
        """Envía prompt + texto al proveedor y retorna la respuesta cruda.
        on_token(count) se llama en cada token recibido con el total acumulado.
        on_texto(fragment) se llama en cada token con el texto del fragmento.
        should_cancel() se comprueba cada segundo vía watchdog — si retorna True
        se lanza InterruptedError inmediatamente, incluso antes de recibir el primer token.
        """
        ...

    def parsear_respuesta(self, texto: str) -> ResultadoExtraccion:
        """
        Parsea la respuesta JSON del LLM de forma tolerante a fallos:
        - Limpia bloques <think>…</think>
        - Desenvuelve bloques ```json … ```
        - Intenta reparar JSON truncado (modelo que alcanza el límite de tokens)
        - Parsea entidad por entidad: un campo inválido descarta esa entidad,
          no toda la extracción
        - Nunca lanza excepción
        """
        limpio = re.sub(r"<think>.*?</think>", "", texto, flags=re.DOTALL).strip()
        m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", limpio, re.DOTALL)
        if m:
            limpio = m.group(1)

        # Intentar parsear JSON completo; si falla, intentar reparar
        data = None
        try:
            data = json.loads(limpio)
        except json.JSONDecodeError as exc:
            print(f"\n[lectografo] JSON incompleto ({exc}), intentando recuperar entidades parciales…",
                  flush=True)
            data = _reparar_json(limpio)
            if data is None:
                print(f"[lectografo] No se pudo recuperar ninguna entidad.", flush=True)
                print(f"[lectografo] Respuesta cruda (primeros 400 chars):\n{limpio[:400]}", flush=True)
                return ResultadoExtraccion()

        # Parsear entidad por entidad
        conceptos:    list[ConceptoPropuesto] = []
        relaciones:   list[RelacionPropuesta] = []
        bucles:       list[BucleDetectado]    = []
        metalenguaje: list[FlagMetalenguaje]  = []
        errores = 0

        for raw in (data.get("conceptos") or []):
            if not isinstance(raw, dict):
                continue
            try:
                conceptos.append(ConceptoPropuesto.model_validate(_sanitizar_concepto(raw)))
            except Exception:
                errores += 1

        ids_validos = {c.id for c in conceptos}

        # Mapa de normalización: "c_01" → "c_001", "c1" → "c_001", etc.
        # Extrae el número del ID y lo mapea al ID canónico del concepto.
        def _normalizar_id(raw_id: str) -> str:
            if raw_id in ids_validos:
                return raw_id
            # Intentar extraer sufijo numérico y buscar coincidencia
            import re as _re
            m = _re.search(r"\d+$", raw_id)
            if m:
                num = int(m.group())
                for vid in ids_validos:
                    vm = _re.search(r"\d+$", vid)
                    if vm and int(vm.group()) == num:
                        return vid
            return raw_id

        for raw in (data.get("relaciones") or []):
            if not isinstance(raw, dict):
                continue
            # Normalizar IDs ante posibles variaciones de formato ("c_01" vs "c_001")
            raw = dict(raw)
            raw["origen_id"]  = _normalizar_id(raw.get("origen_id", ""))
            raw["destino_id"] = _normalizar_id(raw.get("destino_id", ""))
            # Descartar relaciones que apunten a conceptos que no existen
            if raw["origen_id"] not in ids_validos or raw["destino_id"] not in ids_validos:
                print(f"[lectografo] Relación descartada: IDs no encontrados "
                      f"({raw.get('origen_id')} → {raw.get('destino_id')})", flush=True)
                errores += 1
                continue
            try:
                relaciones.append(RelacionPropuesta.model_validate(_sanitizar_relacion(raw)))
            except Exception as exc:
                print(f"[lectografo] Relación descartada por validación: {exc}", flush=True)
                errores += 1

        for raw in (data.get("bucles") or []):
            if not isinstance(raw, dict):
                continue
            try:
                bucles.append(BucleDetectado.model_validate(raw))
            except Exception:
                errores += 1

        for raw in (data.get("metalenguaje") or []):
            if not isinstance(raw, dict):
                continue
            try:
                metalenguaje.append(FlagMetalenguaje.model_validate(raw))
            except Exception:
                errores += 1

        if errores:
            print(f"[lectografo] {errores} entidad(es) descartada(s) por campos inválidos.", flush=True)

        return ResultadoExtraccion(
            conceptos=conceptos,
            relaciones=relaciones,
            bucles=bucles,
            metalenguaje=metalenguaje,
        )
