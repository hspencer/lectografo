#!/usr/bin/env python3
"""
Genera el sitio estático de visualización (docs/) a partir de los grafos
ya validados en data/grafos/. Cada slug con {slug}_validacion.json se
serializa igual que GET /api/grafo/{slug} y queda disponible como
visor.html?slug={slug} en GitHub Pages.

No importa src.app ni src.config: ambos exigen PROVIDER (clave LLM) al
arrancar, y este script solo lee y serializa grafos ya extraídos — no
necesita LLM ni .env.

Uso:
    python publicar.py
"""
import json
import shutil
import sys
from pathlib import Path

RAIZ    = Path(__file__).parent
GRAFOS  = RAIZ / "data" / "grafos"
SITIO   = RAIZ / "sitio"
STATIC  = RAIZ / "static"
DOCS    = RAIZ / "docs"

ASSETS_ESTATICOS = ["grafo.js", "grafo3d.js", "navcols.js", "style.css", "sistema/tokens.css"]
PAGINAS           = ["index.html", "index.js", "visor.html", "visor.js"]


def main():
    from src.persistencia.estado import cargar, ruta_validacion
    from src.persistencia.grafo import materializar_desde_validacion
    from src.pipeline.grafo import serializar_para_d3

    if DOCS.exists():
        shutil.rmtree(DOCS)
    (DOCS / "data").mkdir(parents=True)
    (DOCS / "sistema").mkdir(parents=True)

    for nombre in ASSETS_ESTATICOS:
        shutil.copy(STATIC / nombre, DOCS / nombre)
    for nombre in PAGINAS:
        shutil.copy(SITIO / nombre, DOCS / nombre)

    indice = []
    for ruta_val in sorted(GRAFOS.glob("*_validacion.json")):
        slug = ruta_val.name.removesuffix("_validacion.json")
        estado = cargar(ruta_val)
        grafo = materializar_desde_validacion(estado)
        serializado = serializar_para_d3(grafo)
        serializado["slug"] = slug
        serializado["titulo"] = grafo.titulo

        (DOCS / "data" / f"{slug}.json").write_text(
            json.dumps(serializado, ensure_ascii=False), encoding="utf-8"
        )
        indice.append({
            "slug": slug,
            "titulo": grafo.titulo,
            "total_nodos": grafo.total_nodos(),
            "total_relaciones": grafo.total_relaciones(),
            "metadatos": estado.metadatos.model_dump() if estado.metadatos else None,
        })
        print(f"  ✓ {slug}  ({grafo.total_nodos()} conceptos, {grafo.total_relaciones()} relaciones)")

    (DOCS / "data" / "index.json").write_text(
        json.dumps(indice, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print()
    print(f"[lectografo] ✓ Sitio generado en {DOCS.relative_to(RAIZ)}/ "
          f"({len(indice)} grafo{'s' if len(indice) != 1 else ''} publicado{'s' if len(indice) != 1 else ''})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
