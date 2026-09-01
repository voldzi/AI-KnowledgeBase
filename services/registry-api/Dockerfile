FROM python:3.12-slim@sha256:e5c9fa26ffb76e11e0f054f30dc2523a2f9693f0c36c0cf1e39b27e152d899fc

LABEL cz.zeleznalady.akl.service="registry-api"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml ./
COPY app ./app
RUN pip install --no-cache-dir .

COPY alembic.ini ./alembic.ini
COPY alembic ./alembic
COPY openapi.yaml ./openapi.yaml

RUN groupadd --gid 1000 akb \
    && useradd --uid 1000 --gid akb --no-create-home --shell /usr/sbin/nologin akb \
    && chmod -R a+rX /app

USER akb

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
