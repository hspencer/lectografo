# Lectógrafo

Sistema local y soberano para extraer y visualizar grafos conceptuales desde transcripciones de analisis filosoficos.

Lecto- (lectura, texto, lo legible) + -grafo (trazar, representar): "lo que grafica la lectura". El sistema pasa del texto lineal a una topologia de conceptos. Originalmente llamado Llull en referencia a Ramon Llull (1232-1316), pionero de las maquinas combinatorias para razonar sobre conceptos.

## Que hace

1. Ingesta una transcripcion (texto plano, VTT o subtitulos de YouTube).
2. Normaliza el texto y conserva timestamps cuando estan disponibles; el texto fuente se puede editar en cualquier momento, con historial de revisiones y re-normalizacion.
3. Pide a un LLM que extraiga conceptos, relaciones, sinonimia candidata, bidireccionalidad, metalenguaje y bucles, mostrando el grafo emerger en vivo lote a lote.
4. Presenta puntos de decision al investigador para validar caso a caso.
5. Persiste el grafo refinado en un JSON versionable.
6. Detecta nodos sueltos y propone reconectarlos (*getYourStuffTogether*), y detecta conceptos duplicados para fusionarlos en un nodo canonico (consolidacion de sinonimos) — ambos flujos via LLM con revision humana.
7. Visualiza el grafo en un mapa interactivo, alternando entre vista 2D (D3/SVG) y 3D (three.js): resalta el concepto seleccionado, aisla su vecindad al pasar el mouse y atenua el resto.
8. Permite crear y editar grafos personales del investigador, independientes de cualquier transcripcion.
9. Permite anotar, exportar y publicar versiones inmutables del grafo.

## Filosofia de diseno

- **Local y soberano:** los datos viven en el repo. Sin servicios SaaS de almacenamiento ni base de datos.
- **Multi-provider para el LLM:** Anthropic, OpenAI o Gemini se eligen en `.env`. Sin default.
- **Comportamiento antes que implementacion:** el contrato del sistema vive en `specs/` escrito en Allium. El codigo es la expresion de esa especificacion.
- **Iterativo:** el LLM propone, el investigador refina. El sistema preserva la trazabilidad de cada decision.

## Estructura

```
lectografo/
├── README.md
├── .env.example          Plantilla de variables; nunca commitear .env real
├── .gitignore
├── specs/                Especificaciones Allium (lenguaje de comportamiento)
│   ├── lectografo.allium            Modulo raiz: scope, given, config, defaults
│   ├── transcripcion.allium
│   ├── edicion-texto.allium         Edicion del texto fuente y re-normalizacion
│   ├── extraccion.allium
│   ├── extraccion-incremental.allium
│   ├── procesamiento-visible.allium Emergencia visual del grafo durante la extraccion
│   ├── validacion.allium
│   ├── grafo.allium
│   ├── getYourStuffTogether.allium  Reconexion de nodos sueltos
│   ├── grafos-personales.allium
│   └── surfaces.allium
├── transcripts/          Transcripciones crudas (.txt, .vtt) ingresadas por el investigador
├── data/
│   └── grafos/           Grafos persistidos en JSON, una version por archivo
├── prompts/              Plantillas de prompts versionadas (Markdown)
├── static/               Frontend: HTML/CSS/JS vanilla, mapa D3 (2D) y three.js (3D)
└── src/
    ├── app.py            FastAPI: rutas y orquestacion
    ├── llm/               Providers intercambiables (Anthropic, OpenAI, Gemini, Ollama)
    ├── models/            Modelos Pydantic (grafo, validacion, reconexion, consolidacion...)
    ├── persistencia/      Lectura/escritura de estado en data/
    └── pipeline/          Extraccion, validacion, reconexion, consolidacion, grafo
```

## Stack tecnico elegido

Python con FastAPI para todo el backend (ingesta, extraccion LLM, persistencia, servir el frontend estatico). Frontend D3 vanilla servido como HTML+JS estatico desde el mismo proceso.

Razones que justifican esta eleccion:

- **Ecosistema NLP maduro:** `yt-dlp` para descarga de YouTube, `faster-whisper` para transcripcion local cuando hace falta, librerias estables para limpieza de texto y parsing VTT.
- **Runtime unico:** un solo `python` corre el pipeline, el servidor y los scripts de mantenimiento. Reduce dependencias y simplifica el `requirements.txt`.
- **Frontend sin bundler:** D3 y three.js/3d-force-graph cargados por CDN (via import map) evitan el ciclo de build de un frontend Node.js. El investigador puede abrir el HTML directamente si quisiera.
- **SDK oficiales para LLM:** Anthropic, OpenAI y Google publican SDK Python que se intercambian detras de una interfaz `LLMProvider`.

La alternativa Node.js queda descartada por menor disponibilidad de utilidades de transcripcion local. La opcion hibrida (Node frontend + Python pipeline) anade complejidad sin beneficio observable a este alcance.

## Como empezar

```bash
# 1. Clonar e instalar
git clone <repo> lectografo && cd lectografo
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 2. Configurar
cp .env.example .env          # editar con tu proveedor LLM

# 3. Arrancar
./run.sh                      # o: make run
# → http://localhost:8000
```

Desde la interfaz web puedes añadir transcripciones en `transcripts/` y lanzar
la extraccion con el boton "Procesar". Tambien puedes usar la linea de comandos:

```bash
make extraer TEXTO=transcripts/mi-charla.txt   # extrae y guarda
make actualizar TEXTO=transcripts/mi-charla.txt # re-extrae preservando validacion
make estado                                      # lista transcripts y extracciones
make ayuda                                       # lista todos los comandos
```

Lee `specs/lectografo.allium` para entender el comportamiento esperado del sistema.

El comportamiento esta definido en `specs/` (Allium v3). Cualquier ambiguedad debe resolverse contra esos archivos, no contra esta descripcion en prosa.

## Despliegue en linea

La app es stateful (guarda archivos en `data/grafos/` y `transcripts/`), por lo
que necesita almacenamiento persistente. Opciones recomendadas:

**Fly.io** (recomendado para uso personal):
```bash
fly launch --no-deploy
# editar fly.toml: añadir un volumen persistente para data/ y transcripts/
fly deploy
```

**VPS propio** (control total):
```bash
# En el servidor, con systemd o supervisord apuntando a: make run
uvicorn src.app:app --host 0.0.0.0 --port 8000
```

**Render / Railway**: Requieren configurar un disco persistente para `data/`.
Sin persistencia las extracciones se pierden al reiniciar el contenedor.

> Nota: los proveedores LLM remotos (Anthropic, OpenAI, Gemini) requieren que
> el servidor tenga acceso a internet. Ollama necesita correr en el mismo host.

## Notas al pie

[^1]: Allium es un lenguaje de especificacion de comportamiento sin compilador ni runtime, interpretado directamente por humanos y modelos. Ver `/Users/hspencer/Sites/allium` para la referencia oficial.

[^2]: "Local y soberano" significa que el repo es autocontenido: clonarlo es suficiente para reconstruir todo el estado, sin depender de servicios externos para datos.
