# Kromo Cargo en Railway

Un proyecto de Railway por negocio. La app y el MCP remoto quedan en `https://<dominio>/` y `https://<dominio>/mcp`. Se entra con usuario y contraseña, y Claude (web, escritorio y celular) y ChatGPT se conectan por OAuth.

**Sin variables obligatorias.** La primera persona que abre la dirección ve **"Crea tu cuenta"** y queda como dueña: usuario, contraseña y, si quiere, un PIN de caja.

## Desplegar en un toque (template)

Con el template publicado, el botón **Deploy on Railway** crea el servicio, el Volume y el dominio. Al terminar:

1. Abre el dominio que generó Railway.
2. Crea tu cuenta.
3. Ve a **Ajustes → Conectar IA**.

La URL del template va en `site/index.html` y en el README cuando exista; hasta entonces ahí queda un marcador.

### Crear el template (una sola vez)

En Railway: *Workspace → Templates → New Template*.

- **Servicio:** GitHub repo `aurora33labs/kromo-cargo`. Railway detecta `railway.json` y construye el `Dockerfile`.
- **Volume:** montado en **`/data`**. Ahí viven la base SQLite, las fotos, las etiquetas y los respaldos. Sin Volume, todo se pierde en cada deploy.
- **Networking:** *Generate Domain* (puerto 8080).
- **Variables:** ninguna requerida. Opcionales:

  | Variable | Valor | Para qué |
  |---|---|---|
  | `TZ` | `America/Mexico_City` | Zona horaria del negocio (ya viene así en la imagen) |
  | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Postgres en lugar de SQLite |
  | `KROMO_DESPLIEGUE` | `gestionado` | Instalaciones que Aurora33 administra para un cliente: oculta Ko-fi y la promoción |
  | `KROMO_SECRETO` | 64 caracteres aleatorios | Firma de enlaces de descarga; si falta se genera y se guarda en la base |
  | `KROMO_PIN_INICIAL` | 6+ caracteres | Despliegues automatizados: crea al dueño `dueno` con esa contraseña y se salta el registro |

Publica el template y copia su URL (`https://railway.com/deploy/...`) al botón.

## Despliegue manual

1. **New Project → Deploy from GitHub repo →** `aurora33labs/kromo-cargo`.
2. **Settings → Volumes → New Volume**, montado en `/data`.
3. **Networking → Generate Domain.**
4. Abre el dominio y crea la cuenta del dueño.

El healthcheck es `/salud`. Con Volume, el servicio debe tener **1 réplica**.

## Dominio propio

Se configura desde la app: **Ajustes → Dominio**, con los pasos para Railway (Custom Domain, registros CNAME y TXT). Al guardar el dominio, la app lo acepta de inmediato y lo usa como dirección pública (OAuth, cookies seguras, enlaces). No hace falta tocar variables. El dominio `*.up.railway.app` sigue funcionando.

## Conectar las IAs

- **Claude (claude.ai, escritorio, celular):** *Configuración → Conectores → Agregar conector personalizado*, pega `https://<dominio>/mcp`. Se abre la página de la tienda: usuario y contraseña de dueño → *Permitir*.
- **ChatGPT:** *Configuración → Apps y conectores → Modo desarrollador → Crear*, misma URL, autenticación OAuth.
- **Claude Code, Gemini CLI y otros:** crea un token en *Ajustes → Conectar IA → Otros agentes* y usa el comando que aparece ahí (encabezado `Authorization: Bearer …`).

Todo lo que hace cada IA queda en el Historial con su nombre. Los accesos se desconectan desde *Ajustes → Conectar IA*.

## Verificar un despliegue

```sh
cd apps/cargo
bun test/e2e/remoto.ts https://<dominio> <usuario> <contraseña>
```

Si la app está recién desplegada, primero hace el registro con esos datos. Después revisa:
- salud y tipo de despliegue;
- que la API sin sesión no responda;
- login, token y MCP remoto;
- que la IA no pueda leer archivos del servidor;
- la revocación de tokens.

## Operación

- **Actualizar:** push a `main` o redeploy. Las migraciones corren solas al arrancar; con SQLite se respalda la base antes de migrar (`/data/respaldos`).
- **Respaldos:** el dueño los descarga en **Ajustes → Negocio → Descargar respaldo** (SQLite: archivo `.db`; Postgres: JSON). También sirven los respaldos del Volume o del plugin de Postgres en Railway.
- **Diagnóstico:** `kromo-cargo doctor` en la consola del servicio (`railway ssh`).
- **Olvidaron la contraseña:** `railway ssh`, luego `kromo-cargo contrasena <usuario>`. La restablece y cierra sus sesiones; si el usuario no existe, lo crea como dueño.
