// Prueba end-to-end con navegador real + un cliente MCP sobre la misma base.
// Uso: bun test/e2e/flujo.ts  (CHROME_PATH opcional, SHOTS=carpeta para capturas)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Page } from "playwright";

const cli = resolve(import.meta.dir, "../../src/cli.ts");
const data = mkdtempSync(join(tmpdir(), "inv-e2e-"));
const shots = process.env.SHOTS;
const env = { ...process.env, KROMO_DATA: data } as Record<string, string>;
const PORT = 4700;

const check = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(`✗ ${msg}`);
  console.log(`✓ ${msg}`);
};
const shot = async (page: Page, name: string) => shots && page.screenshot({ path: join(shots, `${name}.png`) });

Bun.spawnSync([process.execPath, cli, "demo"], { env });
const server = Bun.spawn([process.execPath, cli, "serve", "--no-open", "--port", String(PORT)], { env, stdout: "pipe", stderr: "pipe" });
await Bun.sleep(1500);
const base = `http://localhost:${PORT}`;
const api = (name: string, body: unknown = {}) =>
  fetch(`${base}/api/acciones/${name}`, { method: "POST", headers: { "x-kromo": "1", "content-type": "application/json" }, body: JSON.stringify(body) }).then(
    (r) => r.json() as Promise<any>,
  );

const browser = await chromium.launch({ channel: "chromium", executablePath: process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errores: string[] = [];
page.on("pageerror", (e) => errores.push(e.message));

try {
  const stockDe = async (codigo: string) => (await api("ver_producto", { codigo })).resultado.stock as number;
  const cocaAntes = await stockDe("7501055300075");
  const lecheAntes = await stockDe("7501020515343");

  // 1) Venta escaneando: Enter con código exacto y "3*código".
  await page.goto(`${base}/#/venta`);
  const buscar = page.getByLabel("Buscar producto");
  await buscar.fill("7501055300075");
  await buscar.press("Enter");
  await buscar.fill("3*7501020515343");
  await buscar.press("Enter");
  await buscar.fill("7501011101012");
  await buscar.press("Enter");
  await page.waitForSelector(".cline >> nth=2", { timeout: 8000 });
  check((await page.locator(".cline").count()) === 3, "tres escaneos seguidos, sin esperar, dan 3 líneas en el ticket");
  await page.getByPlaceholder("0.00").fill("200");
  await shot(page, "1-ticket");
  await page.getByRole("button", { name: /^Cobrar/ }).click();
  await page.waitForSelector(".toast.ok");
  const toastVenta = await page.locator(".toast.ok").innerText();
  check(/Venta #\d+/.test(toastVenta) && toastVenta.includes("cambio"), `aviso de venta con cambio: "${toastVenta.replace(/\s+/g, " ")}"`);
  check((await stockDe("7501055300075")) === cocaAntes - 1 && (await stockDe("7501020515343")) === lecheAntes - 3, "el stock bajó en la base");

  // 2) La IA registra una entrada por MCP y la pantalla se entera en vivo.
  await page.goto(`${base}/#/productos`);
  await page.waitForSelector("tbody tr");
  const mcp = new Client({ name: "claude-code", version: "e2e" });
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [cli, "mcp"], env, stderr: "ignore" }));
  const r: any = await mcp.callTool({ name: "registrar_entrada", arguments: { lineas: [{ codigo: "7501055300075", cantidad: 24, costo_unitario: 13.8 }], proveedor: "FEMSA" } });
  check(JSON.parse(r.content[0].text).ok, "la IA registró una entrada vía MCP");
  await page.waitForSelector(".toast.ia", { timeout: 6000 });
  check((await page.locator(".toast.ia").innerText()).includes("claude-code"), "la UI muestra en vivo el aviso de la IA");
  await shot(page, "2-aviso-ia");
  await mcp.close();

  // 3) Importar un CSV: vista previa + confirmación.
  const csv = join(data, "nuevos.csv");
  writeFileSync(csv, "nombre,precio,costo,stock,categoria\nTé de manzanilla 25 sobres,32,21,10,Abarrotes\nChiles en vinagre 220 g,24,15,12,Abarrotes\n");
  await page.goto(`${base}/#/importar`);
  await page.setInputFiles('input[type="file"]', csv);
  await page.waitForSelector(".modal >> text=Confirma antes de aplicar");
  await shot(page, "3-confirmacion");
  check((await page.locator(".modal").innerText()).includes("Crear"), "la vista previa muestra lo que se va a crear");
  await page.getByRole("button", { name: "Sí, aplicar" }).click();
  await page.waitForSelector("text=Resultado");
  check((await api("buscar_productos", { texto: "manzanilla" })).resultado.total === 1, "el producto importado existe");

  // 4) Historial: distingue IA y permite deshacer.
  await page.goto(`${base}/#/historial`);
  await page.waitForSelector("tbody tr");
  check((await page.locator(".badge.ia").count()) >= 1, "el historial marca la acción de la IA");
  await shot(page, "4-historial");
  const fila = page.locator("tr", { hasText: /^.*Venta #/ }).first();
  await fila.getByRole("button", { name: /Deshacer/ }).click();
  await page.waitForSelector("text=deshecho");
  check((await stockDe("7501020515343")) === lecheAntes, "deshacer la venta regresó el stock");

  // 5) Etiquetas en PDF.
  await page.goto(`${base}/#/etiquetas`);
  await page.locator("tbody tr").nth(0).click();
  await page.locator("tbody tr").nth(1).click();
  const [pdf] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: /Generar 2 etiquetas/ }).click()]);
  await pdf.waitForURL(/archivos\/etiquetas\//, { timeout: 5000 }).catch(() => {});
  check(pdf.url().includes("/archivos/etiquetas/"), `se abrió el PDF de etiquetas (${pdf.url()})`);

  check(errores.length === 0, `sin errores de JavaScript${errores.length ? ": " + errores.join(" | ") : ""}`);
  console.log("\nFlujo completo OK");
} catch (e) {
  if (shots) await page.screenshot({ path: join(shots, "error.png") });
  server.kill();
  console.error("Salida del servidor:\n" + (await new Response(server.stderr).text()) + (await new Response(server.stdout).text()));
  throw e;
} finally {
  await browser.close();
  server.kill();
}
