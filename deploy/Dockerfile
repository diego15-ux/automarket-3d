# AutoMarket 3D · imagen de producción (la API y la web salen de la misma base).
#   docker compose build      (desde la carpeta deploy/; el contexto es la raíz del proyecto)
FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Todo el código de una vez: el postinstall de la raíz compila packages/contracts.
COPY . .
RUN npm ci --no-audit --no-fund

# ── API ────────────────────────────────────────────────────────────────────────
FROM base AS api
# prisma generate solo necesita que DATABASE_URL exista; la real llega al arrancar.
RUN DATABASE_URL=mysql://build:build@localhost:3306/build npm run build -w @automarket/api
ENV NODE_ENV=production
WORKDIR /app/apps/api
EXPOSE 4000
# Aplica las migraciones nuevas y arranca. Las que ya están aplicadas no se repiten.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main.js"]

# ── Web ────────────────────────────────────────────────────────────────────────
FROM base AS web
# Las NEXT_PUBLIC_* quedan dentro de la página al compilar: cambiarlas = volver a compilar.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_MEDIA_HOST
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_MEDIA_HOST=$NEXT_PUBLIC_MEDIA_HOST \
    NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY \
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID \
    API_PROXY_TARGET=http://api:4000 \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @automarket/web
ENV NODE_ENV=production
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["npx", "next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
