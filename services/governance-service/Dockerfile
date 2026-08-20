FROM python:3.12-slim

LABEL cz.zeleznalady.akl.service="governance-service"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AKL_SERVICE_NAME=governance-service

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY document_diff ./document_diff
COPY conflict_detection ./conflict_detection
COPY compliance ./compliance
COPY kb_generation ./kb_generation
COPY openapi.yaml README.md ./

RUN groupadd --gid 1000 akb \
    && useradd --uid 1000 --gid akb --no-create-home --shell /usr/sbin/nologin akb

USER akb

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3).read()"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
