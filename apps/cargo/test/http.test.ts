import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { App } from "../src/app.ts";
import { leerModo } from "../src/config.ts";
import { startServer } from "../src/server.ts";
import { testApp } from "./helpers.ts";

let base: string;
let stop: () => void;
let app: App;
let cleanup: () => Promise<void>;
const H = { "x-kromo": "1", "content-type": "application/json" };

beforeAll(async () => {
  ({ app, cleanup } = await testApp());
  const { server, url } = await startServer(app, { port: 4600, open: false, modo: leerModo({}) });
  base = url;
  stop = () => server.stop(true);
});
afterAll(async () => {
  stop();
  await cleanup();
});

const post = (name: string, body: unknown, headers: Record<string, string> = H) =>
  fetch(`${base}/api/acciones/${name}`, { method: "POST", headers, body: JSON.stringify(body) }).then((r) => r.json() as Promise<any>);

describe("API local", () => {
  test("sirve la UI", async () => {
    const html = await fetch(base).then((r) => r.text());
    expect(html).toContain('<div id="root">');
  });

  test("ejecuta acciones y registra al actor humano", async () => {
    const r = await post("crear_producto", { nombre: "Pan", precio: 5, stock_inicial: 3 });
    expect(r.ok).toBe(true);
    const h = await app.db.get("SELECT actor_tipo, actor_cliente FROM historial ORDER BY id DESC LIMIT 1");
    expect(h).toEqual({ actor_tipo: "humano", actor_cliente: "ui" });
  });

  test("bloquea CSRF: sin encabezado, con otro origen o con otro Host", async () => {
    expect((await post("crear_producto", { nombre: "X", precio: 1 }, { "content-type": "text/plain" })).ok).toBe(false);
    expect((await post("crear_producto", { nombre: "X", precio: 1 }, { ...H, origin: "https://malo.com" })).ok).toBe(false);
    const r = await fetch(`${base}/api/cambios`, { headers: { host: "malo.com" } });
    expect(r.status).toBe(403);
  });

  test("con PIN activo exige sesión y aplica el rol", async () => {
    await post("guardar_usuario", { nombre: "Lupe", rol: "dueno", pin: "1234" });
    await post("guardar_usuario", { nombre: "Beto", rol: "empleado", pin: "5555" });
    await post("configurar_negocio", { requerir_pin: true });
    const sin = await fetch(`${base}/api/acciones/resumen`, { method: "POST", headers: H });
    expect(sin.status).toBe(401);
    const mal = await fetch(`${base}/api/sesion`, { method: "POST", headers: H, body: JSON.stringify({ pin: "0000" }) });
    expect(mal.status).toBe(401);
    const login = await fetch(`${base}/api/sesion`, { method: "POST", headers: H, body: JSON.stringify({ pin: "5555" }) });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    const auth = { ...H, cookie };
    expect((await post("resumen", {}, auth)).ok).toBe(true);
    const r = await post("configurar_negocio", { requerir_pin: false }, auth);
    expect(r.error).toContain("rol");
    const l2 = await fetch(`${base}/api/sesion`, { method: "POST", headers: H, body: JSON.stringify({ pin: "1234" }) });
    const c2 = l2.headers.get("set-cookie")!.split(";")[0]!;
    expect((await post("configurar_negocio", { requerir_pin: false }, { ...H, cookie: c2 })).ok).toBe(true);
  });

  test("subida de archivos solo acepta tipos permitidos", async () => {
    const fd = new FormData();
    fd.append("archivo", new File(["hola"], "malo.sh"));
    const r = await fetch(`${base}/api/subir`, { method: "POST", headers: { "x-kromo": "1" }, body: fd }).then((r) => r.json() as Promise<any>);
    expect(r.ok).toBe(false);
    const fd2 = new FormData();
    fd2.append("archivo", new File(["nombre,precio\nTé,10\n"], "lista.csv"));
    const r2 = await fetch(`${base}/api/subir`, { method: "POST", headers: { "x-kromo": "1" }, body: fd2 }).then((r) => r.json() as Promise<any>);
    expect(r2.ok).toBe(true);
  });

  test("sirve archivos generados sin permitir salir de su carpeta", async () => {
    const r = await post("generar_etiquetas", { tipo: "qr" });
    const pdf = await fetch(base + r.resultado.url);
    expect(pdf.headers.get("content-type")).toContain("pdf");
    writeFileSync(join(app.dataDir, "secreto.txt"), "x");
    const esc = await fetch(`${base}/archivos/etiquetas/..%2Fsecreto.txt`);
    expect(esc.status).toBe(404);
  });
});
