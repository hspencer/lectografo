#!/usr/bin/env python3
"""
CLI de validación interactiva de decisiones de extracción.

Uso:
    python validar.py data/grafos/xxx_extraccion.json
    python validar.py data/grafos/xxx_extraccion.json --listar
    python validar.py data/grafos/xxx_extraccion.json --diferidas
"""
import argparse
import signal
import sys
from datetime import datetime
from pathlib import Path

# ── ANSI ──────────────────────────────────────────────────────────────────────
BOLD   = "\033[1m"
DIM    = "\033[2m"
RESET  = "\033[0m"
CYAN   = "\033[36m"
YELLOW = "\033[33m"
GREEN  = "\033[32m"
RED    = "\033[31m"
GREY   = "\033[90m"

W = 62  # ancho de línea

def sep(char="─"):      return char * W
def titulo(txt, ch="═"): return f"{BOLD}{ch * W}{RESET}\n{BOLD}{txt}{RESET}\n{ch * W}"
def etiq(k, v):          return f"  {GREY}{k:<18}{RESET}{v}"
def ok(txt):             return f"{GREEN}✓{RESET} {txt}"
def warn(txt):           return f"{YELLOW}!{RESET} {txt}"
def err(txt):            return f"{RED}✗{RESET} {txt}"


# ── Utilidades de contexto ─────────────────────────────────────────────────────

def concepto_por_id(extraccion, cid):
    return next((c for c in extraccion.conceptos if c.id == cid), None)

def relacion_por_id(extraccion, rid):
    return next((r for r in extraccion.relaciones if r.id == rid), None)

def bucle_por_id(extraccion, bid):
    return next((b for b in extraccion.bucles if b.id == bid), None)

def flag_por_id(extraccion, mid):
    return next((m for m in extraccion.metalenguaje if m.id == mid), None)

def label(extraccion, cid):
    c = concepto_por_id(extraccion, cid)
    return c.label if c else cid


# ── Mostrar contexto por tipo de decisión ─────────────────────────────────────

def mostrar_sinonimia(decision, extraccion):
    cid = decision.conceptos_implicados_ids[0]
    c = concepto_por_id(extraccion, cid)
    if not c:
        return
    print(etiq("Concepto:", f"{BOLD}{c.label}{RESET}  ({c.id})"))
    print(etiq("Tipo:", c.tipo.value))
    print(etiq("Confianza:", f"{c.confianza:.2f}"))
    print(etiq("Menciones:", str(c.menciones)))
    print(etiq("Descripción:", _wrap(c.descripcion, 42)))
    print(etiq("Cita directa:", f"{DIM}{_wrap(c.cita_directa[:120], 42)}{RESET}"))
    print()
    sins = ", ".join(f"'{s}'" for s in c.sinonimos_candidatos)
    print(f"  Sinónimos candidatos:  {YELLOW}{sins}{RESET}")
    print(f"  Label canónico prop.:  {CYAN}{decision.label_canonico_propuesto}{RESET}")


def mostrar_bidireccionalidad(decision, extraccion):
    r = relacion_por_id(extraccion, decision.relacion_implicada_id)
    if not r:
        return
    lo = label(extraccion, r.origen_id)
    ld = label(extraccion, r.destino_id)
    print(etiq("Relación:", f"{BOLD}{lo}  ↔  {ld}{RESET}"))
    print(etiq("IDs:", f"{r.origen_id} ↔ {r.destino_id}"))
    print(etiq("Tipo:", r.tipo.value))
    print(etiq("Etiqueta:", f'"{r.etiqueta}"'))
    print(etiq("Frase:", _wrap(f'"{r.frase_completa}"', 42)))
    if r.matiz:
        print(etiq("Matiz:", r.matiz))


def mostrar_confianza_baja(decision, extraccion):
    if decision.conceptos_implicados_ids:
        c = concepto_por_id(extraccion, decision.conceptos_implicados_ids[0])
        if c:
            print(etiq("Concepto:", f"{BOLD}{c.label}{RESET}  ({c.id})"))
            print(etiq("Tipo:", c.tipo.value))
            print(etiq("Confianza:", f"{RED}{c.confianza:.2f}{RESET}  (umbral {_confianza_minima:.2f})"))
            print(etiq("Cita:", f'{DIM}"{_wrap(c.cita_directa[:120], 42)}"{RESET}'))
    elif decision.relacion_implicada_id:
        r = relacion_por_id(extraccion, decision.relacion_implicada_id)
        if r:
            lo = label(extraccion, r.origen_id)
            ld = label(extraccion, r.destino_id)
            print(etiq("Relación:", f"{BOLD}{lo}  →  {ld}{RESET}"))
            print(etiq("Confianza:", f"{RED}{r.confianza:.2f}{RESET}  (umbral {_confianza_minima:.2f})"))
            print(etiq("Frase:", f'{DIM}"{_wrap(r.frase_completa[:120], 42)}"{RESET}'))


def mostrar_promocion_tipo(decision, extraccion):
    c = concepto_por_id(extraccion, decision.conceptos_implicados_ids[0])
    if not c:
        return
    print(etiq("Concepto:", f"{BOLD}{c.label}{RESET}  ({c.id})"))
    print(etiq("Tipo actual:", f"{YELLOW}ambiguo{RESET}"))
    print(etiq("Confianza:", f"{c.confianza:.2f}"))
    print(etiq("Descripción:", _wrap(c.descripcion, 42)))
    print(etiq("Cita:", f'{DIM}"{_wrap(c.cita_directa[:120], 42)}"{RESET}'))


def mostrar_bucle(decision, extraccion):
    b = bucle_por_id(extraccion, decision.bucle_implicado_id)
    if not b:
        return
    labels = [label(extraccion, nid) for nid in b.nodos_ids]
    ciclo = " → ".join(labels) + " → ..."
    print(etiq("Ciclo:", CYAN + ciclo + RESET))
    print(etiq("Tipo:", b.tipo.value))
    print(etiq("Descripción:", _wrap(b.descripcion, 42)))


def mostrar_metalenguaje(decision, extraccion):
    m = flag_por_id(extraccion, decision.flag_implicado_id)
    if not m:
        return
    print(etiq("Tipo:", m.tipo.value))
    print(etiq("Contexto:", m.contexto))
    print(etiq("Texto:", f'{DIM}"{_wrap(m.texto[:200], 42)}"{RESET}'))
    print(etiq("Nota LLM:", _wrap(m.nota, 42)))


MOSTRAR_POR_TIPO = {
    "sinonimia":         mostrar_sinonimia,
    "bidireccionalidad": mostrar_bidireccionalidad,
    "confianza_baja":    mostrar_confianza_baja,
    "promocion_de_tipo": mostrar_promocion_tipo,
    "confirmar_bucle":   mostrar_bucle,
    "metalenguaje":      mostrar_metalenguaje,
}

ETIQUETAS_TIPO = {
    "sinonimia":         f"{CYAN}SINONIMIA{RESET}",
    "bidireccionalidad": f"{CYAN}BIDIRECCIONALIDAD{RESET}",
    "confianza_baja":    f"{RED}CONFIANZA BAJA{RESET}",
    "promocion_de_tipo": f"{YELLOW}TIPO AMBIGUO{RESET}",
    "confirmar_bucle":   f"{CYAN}BUCLE{RESET}",
    "metalenguaje":      f"{YELLOW}METALENGUAJE{RESET}",
}

# ── Prompt de resolución ───────────────────────────────────────────────────────

def prompt_resolucion(decision, extraccion):
    """
    Muestra las opciones disponibles para el tipo de decisión
    y retorna (resolucion, nota, label_resolucion).
    """
    from src.models.validacion import ResolucionDecision, EstadoDecision

    tipo = decision.tipo.value

    if tipo == "sinonimia":
        print(f"\n  {DIM}[a]{RESET} aceptar label canónico  "
              f"{DIM}[m]{RESET} modificar label  "
              f"{DIM}[r]{RESET} rechazar sinonimia  "
              f"{DIM}[d]{RESET} diferir")
    elif tipo == "promocion_de_tipo":
        print(f"\n  {DIM}[p]{RESET} primitivo  "
              f"{DIM}[de]{RESET} derivado  "
              f"{DIM}[me]{RESET} metalenguaje  "
              f"{DIM}[r]{RESET} rechazar  "
              f"{DIM}[d]{RESET} diferir")
    else:
        print(f"\n  {DIM}[a]{RESET} aceptar  "
              f"{DIM}[r]{RESET} rechazar  "
              f"{DIM}[d]{RESET} diferir")

    print(f"  {DIM}[n]{RESET} agregar nota y continuar  "
          f"{DIM}[?]{RESET} ver recomendación LLM  "
          f"{DIM}[q]{RESET} guardar y salir")

    while True:
        try:
            raw = input(f"\n  {BOLD}>{RESET} ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            return None, None, None

        if raw == "q":
            return "quit", None, None
        if raw == "?":
            print(f"\n  {DIM}Recomendación LLM:{RESET} {decision.recomendacion_llm}")
            continue
        if raw == "n":
            nota = input("  Nota: ").strip()
            if nota:
                return None, nota, None  # nota sin resolver: solo agrega
            continue

        # Resoluciones según tipo
        if tipo == "sinonimia":
            if raw == "a":
                nota = input("  Nota (opcional, Enter para omitir): ").strip() or None
                return ResolucionDecision.aceptada, nota, None
            if raw == "m":
                nuevo = input(f"  Nuevo label canónico (actual: '{decision.label_canonico_propuesto}'): ").strip()
                if not nuevo:
                    continue
                nota = input("  Nota (opcional): ").strip() or None
                return ResolucionDecision.modificada, nota, nuevo
            if raw == "r":
                nota = input("  Nota (opcional): ").strip() or None
                return ResolucionDecision.rechazada, nota, None
            if raw == "d":
                return ResolucionDecision.diferida, None, None

        elif tipo == "promocion_de_tipo":
            mapa = {"p": "primitivo", "de": "derivado", "me": "metalenguaje"}
            if raw in mapa:
                tipo_elegido = mapa[raw]
                nota = input(f"  Nota (opcional): ").strip() or None
                return ResolucionDecision.modificada, nota, tipo_elegido
            if raw == "r":
                nota = input("  Nota (opcional): ").strip() or None
                return ResolucionDecision.rechazada, nota, None
            if raw == "d":
                return ResolucionDecision.diferida, None, None

        else:
            if raw == "a":
                nota = input("  Nota (opcional, Enter para omitir): ").strip() or None
                return ResolucionDecision.aceptada, nota, None
            if raw == "r":
                nota = input("  Nota (opcional): ").strip() or None
                return ResolucionDecision.rechazada, nota, None
            if raw == "d":
                return ResolucionDecision.diferida, None, None

        print(f"  {warn('Opción no reconocida.')}")


# ── Bucle principal de validación ──────────────────────────────────────────────

def procesar_decision(decision, extraccion, idx, total):
    tipo_label = ETIQUETAS_TIPO.get(decision.tipo.value, decision.tipo.value.upper())
    print(f"\n{sep()}")
    print(f"{BOLD}[{tipo_label}{BOLD}] {idx}/{total} · {DIM}{decision.id}{RESET}")
    print(sep())
    print()

    fn = MOSTRAR_POR_TIPO.get(decision.tipo.value)
    if fn:
        fn(decision, extraccion)

    return prompt_resolucion(decision, extraccion)


def resolver(decision, resolucion, nota, label_res):
    from src.models.validacion import ResolucionDecision, EstadoDecision
    if resolucion == ResolucionDecision.diferida:
        decision.estado = EstadoDecision.diferida
    else:
        decision.estado = EstadoDecision.resuelta
        decision.resolucion = resolucion
        decision.nota_resolucion = nota
        decision.resuelta_en = datetime.utcnow()
        if label_res:
            decision.label_resolucion = label_res


# ── Resumen ────────────────────────────────────────────────────────────────────

def mostrar_resumen(estado):
    p = len(estado.pendientes())
    d = len(estado.diferidas())
    r = len(estado.resueltas())
    total = len(estado.decisiones)
    print(f"\n{sep()}")
    print(f"{BOLD}{estado.titulo[:W]}{RESET}")
    print(sep())
    print(etiq("Total decisiones:", str(total)))
    print(etiq("Resueltas:", ok(str(r))))
    print(etiq("Diferidas:", warn(str(d)) if d else str(d)))
    print(etiq("Pendientes:", (warn if p else ok)(str(p))))
    if estado.completado:
        print(f"\n  {ok(BOLD + 'Validación completada.' + RESET)}")
    print(sep())

    if p + d > 0:
        # Desglose por tipo
        from collections import Counter
        ctr = Counter(
            dec.tipo.value
            for dec in estado.decisiones
            if dec.estado.value in ("pendiente", "diferida")
        )
        print(f"\n  Pendientes/diferidas por tipo:")
        for tipo, n in ctr.most_common():
            marca = ETIQUETAS_TIPO.get(tipo, tipo)
            print(f"    {marca}  ×{n}")
    print()


def listar_pendientes(estado):
    ext = estado.extraccion
    for d in estado.pendientes() + estado.diferidas():
        estado_txt = f"{YELLOW}[diferida]{RESET}" if d.estado.value == "diferida" else ""
        tipo = ETIQUETAS_TIPO.get(d.tipo.value, d.tipo.value)
        if d.conceptos_implicados_ids:
            c = concepto_por_id(ext, d.conceptos_implicados_ids[0])
            obj = c.label if c else d.conceptos_implicados_ids[0]
        elif d.relacion_implicada_id:
            r = relacion_por_id(ext, d.relacion_implicada_id)
            if r:
                obj = f"{label(ext, r.origen_id)} → {label(ext, r.destino_id)}"
            else:
                obj = d.relacion_implicada_id
        else:
            obj = d.id
        print(f"  {DIM}{d.id:<20}{RESET}  {tipo:<30}  {obj}  {estado_txt}")


# ── Helpers ────────────────────────────────────────────────────────────────────

_confianza_minima = 0.6   # se sobreescribe al arrancar

def _wrap(txt: str, ancho: int) -> str:
    """Corta el texto con newline + indentación si supera el ancho."""
    if len(txt) <= ancho:
        return txt
    partes = []
    while txt:
        partes.append(txt[:ancho])
        txt = txt[ancho:]
    return ("\n" + " " * 20).join(partes)


# ── Señal de interrupción ──────────────────────────────────────────────────────

_estado_global = None
_ruta_global = None

def _guardar_y_salir(sig, frame):
    if _estado_global and _ruta_global:
        from src.persistencia.estado import guardar
        guardar(_estado_global, _ruta_global)
        print(f"\n\n  {ok('Sesión guardada.')} {DIM}{_ruta_global}{RESET}")
    sys.exit(0)


# ── main ───────────────────────────────────────────────────────────────────────

def main():
    global _estado_global, _ruta_global, _confianza_minima

    parser = argparse.ArgumentParser(description="Validación interactiva de decisiones de extracción.")
    parser.add_argument("extraccion", help="Ruta al JSON de extracción (data/grafos/xxx_extraccion.json)")
    parser.add_argument("--listar", action="store_true", help="Solo listar decisiones pendientes y salir")
    parser.add_argument("--diferidas", action="store_true", help="Procesar primero las decisiones diferidas")
    args = parser.parse_args()

    from src.config import settings
    from src.models.extraccion import ResultadoExtraccion
    from src.models.validacion import EstadoValidacion, EstadoDecision, ResolucionDecision
    from src.pipeline.validacion import generar_decisiones
    from src.persistencia.estado import guardar, cargar, ruta_validacion

    _confianza_minima = settings.confianza_minima_extraccion

    # ── Cargar o crear sesión ──────────────────────────────────────────
    ruta_ext = Path(args.extraccion)
    if not ruta_ext.exists():
        print(err(f"No se encontró: {ruta_ext}"))
        return 1

    slug = ruta_ext.stem.replace("_extraccion", "")
    ruta_val = ruta_validacion(slug, ruta_ext.parent)

    if ruta_val.exists():
        estado = cargar(ruta_val)
        sesion_nueva = False
        print(f"\n  {ok('Sesión existente cargada.')} {DIM}{ruta_val}{RESET}")
    else:
        extraccion = ResultadoExtraccion.model_validate_json(ruta_ext.read_text("utf-8"))
        decisiones = generar_decisiones(
            extraccion,
            confianza_minima=settings.confianza_minima_extraccion,
            menciones_minimas=2,
        )
        estado = EstadoValidacion(
            titulo=slug.replace("_", " ").title(),
            slug=slug,
            extraccion=extraccion,
            decisiones=decisiones,
        )
        sesion_nueva = True

    _estado_global = estado
    _ruta_global = ruta_val
    signal.signal(signal.SIGINT, _guardar_y_salir)

    mostrar_resumen(estado)

    if args.listar:
        listar_pendientes(estado)
        return 0

    if sesion_nueva:
        guardar(estado, ruta_val)
        print(f"  {ok('Sesión creada.')} {DIM}{ruta_val}{RESET}\n")

    # ── Cola de decisiones a procesar ─────────────────────────────────
    if args.diferidas:
        cola = estado.diferidas() + estado.pendientes()
    else:
        cola = estado.pendientes() + estado.diferidas()

    if not cola:
        if estado.todas_resueltas():
            print(ok(BOLD + "Todas las decisiones están resueltas." + RESET))
        else:
            print(warn("No hay decisiones pendientes ni diferidas."))
        return 0

    total = len(cola)
    for idx, decision in enumerate(cola, 1):
        resolucion, nota, label_res = procesar_decision(
            decision, estado.extraccion, idx, total
        )

        if resolucion == "quit":
            guardar(estado, ruta_val)
            print(f"\n  {ok('Sesión guardada.')} {DIM}{ruta_val}{RESET}")
            return 0

        if resolucion is None and nota:
            # Solo nota, sin resolver la decisión
            from src.models.validacion import AnotacionInvestigador
            import uuid
            estado.anotaciones.append(AnotacionInvestigador(
                id=str(uuid.uuid4())[:8],
                objeto_anotado=decision.id,
                nota=nota,
            ))
            guardar(estado, ruta_val)
            continue

        if resolucion is not None:
            resolver(decision, resolucion, nota, label_res)

        guardar(estado, ruta_val)

        # Feedback inline
        if hasattr(resolucion, 'value'):
            simbolos = {
                "aceptada":   ok("aceptada"),
                "rechazada":  err("rechazada"),
                "modificada": warn("modificada"),
                "diferida":   f"{YELLOW}→ diferida{RESET}",
            }
            print(f"\n  {simbolos.get(resolucion.value, resolucion.value)}")

        # Verificar completado
        if estado.todas_resueltas() and not estado.completado:
            estado.completado = True
            guardar(estado, ruta_val)
            print(f"\n{sep('═')}")
            print(ok(f"{BOLD}Validación completada. Todas las decisiones resueltas.{RESET}"))
            print(sep("═"))
            break

    mostrar_resumen(estado)
    return 0


if __name__ == "__main__":
    sys.exit(main())
