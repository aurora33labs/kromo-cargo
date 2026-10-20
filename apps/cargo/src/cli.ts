#!/usr/bin/env bun
import { backupDatabase, checkDatabase, dataDir, serveMcpStdio } from "@kromo/core";
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
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
                                    Railway/Docker) arranca en modo servidor: inicio de sesión y MCP remoto en /mcp
  mcp                               Servidor MCP por stdio (lo usan Claude, Codex, Gemini)
  conectar [--solo a,b] [--dry-run] Registra el MCP en los clientes de IA detectados
                                    (claude-code, codex, gemini, claude-desktop)
  desconectar                       Quita el registro de todos los clientes
  doctor [--json]                   Diagnostica la instalación
  demo [--forzar]                   Carga datos de demostración (tiendita de abarrotes)
  respaldo                          Copia de seguridad de la base de datos
  restaurar <archivo.db>            Reemplaza los datos con un respaldo (con la app cerrada)
  contrasena <usuario> [contraseña] Restablece la contraseña de un usuario (o crea un dueño)
  pin <nombre> <pin>                Cambia el PIN de caja de un usuario
  actualizar [--forzar]             Descarga e instala la última versión
  datos                             Muestra la carpeta de datos
  salud                             Revisa que la app en marcha responda (healthcheck de Docker)
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
        const sinUsuarios = !(await app.db.get("SELECT id FROM usuarios LIMIT 1"));
        if (sinUsuarios) console.log(`→ Abre ${url} y crea la cuenta del dueño (usuario y contraseña).`);
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

    case "restaurar": {
      const archivo = args[1];
      if (!archivo || !existsSync(archivo)) throw new Error("Uso: kromo-cargo restaurar <archivo.db>  (un respaldo de Kromo Cargo)");
      if (process.env.DATABASE_URL) throw new Error("Con Postgres restaura con las herramientas de tu proveedor (Railway → Backups o pg_restore).");
      const info = join(dir, "servidor.json");
      if (existsSync(info)) {
        const pid = Number(JSON.parse(readFileSync(info, "utf8")).pid);
        let vivo = false;
        try {
          vivo = !!pid && pid !== process.pid && process.kill(pid, 0);
        } catch {}
        if (vivo) throw new Error("La app está abierta. Ciérrala (o detén el contenedor) y vuelve a intentar.");
      }
      // Que sea de verdad una base de Kromo Cargo antes de tocar nada.
      const { Database } = await import("bun:sqlite");
      try {
        const prueba = new Database(archivo, { readonly: true });
        prueba.query("SELECT version FROM migraciones WHERE modulo = 'cargo'").get();
        prueba.close();
      } catch {
        throw new Error("Ese archivo no es un respaldo de Kromo Cargo (.db).");
      }
      const destino = join(dir, "cargo.db");
      if (existsSync(destino)) {
        const app = await createApp(dir);
        try {
          console.log(`✓ Respaldo de los datos actuales: ${backupDatabase(app.db, join(dir, "respaldos"), "antes-de-restaurar")}`);
        } finally {
          await app.db.close();
        }
      }
      for (const extra of ["-wal", "-shm"]) if (existsSync(destino + extra)) rmSync(destino + extra);
      copyFileSync(archivo, destino);
      console.log(`✓ Datos restaurados desde ${archivo}. Abre la app de nuevo.`);
      return;
    }

    case "contrasena":
    case "contraseña": {
      // Recuperación desde la consola del servidor (docker exec -it … / railway ssh).
      const usuario = args[1]?.trim().toLowerCase();
      const clave = args[2] ?? prompt("Nueva contraseña (8+ caracteres):") ?? "";
      if (!usuario || !/^[a-z0-9._-]{3,40}$/.test(usuario) || clave.length < 8) {
        throw new Error("Uso: kromo-cargo contrasena <usuario> [contraseña]  (usuario: 3-40 letras, números, . _ -; contraseña: 8+ caracteres)");
      }
      const app = await createApp(dir);
      try {
        const hash = await Bun.password.hash(clave);
        const u = await app.db.get("SELECT id, nombre FROM usuarios WHERE usuario = ? OR (usuario IS NULL AND LOWER(nombre) = ?)", [usuario, usuario]);
        if (u) {
          await app.db.run("UPDATE usuarios SET usuario = ?, password_hash = ?, activo = 1 WHERE id = ?", [usuario, hash, u.id]);
          await app.db.run("DELETE FROM sesiones WHERE usuario = ?", [u.nombre]);
        } else {
          await app.db.run("INSERT INTO usuarios (nombre, usuario, rol, pin_hash, password_hash, creado_en) VALUES (?, ?, 'dueno', '', ?, ?)", [usuario, usuario, hash, ahora()]);
        }
        console.log(u ? `✓ Contraseña de ${usuario} restablecida (se cerraron sus sesiones).` : `✓ Dueño ${usuario} creado.`);
      } finally {
        await app.db.close();
      }
      return;
    }

    case "pin": {
      // PIN de caja (para cambiar de cajero en un equipo donde ya se entró con contraseña).
      const [nombre, pin] = [args[1], args[2]];
      if (!nombre || !pin || !/^\d{4,12}$/.test(pin)) throw new Error("Uso: kromo-cargo pin <nombre> <pin>  (PIN de 4 a 12 dígitos)");
      const app = await createApp(dir);
      try {
        const u = await app.db.get("SELECT id, nombre FROM usuarios WHERE LOWER(nombre) = LOWER(?) OR usuario = LOWER(?)", [nombre, nombre]);
        if (!u) throw new Error(`No existe el usuario ${nombre}.`);
        await app.db.run("UPDATE usuarios SET pin_hash = ? WHERE id = ?", [await Bun.password.hash(pin), u.id]);
        await app.db.run("DELETE FROM sesiones WHERE usuario = ?", [u.nombre]);
        console.log(`✓ PIN de caja de ${u.nombre} cambiado.`);
      } finally {
        await app.db.close();
      }
      return;
    }

    case "actualizar":
      console.log(await actualizar({ forzar: flag("forzar") }));
      return;

    case "salud": {
      const port = Number(opt("port") ?? process.env.PORT ?? 4321);
      const r = await fetch(`http://127.0.0.1:${port}/salud`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
      if (!r?.ok) {
        console.error(`✗ La app no responde en el puerto ${port}`);
        process.exit(1);
      }
      console.log("✓ ok");
      return;
    }

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
