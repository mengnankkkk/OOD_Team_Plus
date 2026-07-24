# syntax=docker/dockerfile:1.7
ARG NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim

FROM ${NODE_BASE_IMAGE} AS node-base
ARG NPM_REGISTRY=https://registry.npmmirror.com
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY
ENV npm_config_registry=$NPM_REGISTRY
RUN corepack enable && corepack prepare pnpm@10.29.3 --activate

FROM node-base AS dependencies
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM node-base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=cache,id=money-whisperer-next,target=/app/.next/cache \
  pnpm build

FROM ${NODE_BASE_IMAGE} AS runner
ARG DEBIAN_MIRROR=https://mirrors.tuna.tsinghua.edu.cn
ARG PYPI_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DB_PATH=/app/data/money-whisperer.db
ENV PANDADATA_PYTHON=/opt/pandadata-venv/bin/python

RUN for source_file in /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; do \
      if [ -f "$source_file" ]; then \
        sed -i \
          -e "s|http://deb.debian.org/debian-security|${DEBIAN_MIRROR}/debian-security|g" \
          -e "s|https://deb.debian.org/debian-security|${DEBIAN_MIRROR}/debian-security|g" \
          -e "s|http://security.debian.org/debian-security|${DEBIAN_MIRROR}/debian-security|g" \
          -e "s|https://security.debian.org/debian-security|${DEBIAN_MIRROR}/debian-security|g" \
          -e "s|http://deb.debian.org/debian|${DEBIAN_MIRROR}/debian|g" \
          -e "s|https://deb.debian.org/debian|${DEBIAN_MIRROR}/debian|g" \
          "$source_file"; \
      fi; \
    done \
  && apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
  && python3 -m venv /opt/pandadata-venv \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --home-dir /app nextjs \
  && mkdir -p /app/data/backups \
  && chown -R nextjs:nodejs /app/data /opt/pandadata-venv

COPY requirements.txt ./requirements.txt
RUN /opt/pandadata-venv/bin/pip install \
  --index-url "$PYPI_INDEX_URL" \
  --no-cache-dir \
  --requirement requirements.txt

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/src/server/db/migrations ./src/server/db/migrations
COPY --from=builder --chown=nextjs:nodejs /app/.agents/skills/pandadata-api ./.agents/skills/pandadata-api

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
