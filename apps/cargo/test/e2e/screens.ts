// Recorre la UI con un navegador real y guarda capturas. Uso: bun test/e2e/screens.ts <url> <carpeta>
import { chromium } from "playwright";

const [url = "http://localhost:4400", out = "."] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chromium", executablePath: process.env.CHROME_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

for (const p of ["venta", "productos", "entradas", "reportes", "etiquetas", "importar", "historial", "ajustes"]) {
  await page.goto(`${url}/#/${p}`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${p}.png` });
}
console.log(errors.length ? "ERRORES:\n" + errors.join("\n") : "Sin errores de consola");
await browser.close();
