import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "@kromo/core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mcpOptions } from "../src/app.ts";
import { freshDatabase, testApp } from "./helpers.ts";

const parse = (r: any) => JSON.parse(r.content[0].text);

const limpiar: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of limpiar.splice(0)) await f();
});

async function connect() {
  const { app, cleanup } = await testApp();
  limpiar.push(cleanup);
  const server = createMcpServer(app.registry, mcpOptions(app));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "claude-code", version: "test" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { app, client };
}

describe("servidor MCP", () => {
  test("expone herramientas con anotaciones e instrucciones, sin las de solo-UI", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("registrar_venta");
    expect(names).toContain("deshacer");
    expect(names).not.toContain("guardar_usuario");
    const buscar = tools.find((t) => t.name === "buscar_productos")!;
    expect(buscar.annotations?.readOnlyHint).toBe(true);
    const masivo = tools.find((t) => t.name === "actualizar_precios_masivo")!;
    expect(masivo.annotations?.destructiveHint).toBe(true);
    expect(Object.keys(masivo.inputSchema.properties ?? {})).toContain("token_confirmacion");
    expect(client.getInstructions()).toContain("token_confirmacion");
  });

  test("flujo de IA: crear, vender, confirmar en dos pasos y registrar el cliente", async () => {
    const { client, app } = await connect();
    const p = parse(await client.callTool({ name: "crear_producto", arguments: { nombre: "Agua 1 L", precio: 12, categoria: "Bebidas", stock_inicial: 10 } }));
    expect(p.ok).toBe(true);
    const v = parse(await client.callTool({ name: "registrar_venta", arguments: { lineas: [{ producto_id: p.resultado.id, cantidad: 2 }] } }));
    expect(v.resultado.total).toBe(24);

    const paso1 = parse(await client.callTool({ name: "actualizar_precios_masivo", arguments: { categoria: "Bebidas", porcentaje: 10 } }));
    expect(paso1.requiere_confirmacion).toBe(true);
    const paso2 = parse(
      await client.callTool({ name: "actualizar_precios_masivo", arguments: { categoria: "Bebidas", porcentaje: 10, token_confirmacion: paso1.token_confirmacion } }),
    );
    expect(paso2.resultado.cambios[0].despues).toBe(13.2);

    const h = await app.db.get("SELECT actor_tipo, actor_cliente FROM historial ORDER BY id DESC LIMIT 1");
    expect(h).toEqual({ actor_tipo: "ia", actor_cliente: "claude-code" });
  });

  test("los errores llegan como isError con mensaje claro", async () => {
    const { client } = await connect();
    const r: any = await client.callTool({ name: "registrar_venta", arguments: { lineas: [{ producto_id: 999, cantidad: 1 }] } });
    expect(r.isError).toBe(true);
    expect(parse(r).error).toContain("No existe el producto");
  });

  test("recurso cargo://resumen", async () => {
    const { client } = await connect();
    const res = await client.readResource({ uri: "cargo://resumen" });
    const data = JSON.parse((res.contents[0] as any).text);
    expect(data).toHaveProperty("ventas_hoy");
  });

  test("el CLI sirve MCP por stdio (como lo lanzan Claude, Codex y Gemini)", async () => {
    const { url, drop } = await freshDatabase();
    limpiar.push(drop);
    const env: Record<string, string> = { ...(process.env as Record<string, string>), KROMO_DATA: mkdtempSync(join(tmpdir(), "inv-stdio-")) };
    if (url !== ":memory:") env.DATABASE_URL = url;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve(import.meta.dir, "../src/cli.ts"), "mcp"],
      env,
      stderr: "ignore",
    });
    const client = new Client({ name: "codex", version: "test" });
    await client.connect(transport);
    const r = parse(await client.callTool({ name: "resumen", arguments: {} }));
    expect(r.ok).toBe(true);
    expect(r.resultado.productos_activos).toBe(0);
    await client.close();
  }, 20000);
});
