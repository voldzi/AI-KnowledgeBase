FROM python:3.12-slim

ENV PIP_DEFAULT_TIMEOUT=300 \
    PIP_RETRIES=8 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

LABEL cz.zeleznalady.akl.service="llm-gateway-service"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AKL_SERVICE_NAME=llm-gateway-service

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY providers ./providers
COPY openapi.yaml README.md ./

RUN groupadd --gid 1000 akb \
    && useradd --uid 1000 --gid akb --no-create-home --shell /usr/sbin/nologin akb \
    && chmod -R a+rX /app

USER akb

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3).read()"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
