FROM python:3.12-slim

LABEL cz.zeleznalady.akl.service="rag-retrieval-service"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AKL_SERVICE_NAME=rag-retrieval-service

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY retrievers ./retrievers
COPY rerankers ./rerankers
COPY answer_composer ./answer_composer
COPY policies ./policies
COPY openapi.yaml README.md ./

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3).read()"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
