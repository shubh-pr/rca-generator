# API image. Based on the Playwright image so headless Chromium is available for PDF export.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/api/prisma apps/api/prisma
# Dev dependencies are kept: prisma CLI and tsx run migrations and the seed at start-up.
RUN npm ci --include=dev --workspace @rca/api --include-workspace-root

COPY apps/api apps/api
RUN npm run build -w @rca/api

WORKDIR /app/apps/api
ENV PORT=4000 UPLOAD_DIR=/data/uploads
EXPOSE 4000
# Migrations and the (idempotent) seed run on every start.
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/src/server.js"]
