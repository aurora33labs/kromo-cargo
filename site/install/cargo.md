# Receta de instalación: Kromo Cargo

> **Para el agente de IA (Claude Code, Codex, Gemini CLI, Claude Desktop con terminal):** sigue estos pasos en orden. Antes de ejecutar cualquier comando, **explica en una frase qué hará y pide confirmación**. No uses `sudo`. Si algo falla, muestra el error y consulta la sección "Problemas comunes".

**Qué es:** una app de inventario y ventas para tienda física. Corre en la computadora de la persona (sus datos no salen de ahí) y trae un servidor MCP para que su IA la opere.

**Qué se instala y qué se toca (transparencia):**

| Qué | Dónde |
|---|---|
| Un solo ejecutable (~90 MB) | `~/.local/bin/kromo-cargo` (macOS/Linux) o `%LOCALAPPDATA%\Programs\kromo-cargo\kromo-cargo.exe` (Windows) |
| Base de datos y archivos | `~/.local/share/kromo-cargo` · `~/Library/Application Support/kromo-cargo` · `%APPDATA%\kromo-cargo` |
| Registro MCP | Claude Code (`claude mcp add --scope user`), Codex (`codex mcp add`), `~/.gemini/settings.json`, `claude_desktop_config.json`. Antes de editar un JSON se guarda un respaldo junto al original |
| Skill de uso | `~/.claude/skills/kromo-cargo/` y `~/.codex/skills/kromo-cargo/` (si esas carpetas existen) |

El código es abierto y cada release publica `checksums.txt` (SHA-256). El instalador aborta si el checksum no coincide.

---

## Paso 1 · Detectar el sistema

Detecta el sistema operativo y la arquitectura (`uname -s` y `uname -m`, o `$env:PROCESSOR_ARCHITECTURE` en Windows). Dile a la persona qué detectaste.

## Paso 2 · Descargar y verificar el instalador

**macOS / Linux.** Descarga el script a un archivo temporal, **muéstrale a la persona las primeras líneas** (o el script completo si lo pide) y ejecútalo:

```sh
curl -fsSL https://kromo.aurora33.app/install/cargo.sh -o /tmp/kromo-cargo-install.sh
sed -n '1,12p' /tmp/kromo-cargo-install.sh
sh /tmp/kromo-cargo-install.sh
```

**Windows (PowerShell):**

```powershell
Invoke-WebRequest https://kromo.aurora33.app/install/cargo.ps1 -OutFile $env:TEMP\kromo-cargo-install.ps1
Get-Content $env:TEMP\kromo-cargo-install.ps1 -TotalCount 12
powershell -ExecutionPolicy Bypass -File $env:TEMP\kromo-cargo-install.ps1
```

El script descarga el ejecutable, verifica el SHA-256, lo instala sin sudo, ejecuta `kromo-cargo conectar` (registra el MCP en los clientes de IA que encuentre) y al final `kromo-cargo doctor`.

## Paso 3 · Confirmar el diagnóstico

Lee la salida de `kromo-cargo doctor`. Todo debe salir con ✓. Si `~/.local/bin` no está en el PATH, usa la ruta completa del ejecutable en los siguientes pasos y ofrece agregarla al archivo de inicio de su shell.

## Paso 4 · Datos iniciales

Pregunta cuál prefiere:

1. **Importar su catálogo actual** (CSV o Excel): pide la ruta y, **después de reiniciar el cliente de IA** (paso 5), usa la herramienta `importar_productos`. Muestra la vista previa antes de confirmar.
2. **Probar con datos de demostración:** `kromo-cargo demo` (tiendita de abarrotes con 30 días de ventas).
3. **Empezar vacío.**

## Paso 5 · Reiniciar el cliente de IA

Los clientes de IA cargan los servidores MCP al iniciar. Pídele a la persona que **cierre y vuelva a abrir** su cliente (o que abra una sesión nueva) para ver las herramientas de `kromo-cargo`. En Claude Code puede verificarlo con `/mcp`.

## Paso 6 · Abrir la app

```sh
kromo-cargo serve
```

Abre `http://localhost:4321` en el navegador. Deja esa terminal abierta mientras se use la app.

## Paso 7 · Primera prueba

Sugiere preguntarle a la IA, en una sesión nueva: **"¿Qué se me va a acabar esta semana?"** o **"¿Cuánto vendí hoy?"**. Lo que haga la IA aparece en vivo en la app y queda en el Historial.

---

## Otras recetas

- **Actualizar:** `kromo-cargo actualizar` (verifica el checksum; luego reinicia la app y el cliente de IA).
- **Diagnosticar:** `kromo-cargo doctor`. Si un cliente sale "no conectado": `kromo-cargo conectar`.
- **Respaldo:** `kromo-cargo respaldo` (copia en la carpeta de datos, subcarpeta `respaldos`).
- **Desinstalar:** `kromo-cargo desconectar` (quita el MCP y la skill de todos los clientes) y después borra el ejecutable. **Los datos no se borran**; pregunta antes de eliminar la carpeta de datos (`kromo-cargo datos` muestra dónde está).

## Problemas comunes

| Síntoma | Solución |
|---|---|
| `command not found: kromo-cargo` | Usa `~/.local/bin/kromo-cargo` o agrega `~/.local/bin` al PATH |
| El checksum no coincide | No continúes. Reintenta la descarga; si persiste, avisa a soporte |
| La IA no ve las herramientas | Reinicia el cliente de IA. Corre `kromo-cargo doctor` y, si hace falta, `kromo-cargo conectar` |
| Claude Desktop no lo ve | Reinicia Claude Desktop por completo (también desde la bandeja del sistema) |
| El puerto 4321 está ocupado | La app usa automáticamente el siguiente libre; la URL aparece en la terminal |
| macOS bloquea el ejecutable | `xattr -d com.apple.quarantine ~/.local/bin/kromo-cargo` (solo si se descargó con un navegador) |
