#!/usr/bin/env bash
# run.sh — arranca Lectógrafo localmente
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
VENV="$REPO/.venv"
PY="$VENV/bin/python"
UV="$VENV/bin/uvicorn"
REQ="$REPO/requirements.txt"

# ── Entorno virtual ────────────────────────────────────────────────
if [ ! -f "$PY" ]; then
  echo "→ Creando entorno virtual..."
  python3 -m venv "$VENV"
fi

# ── Dependencias ───────────────────────────────────────────────────
if [ -f "$REQ" ]; then
  echo "→ Verificando dependencias..."
  "$PY" -m pip install -q -r "$REQ"
fi

# ── Variables de entorno ───────────────────────────────────────────
if [ -f "$REPO/.env" ]; then
  set -a; source "$REPO/.env"; set +a
else
  echo "⚠  No se encontró .env — copia .env.example a .env y configura tu proveedor LLM."
fi

# ── Directorios de datos ───────────────────────────────────────────
mkdir -p "$REPO/transcripts" "$REPO/data/grafos"

# ── Modo ───────────────────────────────────────────────────────────
DEV=0
for arg in "$@"; do
  case "$arg" in
    --dev|-d) DEV=1 ;;
  esac
done

# ── Servidor ───────────────────────────────────────────────────────
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"

echo ""
echo "  Lectógrafo → http://${HOST}:${PORT}"
if [ "$DEV" = "1" ]; then
  echo "  Modo desarrollo (--reload activo — reinicia al editar .py)"
else
  echo "  Modo estable (sin --reload — las extracciones no se interrumpen)"
fi
echo "  Ctrl+C para detener."
echo ""

if [ "$DEV" = "1" ]; then
  exec "$UV" src.app:app \
    --host "$HOST" \
    --port "$PORT" \
    --reload
else
  exec "$UV" src.app:app \
    --host "$HOST" \
    --port "$PORT"
fi
