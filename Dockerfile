# Cloud Run: misma app FastAPI que corre local con run.sh, contenerizada.
# Paso 1 del port: desplegar sin tocar la logica. src/persistencia/*.py
# sigue leyendo/escribiendo archivos locales (efimeros en Cloud Run, se
# pierden al reiniciar la instancia) hasta que se migre a Firestore.
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "python3 -m uvicorn src.app:app --host 0.0.0.0 --port ${PORT}"]
