# Llull

Sistema local y soberano para extraer y visualizar grafos conceptuales desde transcripciones de analisis filosoficos.

El proyecto toma su nombre de Ramon Llull (1232-1316), pionero de las maquinas combinatorias para razonar sobre conceptos. Llull entendia que el pensamiento puede formalizarse como relaciones entre nociones primitivas; esa intuicion es la raiz operativa de este sistema.

## Que hace

1. Ingesta una transcripcion (texto plano, VTT o subtitulos de YouTube).
2. Normaliza el texto y conserva timestamps cuando estan disponibles.
3. Pide a un LLM que extraiga conceptos, relaciones, sinonimia candidata, bidireccionalidad, metalenguaje y bucles.
4. Presenta puntos de decision al investigador para validar caso a caso.
5. Persiste el grafo refinado en un JSON versionable.
6. Visualiza el grafo con D3 y permite anotar, exportar y publicar versiones inmutables.

## Filosofia de diseno

- **Local y soberano:** los datos viven en el repo. Sin servicios SaaS de almacenamiento ni base de datos.
- **Multi-provider para el LLM:** Anthropic, OpenAI o Gemini se eligen en `.env`. Sin default.
- **Comportamiento antes que implementacion:** el contrato del sistema vive en `specs/` escrito en Allium. El codigo es la expresion de esa especificacion.
- **Iterativo:** el LLM propone, el investigador refina. El sistema preserva la trazabilidad de cada decision.

## Estructura

```
llull/
├── README.md
├── .env.example          Plantilla de variables; nunca commitear .env real
├── .gitignore
├── specs/                Especificaciones Allium (lenguaje de comportamiento)
│   ├── llull.allium      Modulo raiz: scope, given, config, defaults
│   ├── transcripcion.allium
│   ├── extraccion.allium
│   ├── validacion.allium
│   ├── grafo.allium
│   └── surfaces.allium
├── transcripts/          Transcripciones crudas (.txt, .vtt) ingresadas por el investigador
├── data/
│   └── grafos/           Grafos persistidos en JSON, una version por archivo
├── prompts/              Plantillas de prompts versionadas (Markdown)
└── src/                  Implementacion (a desarrollar a partir de specs/)
```

## Stack tecnico elegido

Python con FastAPI para todo el backend (ingesta, extraccion LLM, persistencia, servir el frontend estatico). Frontend D3 vanilla servido como HTML+JS estatico desde el mismo proceso.

Razones que justifican esta eleccion:

- **Ecosistema NLP maduro:** `yt-dlp` para descarga de YouTube, `faster-whisper` para transcripcion local cuando hace falta, librerias estables para limpieza de texto y parsing VTT.
- **Runtime unico:** un solo `python` corre el pipeline, el servidor y los scripts de mantenimiento. Reduce dependencias y simplifica el `requirements.txt`.
- **Frontend sin bundler:** D3 cargado por CDN o copiado a `static/` evita el ciclo de build de un frontend Node.js. El investigador puede abrir el HTML directamente si quisiera.
- **SDK oficiales para LLM:** Anthropic, OpenAI y Google publican SDK Python que se intercambian detras de una interfaz `LLMProvider`.

La alternativa Node.js queda descartada por menor disponibilidad de utilidades de transcripcion local. La opcion hibrida (Node frontend + Python pipeline) anade complejidad sin beneficio observable a este alcance.

## Como empezar

1. Copia `.env.example` a `.env` y elige un proveedor LLM.
2. Pon una transcripcion en `transcripts/` (por ejemplo `mi-charla.txt`).
3. Lee `specs/llull.allium` para entender el comportamiento esperado.
4. Implementa segun la especificacion en `src/`.

El comportamiento del sistema esta definido en `specs/` (Allium v3). Cualquier ambiguedad debe resolverse contra esos archivos, no contra esta descripcion en prosa.

## Notas al pie

[^1]: Allium es un lenguaje de especificacion de comportamiento sin compilador ni runtime, interpretado directamente por humanos y modelos. Ver `/Users/hspencer/Sites/allium` para la referencia oficial.

[^2]: "Local y soberano" significa que el repo es autocontenido: clonarlo es suficiente para reconstruir todo el estado, sin depender de servicios externos para datos.
