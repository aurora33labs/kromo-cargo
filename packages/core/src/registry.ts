import { mkdirSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { z } from "zod";
import { ActionError, defineAction, type ActionDef, type Actor, type Ctx } from "./actions.ts";
import { ahora, uniqueViolationField, type Db } from "./db.ts";

export type ExecResult =
  | { ok: true; resultado: unknown; historial_id?: number }
  | {
      ok: true;
      requiere_confirmacion: true;
      mensaje: string;
      vista_previa: unknown;
      token_confirmacion: string;
    }
  | { ok: false; error: string; detalles?: unknown };

const TOKEN_TTL_MS = 10 * 60 * 1000;

export interface RegistryOptions {
  db: Db;
  dataDir: string;
  /** Si se define, las rutas de archivo de la entrada deben estar dentro de esta carpeta. */
  rutasPermitidas?: string;
  /** Convierte "/archivos/…" en la URL que se entrega (p. ej. absoluta y firmada en servidor). */
  urlArchivo?: (relativa: string) => string;
}

/**
 * Registro de acciones. Toda ejecución pasa por aquí, venga de la UI, del CLI
 * o de MCP: validación, permisos, confirmación en dos pasos, transacción e historial.
 */
export class Registry {
  readonly db: Db;
  readonly dataDir: string;
  private actions = new Map<string, ActionDef<any, any>>();
  private opts: RegistryOptions;

  constructor(opts: RegistryOptions) {
    this.db = opts.db;
    this.dataDir = opts.dataDir;
    this.opts = opts;
    this.register(historialAction, deshacerAction(this));
  }

  register(...defs: ActionDef<any, any>[]): this {
    for (const def of defs) {
      if (this.actions.has(def.name)) throw new Error(`Acción duplicada: ${def.name}`);
      this.actions.set(def.name, def);
    }
    return this;
  }

  get(name: string): ActionDef<any, any> | undefined {
    return this.actions.get(name);
  }

  list(filter?: "mcp" | "http"): ActionDef<any, any>[] {
    return [...this.actions.values()].filter((a) => !filter || a.expose?.[filter] !== false);
  }

  /** Último id del historial: sirve para que la UI detecte cambios hechos por la IA. */
  async lastChange(): Promise<{ id: number; resumen: string | null; actor_tipo: string; actor_cliente: string | null } | null> {
    return this.db.get("SELECT id, resumen, actor_tipo, actor_cliente FROM historial ORDER BY id DESC LIMIT 1");
  }

  async execute(name: string, rawInput: unknown, actor: Actor): Promise<ExecResult> {
    const action = this.actions.get(name);
    if (!action) return { ok: false, error: `No existe la acción "${name}".` };
    if (action.roles && !action.roles.includes(actor.rol)) {
      return { ok: false, error: `Tu rol (${actor.rol}) no tiene permiso para "${action.title}".` };
    }

    const raw = (rawInput ?? {}) as Record<string, unknown>;
    const { token_confirmacion, ...rest } = raw;
    const parsed = action.input.safeParse(rest);
    if (!parsed.success) {
      return { ok: false, error: "Datos inválidos: " + formatIssues(parsed.error), detalles: parsed.error.issues };
    }
    const input = parsed.data;

    let undoPayload: unknown;
    let resumen: string | undefined;
    const makeCtx = (db: Db): Ctx => ({
      db,
      actor,
      dataDir: this.dataDir,
      setUndo: (p) => (undoPayload = p),
      setResumen: (t) => (resumen = t),
      resolverRuta: (ruta) => this.resolverRuta(ruta),
      urlArchivo: (rel) => (this.opts.urlArchivo ? this.opts.urlArchivo(rel) : rel),
    });

    try {
      if (action.confirm) {
        const preview = await action.confirm(input, makeCtx(this.db));
        if (preview !== null && preview !== undefined) {
          const hash = hashInput(name, input);
          if (typeof token_confirmacion !== "string" || !(await this.consumeToken(token_confirmacion, name, hash))) {
            return {
              ok: true,
              requiere_confirmacion: true,
              mensaje:
                "Esta acción requiere confirmación. Muestra la vista previa a la persona y, si la aprueba, " +
                "vuelve a llamar con los mismos datos más token_confirmacion.",
              vista_previa: preview,
              token_confirmacion: await this.createToken(name, hash),
            };
          }
        }
      }

      if (action.kind === "lectura") {
        return { ok: true, resultado: await action.run(input, makeCtx(this.db)) };
      }

      // Las "acciones" (generar archivos, etc.) no cambian datos de negocio: corren fuera
      // de la transacción para no bloquear la base, y solo se registran en el historial.
      let resultado = action.kind === "accion" ? await action.run(input, makeCtx(this.db)) : undefined;
      const historial_id = await this.db.transaction(async (tx) => {
        if (action.kind === "escritura") resultado = await action.run(input, makeCtx(tx));
        return tx.insert(
          `INSERT INTO historial (accion, actor_tipo, actor_cliente, actor_usuario, entrada, resultado, resumen, undo, creado_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            name,
            actor.tipo,
            actor.cliente ?? null,
            actor.usuario ?? null,
            JSON.stringify(input),
            JSON.stringify(resultado ?? null),
            resumen ?? action.title,
            undoPayload === undefined || !action.undo ? null : JSON.stringify(undoPayload),
            ahora(),
          ],
        );
      });
      return { ok: true, resultado, historial_id };
    } catch (e) {
      if (e instanceof ActionError) return { ok: false, error: e.message, detalles: e.detalles };
      const campo = uniqueViolationField(e);
      if (campo) return { ok: false, error: `Ya existe un registro con ese valor de "${campo}".` };
      return { ok: false, error: `Error inesperado: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** Configura las opciones de archivos después de crear el registro (el servidor las conoce al arrancar). */
  configurarArchivos(o: Pick<RegistryOptions, "rutasPermitidas" | "urlArchivo">) {
    if (o.rutasPermitidas) mkdirSync(o.rutasPermitidas, { recursive: true });
    Object.assign(this.opts, o);
  }

  private resolverRuta(ruta: string): string {
    const raiz = this.opts.rutasPermitidas;
    if (!raiz) return ruta;
    let real: string;
    try {
      real = realpathSync(resolve(ruta));
    } catch {
      throw new ActionError(`No encuentro el archivo "${ruta}".`);
    }
    const base = realpathSync(raiz);
    if (real !== base && !real.startsWith(base + sep)) {
      throw new ActionError("Por seguridad, en el servidor solo se pueden usar archivos subidos a la app (o manda el contenido directamente).");
    }
    return real;
  }

  private async createToken(accion: string, hash: string): Promise<string> {
    const token = crypto.randomUUID().slice(0, 8);
    const now = Date.now();
    await this.db.run("DELETE FROM confirmaciones WHERE creado_en < ?", [now - TOKEN_TTL_MS]);
    await this.db.run("INSERT INTO confirmaciones (token, accion, hash, creado_en) VALUES (?, ?, ?, ?)", [token, accion, hash, now]);
    return token;
  }

  private async consumeToken(token: string, accion: string, hash: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const row = await tx.get<{ accion: string; hash: string; creado_en: number | string; usado: number }>(
        "SELECT accion, hash, creado_en, usado FROM confirmaciones WHERE token = ?",
        [token],
      );
      if (!row || Number(row.usado) || row.accion !== accion || row.hash !== hash) return false;
      if (Date.now() - Number(row.creado_en) > TOKEN_TTL_MS) return false;
      await tx.run("UPDATE confirmaciones SET usado = 1 WHERE token = ?", [token]);
      return true;
    });
  }
}

function hashInput(name: string, input: unknown): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(name + ":" + stableStringify(input));
  return hasher.digest("hex");
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (v && typeof v === "object") {
    return (
      "{" +
      Object.keys(v)
        .sort()
        .filter((k) => (v as any)[k] !== undefined)
        .map((k) => JSON.stringify(k) + ":" + stableStringify((v as any)[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(v);
}

function formatIssues(err: z.ZodError): string {
  return err.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message).join("; ");
}

// ── Acciones del núcleo ────────────────────────────────────────────────

const historialAction = defineAction({
  name: "historial",
  title: "Ver historial",
  description:
    "Lista las acciones recientes (de personas y de IAs) con su resumen. Úsalo para saber qué cambió o para obtener el id a deshacer.",
  kind: "lectura",
  input: z.object({
    limite: z.number().int().min(1).max(200).default(30).describe("Máximo de registros"),
    solo_ia: z.boolean().default(false).describe("Solo acciones hechas por una IA"),
  }),
  run: async ({ limite, solo_ia }, { db }) => {
    const rows = await db.all(
      `SELECT id, accion, actor_tipo, actor_cliente, actor_usuario, resumen, creado_en, deshecho_en,
              CASE WHEN undo IS NOT NULL THEN 1 ELSE 0 END AS se_puede_deshacer
       FROM historial ${solo_ia ? "WHERE actor_tipo = 'ia'" : ""}
       ORDER BY id DESC LIMIT ?`,
      [limite],
    );
    return rows.map((r) => ({ ...r, se_puede_deshacer: !!Number(r.se_puede_deshacer) && !r.deshecho_en }));
  },
});

function deshacerAction(registry: Registry) {
  return defineAction({
    name: "deshacer",
    title: "Deshacer acción",
    description:
      "Revierte una acción del historial por su id (p. ej. anular una venta o restaurar precios). No borra nada: registra el movimiento inverso.",
    kind: "escritura",
    roles: ["dueno"],
    input: z.object({ historial_id: z.number().int().describe("id de la acción en el historial") }),
    run: async ({ historial_id }, ctx) => {
      const row = await ctx.db.get<{ accion: string; undo: string | null; resumen: string; deshecho_en: string | null }>(
        "SELECT accion, undo, resumen, deshecho_en FROM historial WHERE id = ?",
        [historial_id],
      );
      if (!row) throw new ActionError(`No existe la acción #${historial_id} en el historial.`);
      if (row.deshecho_en) throw new ActionError(`La acción #${historial_id} ya se deshizo el ${row.deshecho_en}.`);
      const action = registry.get(row.accion);
      if (!row.undo || !action?.undo) throw new ActionError(`La acción "${row.resumen}" no se puede deshacer.`);
      await action.undo(JSON.parse(row.undo), ctx);
      const quien = ctx.actor.tipo === "ia" ? `IA (${ctx.actor.cliente ?? "desconocida"})` : ctx.actor.usuario ?? "persona";
      await ctx.db.run("UPDATE historial SET deshecho_en = ?, deshecho_por = ? WHERE id = ?", [ahora(), quien, historial_id]);
      ctx.setResumen(`Deshizo: ${row.resumen}`);
      return { deshecho: historial_id, resumen: row.resumen };
    },
  });
}
