// Verifica un despliegue en modo servidor (contenedor local o Railway).
// Uso: bun test/e2e/remoto.ts <url> <usuario> <contraseña>
// Si la app está recién desplegada (sin usuarios), primero hace el registro con esos datos.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [base = "http://localhost:8090", usuario = "", contrasena = ""] = process.argv.slice(2);
const H = { "x-kromo": "1", "content-type": "application/json" };
const check = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`✓ ${msg}`);
};
const parse = (r: any) => JSON.parse(r.content[0].text);

const salud = (await fetch(`${base}/salud`).then((r) => r.json())) as any;
check(salud.ok && salud.modo === "servidor", `salud: modo ${salud.modo}, base ${salud.base_de_datos}, versión ${salud.version}`);
check((await fetch(`${base}/api/acciones/resumen`, { method: "POST", headers: H })).status === 401, "la API sin sesión responde 401");

const info = (await fetch(`${base}/api/sesion`).then((r) => r.json())) as any;
check(typeof info.despliegue === "string", `despliegue detectado: ${info.despliegue}`);
if (info.registro) {
  const r = await fetch(`${base}/api/registro`, { method: "POST", headers: H, body: JSON.stringify({ nombre: "Dueño", usuario, contrasena }) });
  check(r.ok, `primer registro: dueño "${usuario}" creado`);
}
const login = await fetch(`${base}/api/sesion`, { method: "POST", headers: H, body: JSON.stringify({ usuario, contrasena }) });
check(login.ok, "login con usuario y contraseña de dueño");
const cookie = login.headers.getSetCookie().find((c) => c.startsWith("kromo_sesion="))!.split(";")[0]!;
const post = (name: string, body: unknown) =>
  fetch(`${base}/api/acciones/${name}`, { method: "POST", headers: { ...H, cookie }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<any>);

const { resultado: tk } = await post("crear_token_acceso", { nombre: "verificación remota" });
check(tk?.token, "token de acceso creado");

const client = new Client({ name: "verificacion", version: "1" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${tk.token}` } } }));
const { tools } = await client.listTools();
check(tools.length >= 17, `MCP remoto: ${tools.length} herramientas`);
const res = parse(await client.callTool({ name: "resumen", arguments: {} }));
check(res.ok, `resumen por MCP: ${res.resultado.productos_activos} productos, ventas de hoy ${res.resultado.ventas_hoy.importe}`);
const bajo = parse(await client.callTool({ name: "productos_stock_bajo", arguments: {} }));
check(bajo.ok, `por agotarse: ${bajo.resultado.total}`);
const et = parse(await client.callTool({ name: "generar_etiquetas", arguments: { tipo: "qr", ids: [1] } }));
if (et.ok) {
  check((await fetch(et.resultado.url)).status === 200, "PDF de etiquetas por enlace firmado");
  check((await fetch(et.resultado.url.split("?")[0])).status === 401, "el mismo PDF sin firma ni sesión responde 401");
}
const ruta = parse(await client.callTool({ name: "importar_productos", arguments: { ruta: "/etc/passwd" } }));
check(!ruta.ok && ruta.error.includes("Por seguridad"), "la IA remota no puede leer archivos del servidor");
await client.close();

const accesos = (await post("listar_accesos", {})).resultado;
await post("revocar_acceso", { id: accesos.find((a: any) => a.nombre === "verificación remota").id });
const revocado = await fetch(`${base}/mcp`, {
  method: "POST",
  headers: { authorization: `Bearer ${tk.token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});
check(revocado.status === 401, "token revocado ya no entra");
console.log(`\nDespliegue OK · cookie de sesión: ${cookie.slice(0, 18)}…`);
console.log(`COOKIE=${cookie}`);
