# Imagen de producción: Bun + código + fixtures. Sin dependencias nativas.
FROM oven/bun:1-slim AS base
WORKDIR /app
ENV NODE_ENV=production

COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile || bun install --production

COPY agent ./agent
COPY src ./src
COPY public ./public
COPY fixtures ./fixtures
COPY demo.ts tsconfig.json ./

# Verificación en build: si las reglas o los fixtures se rompen, la imagen no se construye.
RUN bun demo.ts > /dev/null && rm -rf output

RUN mkdir -p /app/output && chown -R bun:bun /app/output
USER bun
EXPOSE 3000
ENV PORT=3000
HEALTHCHECK --interval=30s --timeout=3s CMD bun -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "src/server.ts"]
