# syntax=docker/dockerfile:1
# ---------- build the SPA ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts --workspace @rca/web --include-workspace-root
COPY apps/web apps/web
RUN npm run build -w @rca/web

# ---------- Caddy: static files, /api reverse proxy, automatic HTTPS ----------
FROM caddy:2-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
# Run as an unprivileged user; the caddy binary in the official image has cap_net_bind_service.
RUN addgroup -S caddy && adduser -S -G caddy caddy && mkdir -p /data /config && chown -R caddy:caddy /data /config /srv
USER caddy
EXPOSE 80 443
