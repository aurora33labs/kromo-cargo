import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Actor } from "./actions.ts";
import { CORS, SCOPE, type Auth } from "./auth.ts";
import type { Registry } from "./registry.ts";

export interface McpResourceDef {
  name: string;
  uri: string;
  description: string;
  read: () => unknown | Promise<unknown>;
}

export interface McpOptions {
  name: string;
  version: string;
  /** Instrucciones que el cliente de IA recibe al conectarse (reglas de uso). */
  instructions?: string;
  resources?: McpResourceDef[];
}

/** Crea un servidor MCP cuyas herramientas son las acciones del registro. */
export function createMcpServer(registry: Registry, opts: McpOptions): McpServer {
  const server = new McpServer({ name: opts.name, version: opts.version }, { instructions: opts.instructions });

  // Por stdio, la IA es del dueño de la computadora. Por HTTP, la identidad viene del token.
  const actor = (extra?: { authInfo?: { extra?: Record<string, unknown> } }): Actor => {
    const id = extra?.authInfo?.extra as { usuario?: string; rol?: Actor["rol"]; cliente?: string } | undefined;
    return {
      tipo: "ia",
      cliente: id?.cliente ?? server.server.getClientVersion()?.name ?? "desconocido",
      usuario: id?.usuario,
      rol: id?.rol ?? "dueno",
    };
  };

  for (const action of registry.list("mcp")) {
    const shape: Record<string, z.ZodType> = { ...action.input.shape };
    let description = action.description;
    if (action.confirm) {
      shape.token_confirmacion = z
        .string()
        .optional()
        .describe("Token devuelto por la primera llamada, solo después de que la persona apruebe la vista previa.");
      description +=
        " Puede requerir confirmación en dos pasos: la primera llamada regresa una vista previa y un token_confirmacion.";
    }
    server.registerTool(
      action.name,
      {
        title: action.title,
        description,
        inputSchema: shape,
        annotations: {
          title: action.title,
          readOnlyHint: action.kind === "lectura",
          destructiveHint: action.kind === "escritura" && !!action.confirm,
          idempotentHint: action.kind === "lectura",
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>, extra: any) => {
        const res = await registry.execute(action.name, args, actor(extra));
        return {
          content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
          isError: !res.ok,
        };
      },
    );
  }

  for (const r of opts.resources ?? []) {
    server.registerResource(r.name, r.uri, { description: r.description, mimeType: "application/json" }, async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await r.read(), null, 2) }],
    }));
  }

  return server;
}

export async function serveMcpStdio(registry: Registry, opts: McpOptions): Promise<void> {
  const server = createMcpServer(registry, opts);
  await server.connect(new StdioServerTransport());
}

/**
 * MCP remoto (Streamable HTTP, sin estado) protegido con tokens Bearer.
 * Cada petición crea un servidor ligero: no hay sesiones en memoria, así que funciona con réplicas.
 */
export function createMcpHttpHandler(registry: Registry, opts: McpOptions, auth: Auth) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const id = await auth.validarBearer(req);
    if (!id) return auth.noAutorizado();
    const server = createMcpServer(registry, opts);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const res = await transport.handleRequest(req, {
      authInfo: {
        token: id.token,
        clientId: id.clientId,
        scopes: [SCOPE],
        expiresAt: id.expira,
        extra: { usuario: id.usuario, rol: id.rol, cliente: id.cliente },
      },
    });
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  };
}
