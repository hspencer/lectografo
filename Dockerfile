# Cloud Run: misma app FastAPI que corre local con run.sh, contenerizada.
# Paso 1 del port: desplegar sin tocar la logica. src/persistencia/*.py
# sigue leyendo/escribiendo archivos locales (efimeros en Cloud Run, se
# pierden al reiniciar la instancia) hasta que se migre a Firestore.
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Migracion del corpus local de Herbert a su biblioteca (unico usuario real
# hoy). mGGUCaLtCqyTofBUxcT0 es su bibliotecaId real (Firestore
# personas/{uid}.bibliotecaIds[0]). Se copia en vez de mover: run.sh local
# no escopa por biblioteca y sigue leyendo la raiz de data/grafos/ y
# transcripts/ tal como siempre.
RUN BIB=mGGUCaLtCqyTofBUxcT0 \
    && mkdir -p "data/grafos/$BIB" "transcripts/$BIB" \
    && find data/grafos -maxdepth 1 -name '*.json' -exec cp {} "data/grafos/$BIB/" \; \
    && [ -d data/grafos/grafos-personales ] && cp -r data/grafos/grafos-personales "data/grafos/$BIB/" || true \
    && find transcripts -maxdepth 1 -name '*.txt' -exec cp {} "transcripts/$BIB/" \;

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "python3 -m uvicorn src.app:app --host 0.0.0.0 --port ${PORT}"]
