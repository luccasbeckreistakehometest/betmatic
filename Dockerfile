# Betmatic — the official Playwright image already carries Chromium 1.55 and every system library it
# needs. The market sweep runs a HEADED browser (headless gets nothing from Betano), so the server is
# started under xvfb-run: a virtual display the job can open a window on.
FROM mcr.microsoft.com/playwright:v1.55.1-noble AS deps
WORKDIR /app
# better-sqlite3 compila do fonte aqui e a imagem do Playwright não traz toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM mcr.microsoft.com/playwright:v1.55.1-noble AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY --from=deps /app/node_modules ./node_modules
# .dockerignore keeps .env*, data and test artefacts out of the context: no secret is baked into a
# layer. NEXT_PUBLIC_BASE_URL and APP_URL are read at runtime (src/lib/base-url.ts), not inlined.
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM mcr.microsoft.com/playwright:v1.55.1-noble AS run
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends xvfb && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DATA_DIR=/app/data PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/scripts ./scripts
# Source definitions read at runtime by the admin research routes (src/lib/config.ts).
COPY --from=build /app/config ./config
COPY package.json next.config.* ./
RUN mkdir -p /app/data /app/.browser-profiles
VOLUME ["/app/data", "/app/.browser-profiles"]
EXPOSE 3000
CMD ["sh", "/app/scripts/docker-entrypoint.sh"]
