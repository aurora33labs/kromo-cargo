import { z } from "zod";
import type { Db } from "./db.ts";

export type Rol = "dueno" | "empleado";

/** Quién ejecuta una acción: una persona desde la UI o una IA desde MCP. */
export interface Actor {
  tipo: "humano" | "ia";
  /** Cliente de IA (p. ej. "claude-code", "codex") o "ui". */
  cliente?: string;
  usuario?: string;
  rol: Rol;
}

export type Kind = "lectura" | "escritura" | "accion";

export interface Ctx {
  /** Base de datos; dentro de una escritura ya es la transacción en curso. */
  db: Db;
  actor: Actor;
  /** Directorio de datos de la app (fotos, exportaciones, etc.). */
  dataDir: string;
  /** Guarda lo necesario para deshacer esta acción desde el historial. */
  setUndo(payload: unknown): void;
  /** Texto corto para el historial: "Venta #12 por $45.00". */
  setResumen(texto: string): void;
  /**
   * Valida una ruta de archivo que viene en la entrada. En modo servidor solo se permiten
   * archivos dentro de la carpeta de subidas (evita que una IA remota lea archivos del servidor).
   */
  resolverRuta(ruta: string): string;
  /** URL para descargar un archivo generado (relativa en local; absoluta y firmada en servidor). */
  urlArchivo(relativa: string): string;
}

export interface ActionDef<S extends z.ZodObject = z.ZodObject, R = unknown> {
  name: string;
  title: string;
  description: string;
  input: S;
  kind: Kind;
  /** Roles permitidos. Si se omite, cualquiera. */
  roles?: Rol[];
  /** Dónde se expone. Por defecto en ambos. */
  expose?: { mcp?: boolean; http?: boolean };
  /**
   * Si regresa algo distinto de null/undefined, la acción requiere confirmación:
   * lo regresado es la vista previa que se muestra antes de ejecutar.
   */
  confirm?: (input: z.output<S>, ctx: Ctx) => unknown | Promise<unknown>;
  run: (input: z.output<S>, ctx: Ctx) => R | Promise<R>;
  /** Revierte la acción a partir del payload guardado con ctx.setUndo. */
  undo?: (payload: any, ctx: Ctx) => void | Promise<void>;
}

export function defineAction<S extends z.ZodObject, R>(def: ActionDef<S, R>): ActionDef<S, R> {
  return def;
}

/** Error esperado (validación de negocio). Su mensaje se muestra tal cual al usuario o a la IA. */
export class ActionError extends Error {
  constructor(message: string, public detalles?: unknown) {
    super(message);
    this.name = "ActionError";
  }
}
