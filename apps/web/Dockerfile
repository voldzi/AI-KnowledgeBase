# syntax=docker/dockerfile:1.7

FROM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS deps
WORKDIR /app
COPY apps/web/package.json apps/web/pnpm-lock.yaml apps/web/pnpm-workspace.yaml ./
# Keep dependency downloads across BuildKit retries. The production image must
# remain buildable when the public registry has a transient slow response.
RUN --mount=type=cache,id=akb-web-pnpm-store,target=/pnpm/store \
  npm install -g pnpm@11.7.0 && \
  pnpm config set store-dir /pnpm/store && \
  pnpm config set fetch-retries 5 && \
  pnpm config set fetch-timeout 300000 && \
  pnpm config set network-concurrency 8 && \
  pnpm install --frozen-lockfile

FROM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS builder
WORKDIR /app
ARG NEXT_PUBLIC_AKL_BASE_PATH=""
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_AKL_BASE_PATH=$NEXT_PUBLIC_AKL_BASE_PATH
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /usr/local/lib/node_modules/pnpm /usr/local/lib/node_modules/pnpm
COPY apps/web/ ./
COPY contracts/director-copilot/v2 /contracts/director-copilot/v2
RUN node /usr/local/lib/node_modules/pnpm/bin/pnpm.cjs run build

FROM node:26-alpine@sha256:2d984a15c9b54fd0aeb608b8e0d0d83529eb34d2966db27a1fb4f1edc3d298a3 AS runner
WORKDIR /app
ARG NEXT_PUBLIC_AKL_BASE_PATH=""
ARG AKL_IMAGE_SERVICE="web"
LABEL cz.zeleznalady.akl.service="${AKL_IMAGE_SERVICE}"
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_AKL_BASE_PATH=$NEXT_PUBLIC_AKL_BASE_PATH

RUN apk add --no-cache su-exec
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
RUN mkdir -p /data/object-storage && chown -R nextjs:nextjs /data

COPY --from=builder --chown=nextjs:nextjs /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY --chown=nextjs:nextjs apps/web/otel-bootstrap.cjs ./otel-bootstrap.cjs
COPY apps/web/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://$HOSTNAME:3000${NEXT_PUBLIC_AKL_BASE_PATH:-}/health" >/dev/null || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--require", "/app/otel-bootstrap.cjs", "server.js"]
