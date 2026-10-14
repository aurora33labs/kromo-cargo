# Kromo Cargo

Inventario y venta rápida para una tienda física (una sucursal, de 1 a 3 usuarios), **app + AI-first**: la pantalla de mostrador y un servidor MCP trabajan sobre la misma base. Lo que hace una persona o una IA (Claude Code, Codex, Gemini CLI, Claude Desktop) aparece en vivo en la app, queda en el historial y se puede deshacer.

Es la primera app de **Kromo**, la línea de herramientas App + IA de [Aurora33](https://aurora33.app): `packages/core` contiene lo genérico y `apps/cargo` lo específico.

## Base de datos: SQLite o Postgres

El mismo código corre en los dos motores:

| Dónde | Motor | Cómo |
|---|---|---|
| Laptop del cliente | SQLite | Por defecto, un archivo en la carpeta de datos |
| Railway, un proyecto por cliente | SQLite en un Volume, o Postgres | Postgres si existe `DATABASE_URL` |
| SaaS multi-cliente (futuro) | Postgres | `DATABASE_URL` |

- La capa está en `packages/core/src/db.ts`: interfaz `Db` asíncrona, placeholders `?` en ambos motores y transacciones exclusivas (`BEGIN IMMEDIATE` en SQLite, *advisory lock* en Postgres) para que la app y el MCP no se pisen.
- Las fechas se guardan como texto local `AAAA-MM-DD HH:MM:SS` generado en JS. **En un servidor hay que definir `TZ=America/Mexico_City`** (o la zona del negocio); si no, "ventas de hoy" se calcula en UTC.
- Respaldos: `kromo-cargo respaldo` en SQLite; con Postgres, `pg_dump` o los respaldos de Railway.

## Modo servidor (Railway)

La misma app corre como servicio web cuando existe `KROMO_URL_PUBLICA` o `RAILWAY_PUBLIC_DOMAIN`:

- Escucha en `0.0.0.0:$PORT`, acepta solo su dominio (y `/salud` para el healthcheck).
- **PIN obligatorio** (6+ dígitos). El primer dueño se crea con `KROMO_PIN_INICIAL`; sin esa variable no arranca.
- Sesiones en cookie HttpOnly guardadas en la base (sobreviven reinicios) y bloqueo de fuerza bruta por IP y global.
- **MCP remoto en `/mcp`** (Streamable HTTP, sin estado):
  - **OAuth 2.1** con PKCE y registro dinámico, para los conectores de claude.ai y ChatGPT. La autorización se da con el PIN de un dueño.
  - **Tokens de acceso** para Claude Code, Gemini CLI y otros agentes.
  - Todo se administra y revoca en *Ajustes e IA*.
- Una IA remota no puede leer archivos del servidor: solo usa lo subido a la app o manda el contenido (CSV) directamente. Los PDF y Excel generados se entregan con enlaces firmados que caducan en 1 hora.

Despliegue, variables y template: **[RAILWAY.md](RAILWAY.md)**. La imagen está en `Dockerfile` y la configuración de Railway en `railway.json`.

## Desarrollo

```sh
bun install
bun test                         # 42 pruebas con SQLite: acciones, MCP, API, concurrencia, modo servidor y OAuth
bun run db:up                    # Postgres local en Docker (puerto 55440)
bun run test:pg                  # las mismas 42 pruebas contra Postgres (una base nueva por prueba)
bun run typecheck
cd apps/cargo
bun src/cli.ts demo              # datos de demostración
bun run dev                      # UI con recarga en http://localhost:4321
bun src/cli.ts mcp               # servidor MCP por stdio
bun run build                    # ejecutable único en dist/kromo-cargo
```

Para no mezclar datos de prueba con los reales: `KROMO_DATA=/tmp/inv bun src/cli.ts …`.

Prueba end-to-end con navegador real + cliente MCP (requiere Chromium de Playwright):

```sh
bun test/e2e/flujo.ts            # CHROME_PATH=… si usas otro Chromium; SHOTS=carpeta para capturas
DATABASE_URL=postgres://…/base_vacia bun test/e2e/flujo.ts   # lo mismo sobre Postgres
bun test/e2e/remoto.ts https://<dominio> <PIN>               # verifica un despliegue en modo servidor
```

Contenedor local como en Railway:

```sh
docker build -t kromo-cargo .
docker run -p 8090:8080 -v inv:/data -e KROMO_URL_PUBLICA=http://localhost:8090 -e KROMO_PIN_INICIAL=135791 kromo-cargo
```

## Estructura

```
packages/core/src/
  actions.ts    defineAction(): nombre, descripción, input Zod, kind, roles, confirm, run, undo
  registry.ts   ejecución única: validación, permisos, confirmación en dos pasos, transacción, historial, deshacer
  mcp.ts        cada acción = una herramienta MCP (con anotaciones), más recursos e instrucciones
  http.ts       API generada desde el registro + protección CSRF / DNS rebinding
  auth.ts       sesiones, tokens de acceso, OAuth 2.1 (PKCE, registro dinámico) y limitador de intentos
  db.ts         interfaz Db para SQLite y Postgres, migraciones portables, respaldo antes de migrar
  paths.ts      carpeta de datos por sistema operativo
apps/cargo/src/
  actions/      productos, movimientos (entradas/ventas/ajustes), reportes, etiquetas, importación, negocio
  ui/           React (Bun la empaqueta y la embebe en el ejecutable)
  skill/        SKILL.md que se instala para Claude Code / Codex
  cli.ts        serve · mcp · conectar · desconectar · doctor · demo · respaldo · pin · actualizar
  config.ts     modo local / servidor (variables de entorno)
  server.ts     UI, API, sesiones, OAuth, MCP remoto y archivos firmados
  conectar.ts   registro del MCP en los 4 clientes (con respaldo de cada config)
site/           landing con "Copiar prompt" + recetas y scripts de instalación
```

### Agregar una acción

Escribe un `defineAction` en `apps/cargo/src/actions/` y regístralo en `app.ts`. Con eso ya tienes la herramienta MCP, el endpoint `POST /api/acciones/<nombre>` y la entrada en el historial. Para que se pueda deshacer, llama `ctx.setUndo(payload)` en `run` y define `undo`. Para pedir confirmación, haz que `confirm` regrese una vista previa.

Reglas del dominio: el stock es la suma de `movimientos` (nunca se edita ni se borra); para quitar un producto se archiva (`activo = 0`).

SQL portable (lo validan las pruebas en ambos motores): `CAST(COUNT(*) AS INTEGER)` en lugar de `COUNT(*)` (Postgres lo regresa como texto), `positivo(expr)` en lugar de `MAX(a, b)` escalar, fechas como parámetro con `ahora()` / `hoy()` (nunca `datetime('now')` ni `now()`), `db.insert()` para obtener el id y `{{pk}}` / `{{ahora}}` en las migraciones.

## Instalación por prompt

1. La persona copia el prompt de `site/index.html` y lo pega en su agente.
2. El agente sigue `site/install/cargo.md`: explica cada paso, ejecuta `cargo.sh` / `cargo.ps1`, que descarga el binario del release, **verifica el SHA-256**, lo instala sin sudo y corre `kromo-cargo conectar` y `kromo-cargo doctor`.

## Publicar un release

1. Sube la versión en `apps/cargo/package.json`.
2. `git tag v0.1.0 && git push --tags`. El workflow `release.yml` compila para linux x64/arm64, windows x64 y macOS x64/arm64 (firmados ad-hoc en un runner de macOS), y publica los binarios, `checksums.txt` y `version.txt`.

## Sitio

`site/` se publica en `https://kromo.aurora33.app`: la landing en `/` y la receta y los scripts en `/install/`. El prompt de la landing apunta a `https://kromo.aurora33.app/install/cargo.md`.

## Limitaciones conocidas

- El ejecutable pesa entre 70 y 95 MB, porque incluye el runtime de Bun.
- Sin firma de desarrollador de Apple ni de Windows. La descarga por `curl`/PowerShell no activa Gatekeeper ni SmartScreen, pero conviene firmar y notarizar antes de distribuir a gran escala.
- Desde una IA remota no se pueden dar de alta fotos (no tiene acceso a archivos del servidor); se suben desde la UI.
- El template de Railway se publica desde el panel de Railway (pasos en RAILWAY.md); aún no está creado.
- Los conectores de claude.ai y ChatGPT se probaron con el flujo OAuth completo de forma automatizada, pero no contra esos clientes reales: requieren una URL pública.

## Seguridad

Modelo de seguridad y cómo reportar vulnerabilidades: **[SECURITY.md](SECURITY.md)**.

## Licencia

[PolyForm Shield 1.0.0](LICENSE): puedes usar, copiar, modificar y distribuir Kromo Cargo para cualquier fin, **excepto para ofrecer un producto o servicio que compita** con Kromo Cargo o con los servicios que Aurora33 presta usándolo (por ejemplo, instalarlo y mantenerlo a terceros como servicio).

**Permiso adicional:** un negocio que usa Kromo Cargo puede contratar a cualquier persona o empresa para instalar, modificar, alojar o mantener **su propia instalación**, para su uso interno. Eso no cuenta como competir.

No es una licencia open source aprobada por la OSI: el código está a la vista y es gratis de usar, con esa única restricción.
