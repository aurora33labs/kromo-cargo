import { ActionError, defineAction } from "@kromo/core";
import { z } from "zod";
import { modo } from "../config.ts";
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
      url_publica: modo.urlPublica,
      url_mcp: modo.urlPublica ? `${modo.urlPublica}/mcp` : null,
      pin_minimo: modo.pinMinimo,
    };
  },
});

export const configurarNegocio = defineAction({
  name: "configurar_negocio",
  title: "Configurar negocio",
  description: "Cambia el nombre del negocio o si la app pide PIN al entrar.",
  kind: "escritura",
  roles: ["dueno"],
  expose: { mcp: false },
  input: z.object({
    nombre_negocio: z.string().trim().min(1).max(120).optional(),
    requerir_pin: z.boolean().optional(),
  }),
  run: async (i, { db, setUndo, setResumen }) => {
    const antes = await getConfig(db);
    if (i.requerir_pin === false && modo.servidor) throw new ActionError("En el servidor el PIN es obligatorio: la app está en internet.");
    if (i.requerir_pin) {
      const duenos = await db.get("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM usuarios WHERE rol = 'dueno' AND activo = 1");
      if (!Number(duenos?.n)) throw new ActionError("Primero crea un usuario dueño con PIN; si no, nadie podría entrar.");
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
    (await db.all("SELECT id, nombre, rol, activo, creado_en FROM usuarios ORDER BY nombre")).map((u) => ({ ...u, activo: !!Number(u.activo) })),
});

export const guardarUsuario = defineAction({
  name: "guardar_usuario",
  title: "Guardar usuario",
  description: "Crea o edita un usuario (dueño o empleado) con PIN numérico (4+ dígitos; 6+ en servidor).",
  kind: "escritura",
  roles: ["dueno"],
  expose: { mcp: false },
  input: z.object({
    id: z.number().int().optional(),
    nombre: z.string().trim().min(1).max(60),
    rol: z.enum(["dueno", "empleado"]),
    pin: z.string().regex(/^\d{4,12}$/, "El PIN debe tener de 4 a 12 dígitos").optional(),
    activo: z.boolean().default(true),
  }),
  run: async (i, { db, setResumen }) => {
    if (i.pin && i.pin.length < modo.pinMinimo) throw new ActionError(`El PIN debe tener al menos ${modo.pinMinimo} dígitos.`);
    const pin_hash = i.pin ? await Bun.password.hash(i.pin) : undefined;
    if (i.id) {
      await db.run(`UPDATE usuarios SET nombre = ?, rol = ?, activo = ?${pin_hash ? ", pin_hash = ?" : ""} WHERE id = ?`, [
        i.nombre,
        i.rol,
        i.activo ? 1 : 0,
        ...(pin_hash ? [pin_hash] : []),
        i.id,
      ]);
      setResumen(`Editó el usuario ${i.nombre}`);
      return { id: i.id };
    }
    if (!pin_hash) throw new ActionError("Un usuario nuevo necesita PIN.");
    const id = await db.insert("INSERT INTO usuarios (nombre, rol, pin_hash, creado_en) VALUES (?, ?, ?, ?)", [i.nombre, i.rol, pin_hash, ahora()]);
    setResumen(`Creó el usuario ${i.nombre} (${i.rol})`);
    return { id };
  },
});
