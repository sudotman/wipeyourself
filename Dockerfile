FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Cloud Run sets $PORT. Use 8080 locally by default.
EXPOSE 8080

CMD ["sh","-c","python main.py --host 0.0.0.0 --port ${PORT:-8080}"]


