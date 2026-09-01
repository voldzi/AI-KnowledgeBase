FROM python:3.12-slim@sha256:e5c9fa26ffb76e11e0f054f30dc2523a2f9693f0c36c0cf1e39b27e152d899fc

LABEL cz.zeleznalady.akl.service="rag-retrieval-service"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AKL_SERVICE_NAME=rag-retrieval-service

WORKDIR /app

COPY requirements.c4.lock .
RUN pip install --no-cache-dir --require-hashes -r requirements.c4.lock

COPY app ./app
COPY retrievers ./retrievers
COPY rerankers ./rerankers
COPY answer_composer ./answer_composer
COPY policies ./policies
COPY openapi.yaml README.md ./

RUN groupadd --gid 1000 akb \
    && useradd --uid 1000 --gid akb --no-create-home --shell /usr/sbin/nologin akb \
    && chmod -R a+rX /app

USER akb

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3).read()"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
