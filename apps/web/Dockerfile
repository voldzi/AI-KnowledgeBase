# syntax=docker/dockerfile:1.7

FROM node:26.8.1-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS deps
WORKDIR /app
COPY apps/web/package.json apps/web/pnpm-lock.yaml apps/web/pnpm-workspace.yaml ./
COPY apps/web/vendor/stratos-ui/ ./vendor/stratos-ui/
ADD --checksum=sha256:b9e49603540d04107b98e93917a30e6114970d403c23e40309a44ea9c2bca7fd \
  https://registry.npmjs.org/pnpm/-/pnpm-11.19.0.tgz /tmp/pnpm.tgz
# Keep dependency downloads across BuildKit retries. The production image must
# remain buildable when the public registry has a transient slow response.
RUN --mount=type=cache,id=akb-web-pnpm-store,target=/pnpm/store \
  mkdir -p /usr/local/lib/node_modules/pnpm && \
  tar -xzf /tmp/pnpm.tgz -C /usr/local/lib/node_modules/pnpm --strip-components=1 && \
  rm /tmp/pnpm.tgz && \
  node /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs config set store-dir /pnpm/store && \
  node /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs config set fetch-retries 5 && \
  node /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs config set fetch-timeout 300000 && \
  node /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs config set network-concurrency 8 && \
  node /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs install --frozen-lockfile

FROM node:26.8.1-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS builder
WORKDIR /app
ARG NEXT_PUBLIC_AKL_BASE_PATH=""
ARG NEXT_PUBLIC_STRATOS_HOME_URL=""
ARG NEXT_PUBLIC_PROJECTFLOW_URL=""
ARG NEXT_PUBLIC_ARCHFLOW_URL=""
ARG NEXT_PUBLIC_CHAT_URL=""
ARG NEXT_PUBLIC_AKB_URL=""
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_AKL_BASE_PATH=$NEXT_PUBLIC_AKL_BASE_PATH
ENV NEXT_PUBLIC_STRATOS_HOME_URL=$NEXT_PUBLIC_STRATOS_HOME_URL
ENV NEXT_PUBLIC_PROJECTFLOW_URL=$NEXT_PUBLIC_PROJECTFLOW_URL
ENV NEXT_PUBLIC_ARCHFLOW_URL=$NEXT_PUBLIC_ARCHFLOW_URL
ENV NEXT_PUBLIC_CHAT_URL=$NEXT_PUBLIC_CHAT_URL
ENV NEXT_PUBLIC_AKB_URL=$NEXT_PUBLIC_AKB_URL
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /usr/local/lib/node_modules/pnpm /usr/local/lib/node_modules/pnpm
COPY apps/web/ ./
COPY contracts /contracts
RUN node /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs run build

FROM node:26.8.1-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS runner
WORKDIR /app
ARG NEXT_PUBLIC_AKL_BASE_PATH=""
ARG AKL_IMAGE_SERVICE="web"
LABEL cz.zeleznalady.akl.service="${AKL_IMAGE_SERVICE}"
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_AKL_BASE_PATH=$NEXT_PUBLIC_AKL_BASE_PATH

RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
RUN mkdir -p /data/object-storage && chown -R nextjs:nextjs /data

COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --chown=nextjs:nextjs apps/web/otel-bootstrap.cjs ./otel-bootstrap.cjs
COPY --chown=nextjs:nextjs apps/web/official-source-worker.mjs ./official-source-worker.mjs
COPY apps/web/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://$HOSTNAME:3000${NEXT_PUBLIC_AKL_BASE_PATH:-}/health" >/dev/null || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--require", "/app/otel-bootstrap.cjs", "server.js"]
