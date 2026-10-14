import { afterAll, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../src/app.ts";
import { MOTOR, freshDatabase } from "./helpers.ts";

const limpiar: (() => Promise<void>)[] = [];
afterAll(async () => {
  for (const f of limpiar) await f();
});

test(`dos procesos vendiendo a la vez nunca venden más del stock (${MOTOR})`, async () => {
  const dir = mkdtempSync(join(tmpdir(), "inv-conc-"));
  const fresh = await freshDatabase();
  const url = fresh.url === ":memory:" ? join(dir, "cargo.db") : fresh.url;
  const app = await createApp(dir, url);
  limpiar.push(async () => {
    await app.db.close();
    await fresh.drop();
  });
  const p = (await app.registry.execute("crear_producto", { nombre: "Último lote", precio: 10, stock_inicial: 5 }, { tipo: "humano", rol: "dueno" })) as any;

  // Como la app (UI) y el MCP: dos procesos distintos sobre la misma base.
  const script = resolve(import.meta.dir, "fixtures/vender.ts");
  const procesos = ["ui", "codex"].map((cliente) =>
    Bun.spawn([process.execPath, script, dir, url, String(p.resultado.id), "6", cliente], { stdout: "pipe", stderr: "inherit" }),
  );
  const salidas = await Promise.all(procesos.map(async (proc) => JSON.parse(await new Response(proc.stdout).text()) as string[]));
  const todos = salidas.flat();
  expect(todos.filter((r) => r === "ok").length).toBe(5);
  expect(todos.filter((r) => r.includes("Stock insuficiente")).length).toBe(7);
  const final = (await app.registry.execute("ver_producto", { producto_id: p.resultado.id }, { tipo: "humano", rol: "dueno" })) as any;
  expect(final.resultado.stock).toBe(0);
}, 30000);
