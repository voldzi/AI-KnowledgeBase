FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AKL_SERVICE_NAME=platform-infrastructure \
    PLATFORM_HOST=0.0.0.0 \
    PLATFORM_PORT=8080

WORKDIR /app

RUN addgroup --system akl && adduser --system --ingroup akl akl

COPY services/platform-infrastructure/akl_platform_status ./akl_platform_status
COPY services/platform-infrastructure/README.md ./README.md

USER akl

EXPOSE 8080

HEALTHCHECK --interval=20s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2).read()"

CMD ["python", "-m", "akl_platform_status.server"]
