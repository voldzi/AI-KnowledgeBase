FROM gitea/act_runner:0.2.11 AS act_runner
FROM docker:27-cli AS docker_cli

# Playwright's Linux browser binaries need glibc and the Debian browser
# dependencies. Alpine can download the cache but cannot reliably execute it.
FROM node:22-bookworm-slim

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        coreutils \
        curl \
        git \
        python3 \
        python3-pip \
        python3-venv \
        ruby-full \
        shellcheck \
        tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=docker_cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker_cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose

RUN groupadd --gid 107 akbci-docker \
    && useradd --uid 1001 --gid akbci-docker --create-home --home-dir /home/akbci --shell /bin/bash akbci

COPY --from=act_runner /usr/local/bin/act_runner /usr/local/bin/act_runner
COPY --from=act_runner /opt/act/run.sh /opt/act/run.sh

# The private home CA is copied by the VM bootstrap process, never from Git.
COPY git.home.cz.crt /usr/local/share/ca-certificates/git.home.cz.crt
RUN update-ca-certificates

RUN npm install --global pnpm@11.7.0 \
    && node --version \
    && pnpm --version \
    && python3 --version \
    && ruby --version \
    && docker compose version

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/act/run.sh"]
