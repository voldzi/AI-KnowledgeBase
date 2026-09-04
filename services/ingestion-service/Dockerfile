FROM python:3.12-slim@sha256:e5c9fa26ffb76e11e0f054f30dc2523a2f9693f0c36c0cf1e39b27e152d899fc

ENV PIP_DEFAULT_TIMEOUT=300 \\
    PIP_RETRIES=8 \\
    PIP_DISABLE_PIP_VERSION_CHECK=1

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AKL_SERVICE_NAME=ingestion-service

WORKDIR /app

ARG AKL_INSTALL_DOCLING=false

RUN printf '%s\n' \
        'Types: deb' \
        'URIs: https://snapshot.debian.org/archive/debian/20260824T000000Z' \
        'Suites: trixie trixie-updates' \
        'Components: main' \
        'Signed-By: /usr/share/keyrings/debian-archive-keyring.pgp' \
        'Check-Valid-Until: no' \
        '' \
        'Types: deb' \
        'URIs: https://snapshot.debian.org/archive/debian-security/20260824T000000Z' \
        'Suites: trixie-security' \
        'Components: main' \
        'Signed-By: /usr/share/keyrings/debian-archive-keyring.pgp' \
        'Check-Valid-Until: no' \
        > /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Check-Valid-Until=false update \
    && apt-get install -y --no-install-recommends \
        ghostscript=10.05.1~dfsg-1+deb13u1 \
        libreoffice-calc-nogui=4:25.2.3-2+deb13u6 \
        libreoffice-impress-nogui=4:25.2.3-2+deb13u6 \
        libreoffice-writer-nogui=4:25.2.3-2+deb13u6 \
        fonts-dejavu-core=2.37-8 \
        fonts-liberation=1:2.1.5-3 \
        fonts-noto-core=20201225-2 \
        ocrmypdf=16.7.0+dfsg1-3 \
        poppler-utils=25.03.0-5+deb13u4 \
        qpdf=12.2.0-1 \
        tesseract-ocr=5.5.0-1+b1 \
        tesseract-ocr-ces=1:4.1.0-2 \
        tesseract-ocr-eng=1:4.1.0-2 \
        tesseract-ocr-osd=1:4.1.0-2 \
        unpaper=7.0.0-3+b2 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.c4.lock requirements-docling.c4.lock ./
RUN case "$AKL_INSTALL_DOCLING" in \
      true) pip install --no-cache-dir --only-binary=:all: \
        --extra-index-url https://download.pytorch.org/whl/cpu \
        --require-hashes -r requirements-docling.c4.lock ;; \
      false) pip install --no-cache-dir --only-binary=:all: \
        --require-hashes -r requirements.c4.lock ;; \
      *) printf '%s\n' 'AKL_INSTALL_DOCLING must be true or false' >&2; exit 2 ;; \
    esac

COPY app ./app
COPY parsers ./parsers
COPY docling_models ./docling_models
COPY chunkers ./chunkers
COPY embeddings ./embeddings
COPY indexers ./indexers
COPY intelligence ./intelligence
COPY renditions ./renditions
COPY openapi.yaml README.md ./

# Immutable release trees can be extracted with owner-only source modes. The
# model provisioner runs as the invoking host uid, so only its import surface
# must be readable without granting it write access.
RUN chmod -R a+rX /app/docling_models /app/parsers

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/health', timeout=3).read()"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090"]
