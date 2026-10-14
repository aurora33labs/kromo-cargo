import { z } from "zod";
import type { Actor } from "./actions.ts";
import type { Registry } from "./registry.ts";

export const CSRF_HEADER = "x-kromo";

export interface ApiOptions {
  /** Resuelve el actor de la petición, o regresa una Response (p. ej. 401). */
  getActor: (req: Request) => Actor | Response | Promise<Actor | Response>;
  /** Hosts permitidos en el encabezado Host. Por defecto solo localhost. */
  allowedHosts?: string[];
}

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

/**
 * Protege la API local contra sitios web maliciosos que intenten llamar a
 * localhost desde el navegador (CSRF y DNS rebinding).
 */
export function guardRequest(req: Request, allowedHosts = LOCAL_HOSTS): Response | null {
  const url = new URL(req.url);
  const host = (req.headers.get("host") ?? url.host).replace(/:\d+$/, "");
  if (!allowedHosts.includes("*") && !allowedHosts.includes(host)) return json({ ok: false, error: "Host no permitido" }, 403);
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== (req.headers.get("host") ?? url.host)) {
    return json({ ok: false, error: "Origen no permitido" }, 403);
  }
  if (req.method !== "GET" && req.method !== "HEAD" && req.headers.get(CSRF_HEADER) !== "1") {
    return json({ ok: false, error: `Falta el encabezado ${CSRF_HEADER}` }, 403);
  }
  return null;
}

/** Rutas genéricas de la API generadas desde el registro. */
export function createApiHandler(registry: Registry, opts: ApiOptions) {
  return async (req: Request): Promise<Response | null> => {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return null;
    const blocked = guardRequest(req, opts.allowedHosts);
    if (blocked) return blocked;

    if (req.method === "GET" && url.pathname === "/api/acciones") {
      return json(
        registry.list("http").map((a) => ({
          name: a.name,
          title: a.title,
          description: a.description,
          kind: a.kind,
          roles: a.roles ?? null,
          schema: z.toJSONSchema(a.input),
        })),
      );
    }

    if (req.method === "GET" && url.pathname === "/api/cambios") {
      return json(await registry.lastChange());
    }

    const m = url.pathname.match(/^\/api\/acciones\/([a-z_]+)$/);
    if (req.method === "POST" && m) {
      const action = registry.get(m[1]!);
      if (!action || action.expose?.http === false) return json({ ok: false, error: "Acción no encontrada" }, 404);
      const actor = await opts.getActor(req);
      if (actor instanceof Response) return actor;
      let body: unknown = {};
      try {
        const text = await req.text();
        body = text ? JSON.parse(text) : {};
      } catch {
        return json({ ok: false, error: "JSON inválido" }, 400);
      }
      return json(await registry.execute(action.name, body, actor));
    }
    return null;
  };
}
