#!/usr/bin/env bun
import { backupDatabase, checkDatabase, dataDir, serveMcpStdio } from "@kromo/core";
import { accessSync, constants, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { leerServidor } from "./actions/reportes.ts";
import { APP, VERSION, createApp, mcpOptions } from "./app.ts";
import { modo } from "./config.ts";
import { conectar, desconectar, detectarClientes, type ClienteId } from "./conectar.ts";
import { cargarDemo } from "./demo.ts";
import { ahora } from "./lib.ts";
import { actualizar } from "./release.ts";
import { isCompiled, startServer } from "./server.ts";

const AYUDA = `Kromo Cargo ${VERSION} — inventario y venta rápida para tienda física, operado por personas y por IA.

Uso: kromo-cargo <comando> [opciones]

  serve [--port 4321] [--no-open]   Abre la app en el navegador. Con KROMO_URL_PUBLICA (o en
                                    Railway) arranca en modo servidor: PIN obligatorio y MCP remoto en /mcp
  mcp                               Servidor MCP por stdio (lo usan Claude, Codex, Gemini)
  conectar [--solo a,b] [--dry-run] Registra el MCP en los clientes de IA detectados
                                    (claude-code, codex, gemini, claude-desktop)
  desconectar                       Quita el registro de todos los clientes
  doctor [--json]                   Diagnostica la instalación
  demo [--forzar]                   Carga datos de demostración (tiendita de abarrotes)
  respaldo                          Copia de seguridad de la base de datos
  pin <nombre> <pin>                Restablece el PIN de un usuario (o crea un dueño)
  actualizar [--forzar]             Descarga e instala la última versión
  datos                             Muestra la carpeta de datos
  version                           Muestra la versión

Licencia: PolyForm Shield 1.0.0 con un permiso adicional (https://polyformproject.org/licenses/shield/1.0.0)
Required Notice: Copyright (c) 2026 Aurora33 Labs (https://aurora33.app)
`;

const args = process.argv.slice(2);
const cmd = args[0] ?? "ayuda";
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const dir = dataDir(APP, "KROMO_DATA");
const ok = (b: boolean) => (b ? "✓" : "✗");

async function main() {
  switch (cmd) {
    case "serve": {
      const app = await createApp(dir);
      const port = Number(opt("port") ?? process.env.PORT ?? 4321);
      const { url } = await startServer(app, { port, open: !flag("no-open"), modo });
      if (modo.servidor) {
        console.log(`Kromo Cargo en modo servidor: ${url}  (escuchando en 0.0.0.0:${port})`);
        console.log(`MCP remoto: ${url}/mcp  ·  base de datos: ${app.db.dialect}  ·  zona horaria: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
      } else console.log(`Kromo Cargo abierto en ${url}  (Ctrl+C para cerrar)`);
      return;
    }

    case "mcp": {
      const app = await createApp(dir);
      await serveMcpStdio(app.registry, mcpOptions(app));
      console.error(`[kromo-cargo] MCP listo (datos: ${dir})`);
      return;
    }

    case "conectar": {
      const solo = opt("solo")?.split(",").map((s) => s.trim()) as ClienteId[] | undefined;
      const res = conectar({ solo, dryRun: flag("dry-run") });
      if (!res.length) {
        console.log("No encontré clientes de IA (Claude Code, Codex CLI, Gemini CLI ni Claude Desktop).");
        process.exitCode = 1;
      }
      for (const r of res) console.log(`${ok(r.ok)} ${r.cliente}: ${r.mensaje}`);
      return;
    }

    case "desconectar": {
      const res = desconectar();
      if (!res.length) console.log("No había nada conectado.");
      for (const r of res) console.log(`${ok(r.ok)} ${r.cliente}: ${r.mensaje}`);
      return;
    }

    case "doctor":
      return await doctor();

    case "demo": {
      const app = await createApp(dir);
      try {
        const r = await cargarDemo(app.db, { forzar: flag("forzar") });
        console.log(`✓ Datos de demostración cargados: ${r.productos} productos y ${r.ventas} ventas de los últimos 30 días.`);
      } finally {
        await app.db.close();
      }
      return;
    }

    case "respaldo": {
      const app = await createApp(dir);
      try {
        console.log(`✓ Respaldo creado: ${backupDatabase(app.db, join(dir, "respaldos"))}`);
      } finally {
        await app.db.close();
      }
      return;
    }

    case "pin": {
      // Restablece (o crea como dueño) el PIN de un usuario. Pensado para la consola del servidor.
      const [nombre, pin] = [args[1], args[2]];
      if (!nombre || !pin || !/^\d{4,12}$/.test(pin) || pin.length < modo.pinMinimo) {
        throw new Error(`Uso: kromo-cargo pin <nombre> <pin>  (PIN de ${modo.pinMinimo} a 12 dígitos)`);
      }
      const app = await createApp(dir);
      try {
        const hash = await Bun.password.hash(pin);
        const u = await app.db.get("SELECT id FROM usuarios WHERE nombre = ?", [nombre]);
        if (u) await app.db.run("UPDATE usuarios SET pin_hash = ?, activo = 1 WHERE id = ?", [hash, u.id]);
        else await app.db.run("INSERT INTO usuarios (nombre, rol, pin_hash, creado_en) VALUES (?, 'dueno', ?, ?)", [nombre, hash, ahora()]);
        await app.db.run("DELETE FROM sesiones WHERE usuario = ?", [nombre]);
        console.log(u ? `✓ PIN de ${nombre} restablecido (se cerraron sus sesiones).` : `✓ Dueño ${nombre} creado.`);
      } finally {
        await app.db.close();
      }
      return;
    }

    case "actualizar":
      console.log(await actualizar({ forzar: flag("forzar") }));
      return;

    case "datos":
      console.log(dir);
      return;

    case "version":
    case "--version":
    case "-v":
      console.log(VERSION);
      return;

    default:
      console.log(AYUDA);
  }
}

async function doctor() {
  const checks: { nombre: string; ok: boolean; detalle: string }[] = [];
  checks.push({ nombre: "Versión", ok: true, detalle: `${VERSION} (${isCompiled ? process.execPath : "modo desarrollo"})` });
  checks.push({
    nombre: "Modo",
    ok: true,
    detalle: modo.servidor ? `servidor · ${modo.urlPublica ?? "sin URL pública"} · TZ ${Intl.DateTimeFormat().resolvedOptions().timeZone}` : "local",
  });

  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    checks.push({ nombre: "Carpeta de datos", ok: true, detalle: dir });
  } catch (e) {
    checks.push({ nombre: "Carpeta de datos", ok: false, detalle: `${dir} no se puede escribir: ${(e as Error).message}` });
  }

  try {
    const app = await createApp(dir);
    const integridad = await checkDatabase(app.db);
    const productos = Number((await app.db.get("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM productos WHERE activo = 1"))?.n);
    const ventas = Number((await app.db.get("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM ventas WHERE anulada = 0"))?.n);
    const motor = app.db.dialect === "postgres" ? "Postgres (DATABASE_URL)" : "SQLite";
    checks.push({
      nombre: "Base de datos",
      ok: integridad === "ok",
      detalle: `${motor} · ${productos} productos, ${ventas} ventas · integridad: ${integridad}`,
    });
    checks.push({ nombre: "Herramientas MCP", ok: true, detalle: `${app.registry.list("mcp").length} disponibles` });
    await app.db.close();
  } catch (e) {
    checks.push({ nombre: "Base de datos", ok: false, detalle: (e as Error).message });
  }

  const srv = leerServidor(dir);
  checks.push({ nombre: "App", ok: true, detalle: srv ? `abierta en ${srv.url}` : "cerrada (ábrela con: kromo-cargo serve)" });

  const clientes = detectarClientes();
  for (const c of clientes.filter((c) => c.detectado)) {
    checks.push({ nombre: c.nombre, ok: c.conectado, detalle: c.conectado ? "conectado" : "detectado pero no conectado (corre: kromo-cargo conectar)" });
  }
  if (!clientes.some((c) => c.detectado)) {
    checks.push({ nombre: "Clientes de IA", ok: false, detalle: "No encontré Claude Code, Codex CLI, Gemini CLI ni Claude Desktop" });
  }
  const skill = [join(process.env.HOME ?? "", ".claude", "skills", APP, "SKILL.md")].some(existsSync);
  checks.push({ nombre: "Skill (Claude Code)", ok: skill, detalle: skill ? "instalada" : "no instalada (se instala con: kromo-cargo conectar)" });

  if (flag("json")) {
    console.log(JSON.stringify({ ok: checks.every((c) => c.ok), checks }, null, 2));
  } else {
    console.log(`Kromo Cargo — diagnóstico\n`);
    for (const c of checks) console.log(`${ok(c.ok)} ${c.nombre.padEnd(20)} ${c.detalle}`);
    const fallas = checks.filter((c) => !c.ok).length;
    console.log(fallas ? `\n${fallas} punto(s) por revisar.` : "\nTodo en orden.");
  }
  if (checks.some((c) => !c.ok && (c.nombre === "Base de datos" || c.nombre === "Carpeta de datos"))) process.exitCode = 1;
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
