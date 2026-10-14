import { z } from "zod";

// Mensajes de validación en español para la UI y para la IA.
z.config(z.locales.es());

export * from "./actions.ts";
export * from "./auth.ts";
export * from "./db.ts";
export * from "./http.ts";
export * from "./mcp.ts";
export * from "./paths.ts";
export * from "./registry.ts";
