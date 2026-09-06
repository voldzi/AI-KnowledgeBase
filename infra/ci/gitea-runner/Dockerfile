FROM gitea/act_runner:0.3.0@sha256:8368754bb612a1deb07ed604e3b955338aefc01576d4d0d92e8dd82f29250fcd AS act_runner
FROM docker:29.7.2-cli@sha256:3f4743208d2338c934d7b8bcfbe1bb54c0b2355c510ad5e0f31c0c4a54bd704e AS docker_cli

# Playwright's Linux browser binaries need glibc and the Debian browser
# dependencies. Alpine can download the cache but cannot reliably execute it.
FROM node:26.8.1-bookworm-slim@sha256:367679cf9792759492a486e4aa4b421764d71a9546a6dae8aab81a99eb797b3e AS ci-tools

USER root

# Service and OpenAPI contracts include Czech text. Keep Ruby and Python
# deterministic instead of inheriting the host executor's ASCII locale.
ENV LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        coreutils \
        curl \
        fonts-liberation \
        git \
        libasound2 \
        libatk-bridge2.0-0 \
        libatk1.0-0 \
        libatspi2.0-0 \
        libcups2 \
        libdbus-1-3 \
        libdrm2 \
        libgbm1 \
        libglib2.0-0 \
        libgtk-3-0 \
        libnspr4 \
        libnss3 \
        libx11-6 \
        libx11-xcb1 \
        libxcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxext6 \
        libxfixes3 \
        libxkbcommon0 \
        libxrandr2 \
        libxrender1 \
        libxshmfence1 \
        libxss1 \
        libxtst6 \
        openssh-client \
        python3 \
        python3-pip \
        python3-venv \
        ruby-full \
        shellcheck \
        tini \
        xvfb \
    && rm -rf /var/lib/apt/lists/*

COPY --from=docker_cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker_cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
COPY --from=docker_cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose

RUN groupadd --gid 107 akbci-docker \
    && useradd --uid 1001 --gid akbci-docker --create-home --home-dir /home/akbci --shell /bin/bash akbci

# The private home CA is copied by the VM bootstrap process, never from Git.
COPY git.home.cz.crt /usr/local/share/ca-certificates/git.home.cz.crt
RUN update-ca-certificates

RUN npm install --global pnpm@11.19.0 \
    && node --version \
    && pnpm --version \
    && python3 --version \
    && ruby --version \
    && docker buildx version \
    && docker compose version

FROM ci-tools AS runner

COPY --from=act_runner /usr/local/bin/act_runner /usr/local/bin/act_runner
COPY --from=act_runner /usr/local/bin/run.sh /usr/local/bin/run.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/run.sh"]
