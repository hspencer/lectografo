#!/usr/bin/env python3
"""
Re-extrae un transcript preservando el trabajo de validación ya realizado.

- Hereda las resoluciones de todas las decisiones cuyo ID coincida con la nueva extracción.
- Conserva conceptos_editados, relaciones_editadas, relaciones_investigador y anotaciones.
- Aborta sin sobrescribir si la nueva extracción sale vacía.

Uso:
    python actualizar.py transcripts/mi-charla.txt
    python actualizar.py transcripts/mi-charla.txt --debug
"""
import argparse
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(
        description="Re-extrae un transcript preservando la validación previa."
    )
    parser.add_argument("ruta", help="Ruta al transcript (.txt, .md, .vtt, .srt)")
    parser.add_argument("--prompt", default="extraccion_v1.md", help="Prompt en prompts/")
    parser.add_argument("--debug", action="store_true", help="Imprime la respuesta cruda del LLM")
    args = parser.parse_args()

    from src.config import settings
    from src.llm import get_llm
    from src.pipeline.ingesta import leer_archivo
    from src.pipeline.extraccion import extraer, cargar_prompt
    from src.pipeline.validacion import generar_decisiones
    from src.persistencia.estado import cargar, guardar, ruta_validacion

    slug = Path(args.ruta).stem.lower().replace(" ", "_")[:50]
    ruta_val = ruta_validacion(slug, settings.grafos_dir)
    ruta_ext = settings.grafos_dir / f"{slug}_extraccion.json"

    if not ruta_val.exists():
        print(f"[lectografo] No existe validación para '{slug}'.")
        print(f"        Usa primero:  make extraer TEXTO={args.ruta}")
        return 1

    estado_previo = cargar(ruta_val)
    dec_previas = {d.id: d for d in estado_previo.decisiones}

    n_resueltas = len(estado_previo.resueltas())
    n_total     = len(estado_previo.decisiones)
    print(f"[lectografo] Validación existente: {n_resueltas}/{n_total} decisiones resueltas")
    print(f"        Conceptos editados:   {len(estado_previo.conceptos_editados)}")
    print(f"        Relaciones del inv.:  {len(estado_previo.relaciones_investigador)}")
    print(f"        Anotaciones:          {len(estado_previo.anotaciones)}")
    print()

    # 1. Re-extraer
    transcripcion = leer_archivo(args.ruta)
    print(f"[1/3] Leyendo transcript: {transcripcion.titulo} ({len(transcripcion.texto):,} chars)")

    llm = get_llm()
    print(f"[2/3] Invocando LLM ({settings.provider} / {settings.ollama_model or ''})...")

    if args.debug:
        prompt_sistema = cargar_prompt(args.prompt)
        respuesta_cruda = llm.invocar(prompt_sistema, transcripcion.texto)
        print("\n── Respuesta cruda ───────────────────────────────")
        print(respuesta_cruda[:2000])
        print("──────────────────────────────────────────────────\n")
        nueva_ext = llm.parsear_respuesta(respuesta_cruda)
    else:
        nueva_ext = extraer(transcripcion, llm, args.prompt)

    if not nueva_ext.conceptos and not nueva_ext.relaciones:
        print("⚠  Extracción vacía — abortando para no sobrescribir la validación existente.")
        print("   Corre con --debug para ver la respuesta cruda del LLM.")
        return 1

    print()
    print(f"[3/3] Nueva extracción: {len(nueva_ext.conceptos)} conceptos, "
          f"{len(nueva_ext.relaciones)} relaciones, "
          f"{len(nueva_ext.bucles)} bucles, "
          f"{len(nueva_ext.metalenguaje)} metalenguaje")

    # 2. Re-generar decisiones
    nuevas_dec = generar_decisiones(
        nueva_ext,
        confianza_minima=settings.confianza_minima_extraccion,
        menciones_minimas=2,
    )

    # 3. Heredar resoluciones por ID
    heredadas = 0
    for d in nuevas_dec:
        prev = dec_previas.get(d.id)
        if prev and prev.resolucion is not None:
            d.estado            = prev.estado
            d.resolucion        = prev.resolucion
            d.nota_resolucion   = prev.nota_resolucion
            d.resuelta_en       = prev.resuelta_en
            d.label_resolucion  = prev.label_resolucion
            heredadas += 1

    pendientes = sum(1 for d in nuevas_dec if d.estado == "pendiente")
    nuevas     = len(nuevas_dec) - heredadas

    print()
    print(f"       Decisiones nuevas:    {len(nuevas_dec)}")
    print(f"       Heredadas del previo: {heredadas}")
    print(f"       Sin resolver:         {pendientes}")

    # 4. Actualizar estado preservando overrides y anotaciones
    estado_previo.extraccion = nueva_ext
    estado_previo.decisiones = nuevas_dec
    estado_previo.completado = all(d.estado == "resuelta" for d in nuevas_dec)

    # Limpiar overrides de entidades que ya no existen (evita confusión en UI)
    ids_conceptos_nuevos   = {c.id for c in nueva_ext.conceptos}
    ids_relaciones_nuevas  = {r.id for r in nueva_ext.relaciones}
    estado_previo.conceptos_editados  = {
        k: v for k, v in estado_previo.conceptos_editados.items()  if k in ids_conceptos_nuevos
    }
    estado_previo.relaciones_editadas = {
        k: v for k, v in estado_previo.relaciones_editadas.items() if k in ids_relaciones_nuevas
    }

    # 5. Guardar extraccion + validacion
    ruta_ext.write_text(
        json.dumps(nueva_ext.model_dump(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    guardar(estado_previo, ruta_val)

    print()
    print(f"[lectografo] ✓ Actualizado: {ruta_ext.name}")
    print(f"[lectografo] ✓ Actualizado: {ruta_val.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
