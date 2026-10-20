import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { App } from "../src/app.ts";
import { detectarDespliegue, establecerModo, leerModo, normalizarDominio, type Modo } from "../src/config.ts";
import { Limitador } from "@kromo/core";
import { startServer } from "../src/server.ts";
import { MOTOR, testApp } from "./helpers.ts";

const PORT = 4650;
const BASE = `http://localhost:${PORT}`;
const CLAVE = "lupe-secreta-1";
const PIN = "246810";
const modo: Modo = { servidor: true, urlPublica: BASE, urlBase: BASE, hosts: ["localhost", "127.0.0.1"], pinMinimo: 4, despliegue: "railway" };
const H = { "x-kromo": "1", "content-type": "application/json" };

let app: App;
let cleanup: () => Promise<void>;
let stop: () => void;
let cookie: string;

const parse = (r: any) => JSON.parse(r.content[0].text);
const post = (name: string, body: unknown, headers: Record<string, string> = { ...H, cookie }) =>
  fetch(`${BASE}/api/acciones/${name}`, { method: "POST", headers, body: JSON.stringify(body) }).then((r) => r.json() as Promise<any>);

const entrar = (usuario: string, contrasena: string, extra: Record<string, string> = {}) =>
  fetch(`${BASE}/api/sesion`, { method: "POST", headers: { ...H, ...extra }, body: JSON.stringify({ usuario, contrasena }) });
const galleta = (r: Response, nombre: string) => r.headers.getSetCookie().find((c) => c.startsWith(`${nombre}=`))!.split(";")[0]!;

async function mcpCon(token: string, nombre = "prueba") {
  const client = new Client({ name: nombre, version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}

beforeAll(async () => {
  ({ app, cleanup } = await testApp());
  // Sin variables: arranca y espera el primer registro desde la UI.
  delete process.env.KROMO_PIN_INICIAL;
  const { server } = await startServer(app, { port: PORT, open: false, modo });
  stop = () => server.stop(true);
  const info = (await fetch(`${BASE}/api/sesion`).then((r) => r.json())) as any;
  expect(info).toMatchObject({ registro: true, requiere_pin: true, despliegue: "railway", usuario: null });
  // Dos registros al mismo tiempo: solo uno crea al dueño.
  const datos = { negocio: "Abarrotes Lupe", nombre: "Lupe", usuario: "lupe", contrasena: CLAVE, pin: PIN };
  const registro = () => fetch(`${BASE}/api/registro`, { method: "POST", headers: H, body: JSON.stringify(datos) });
  const rs = await Promise.all([registro(), registro()]);
  expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(Number((await app.db.get("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM usuarios"))!.n)).toBe(1);
  cookie = galleta(rs.find((r) => r.status === 200)!, "kromo_sesion");
});
afterAll(async () => {
  stop();
  await cleanup();
  establecerModo(leerModo({})); // las demás pruebas corren en modo local
});

describe(`modo servidor (${MOTOR})`, () => {
  test("salud responde sin sesión y con cualquier Host (healthcheck de Railway)", async () => {
    const r = await fetch(`${BASE}/salud`, { headers: { host: "healthcheck.railway.app" } });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).modo).toBe("servidor");
  });

  test("la API exige sesión aunque no se haya activado el PIN, y la cookie es segura", async () => {
    const sin = await fetch(`${BASE}/api/acciones/resumen`, { method: "POST", headers: H });
    expect(sin.status).toBe(401);
    expect((await post("resumen", {})).ok).toBe(true);
    const info = (await fetch(`${BASE}/api/sesion`, { headers: { cookie } }).then((r) => r.json())) as any;
    expect(info).toMatchObject({ negocio: "Abarrotes Lupe", registro: false, usuario: { nombre: "Lupe", rol: "dueno", pendiente: false } });
    expect((await post("configurar_negocio", { requerir_pin: false })).error).toContain("obligatorio");
    expect((await fetch(`${BASE}/api/registro`, { method: "POST", headers: H, body: JSON.stringify({ nombre: "X", usuario: "otro", contrasena: "12345678" }) })).status).toBe(409);
  });

  test("las sesiones se guardan en la base (sobreviven reinicios) y se cierran", async () => {
    const l = await entrar("lupe", CLAVE);
    const c = galleta(l, "kromo_sesion");
    const n = await app.db.get("SELECT CAST(COUNT(*) AS INTEGER) AS n FROM sesiones");
    expect(Number(n.n)).toBeGreaterThanOrEqual(2);
    await fetch(`${BASE}/api/sesion`, { method: "DELETE", headers: { ...H, cookie: c } });
    const r = await fetch(`${BASE}/api/acciones/resumen`, { method: "POST", headers: { ...H, cookie: c } });
    expect(r.status).toBe(401);
  });

  test("rechaza hosts desconocidos", async () => {
    const r = await fetch(`${BASE}/api/cambios`, { headers: { host: "otro-dominio.com", cookie } });
    expect(r.status).toBe(403);
  });

  test("bloquea la fuerza bruta de la contraseña por IP", async () => {
    const intento = () => entrar("lupe", "no-es-esta", { "x-forwarded-for": "203.0.113.7" });
    for (let i = 0; i < 5; i++) expect((await intento()).status).toBe(401);
    expect((await intento()).status).toBe(429);
    // Inventar una IP al inicio de X-Forwarded-For no sirve para saltarse el bloqueo.
    expect((await entrar("lupe", CLAVE, { "x-forwarded-for": "1.1.1.1, 203.0.113.7" })).status).toBe(429);
  }, 20000);

  test("PIN de caja: solo en un equipo donde ya se entró con contraseña, y los PIN no se repiten", async () => {
    const pinCon = (headers: Record<string, string>) => fetch(`${BASE}/api/sesion/pin`, { method: "POST", headers: { ...H, ...headers }, body: JSON.stringify({ pin: PIN }) });
    expect((await pinCon({})).status).toBe(403);
    const l = await entrar("lupe", CLAVE, { "x-forwarded-for": "192.0.2.10" });
    const equipo = galleta(l, "kromo_equipo");
    const r = await pinCon({ cookie: equipo, "x-forwarded-for": "192.0.2.10" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).usuario.nombre).toBe("Lupe");
    expect((await fetch(`${BASE}/api/sesion`, { headers: { cookie: equipo } }).then((x) => x.json()) as any).equipo).toBe(true);
    const dup = await post("guardar_usuario", { nombre: "Beto", usuario: "beto", contrasena: "beto-12345", rol: "empleado", pin: PIN });
    expect(dup.error).toContain("ya lo usa");
    // Olvidar el equipo: ya no se entra con PIN desde ahí.
    await fetch(`${BASE}/api/sesion?olvidar=1`, { method: "DELETE", headers: { ...H, cookie: equipo } });
    expect((await pinCon({ cookie: equipo, "x-forwarded-for": "192.0.2.10" })).status).toBe(403);
  });

  test("usuarios: debe quedar un dueño activo; cambiar el acceso cierra sus sesiones", async () => {
    const lista = (await post("listar_usuarios", {})).resultado;
    const lupe = lista.find((u: any) => u.nombre === "Lupe");
    expect(lupe).toMatchObject({ usuario: "lupe", tiene_pin: true, pendiente: false });
    expect((await post("guardar_usuario", { id: lupe.id, nombre: "Lupe", rol: "empleado" })).error).toContain("al menos un dueño");
    expect((await post("guardar_usuario", { id: lupe.id, nombre: "Lupe", rol: "dueno", activo: false })).error).toContain("al menos un dueño");
    const nuevo = await post("guardar_usuario", { nombre: "Ana", usuario: "ana", contrasena: "ana-12345", rol: "empleado" });
    const ca = galleta(await entrar("ana", "ana-12345"), "kromo_sesion");
    expect((await post("resumen", {}, { ...H, cookie: ca })).ok).toBe(true);
    await post("guardar_usuario", { id: nuevo.resultado.id, nombre: "Ana", rol: "empleado", contrasena: "ana-nueva-1" });
    expect((await fetch(`${BASE}/api/acciones/resumen`, { method: "POST", headers: { ...H, cookie: ca } })).status).toBe(401);
    expect((await entrar("ana", "ana-nueva-1")).status).toBe(200);
  });

  test("un usuario de la versión anterior (solo PIN) entra con nombre y PIN y define su usuario", async () => {
    await app.db.run("INSERT INTO usuarios (nombre, rol, pin_hash, creado_en) VALUES ('Doña Mari', 'empleado', ?, '2026-01-01 00:00:00')", [await Bun.password.hash("135790")]);
    const l = await entrar("doñamari", "135790"); // la UI quita los espacios del usuario
    expect(l.status).toBe(200);
    const c = galleta(l, "kromo_sesion");
    const info = (await fetch(`${BASE}/api/sesion`, { headers: { cookie: c } }).then((r) => r.json())) as any;
    expect(info.usuario.pendiente).toBe(true);
    const cuenta = await fetch(`${BASE}/api/cuenta`, { method: "POST", headers: { ...H, cookie: c }, body: JSON.stringify({ usuario: "mari", contrasena: "mari-12345" }) });
    expect(cuenta.status).toBe(200);
    expect((await entrar("doña mari", "135790")).status).toBe(401);
    expect((await entrar("mari", "mari-12345")).status).toBe(200);
  });

  test("dominio propio: se acepta como host, cambia la URL pública y se puede quitar", async () => {
    expect(normalizarDominio("https://Tienda.Example.com/")).toBe("tienda.example.com");
    expect(normalizarDominio("no es dominio")).toBeNull();
    expect((await post("configurar_dominio", { dominio: "localhost:8080" })).error).toContain("Escribe solo el dominio");
    const r = await post("configurar_dominio", { dominio: "tienda.invalid" });
    expect(r.resultado).toMatchObject({ dominio: "tienda.invalid", url_publica: "https://tienda.invalid", responde: false });
    expect((await fetch(`${BASE}/api/cambios`, { headers: { host: "tienda.invalid", cookie } })).status).toBe(200);
    const meta = (await fetch(`${BASE}/.well-known/oauth-protected-resource`).then((x) => x.json())) as any;
    expect(meta.authorization_servers).toEqual(["https://tienda.invalid"]);
    expect((await post("ver_configuracion", {})).resultado).toMatchObject({ dominio: "tienda.invalid", url_base: BASE });
    await post("configurar_dominio", { dominio: null });
    expect((await fetch(`${BASE}/api/cambios`, { headers: { host: "otro.invalid", cookie } })).status).toBe(403);
    const meta2 = (await fetch(`${BASE}/.well-known/oauth-protected-resource`).then((x) => x.json())) as any;
    expect(meta2.authorization_servers).toEqual([BASE]);
  }, 20000);

  test("respaldo descargable y exportaciones a CSV", async () => {
    const r = await post("crear_respaldo", {});
    expect(r.ok).toBe(true);
    const descarga = await fetch(r.resultado.url);
    expect(descarga.status).toBe(200);
    expect(descarga.headers.get("content-disposition")).toContain("attachment");
    expect((await descarga.arrayBuffer()).byteLength).toBeGreaterThan(100);
    // Sin firma, un empleado no puede bajar respaldos.
    const cb = galleta(await entrar("ana", "ana-nueva-1"), "kromo_sesion");
    expect((await fetch(r.resultado.url.split("?")[0], { headers: { cookie: cb } })).status).toBe(403);

    const v = await post("exportar_ventas", {});
    expect(v.ok).toBe(true);
    const csv = await fetch(v.resultado.url).then((x) => x.text());
    expect(csv).toContain("venta,fecha,metodo_pago,sku,producto");
    const h = await post("exportar_historial", {});
    expect(await fetch(h.resultado.url).then((x) => x.text())).toContain("actor_tipo");
  });

  test("MCP sin token responde 401 con la ubicación del servidor de autorización", async () => {
    const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource"`);
  });

  test("token de acceso: la IA opera por MCP remoto, queda en el historial y se puede revocar", async () => {
    const { resultado } = await post("crear_token_acceso", { nombre: "Claude Code de Lupe" });
    expect(resultado.token).toStartWith("krt_");
    const client = await mcpCon(resultado.token);
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(10);
    const p = parse(await client.callTool({ name: "crear_producto", arguments: { nombre: "Café 250 g", precio: 95, stock_inicial: 4 } }));
    expect(p.ok).toBe(true);
    const h = await app.db.get("SELECT actor_tipo, actor_cliente, actor_usuario FROM historial ORDER BY id DESC LIMIT 1");
    expect(h).toEqual({ actor_tipo: "ia", actor_cliente: "Claude Code de Lupe", actor_usuario: "Lupe" });
    await client.close();

    const accesos = (await post("listar_accesos", {})).resultado;
    const id = accesos.find((a: any) => a.nombre === "Claude Code de Lupe").id;
    await post("revocar_acceso", { id });
    const r = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${resultado.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(r.status).toBe(401);
  });

  test("OAuth 2.1 completo: registro, PIN, código con PKCE, token, MCP y refresh con rotación", async () => {
    const meta = (await fetch(`${BASE}/.well-known/oauth-protected-resource`).then((r) => r.json())) as any;
    expect(meta.authorization_servers).toEqual([BASE]);
    const as = (await fetch(`${BASE}/.well-known/oauth-authorization-server`).then((r) => r.json())) as any;
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);

    const redirect = "https://claude.ai/api/mcp/auth_callback";
    const reg = (await fetch(as.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirect] }),
    }).then((r) => r.json())) as any;
    expect(reg.client_id).toStartWith("cli_");
    const malo = await fetch(as.registration_endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://evil.com/cb"] }) });
    expect(malo.status).toBe(400);

    const verifier = "v".repeat(20) + crypto.randomUUID();
    const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: reg.client_id,
      redirect_uri: redirect,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
    });
    const pagina = await fetch(`${as.authorization_endpoint}?${params}`);
    expect(pagina.status).toBe(200);
    const html = await pagina.text();
    expect(html).toContain("Conectar Claude");
    expect(html).toContain("<b>claude.ai</b>");
    expect(html).not.toContain("no es Claude ni ChatGPT");
    expect(pagina.headers.get("x-frame-options")).toBe("DENY");
    const otraRedir = await fetch(`${as.authorization_endpoint}?${new URLSearchParams({ ...Object.fromEntries(params), redirect_uri: "https://evil.com/cb" })}`);
    expect(otraRedir.status).toBe(400);

    expect(html).toContain('autocomplete="username"');
    const enviar = (contrasena: string) =>
      fetch(as.authorization_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "198.51.100.20" },
        body: new URLSearchParams({ ...Object.fromEntries(params), usuario: "lupe", contrasena, accion: "permitir" }),
        redirect: "manual",
      });
    expect((await enviar("incorrecta")).status).toBe(401);
    const ok = await enviar(CLAVE);
    expect(ok.status).toBe(302);
    const destino = new URL(ok.headers.get("location")!);
    expect(destino.origin + destino.pathname).toBe(redirect);
    expect(destino.searchParams.get("state")).toBe("xyz");
    const code = destino.searchParams.get("code")!;

    const token = (body: Record<string, string>) =>
      fetch(as.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) });
    const base = { grant_type: "authorization_code", code, redirect_uri: redirect, client_id: reg.client_id };
    expect((await token({ ...base, code_verifier: "incorrecto" })).status).toBe(400);
    const t = (await (await token({ ...base, code_verifier: verifier })).json()) as any;
    expect(t.token_type).toBe("Bearer");
    expect((await token({ ...base, code_verifier: verifier })).status).toBe(400); // el código es de un solo uso

    const client = await mcpCon(t.access_token);
    const r = parse(await client.callTool({ name: "resumen", arguments: {} }));
    expect(r.ok).toBe(true);
    await client.close();

    const r2 = (await (await token({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: reg.client_id })).json()) as any;
    expect(r2.access_token).not.toBe(t.access_token);
    expect((await token({ grant_type: "refresh_token", refresh_token: t.refresh_token })).status).toBe(400); // rotado
    const c2 = await mcpCon(r2.access_token);
    expect(parse(await c2.callTool({ name: "resumen", arguments: {} })).ok).toBe(true);
    await c2.close();

    const accesos = (await post("listar_accesos", {})).resultado.filter((a: any) => a.tipo === "oauth");
    expect(accesos.map((a: any) => a.nombre)).toEqual(["Claude"]);
  });

  test("OAuth: un cliente que se hace llamar \"Claude\" pero regresa a otro dominio muestra el destino real y una advertencia", async () => {
    const redirect = "https://claude-ai.example.net/cb";
    const reg = (await fetch(`${BASE}/oauth/registro`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [redirect] }),
    }).then((r) => r.json())) as any;
    const params = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: redirect, code_challenge: "x".repeat(43), code_challenge_method: "S256" });
    const html = await fetch(`${BASE}/oauth/autorizar?${params}`).then((r) => r.text());
    expect(html).toContain("<b>claude-ai.example.net</b>");
    expect(html).toContain("claude-ai.example.net no es Claude ni ChatGPT");
  });

  test("cabeceras de seguridad en la UI, la API y el MCP", async () => {
    const ui = await fetch(`${BASE}/`);
    expect(ui.status).toBe(200);
    expect(await ui.text()).toContain('<div id="root">');
    expect(ui.headers.get("content-type")).toStartWith("text/html");
    expect(ui.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(ui.headers.get("content-security-policy")).toContain("script-src 'self'");
    for (const r of [
      ui,
      await fetch(`${BASE}/api/acciones/resumen`, { method: "POST", headers: { ...H, cookie } }),
      await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
    ]) {
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("referrer-policy")).toBe("no-referrer");
      expect(r.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  test("una IA remota no puede leer archivos del servidor; sí puede importar mandando el contenido", async () => {
    const { resultado } = await post("crear_token_acceso", { nombre: "ChatGPT" });
    const client = await mcpCon(resultado.token);
    const leer = parse(await client.callTool({ name: "importar_productos", arguments: { ruta: "/etc/passwd" } }));
    expect(leer.ok).toBe(false);
    expect(leer.error).toContain("Por seguridad");
    const foto = parse(await client.callTool({ name: "crear_producto", arguments: { nombre: "X", precio: 1, foto_path: "/etc/hosts" } }));
    expect(foto.error).toContain("Por seguridad");

    const contenido = "nombre,precio,stock\nTé verde,30,6\nGalletas,18,10\n";
    const paso1 = parse(await client.callTool({ name: "importar_productos", arguments: { contenido } }));
    expect(paso1.vista_previa.crear).toBe(2);
    const paso2 = parse(await client.callTool({ name: "importar_productos", arguments: { contenido, token_confirmacion: paso1.token_confirmacion } }));
    expect(paso2.resultado.creados).toBe(2);

    // Archivos generados: enlace absoluto y firmado que funciona sin sesión; alterado o sin firma, no.
    const et = parse(await client.callTool({ name: "generar_etiquetas", arguments: { tipo: "qr" } }));
    expect(et.resultado.url).toStartWith(`${BASE}/archivos/etiquetas/`);
    expect(et.resultado.url).toContain("?f=");
    const pdf = await fetch(et.resultado.url);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await fetch(et.resultado.url.replace(/.$/, (c: string) => (c === "0" ? "1" : "0")))).status).toBe(401);
    expect((await fetch(et.resultado.url.split("?")[0])).status).toBe(401);
    expect((await fetch(et.resultado.url.split("?")[0], { headers: { cookie } })).status).toBe(200);
    await client.close();
  });
});

describe("tipo de despliegue", () => {
  test("se detecta por variables o se fuerza con KROMO_DESPLIEGUE", () => {
    expect(detectarDespliegue({ RAILWAY_ENVIRONMENT: "production" }, false)).toBe("railway");
    expect(detectarDespliegue({}, true)).toBe("docker");
    expect(detectarDespliegue({ KROMO_EN_DOCKER: "1" }, false)).toBe("docker");
    expect(detectarDespliegue({}, false)).toBe("local");
    expect(detectarDespliegue({ KROMO_DESPLIEGUE: "gestionado", RAILWAY_ENVIRONMENT: "x" }, false)).toBe("gestionado");
    expect(leerModo({ KROMO_MODO: "servidor", KROMO_EN_DOCKER: "1" }, false)).toMatchObject({ servidor: true, despliegue: "docker" });
  });

  test("KROMO_PIN_INICIAL (opcional) crea un dueño \"dueno\" con esa contraseña", async () => {
    const { app: otra, cleanup: limpiar } = await testApp();
    try {
      const { prepararServidor, verificarCredenciales } = await import("../src/server.ts");
      await prepararServidor(otra, { ...modo }, { KROMO_PIN_INICIAL: "13579246", KROMO_DUENO: "Rosa" });
      expect(await verificarCredenciales(otra, "dueno", "13579246")).toMatchObject({ usuario: "Rosa", rol: "dueno" });
    } finally {
      await limpiar();
    }
  });
});

describe("limitador de intentos", () => {
  test("un ataque desde muchas IP bloquea a las desconocidas pero no deja fuera a quien ya entró", () => {
    const l = new Limitador();
    l.exito("10.0.0.1");
    for (let i = 0; i < 20; i++) l.fallo(`198.51.100.${i}`);
    expect(l.bloqueado("203.0.113.50")).toBe(true);
    expect(l.bloqueado("10.0.0.1")).toBe(false);
    for (let i = 0; i < 5; i++) l.fallo("10.0.0.1");
    expect(l.bloqueado("10.0.0.1")).toBe(true);
  });
});
