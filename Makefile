PY     := .venv/bin/python
GRAFOS := data/grafos

.PHONY: run run-stable extraer actualizar reset estado ayuda

# ── Servidor ──────────────────────────────────────────────────────────────────
# --reload reinicia el servidor al guardar archivos Python (mata extracciones en curso)
run:
	$(PY) -m uvicorn src.app:app --reload

# Sin --reload: los cambios en Python no interrumpen las extracciones en progreso
run-stable:
	$(PY) -m uvicorn src.app:app --port 8000

# ── Extracción ────────────────────────────────────────────────────────────────
# Uso:  make extraer TEXTO=transcripts/mi-charla.txt
#       make extraer TEXTO=transcripts/mi-charla.txt DEBUG=1
extraer:
ifndef TEXTO
	$(error Falta TEXTO. Uso: make extraer TEXTO=transcripts/archivo.txt)
endif
	$(PY) extraer.py $(TEXTO) --guardar $(if $(DEBUG),--debug,)

# ── Re-extracción preservando validación ─────────────────────────────────────
# Uso:  make actualizar TEXTO=transcripts/mi-charla.txt
#       make actualizar TEXTO=transcripts/mi-charla.txt DEBUG=1
actualizar:
ifndef TEXTO
	$(error Falta TEXTO. Uso: make actualizar TEXTO=transcripts/archivo.txt)
endif
	$(PY) actualizar.py $(TEXTO) $(if $(DEBUG),--debug,)

# ── Estado ───────────────────────────────────────────────────────────────────
estado:
	@echo "── Transcripts disponibles ──────────────────────"
	@ls transcripts/ 2>/dev/null || echo "  (ninguno)"
	@echo ""
	@echo "── Extracciones guardadas ───────────────────────"
	@ls $(GRAFOS)/*_extraccion.json 2>/dev/null | sed 's|$(GRAFOS)/||;s|_extraccion.json||' || echo "  (ninguna)"
	@echo ""
	@echo "── Validaciones guardadas ───────────────────────"
	@ls $(GRAFOS)/*_validacion.json 2>/dev/null | sed 's|$(GRAFOS)/||;s|_validacion.json||' || echo "  (ninguna)"

# ── Reset ─────────────────────────────────────────────────────────────────────
# Borra todos los JSONs de data/grafos/ (extraccion + validacion)
# Pide confirmación antes de borrar.
reset:
	@echo "⚠  Esto borrará todos los archivos en $(GRAFOS)/"
	@ls $(GRAFOS)/*.json 2>/dev/null || (echo "  Ya está vacío."; exit 0)
	@printf "   ¿Continuar? [s/N] " && read ans && [ "$$ans" = "s" ] || (echo "Cancelado."; exit 1)
	rm -f $(GRAFOS)/*.json
	@echo "✓ Base de datos borrada."

# ── Ayuda ─────────────────────────────────────────────────────────────────────
ayuda:
	@echo ""
	@echo "  make run                           Arranca el servidor con --reload (reinicia al editar)"
	@echo "  make run-stable                    Arranca el servidor sin --reload (no interrumpe extracciones)"
	@echo "  make extraer TEXTO=transcripts/…   Extrae y guarda un transcript"
	@echo "  make extraer TEXTO=… DEBUG=1       Igual pero vuelca el raw del LLM"
	@echo "  make actualizar TEXTO=transcripts/… Re-extrae preservando validación previa"
	@echo "  make actualizar TEXTO=… DEBUG=1    Igual pero vuelca el raw del LLM"
	@echo "  make estado                        Lista transcripts y extracciones"
	@echo "  make reset                         Borra toda la base de datos (pide confirmación)"
	@echo ""
