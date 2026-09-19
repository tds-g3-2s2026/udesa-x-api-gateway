# Dependencies installed before copying the source so the layer cache
# survives any change under src/.
FROM oven/bun:1.4.0 AS base
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Tests only. Sits before the final stage because `docker build` without
# --target builds the last one, and that has to be production.
FROM base AS test
COPY . .
RUN chown -R bun:bun /app
USER bun
CMD ["bun", "run", "test:ci"]

# Final stage: Bun runs the TypeScript entrypoint directly, no build step.
FROM base AS production
COPY src/ ./src/
COPY tsconfig.json ./
RUN chown -R bun:bun /app
USER bun
EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
    CMD ["bun", "-e", "fetch('http://localhost:8000/healthcheck').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["bun", "run", "src/index.ts"]
