# Kromo Cargo en Railway

Un proyecto de Railway por negocio. La app y el MCP remoto quedan en `https://<dominio>/` y `https://<dominio>/mcp`, con PIN obligatorio y OAuth para conectar Claude (web, escritorio y celular) y ChatGPT.

## Despliegue manual (primer cliente)

1. **New Project → Deploy from GitHub repo →** `aurora33labs/kromo-cargo`. Railway detecta `railway.json` y construye el `Dockerfile`.
2. **Volume:** en el servicio, *Settings → Volumes → New Volume*, montado en **`/data`**. Ahí viven la base SQLite, las fotos, las etiquetas y las exportaciones. Sin Volume, todo se pierde en cada deploy.
3. **Variables:**

   | Variable | Valor | Para qué |
   |---|---|---|
   | `KROMO_PIN_INICIAL` | 6 a 12 dígitos | PIN del primer dueño. Solo se usa si no hay usuarios |
   | `KROMO_DUENO` | p. ej. `Lupe` | Nombre de ese dueño (opcional) |
   | `TZ` | `America/Mexico_City` | Zona horaria del negocio (ya viene así en la imagen) |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | **Opcional.** Solo si quieres Postgres en lugar de SQLite |
   | `KROMO_SECRETO` | 64 caracteres aleatorios | **Opcional.** Firma de enlaces de descarga; si falta se genera y se guarda en la base |

4. **Networking → Generate Domain.** Railway define `RAILWAY_PUBLIC_DOMAIN` y la app la usa como URL pública. Para un dominio propio, define además `KROMO_URL_PUBLICA=https://cargo.minegocio.mx`.
5. Abre el dominio, entra con el PIN y ve a **Ajustes e IA** para conectar las IAs.

El healthcheck es `/salud`. Con Volume, el servicio debe tener **1 réplica**.

## Conectar las IAs

- **Claude (claude.ai, escritorio, celular):** *Configuración → Conectores → Agregar conector personalizado*, pega `https://<dominio>/mcp`. Se abre la página de la tienda: PIN de dueño → *Permitir*.
- **ChatGPT:** *Configuración → Apps y conectores → Modo desarrollador → Crear*, misma URL, autenticación OAuth.
- **Claude Code / Gemini CLI / otros:** crea un token en *Ajustes e IA* y usa el comando que aparece ahí (encabezado `Authorization: Bearer …`).

Todo lo que hace cada IA queda en el Historial con su nombre, y los accesos se revocan desde *Ajustes e IA*.

## Crear el template (botón "Deploy on Railway")

En Railway: *Workspace → Templates → New Template*, a partir del proyecto anterior. Configura:

- Servicio desde el repo `aurora33labs/kromo-cargo`, con Volume en `/data`.
- Variables: `KROMO_PIN_INICIAL` como **requerida** (descripción: "PIN de 6 a 12 dígitos para el dueño"), `KROMO_DUENO` opcional y `TZ=America/Mexico_City`.
- Dominio público generado.

Publica el template y agrega el botón a la landing (`site/index.html`) y al README.

## Verificar un despliegue

```sh
cd apps/cargo
bun test/e2e/remoto.ts https://<dominio> <PIN>
```

Revisa: salud, PIN obligatorio, token, MCP remoto (19 herramientas), enlaces firmados, que la IA no pueda leer archivos del servidor y la revocación de tokens.

## Operación (servicio gestionado)

- **Actualizar:** push a `main` (o redeploy). Las migraciones corren solas al arrancar; en SQLite se respalda la base antes de migrar (`/data/respaldos`).
- **Respaldos:** con SQLite, `kromo-cargo respaldo` desde la consola del servicio, o respaldos del Volume en Railway. Con Postgres, los respaldos del plugin de Postgres.
- **Diagnóstico:** `kromo-cargo doctor` en la consola del servicio.
- **Olvidaron el PIN:** en la consola del servicio, `kromo-cargo pin <nombre> <nuevo-pin>`. Restablece el PIN y cierra sus sesiones; si el usuario no existe, lo crea como dueño.
