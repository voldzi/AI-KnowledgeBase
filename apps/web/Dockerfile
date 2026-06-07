# syntax=docker/dockerfile:1.7

FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci

FROM node:26-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_AKL_BASE_PATH=""
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_AKL_BASE_PATH=$NEXT_PUBLIC_AKL_BASE_PATH
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_AKL_BASE_PATH=""

RUN apk add --no-cache su-exec
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs
RUN mkdir -p /data/object-storage && chown -R nextjs:nextjs /data

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nextjs /app/.next/static ./.next/static
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://$HOSTNAME:3000/health >/dev/null || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
