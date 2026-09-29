# syntax=docker/dockerfile:1
# ---------- build ----------
FROM node:22-bookworm-slim AS build
# OpenSSL 3 so Prisma picks the same engines as the runtime image (Ubuntu noble, OpenSSL 3).
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/api/prisma apps/api/prisma
RUN npm ci --workspace @rca/api --include-workspace-root
COPY apps/api apps/api
RUN npm run build -w @rca/api \
 && npm prune --omit=dev --workspace @rca/api --include-workspace-root

# ---------- runtime ----------
# The Playwright image ships Chromium and its libraries plus an unprivileged user (pwuser).
FROM mcr.microsoft.com/playwright:v1.63.0-noble AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY --from=build --chown=pwuser:pwuser /app/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /app/package.json ./package.json
COPY --from=build --chown=pwuser:pwuser /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=pwuser:pwuser /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=pwuser:pwuser /app/apps/api/prisma ./apps/api/prisma
RUN mkdir -p /data/uploads && chown -R pwuser:pwuser /data
USER pwuser
WORKDIR /app/apps/api
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 CMD curl -fs http://127.0.0.1:4000/readyz || exit 1
# Migrations run automatically on every deploy, then the server starts.
CMD ["sh", "-c", "node ../../node_modules/prisma/build/index.js migrate deploy && exec node dist/src/server.js"]
