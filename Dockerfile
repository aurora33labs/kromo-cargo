# Imagen de Kromo Cargo para Railway, Docker en tu computadora o cualquier servidor.
# Compila un solo ejecutable y lo corre en una imagen mínima.

FROM oven/bun:1.4.3 AS build
WORKDIR /src
COPY package.json bun.lock ./
COPY packages/core/package.json packages/core/
COPY apps/cargo/package.json apps/cargo/
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY packages packages
COPY apps/cargo apps/cargo
RUN cd apps/cargo && bun build src/cli.ts --compile --minify --outfile /out/kromo-cargo

FROM debian:bookworm-slim
# tzdata: la hora local del negocio (TZ) define "ventas de hoy".
RUN apt-get update && apt-get install -y --no-install-recommends tzdata ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/kromo-cargo /usr/local/bin/kromo-cargo
# /data: monta aquí el Volume (SQLite, fotos, etiquetas, respaldos). Sin instrucción VOLUME: Railway la rechaza.
# Corre como root a propósito: los Volumes de Railway se montan como root y un usuario sin privilegios no podría escribir.
# Sin variables obligatorias: el dueño crea su cuenta en la UI la primera vez que se abre.
ENV KROMO_DATA=/data \
    KROMO_MODO=servidor \
    KROMO_EN_DOCKER=1 \
    TZ=America/Mexico_City \
    NODE_ENV=production \
    PORT=8080
EXPOSE 8080
# Railway usa el healthcheck de railway.json; Docker usa este.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["kromo-cargo", "salud"]
CMD ["kromo-cargo", "serve", "--no-open"]
