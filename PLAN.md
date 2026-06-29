# Plan de implementación — Lectógrafo

Generado: 2026-06-29  
Estado de partida: MVP funcional (Ollama + extracción + validación básica + D3)

---

## Hallazgos del análisis

### Lo que ya funciona (no tocar)
- Extracción completa e incremental con Ollama (streaming, cancellation, JSON recovery)
- Modelos Pydantic: `ConceptoPropuesto`, `RelacionPropuesta`, `BucleDetectado`, `FlagMetalenguaje`
- Validación: generación de decisiones + resolución + anotaciones
- Persistencia JSON (`{slug}_extraccion.json`, `{slug}_validacion.json`)
- Frontend: biblioteca, validación, D3 mapa, grafos personales (CRUD básico)
- FastAPI: 40+ endpoints funcionando

### Gaps por spec

| Spec | Estado | Gaps principales |
|------|--------|-----------------|
| `transcripcion` | Parcial | YouTube ingestion |
| `extraccion` | Parcial | Anthropic/OpenAI/Gemini no conectados |
| `extraccion-incremental` | Parcial | Tesauro UI, PropuestaConsolidacion, revoke, surfaces |
| `validacion` | Parcial | `promocion_de_tipo`, merge real de sinónimos |
| `grafo` | Sin implementar | Entidad formal, materialización, `PersistenciaGrafo` |
| `grafos-personales` | Parcial | ReferenciaConcepto, Sugerencia LLM, citas |
| `surfaces` | Parcial | `ConfiguracionProveedor`, timeout, Codec |
| `procesamiento-visible` | Parcial | Fases visuales, ContraArgumento, GrafoEnConstruccion |
| `getYourStuffTogether` | Sin implementar | Feature completa |

---

## Fase 0 (ya completada) — Discovery

Realizado por subagentes en esta sesión. Ver hallazgos arriba.

**APIs y patrones aprobados para fases siguientes:**
- Modelos: `pydantic.BaseModel` con `Field(default_factory=...)`
- Persistencia: `{slug}_{feature}.json` via `model_dump_json(indent=2)`
- LLM: extender `EvaluadorLLM` (streaming obligatorio, watchdog cancellation)
- API: FastAPI con Pydantic payloads, devolver `{"ok": bool, ...}`
- Frontend: estado global `state`, helper `apiFetch()`, render() reconstruye DOM

---

## Fase 1 — Entidad Grafo formal y capa de persistencia

**Spec:** `grafo.allium`  
**Por qué primero:** Todo lo siguiente (getYourStuffTogether, grafos-personales, procesamiento-visible) necesita `Nodo`/`Relacion`/`Grafo` como entidades de primera clase. Ahora el grafo se reconstruye implícitamente desde `extraccion.json` cada vez.

### Qué implementar

**`src/models/grafo.py`** — nuevas entidades Pydantic:
```python
class Nodo(BaseModel):
    id: str                        # "node_001"
    label: str
    tipos: list[str]               # ["primitivo"], ["metalenguaje"], etc.
    descripcion_corta: str
    sinonimos_consolidados: list[str]
    contexto_primera_aparicion: str | None
    notas_usuario: list[str]
    conceptos_origen: list[str]    # IDs de ConceptoPropuesto originales
    creado_en: datetime

class Relacion(BaseModel):
    id: str
    origen_id: str                 # ID de Nodo
    destino_id: str                # ID de Nodo
    tipo: str                      # ontología abierta
    etiqueta: str
    frase_completa: str
    bidireccional: bool
    matiz: str | None
    contexto: str | None
    notas_usuario: list[str]
    confianza_extraccion: float
    estado_validacion: str         # "aceptada" | "pendiente" | "indefinida"
    relacion_origen_id: str | None
    creada_en: datetime

class Bucle(BaseModel):
    id: str
    nodo_ids: list[str]
    descripcion: str
    tipo: str                      # "fundamental" | "contingente"
    bucle_origen_id: str

class Grafo(BaseModel):
    id: str                        # "{slug}-v1"
    transcripcion_id: str          # slug
    titulo: str
    version: str                   # "1.0"
    creador: str
    creado_en: datetime
    nodos: list[Nodo]
    relaciones: list[Relacion]
    bucles: list[Bucle]
```

**`src/persistencia/grafo.py`** — guardar/cargar:
- `ruta_grafo(slug, base_dir)` → `{slug}_grafo.json`
- `guardar(grafo: Grafo, slug, base_dir)`
- `cargar(slug, base_dir) -> Grafo`
- `existe(slug, base_dir) -> bool`
- `materializar_desde_validacion(estado_validacion) -> Grafo` — función de migración que construye un Grafo desde el formato actual (extraccion.json + validacion.json)

**`src/pipeline/grafo.py`** — reglas de materialización:
- `materializar_nodo(decision, conceptos)` — implementa `MaterializarNodoDesdeConceptoAceptado`
- `materializar_relacion(decision, nodos)` — implementa `MaterializarRelacionDesdeDecisionAceptada`
- `nodos_sueltos(grafo: Grafo) -> list[Nodo]` — nodos sin ninguna Relacion como origen o destino

**Actualizar `src/app.py`:**
- `GET /api/grafo/{slug}` — devolver desde `{slug}_grafo.json` si existe, sino materializar y guardar
- `POST /api/grafo/{slug}/guardar` — materializar desde validación actual y persistir

**Anti-patrones a evitar:**
- No romper el endpoint `/api/grafo/{slug}` actual — el frontend D3 lo consume
- No migrar los JSON existentes automáticamente sin flag explícito

### Verificación
```bash
# Verificar que el nuevo modelo puede round-trip
python -c "from src.models.grafo import Grafo; print('ok')"
# Verificar endpoint
curl localhost:8000/api/grafo/heraclito | python -m json.tool
# Verificar nodos_sueltos
python -c "from src.pipeline.grafo import nodos_sueltos; print('ok')"
```

---

## Fase 2 — Validación completa (sinónimos + promoción de tipo)

**Spec:** `validacion.allium`  
**Depende de:** Fase 1 (necesita Nodo para ejecutar el merge real)

### Qué implementar

**Nuevo `TipoDecision.promocion_de_tipo`** en `src/pipeline/validacion.py`:
- Generar decision tipo `promocion_de_tipo` para todo `ConceptoPropuesto` con `tipo = "ambiguo"`
- Pregunta: `"Clasificar '{label}': primitivo, derivado o metalenguaje?"`
- Al resolver con `modificada`: el campo `nota_resolucion` contiene el tipo elegido

**Ejecución real del merge de sinónimos** — actualmente la decisión se resuelve pero los conceptos no se fusionan:
- En `POST /api/validacion/{slug}/decisiones/{did}/resolver`, cuando `tipo=sinonimia` y `resolucion=aceptada`:
  1. Tomar los `conceptos_implicados`
  2. Elegir `label_resolucion ?? label_canonico_propuesto ?? conceptos[0].label` como label canónico
  3. Actualizar `estado_validacion.conceptos_editados` para marcar los conceptos absorbidos
  4. Redirigir sus relaciones al concepto canónico
  5. Si el Grafo ya fue materializado, re-materializar

**Filtro por tipo en UI** — en `static/app.js`:
- Agregar `<select id="filtro-tipo-decision">` encima de la tabla de decisiones
- Filtrar en memoria por `decision.tipo`
- Agregar botón "Siguiente pendiente" que hace scroll al primer item con `estado = "pendiente"`

### Verificación
```bash
# Verificar que se generan decisiones de promocion_de_tipo
curl -X POST localhost:8000/api/extracciones/heraclito/procesar
# Verificar merge de sinónimos: resolver una decisión de sinonimia y ver que los conceptos se fusionen
```

---

## Fase 3 — getYourStuffTogether

**Spec:** `getYourStuffTogether.allium`  
**Depende de:** Fase 1 (`nodos_sueltos`, `Grafo` formal)

### Qué implementar

**`src/models/reconexion.py`**:
```python
class ConexionPropuesta(BaseModel):
    id: str
    origen_id: str     # Nodo.id
    destino_id: str    # Nodo.id
    frase: str
    tipo: str
    confianza: float

class PropuestaEnRevision(BaseModel):
    id: str
    conexion: ConexionPropuesta
    frase_editada: str
    seleccionada: bool = True   # pre-marcada
    estado: str = "pendiente"   # "pendiente" | "aceptada" | "rechazada"

class SesionReconexion(BaseModel):
    id: str
    grafo_id: str
    propuestas: list[PropuestaEnRevision]
    estado: str = "en_revision"  # "en_revision" | "completada" | "cancelada"
    iniciada_en: datetime
    completada_en: datetime | None = None
```

**`prompts/reconexion_v1.md`** — prompt específico para reconexión:
- Contexto: grafo serializado (nodos con label+descripcion, relaciones con etiqueta)
- Input: nodos sueltos con sus `cita_directa`
- Output JSON: lista de `{origen_id, destino_id, frase, tipo, confianza}`
- Transcripción completa opcional (si cabe en `config.max_chars_por_prompt`)

**`src/pipeline/reconexion.py`**:
- `construir_contexto_grafo(grafo: Grafo) -> str` — serializa nodos + relaciones como texto comprimido
- `construir_prompt_reconexion(grafo, nodos_sueltos, transcripcion_texto) -> str`
- `ejecutar_reconexion(grafo, proveedor, transcripcion_texto, on_token, should_cancel) -> list[ConexionPropuesta]`

**`src/persistencia/reconexion.py`**:
- `{slug}_reconexion.json` — guarda la sesión activa

**API en `src/app.py`**:
- `GET /api/grafo/{slug}/reconexion/estado` — ¿hay nodos sueltos? ¿hay sesión activa?
- `POST /api/grafo/{slug}/reconexion/iniciar` — lanza EjecucionReconexion
- `GET /api/grafo/{slug}/reconexion/sesion` — devuelve SesionReconexion activa
- `POST /api/grafo/{slug}/reconexion/confirmar` — acepta selección, materializa Relaciones
- `DELETE /api/grafo/{slug}/reconexion/sesion` — cancela sesión

**Frontend en `static/grafo.js` y `static/app.js`**:
- Botón "reconectar" (ícono anillo de nodos) visible solo cuando `nodos_sueltos > 0`
- Panel lateral: lista de frases editables con checkboxes pre-marcados
- Enviar selección + frases editadas al endpoint `/confirmar`
- Tras confirmar: recargar grafo, ocultar botón si ya no hay nodos sueltos

### Verificación
```bash
# Verificar que nodos sueltos se detectan
curl localhost:8000/api/grafo/heraclito/reconexion/estado
# Verificar flujo completo: iniciar → sesión → confirmar → grafo actualizado
```

---

## Fase 4 — Proveedores LLM adicionales + ConfiguracionProveedor

**Specs:** `extraccion.allium` (ProveedorLLM), `surfaces.allium` (ConfiguracionProveedor)  
**Depende de:** Ninguna fase anterior (puede implementarse en paralelo con Fase 2-3)

### Qué implementar

**`src/llm/anthropic.py`** — extender `EvaluadorLLM`:
- Usar `anthropic` SDK (streaming con `stream()`)
- `on_token` callback por cada `text_delta`
- `should_cancel()` watchdog en hilo separado
- Modelos: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`
- Prompt caching: usar `cache_control: {"type": "ephemeral"}` en bloque de sistema

**`src/llm/openai.py`** — extender `EvaluadorLLM`:
- Usar `openai` SDK con `stream=True`
- `on_token` por cada `chunk.choices[0].delta.content`

**`src/llm/gemini.py`** — extender `EvaluadorLLM`:
- Usar `google-generativeai` SDK
- `generate_content_stream()` con callbacks

**Actualizar `src/llm/__init__.py`**:
```python
def get_llm(provider: str) -> EvaluadorLLM:
    match provider:
        case "anthropic": return AnthropicLLM(...)
        case "openai":    return OpenAILLM(...)
        case "gemini":    return GeminiLLM(...)
        case "ollama":    return OllamaLLM(...)
        case _:           raise ValueError(f"Unknown provider: {provider}")
```

**`ConfiguracionProveedor` en `static/index.html` y `static/app.js`**:
- Modal de settings (ya hay botón `#btn-settings` sin funcionalidad)
- Campos: proveedor activo (radio), modelo (text input o select), API key (password input)
- `PATCH /api/settings` — ya existe, extender para multi-proveedor
- Mostrar estado: "conectado" / "sin API key" / "error" por proveedor

### Anti-patrones a evitar
- No hardcodear nombre de modelo; leerlo desde config
- No guardar API keys en `{slug}_*.json`; solo en `.env`

### Verificación
```bash
# Verificar que el factory carga todos los proveedores
python -c "from src.llm import get_llm; print(get_llm('anthropic'))"
# Verificar endpoint settings con nuevo proveedor
curl -X PATCH localhost:8000/api/settings -d '{"provider":"anthropic","model":"claude-sonnet-4-6"}'
```

---

## Fase 5 — Extracción incremental UI + procesamiento visible

**Specs:** `extraccion-incremental.allium`, `procesamiento-visible.allium`, `surfaces.allium`  
**Depende de:** Fase 1 (Grafo formal para visualización en construcción)

### Qué implementar

**`PanelExtraccionIncremental`** — reemplazar el progress bar actual:
- Mostrar cada batch como una fila: `[Lote 3/8] ⟳ conceptos emergiendo...`
- Tres fases visuales por lote:
  1. `conceptos_emergiendo` — los nodos aparecen en el D3 con animación de entrada
  2. `relaciones_consolidando` — las aristas aparecen gradualmente
  3. `integrado` — lote fijado, disponible para interacción
- Parámetros de timing en config: `ms_fase_conceptos` (default 800ms), `ms_fase_relaciones` (default 600ms)

**`PropuestaConsolidacion`** en UI:
- Cuando el tesauro detecta alta similitud entre conceptos de distintos lotes, mostrar banner:
  `"¿'conciencia' es lo mismo que 'awareness'? [Fusionar] [Mantener separados]"`
- Actualizar `src/pipeline/extraccion.py` para emitir eventos de similitud via SSE

**`ContraArgumentoDecision`**:
- Si un concepto previamente rechazado reaparece en un lote posterior, mostrar:
  `"'espíritu absoluto' apareció de nuevo (lote 5). ¿Confirmar rechazo o reconsiderar?"`
- Requiere que el tesauro tenga memoria de rechazos

**`ResumenSesionCompletada`** — modal al terminar extracción incremental:
- Total de conceptos integrados, relaciones, bucles
- Lista de fusiones realizadas
- Botón "Ir a validación"

**`GrafoEnConstruccion`** — reemplazar la vista de solo-espectador:
- Los lotes `integrado` permiten interacción: hacer clic en nodo para ver detalle, anular decisión de rechazo
- Los lotes `en_proceso` muestran nodos con opacidad reducida

### Verificación
```bash
# Extraer incrementalmente y verificar fases en UI
curl -X POST localhost:8000/api/extracciones/heraclito/procesar -d '{"modo":"incremental"}'
# Verificar eventos SSE de similitud
curl -N localhost:8000/api/extracciones/heraclito/stream
```

---

## Fase 6 — Grafos personales: referencias vivas + sugerencias LLM

**Spec:** `grafos-personales.allium`  
**Depende de:** Fase 1 (Grafo formal para ReferenciaConcepto)

### Qué implementar

**`ReferenciaConcepto`** en `src/models/grafo_personal.py`:
```python
class ReferenciaConcepto(BaseModel):
    id: str
    nodo_id: str        # Nodo.id en el grafo fuente
    grafo_fuente_id: str  # Grafo.id
    cita_pasaje: str | None  # extracto específico del texto
    nota: str | None
```
- Actualizar `ConceptoInvestigador` para incluir `referencias: list[ReferenciaConcepto]`
- Endpoint: `POST /api/grafos-personales/{slug}/conceptos/{cid}/referencias`

**Import desde grafo principal:**
- Endpoint: `POST /api/grafos-personales/{slug}/importar-nodo`
- Body: `{nodo_id, grafo_fuente_slug}`
- Crea `ConceptoInvestigador` con referencia al nodo original

**`Sugerencia` LLM** — el investigador puede pedir sugerencias de conexión entre conceptos:
- Endpoint: `POST /api/grafos-personales/{slug}/sugerencias/solicitar`
- Llama al LLM con el grafo personal serializado + grafos fuente referenciados
- Devuelve `list[Sugerencia]` (tipo `SugerenciaConcepto` o `SugerenciaRelacion`)
- Endpoints: `POST /sugerencias/{sid}/aceptar`, `POST /sugerencias/{sid}/descartar`
- Config: `max_sugerencias_por_solicitud = 5`

**`CitaPasaje`** en UI:
- En el editor de grafos personales, al hacer clic en un concepto mostrar panel de citas
- Botón "Agregar cita" → campo de texto libre + referencia al texto fuente

**`AnotacionPersonal`**:
- Igual que `AnotacionInvestigador` en validación, pero para grafos personales
- Endpoint: `POST /api/grafos-personales/{slug}/anotar`

### Verificación
```bash
# Importar nodo desde grafo existente
curl -X POST localhost:8000/api/grafos-personales/mi-grafo/importar-nodo \
  -d '{"nodo_id":"node_001","grafo_fuente_slug":"heraclito"}'
# Solicitar sugerencias
curl -X POST localhost:8000/api/grafos-personales/mi-grafo/sugerencias/solicitar
```

---

## Fase 7 — Transcripción: ingesta YouTube (baja prioridad)

**Spec:** `transcripcion.allium` (FuenteOrigen.youtube)  
**Depende de:** Ninguna fase anterior

### Qué implementar

**Dependencias externas:**
- `yt-dlp` — descarga audio de YouTube
- `openai-whisper` o `faster-whisper` — transcripción local
- O: usar la API de Whisper si el investigador tiene API key de OpenAI

**Nuevo endpoint:**
- `POST /api/transcripciones/desde-youtube` — body: `{url: str}`
- Descarga audio → transcribe → normaliza → guarda como `{slug}.txt`
- Streaming de progreso via SSE

**Frontend:**
- En la biblioteca, agregar opción "Desde YouTube" al crear nueva transcripción
- Input de URL + barra de progreso de transcripción

### Verificación
```bash
# Transcribir un video corto de prueba
curl -X POST localhost:8000/api/transcripciones/desde-youtube \
  -d '{"url":"https://www.youtube.com/watch?v=..."}'
```

---

## Orden de ejecución recomendado

```
Fase 1 (Grafo formal)
    ↓
Fase 2 (Validación) ──────── Fase 4 (Proveedores LLM)
    ↓                                ↓
Fase 3 (getYourStuffTogether)   (paralelo a F2-F3)
    ↓
Fase 5 (Extracción incremental UI)
    ↓
Fase 6 (Grafos personales)
    ↓
Fase 7 (YouTube) ← baja prioridad, puede ir en cualquier momento
```

Fases 2 y 4 pueden ejecutarse en paralelo.  
Fase 3 requiere Fase 1 completada.  
Fase 5 requiere Fase 1.  
Fase 6 requiere Fase 1.

---

## Notas para cada sesión de ejecución

Cada fase debe comenzar leyendo:
1. `PLAN.md` (este archivo) para contexto
2. La spec `.allium` correspondiente en `specs/`
3. Los archivos de código que se van a modificar

No asumir que una función existe; buscarla con grep antes de llamarla.  
No inventar endpoints de SDK; verificar en la documentación del proveedor.
