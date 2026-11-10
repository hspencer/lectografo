# Cloud Run: misma app FastAPI que corre local con run.sh, contenerizada.
# En Cloud Run, GRAFOS_DIR/TRANSCRIPTS_DIR (env vars, ver src/config.py)
# apuntan a un bucket GCS montado como volumen -- sobrevive a redeploys y
# a que la instancia se recicle, a diferencia del disco local de antes.
# El corpus ya vive en gs://lectografo-datos/{grafos,transcripts}/<bibId>/,
# sembrado una sola vez a mano; no hace falta hornearlo en la imagen.
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "python3 -m uvicorn src.app:app --host 0.0.0.0 --port ${PORT}"]
