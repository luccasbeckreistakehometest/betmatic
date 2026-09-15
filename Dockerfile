# Betmatic — the official Playwright image already carries Chromium 1.55 and every system library it
# needs. The market sweep runs a HEADED browser (headless gets nothing from Betano), so the server is
# started under xvfb-run: a virtual display the job can open a window on.
FROM mcr.microsoft.com/playwright:v1.55.0-noble AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM mcr.microsoft.com/playwright:v1.55.0-noble AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM mcr.microsoft.com/playwright:v1.55.0-noble AS run
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends xvfb && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DATA_DIR=/app/data PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/scripts ./scripts
COPY package.json next.config.* ./
RUN mkdir -p /app/data /app/.browser-profiles
VOLUME ["/app/data", "/app/.browser-profiles"]
EXPOSE 3000
CMD ["xvfb-run", "-a", "-s", "-screen 0 1600x1100x24", "npx", "next", "start", "-p", "3000"]
