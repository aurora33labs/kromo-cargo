import { ActionError, backupDescargable, defineAction, type Db } from "@kromo/core";
import { basename, join } from "node:path";
import { z } from "zod";
import { establecerDominio, modo, normalizarDominio } from "../config.ts";
import { ahora, getConfig } from "../lib.ts";

export const verConfiguracion = defineAction({
  name: "ver_configuracion",
  title: "Ver configuración",
  description: "Configuración del negocio.",
  kind: "lectura",
  expose: { mcp: false },
  input: z.object({}),
  run: async (_i, { db, dataDir }) => {
    const c = await getConfig(db);
    return {
      nombre_negocio: c.nombre_negocio,
      moneda: c.moneda,
      requerir_pin: c.requerir_pin === "1",
      carpeta_datos: dataDir,
      base_de_datos: db.dialect === "postgres" ? "Postgres" : "SQLite (archivo local)",
      modo: modo.servidor ? "servidor" : "local",
      despliegue: modo.despliegue,
      url_publica: modo.urlPublica,
      url_base: modo.urlBase,
      dominio: modo.dominio ?? null,
      url_mcp: modo.urlPublica ? `${modo.urlPublica}/mcp` : null,
      pin_minimo: modo.pinMinimo,
    };
  },
});

const duenosActivos = async (db: Db, excepto?: number) =>
  Number((await db.get("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM usuarios WHERE rol = 'dueno' AND activo = 1 AND id <> ?", [excepto ?? -1]))?.n ?? 0);

export const configurarNegocio = defineAction({
  name: "configurar_negocio",
  title: "Configurar negocio",
  description: "Cambia el nombre del negocio o si la app pide iniciar sesión al entrar.",
  kind: "escritura",
  roles: ["dueno"],
  expose: { mcp: false },
  input: z.object({
    nombre_negocio: z.string().trim().min(1).max(120).optional(),
    requerir_pin: z.boolean().optional(),
  }),
  run: async (i, { db, setUndo, setResumen }) => {
    const antes = await getConfig(db);
    if (i.requerir_pin === false && modo.servidor) throw new ActionError("En el servidor iniciar sesión es obligatorio: la app está en internet.");
    if (i.requerir_pin) {
      const n = await db.get("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM usuarios WHERE rol = 'dueno' AND activo = 1 AND password_hash IS NOT NULL");
      if (!Number(n?.n)) throw new ActionError("Primero crea un usuario dueño con contraseña; si no, nadie podría entrar.");
    }
    const prev: Record<string, string> = {};
    const set = (k: string, v: string) => db.run("UPDATE configuracion SET valor = ? WHERE clave = ?", [v, k]);
    if (i.nombre_negocio !== undefined) (prev.nombre_negocio = antes.nombre_negocio!), await set("nombre_negocio", i.nombre_negocio);
    if (i.requerir_pin !== undefined) (prev.requerir_pin = antes.requerir_pin!), await set("requerir_pin", i.requerir_pin ? "1" : "0");
    setUndo(prev);
    setResumen("Actualizó la configuración del negocio");
    return getConfig(db);
  },
  undo: async (prev: Record<string, string>, { db }) => {
    for (const [k, v] of Object.entries(prev)) await db.run("UPDATE configuracion SET valor = ? WHERE clave = ?", [v, k]);
  },
});

export const listarUsuarios = defineAction({
  name: "listar_usuarios",
  title: "Listar usuarios",
  description: "Usuarios de la app.",
  kind: "lectura",
  roles: ["dueno"],
  expose: { mcp: false },
  input: z.object({}),
  run: async (_i, { db }) =>
    (await db.all("SELECT id, nombre, usuario, rol, activo, pin_hash, password_hash, creado_en FROM usuarios ORDER BY nombre")).map(
      ({ pin_hash, password_hash, ...u }) => ({ ...u, activo: !!Number(u.activo), tiene_pin: !!pin_hash, pendiente: !password_hash }),
    ),
});

/** ¿Algún otro usuario activo ya usa este PIN? Los PIN de caja deben ser únicos: identifican a quién cobra. */
async function pinEnUso(db: Db, pin: string, excepto?: number): Promise<boolean> {
  for (const u of await db.all("SELECT pin_hash FROM usuarios WHERE pin_hash <> '' AND id <> ?", [excepto ?? -1])) {
    if (await Bun.password.verify(pin, u.pin_hash)) return true;
  }
  return false;
}

export const guardarUsuario = defineAction({
  name: "guardar_usuario",
  title: "Guardar usuario",
  description: "Crea o edita un usuario (dueño o empleado): usuario y contraseña para entrar, y PIN opcional para cambiar de cajero.",
  kind: "escritura",
  roles: ["dueno"],
  expose: { mcp: false },
  input: z.object({
    id: z.number().int().optional(),
    nombre: z.string().trim().min(1).max(60),
    usuario: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._-]{3,40}$/, "El usuario debe tener de 3 a 40 letras, números, punto o guion, sin espacios")
      .optional(),
    contrasena: z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(200).optional(),
    rol: z.enum(["dueno", "empleado"]),
    pin: z.string().regex(/^\d{4,12}$/, "El PIN debe tener de 4 a 12 dígitos").optional(),
    quitar_pin: z.boolean().default(false),
    activo: z.boolean().default(true),
  }),
  run: async (i, { db, setResumen }) => {
    const otro = await db.get("SELECT id FROM usuarios WHERE LOWER(nombre) = LOWER(?) AND id <> ?", [i.nombre, i.id ?? -1]);
    if (otro) throw new ActionError(`Ya hay un usuario llamado ${i.nombre}. Usa otro nombre.`);
    if (i.usuario && (await db.get("SELECT id FROM usuarios WHERE usuario = ? AND id <> ?", [i.usuario, i.id ?? -1]))) {
      throw new ActionError(`El usuario "${i.usuario}" ya existe. Elige otro.`);
    }
    if (i.pin && (await pinEnUso(db, i.pin, i.id))) throw new ActionError("Ese PIN ya lo usa otra persona. Elige otro.");
    const password_hash = i.contrasena ? await Bun.password.hash(i.contrasena) : undefined;
    const pin_hash = i.pin ? await Bun.password.hash(i.pin) : i.quitar_pin ? "" : undefined;

    if (i.id) {
      const antes = await db.get("SELECT nombre, usuario, rol, activo, password_hash FROM usuarios WHERE id = ?", [i.id]);
      if (!antes) throw new ActionError("Ese usuario no existe.");
      const dejaDeSerDueno = antes.rol === "dueno" && Number(antes.activo) && (i.rol !== "dueno" || !i.activo);
      if (dejaDeSerDueno && (await duenosActivos(db, i.id)) === 0) {
        throw new ActionError("Debe quedar al menos un dueño activo; si no, nadie podría administrar la app.");
      }
      if (!antes.usuario && !i.usuario && password_hash) throw new ActionError("Para poner contraseña, define también el usuario.");
      const sets = ["nombre = ?", "rol = ?", "activo = ?"];
      const vals: unknown[] = [i.nombre, i.rol, i.activo ? 1 : 0];
      if (i.usuario) sets.push("usuario = ?"), vals.push(i.usuario);
      if (password_hash) sets.push("password_hash = ?"), vals.push(password_hash);
      if (pin_hash !== undefined) sets.push("pin_hash = ?"), vals.push(pin_hash);
      await db.run(`UPDATE usuarios SET ${sets.join(", ")} WHERE id = ?`, [...vals, i.id]);
      // Cualquier cambio de identidad o de acceso cierra sus sesiones abiertas.
      const cambioAcceso = password_hash || pin_hash !== undefined || antes.nombre !== i.nombre || antes.rol !== i.rol || !i.activo;
      if (cambioAcceso) await db.run("DELETE FROM sesiones WHERE usuario = ? OR usuario = ?", [antes.nombre, i.nombre]);
      setResumen(`Editó el usuario ${i.nombre}`);
      return { id: i.id };
    }
    if (!i.usuario || !password_hash) throw new ActionError("Un usuario nuevo necesita usuario y contraseña.");
    const id = await db.insert("INSERT INTO usuarios (nombre, usuario, rol, pin_hash, password_hash, creado_en) VALUES (?, ?, ?, ?, ?, ?)", [
      i.nombre,
      i.usuario,
      i.rol,
      pin_hash ?? "",
      password_hash,
      ahora(),
    ]);
    setResumen(`Creó el usuario ${i.nombre} (${i.rol})`);
    return { id };
  },
});

/** ¿El dominio ya apunta a esta app? Pide /salud por https con un tiempo límite corto. */
async function dominioResponde(dominio: string): Promise<boolean> {
  try {
    const r = await fetch(`https://${dominio}/salud`, { signal: AbortSignal.timeout(5000), redirect: "manual" });
    return r.ok && (await r.json().catch(() => null))?.ok === true;
  } catch {
    return false;
  }
}

export const configurarDominio = defineAction({
  name: "configurar_dominio",
  title: "Configurar dominio",
  description: "Guarda el dominio propio del negocio (p. ej. tienda.com). La app lo acepta y lo usa como dirección pública.",
  kind: "escritura",
  roles: ["dueno"],
  expose: { mcp: false },
  input: z.object({ dominio: z.string().max(260).nullable() }),
  run: async ({ dominio: entrada }, { db, setUndo, setResumen }) => {
    if (!modo.servidor) throw new ActionError("El dominio propio es para la app en servidor (Railway o Docker).");
    const dominio = entrada ? normalizarDominio(entrada) : null;
    if (entrada && !dominio) throw new ActionError("Escribe solo el dominio, por ejemplo tienda.com o inventario.tienda.com.");
    const antes = (await getConfig(db)).dominio ?? null;
    if (dominio) {
      await db.run("INSERT INTO configuracion (clave, valor) VALUES ('dominio', ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor", [dominio]);
    } else {
      await db.run("DELETE FROM configuracion WHERE clave = 'dominio'");
    }
    establecerDominio(dominio);
    setUndo({ antes });
    setResumen(dominio ? `Configuró el dominio ${dominio}` : "Quitó el dominio propio");
    return { dominio, url_publica: modo.urlPublica, responde: dominio ? await dominioResponde(dominio) : null };
  },
  undo: async ({ antes }: { antes: string | null }, { db }) => {
    if (antes) await db.run("INSERT INTO configuracion (clave, valor) VALUES ('dominio', ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor", [antes]);
    else await db.run("DELETE FROM configuracion WHERE clave = 'dominio'");
    establecerDominio(antes);
  },
});

export const crearRespaldo = defineAction({
  name: "crear_respaldo",
  title: "Descargar respaldo",
  description: "Crea un respaldo completo de la base de datos para descargarlo.",
  kind: "accion",
  roles: ["dueno"],
  expose: { mcp: false },
  input: z.object({}),
  run: async (_i, { db, dataDir, setResumen, urlArchivo }) => {
    const ruta = await backupDescargable(db, join(dataDir, "respaldos"));
    setResumen("Descargó un respaldo de los datos");
    return { ruta, url: urlArchivo(`/archivos/respaldos/${basename(ruta)}`), formato: ruta.endsWith(".json") ? "json" : "sqlite" };
  },
});
