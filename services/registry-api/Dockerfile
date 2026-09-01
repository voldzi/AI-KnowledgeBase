FROM python:3.12-slim@sha256:e5c9fa26ffb76e11e0f054f30dc2523a2f9693f0c36c0cf1e39b27e152d899fc

ARG SOURCE_DATE_EPOCH

LABEL cz.zeleznalady.akl.service="registry-api"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml ./
COPY requirements.c4.lock ./
COPY app ./app
RUN test "$SOURCE_DATE_EPOCH" -gt 0 \
    && export SOURCE_DATE_EPOCH \
    && export PIP_NO_CACHE_DIR=1 \
    && pip install --no-cache-dir --require-hashes -r requirements.c4.lock \
    && pip install --no-cache-dir --no-deps . \
    && rm -rf /root/.cache/pip

COPY alembic.ini ./alembic.ini
COPY alembic ./alembic
COPY openapi.yaml ./openapi.yaml

RUN groupadd --gid 1000 akb \
    && useradd --uid 1000 --gid akb --no-create-home --shell /usr/sbin/nologin akb \
    && chmod -R a+rX /app

USER akb

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
