# Imagen de Kromo Cargo para Railway (o cualquier servidor con Docker).
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
# /data: monta aquí el Volume (SQLite, fotos, etiquetas, exportaciones).
ENV KROMO_DATA=/data \
    KROMO_MODO=servidor \
    TZ=America/Mexico_City \
    NODE_ENV=production \
    PORT=8080
VOLUME /data
EXPOSE 8080
CMD ["kromo-cargo", "serve", "--no-open"]
