#!/usr/bin/env python3
"""
CLI de extracción: lee una transcripción, invoca el LLM y muestra el resultado.

Uso:
    python extraer.py <ruta_transcripcion> [--guardar]

Ejemplos:
    python extraer.py transcripts/mi-charla.txt
    python extraer.py "transcripts/SITUACIÓN Y CONSTELACIÓN.txt" --guardar
"""
import argparse
import json
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Extrae un grafo conceptual desde una transcripción.")
    parser.add_argument("ruta", help="Ruta al archivo de transcripción (.txt, .md, .vtt, .srt)")
    parser.add_argument("--guardar", action="store_true", help="Guarda el resultado en data/grafos/")
    parser.add_argument("--prompt", default="extraccion_v1.md", help="Nombre del prompt en prompts/")
    parser.add_argument("--debug",  action="store_true", help="Imprime la respuesta cruda del LLM antes de parsear")
    args = parser.parse_args()

    # Importar aquí para que los errores de config aparezcan después del --help
    from src.config import settings
    from src.llm import get_llm
    from src.pipeline.ingesta import leer_archivo
    from src.pipeline.extraccion import extraer

    print(f"[lectografo] Proveedor: {settings.provider}")
    if settings.provider == "ollama":
        print(f"[lectografo] Modelo:    {settings.ollama_model}")
        print(f"[lectografo] Endpoint:  {settings.ollama_endpoint}")
    print(f"[lectografo] Prompt:    {args.prompt}")
    print()

    # 1. Leer transcripción
    print(f"[1/3] Leyendo transcripción: {args.ruta}")
    transcripcion = leer_archivo(args.ruta)
    chars = len(transcripcion.texto)
    print(f"      Título:    {transcripcion.titulo}")
    print(f"      Extensión: .{transcripcion.extension}")
    print(f"      Tamaño:    {chars:,} caracteres")
    print()

    # 2. Invocar LLM
    print("[2/3] Invocando LLM (puede tardar varios minutos)...")
    llm = get_llm()
    if args.debug:
        # Invocar y mostrar raw antes de parsear
        from src.pipeline.extraccion import cargar_prompt
        prompt_sistema = cargar_prompt(args.prompt)
        respuesta_cruda = llm.invocar(prompt_sistema, transcripcion.texto)
        print("\n── Respuesta cruda (raw) ─────────────────────────")
        print(respuesta_cruda[:2000])
        print("──────────────────────────────────────────────────\n")
        resultado = llm.parsear_respuesta(respuesta_cruda)
    else:
        resultado = extraer(transcripcion, llm, args.prompt)

    # 3. Mostrar resumen
    print()
    print("[3/3] Resultado:")
    print(f"      Conceptos:    {len(resultado.conceptos)}")
    print(f"      Relaciones:   {len(resultado.relaciones)}")
    print(f"      Bucles:       {len(resultado.bucles)}")
    print(f"      Metalenguaje: {len(resultado.metalenguaje)}")
    print()

    if not resultado.conceptos and not resultado.relaciones:
        print("⚠  Extracción vacía: el LLM no devolvió conceptos ni relaciones.")
        print("   Causas frecuentes:")
        print("     · El modelo no siguió el schema JSON esperado.")
        print("     · El contexto (num_ctx) es demasiado pequeño para el transcript.")
        print("     · Corre con --debug para ver la respuesta cruda.")
        print()

    if resultado.conceptos:
        print("── Conceptos ──────────────────────────────────")
        for c in resultado.conceptos:
            marca = "?" if c.confianza < settings.confianza_minima_extraccion else " "
            sins = f"  ≈ {', '.join(c.sinonimos_candidatos)}" if c.sinonimos_candidatos else ""
            print(f"  [{marca}] {c.id}  {c.label:<30}  conf={c.confianza:.2f}  ×{c.menciones}{sins}")
        print()

    if resultado.relaciones:
        print("── Relaciones ─────────────────────────────────")
        for r in resultado.relaciones:
            marca = "?" if r.confianza < settings.confianza_minima_extraccion else " "
            bidir = "↔" if r.bidireccional else "→"
            print(f"  [{marca}] {r.id}  {r.origen_id} {bidir} {r.destino_id}  [{r.tipo.value}]  \"{r.etiqueta}\"  conf={r.confianza:.2f}")
        print()

    if resultado.bucles:
        print("── Bucles ─────────────────────────────────────")
        for b in resultado.bucles:
            nodos = " → ".join(b.nodos_ids) + " → ..."
            print(f"  {b.id}  [{b.tipo.value}]  {nodos}")
            print(f"       {b.descripcion}")
        print()

    if resultado.metalenguaje:
        print("── Metalenguaje ───────────────────────────────")
        for m in resultado.metalenguaje:
            print(f"  {m.id}  [{m.tipo.value}]")
            print(f"       {m.texto[:120]}...")
        print()

    # 4. Guardar si se pidió (solo si hay contenido)
    if args.guardar:
        if not resultado.conceptos and not resultado.relaciones:
            print("[lectografo] No se guardó: extracción vacía.")
        else:
            from src.config import settings as cfg
            slug = Path(args.ruta).stem.lower().replace(" ", "_")[:50]
            salida = cfg.grafos_dir / f"{slug}_extraccion.json"
            salida.parent.mkdir(parents=True, exist_ok=True)
            salida.write_text(
                json.dumps(resultado.model_dump(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(f"[lectografo] Guardado en: {salida}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
